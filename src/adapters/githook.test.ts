import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  GROVE_BEGIN,
  GROVE_END,
  resolveHooksDir,
  buildHookBlock,
  installPostCommit,
  uninstallPostCommit,
} from './githook'

// ---------------------------------------------------------------------------
// Helpers — fresh temp git repo per scenario (ADR-0004 chain-safety tests)
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-githook-'))
}

function rmRf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@grove.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Grove Test"', { cwd: dir, stdio: 'pipe' })
}

/** A fake grove invocation so tests never need a real grove binary. */
const FAKE_INVOCATION = 'echo GROVE_RAN'

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Count non-overlapping occurrences of needle in haystack. */
function countOf(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

// ---------------------------------------------------------------------------
// buildHookBlock — pure string assembly
// ---------------------------------------------------------------------------

describe('buildHookBlock', () => {
  it('wraps the invocation in sentinel markers with a fail-open commit-hook call', () => {
    const block = buildHookBlock(FAKE_INVOCATION, '/some/repo')
    expect(block).toContain(GROVE_BEGIN)
    expect(block).toContain(GROVE_END)
    expect(block).toContain(FAKE_INVOCATION)
    // commit-hook subcommand + repo path (now single-quote-escaped, not "...")
    expect(block).toContain('commit-hook')
    expect(block).toContain("--repo '/some/repo'")
    // fail-open guarantee: a Grove failure must never block the commit
    expect(block).toContain('|| true')
    // sentinel ordering: BEGIN must come before END
    expect(block.indexOf(GROVE_BEGIN)).toBeLessThan(block.indexOf(GROVE_END))
  })

  // ---- shell-injection hardening (P0) --------------------------------------
  it('single-quote-escapes a repoDir containing quotes and $() — no RCE', () => {
    // A repoDir an attacker (or an unlucky path) could control. Interpolated
    // naively into a "..." shell line this is RCE on every commit.
    const evil = `/tmp/a'; touch HACKED; echo '$(touch PWNED)`
    const block = buildHookBlock(FAKE_INVOCATION, evil)

    // The dangerous substrings must NOT appear in a form the shell would honor:
    // the single quote that would break out must be escaped as '\'' , and the
    // whole value lives inside single quotes so $() is inert.
    expect(block).toContain("'\\''") // the '->'\'' escape is present
    // No raw `--repo "<evil>"` double-quoted interpolation (the old vuln shape)
    expect(block).not.toContain(`--repo "${evil}"`)

    // The ONLY rigorous proof is behavioral: round-trip through /bin/sh and
    // confirm the shell parses our --repo token back to EXACTLY the evil string
    // (a single literal argument, with $() NOT executed). The dangerous bytes may
    // appear verbatim inside the SAFE single-quoted token — that's expected; what
    // matters is the shell never honors them as structure.
    const repoIdx = block.indexOf('--repo ')
    const repoTokenLine = block.slice(repoIdx).split('\n')[0]!
    // Extract just the quoted token between `--repo ` and ` 2>/dev/null`.
    const quoted = repoTokenLine.replace(/^--repo /, '').replace(/ 2>\/dev\/null.*$/, '')
    const seen = execSync(`printf %s ${quoted}`, { shell: '/bin/sh' }).toString()
    expect(seen).toBe(evil)
  })

  it('a repoDir with only a double quote is escaped, not left raw', () => {
    const block = buildHookBlock(FAKE_INVOCATION, '/tmp/a"b')
    // single-quoting makes the embedded double-quote harmless and literal
    expect(block).toContain(`--repo '/tmp/a"b'`)
  })
})

// ---------------------------------------------------------------------------
// resolveHooksDir — honor core.hooksPath (husky/lefthook), else .git/hooks
// ---------------------------------------------------------------------------

describe('resolveHooksDir', () => {
  let tmp: string
  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('defaults to .git/hooks when core.hooksPath is unset', () => {
    tmp = mkTmp()
    gitInit(tmp)
    const dir = resolveHooksDir(tmp)
    expect(dir).toBe(path.join(tmp, '.git', 'hooks'))
  })

  it('honors core.hooksPath (e.g. .husky) resolved relative to the repo', () => {
    tmp = mkTmp()
    gitInit(tmp)
    execSync('git config core.hooksPath .husky', { cwd: tmp, stdio: 'pipe' })
    const dir = resolveHooksDir(tmp)
    expect(dir).toBe(path.join(tmp, '.husky'))
  })

  it('falls back to .git/hooks when git is unavailable / not a repo', () => {
    tmp = mkTmp()
    // No git init → `git config` will error; must fall back, not throw
    const dir = resolveHooksDir(tmp)
    expect(dir).toBe(path.join(tmp, '.git', 'hooks'))
  })
})

// ---------------------------------------------------------------------------
// installPostCommit
// ---------------------------------------------------------------------------

describe('installPostCommit', () => {
  let tmp: string
  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('creates a new executable post-commit hook in a fresh repo', () => {
    tmp = mkTmp()
    gitInit(tmp)

    const res = installPostCommit(tmp, FAKE_INVOCATION)

    expect(res.action).toBe('created')
    expect(res.hookPath).toBe(path.join(tmp, '.git', 'hooks', 'post-commit'))
    expect(fs.existsSync(res.hookPath)).toBe(true)
    expect(isExecutable(res.hookPath)).toBe(true)

    const content = fs.readFileSync(res.hookPath, 'utf-8')
    expect(content.startsWith('#!/bin/sh')).toBe(true)
    expect(content).toContain(GROVE_BEGIN)
    expect(content).toContain(GROVE_END)
    expect(content).toContain(FAKE_INVOCATION)
  })

  it('chains onto a pre-existing custom hook, preserving it verbatim', () => {
    tmp = mkTmp()
    gitInit(tmp)
    const hookPath = path.join(tmp, '.git', 'hooks', 'post-commit')
    fs.writeFileSync(hookPath, '#!/bin/sh\necho CUSTOM\n', { mode: 0o755 })

    const res = installPostCommit(tmp, FAKE_INVOCATION)

    expect(res.action).toBe('chained')
    const content = fs.readFileSync(hookPath, 'utf-8')
    // Original hook still present
    expect(content).toContain('echo CUSTOM')
    // Grove block appended
    expect(content).toContain(GROVE_BEGIN)
    expect(content).toContain(FAKE_INVOCATION)
    // Still executable
    expect(isExecutable(hookPath)).toBe(true)
  })

  it('is idempotent — installing twice leaves exactly one grove block', () => {
    tmp = mkTmp()
    gitInit(tmp)

    const first = installPostCommit(tmp, FAKE_INVOCATION)
    expect(first.action).toBe('created')

    const second = installPostCommit(tmp, FAKE_INVOCATION)
    expect(second.action).toBe('already')

    const content = fs.readFileSync(first.hookPath, 'utf-8')
    expect(countOf(content, GROVE_BEGIN)).toBe(1)
    expect(countOf(content, GROVE_END)).toBe(1)
  })

  it('honors core.hooksPath — installs into .husky, NOT .git/hooks', () => {
    tmp = mkTmp()
    gitInit(tmp)
    execSync('git config core.hooksPath .husky', { cwd: tmp, stdio: 'pipe' })

    const res = installPostCommit(tmp, FAKE_INVOCATION)

    expect(res.action).toBe('created')
    expect(res.hookPath).toBe(path.join(tmp, '.husky', 'post-commit'))
    expect(fs.existsSync(res.hookPath)).toBe(true)
    // Must NOT have written into .git/hooks
    expect(fs.existsSync(path.join(tmp, '.git', 'hooks', 'post-commit'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// uninstallPostCommit
// ---------------------------------------------------------------------------

describe('uninstallPostCommit', () => {
  let tmp: string
  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('unchains — strips grove block but keeps the other hook intact', () => {
    tmp = mkTmp()
    gitInit(tmp)
    const hookPath = path.join(tmp, '.git', 'hooks', 'post-commit')
    fs.writeFileSync(hookPath, '#!/bin/sh\necho CUSTOM\n', { mode: 0o755 })
    installPostCommit(tmp, FAKE_INVOCATION)

    const res = uninstallPostCommit(tmp)

    expect(res.action).toBe('unchained')
    expect(fs.existsSync(hookPath)).toBe(true)
    const content = fs.readFileSync(hookPath, 'utf-8')
    expect(content).toContain('echo CUSTOM')
    expect(content).not.toContain(GROVE_BEGIN)
    expect(content).not.toContain(GROVE_END)
    expect(content).not.toContain(FAKE_INVOCATION)
  })

  it('removes — deletes a grove-only hook file entirely', () => {
    tmp = mkTmp()
    gitInit(tmp)
    const created = installPostCommit(tmp, FAKE_INVOCATION)
    expect(created.action).toBe('created')

    const res = uninstallPostCommit(tmp)

    expect(res.action).toBe('removed')
    expect(res.hookPath).toBe(created.hookPath)
    expect(fs.existsSync(created.hookPath)).toBe(false)
  })

  it('reports absent when there is no hook file', () => {
    tmp = mkTmp()
    gitInit(tmp)

    const res = uninstallPostCommit(tmp)

    expect(res.action).toBe('absent')
  })

  it('reports absent when a hook exists but has no grove sentinel', () => {
    tmp = mkTmp()
    gitInit(tmp)
    const hookPath = path.join(tmp, '.git', 'hooks', 'post-commit')
    fs.writeFileSync(hookPath, '#!/bin/sh\necho CUSTOM\n', { mode: 0o755 })

    const res = uninstallPostCommit(tmp)

    expect(res.action).toBe('absent')
    // Untouched
    expect(fs.readFileSync(hookPath, 'utf-8')).toContain('echo CUSTOM')
  })
})

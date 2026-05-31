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
  hooksDirInWorktree,
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
    const block = buildHookBlock(FAKE_INVOCATION)
    expect(block).toContain(GROVE_BEGIN)
    expect(block).toContain(GROVE_END)
    expect(block).toContain(FAKE_INVOCATION)
    expect(block).toContain('commit-hook')
    // fail-open guarantee: a Grove failure must never block the commit
    expect(block).toContain('|| true')
    // sentinel ordering: BEGIN must come before END
    expect(block.indexOf(GROVE_BEGIN)).toBeLessThan(block.indexOf(GROVE_END))
  })

  // ---- isolation: no machine path baked into the (possibly committed) hook ---
  it('resolves the repo at RUNTIME (portable) — bakes in no install-time machine path', () => {
    // The hook can end up committed (husky/lefthook .husky). It must therefore
    // embed NO absolute developer path and stay correct on any clone — so the
    // repo is resolved at runtime via `git rev-parse --show-toplevel`.
    const block = buildHookBlock(FAKE_INVOCATION)
    expect(block).toContain('--repo "$(git rev-parse --show-toplevel)"')
    // No single-quoted absolute path (the old install-time shape that leaked $HOME).
    expect(block).not.toMatch(/--repo '\//)
  })

  it('interpolates no external path — there is no command-substitution surface', () => {
    // The old design interpolated repoDir into the shell line (an RCE surface if
    // a path held $()/quotes). Now the ONLY substitution is git's own
    // --show-toplevel, double-quoted; nothing external is interpolated at all.
    const block = buildHookBlock(FAKE_INVOCATION)
    const hookLine = block.split('\n').find((l) => l.includes('commit-hook'))!
    expect(hookLine).toBe(
      `${FAKE_INVOCATION} commit-hook --repo "$(git rev-parse --show-toplevel)" 2>/dev/null || true`,
    )
  })
})

// ---------------------------------------------------------------------------
// hooksDirInWorktree — is the hooks dir a TRACKED (committable) part of the tree?
// ---------------------------------------------------------------------------

describe('hooksDirInWorktree', () => {
  it('is false for the default .git/hooks (never tracked)', () => {
    expect(hooksDirInWorktree('/repo', '/repo/.git/hooks')).toBe(false)
  })

  it('is true for a husky/lefthook dir inside the working tree (committable)', () => {
    expect(hooksDirInWorktree('/repo', '/repo/.husky')).toBe(true)
    expect(hooksDirInWorktree('/repo', '/repo/.config/hooks')).toBe(true)
  })

  it('is false for an absolute hooks dir outside the repo', () => {
    expect(hooksDirInWorktree('/repo', '/etc/git-hooks')).toBe(false)
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
    expect(res.inWorktree).toBe(false) // .git/hooks is never tracked → no commit risk
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
    expect(res.inWorktree).toBe(true) // .husky IS tracked → init must warn (commit risk)
    expect(fs.existsSync(res.hookPath)).toBe(true)
    // Must NOT have written into .git/hooks
    expect(fs.existsSync(path.join(tmp, '.git', 'hooks', 'post-commit'))).toBe(false)
    // ISOLATION: the committed-capable hook bakes in NO absolute machine path.
    const content = fs.readFileSync(res.hookPath, 'utf-8')
    expect(content).toContain('--repo "$(git rev-parse --show-toplevel)"')
    expect(content).not.toContain(tmp) // no install-time abs path leaked into the file
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

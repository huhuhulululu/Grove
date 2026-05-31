/**
 * e2e.test.ts — REAL end-to-end tests that EXECUTE the generated artifacts
 * (the post-commit hook + the statusline wrapper) through a real shell / real
 * git, not just assert their generated text. Closes the AUDIT R4 QA gap:
 * "the hook/wrapper were never executed in tests."
 *
 * These tests build the `sq` bundle on demand (so they are self-contained) and
 * spawn real subprocesses, so they are heavier than the unit tests. Each uses an
 * isolated temp git repo + temp GROVE_HOME so nothing touches real state.
 *
 * Run: npx vitest run src/cli/e2e.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as url from 'node:url'
import { execSync, execFileSync } from 'node:child_process'
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { installPostCommit } from '../adapters/githook'
import { installStatusline } from '../adapters/statusline-install'
import { groveInvocation } from './sq'
import { stateDir } from '../store/paths'

// ---------------------------------------------------------------------------
// Shared: build the bundle once (the generated hook/wrapper point at it)
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(url.fileURLToPath(import.meta.url), '..', '..', '..')
const builtBundle = path.join(repoRoot, 'dist', 'cli', 'sq.js')

function ensureBuilt(): void {
  if (!fs.existsSync(builtBundle)) {
    execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' })
  }
}

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function removeTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@grove.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Grove Test"', { cwd: dir, stdio: 'pipe' })
}

/** Poll for a predicate (the background ingest needs a beat to land state). */
function waitFor(pred: () => boolean, timeoutMs = 5000): boolean {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    // Tiny busy-wait — fine for a test; keeps it synchronous & deterministic.
    const until = Date.now() + 25
    while (Date.now() < until) { /* spin */ }
  }
  return pred()
}

// ---------------------------------------------------------------------------
// (a) Post-commit hook: install via the REAL installer, fire a REAL git commit
// ---------------------------------------------------------------------------

describe('e2e: installed post-commit hook runs on a REAL git commit', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeAll(() => {
    ensureBuilt()
  })

  beforeEach(() => {
    tmpRepo = makeTmpDir('grove-e2e-hook-repo-')
    tmpHome = makeTmpDir('grove-e2e-hook-home-')
    gitInit(tmpRepo)
    // A lean CLAUDE.md so the commit-time scan has a Pillar-B signal to reward.
    fs.writeFileSync(
      path.join(tmpRepo, 'CLAUDE.md'),
      Array.from({ length: 10 }, (_, i) => `# line ${i + 1}`).join('\n'),
    )
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('install (real installPostCommit) → git commit → Grove ran, commit succeeded, not blocked', () => {
    // Install the hook exactly as `sq init` does (built-bundle fallback branch).
    const inv = groveInvocation({ sqOnPath: () => false })
    const res = installPostCommit(tmpRepo, inv)
    expect(res.action).toBe('created')
    expect(fs.existsSync(res.hookPath)).toBe(true)

    // The installed hook calls `commit-hook` with NO --home, so it resolves state
    // via GROVE_HOME — set that on the commit subprocess to isolate test state.
    fs.writeFileSync(path.join(tmpRepo, 'src.ts'), 'export const x = 1\n')
    execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })

    // Fire a REAL commit. If the hook errored non-fail-open, this would throw.
    execSync('git commit -m "feat: e2e"', {
      cwd: tmpRepo,
      env: { ...process.env, GROVE_HOME: tmpHome },
      stdio: 'pipe',
    })

    // The commit was NOT blocked — HEAD advanced to our message.
    const head = execSync('git log -1 --pretty=%s', { cwd: tmpRepo }).toString().trim()
    expect(head).toBe('feat: e2e')

    // Grove ran: the installed hook executed the BUILT bundle, which scanned the
    // committed repo and PERSISTED state under GROVE_HOME (the authoritative proof
    // — events.jsonl + state.json in the repo-scoped subdir).
    const subdirs = fs.readdirSync(tmpHome)
    expect(subdirs.length).toBeGreaterThan(0)
    const stateFiles = subdirs.flatMap((d) => {
      const full = path.join(tmpHome, d)
      return fs.statSync(full).isDirectory() ? fs.readdirSync(full) : []
    })
    expect(stateFiles).toContain('state.json')
    expect(stateFiles).toContain('events.jsonl')

    // The persisted state proves an event was actually ingested (clock advanced).
    const stateDirForRepo = subdirs
      .map((d) => path.join(tmpHome, d))
      .find((full) => fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'state.json')))!
    const state = JSON.parse(
      fs.readFileSync(path.join(stateDirForRepo, 'state.json'), 'utf-8'),
    ) as { eventCount: number }
    expect(state.eventCount).toBeGreaterThan(0)
  }, 30000)

  it('a SECOND commit still succeeds (hook is idempotent / fail-open across commits)', () => {
    const inv = groveInvocation({ sqOnPath: () => false })
    installPostCommit(tmpRepo, inv)

    const env = { ...process.env, GROVE_HOME: tmpHome }
    fs.writeFileSync(path.join(tmpRepo, 'a.ts'), '1\n')
    execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })
    execSync('git commit -m "one"', { cwd: tmpRepo, env, stdio: 'pipe' })

    fs.writeFileSync(path.join(tmpRepo, 'b.ts'), '2\n')
    execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })
    // Must not throw — fail-open guarantees the commit is never blocked.
    expect(() =>
      execSync('git commit -m "two"', { cwd: tmpRepo, env, stdio: 'pipe' }),
    ).not.toThrow()

    const count = execSync('git rev-list --count HEAD', { cwd: tmpRepo }).toString().trim()
    expect(Number(count)).toBe(2)
  }, 30000)
})

// ---------------------------------------------------------------------------
// (b) Statusline wrapper: execute the GENERATED wrapper through /bin/sh and
//     assert (1) byte-passthrough of the ORIGINAL command's stdout, and
//     (2) the Grove ingest actually fired (state written for the payload).
// ---------------------------------------------------------------------------

describe('e2e: generated statusline wrapper byte-passes-through + fires Grove ingest', () => {
  let tmpDir: string
  let tmpHome: string
  let settingsPath: string
  let wrapperPath: string

  beforeAll(() => {
    ensureBuilt()
  })

  beforeEach(() => {
    tmpDir = makeTmpDir('grove-e2e-sl-')
    tmpHome = makeTmpDir('grove-e2e-sl-home-')
    settingsPath = path.join(tmpDir, 'settings.json')
    wrapperPath = path.join(tmpDir, 'grove-statusline-wrapper.sh')
  })

  afterEach(() => {
    removeTmp(tmpDir)
    removeTmp(tmpHome)
  })

  it('runs the wrapper via /bin/sh: original HUD passes through byte-for-byte AND energy is ingested', () => {
    // The "original" statusline command echoes a fixed HUD marker. The wrapper
    // must reproduce its stdout verbatim while ALSO background-piping the same
    // payload to grove's statusline-ingest.
    const HUD = 'MY_ORIGINAL_HUD_42'
    const original = `printf '%s' ${HUD}`
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: original } }, null, 2),
      'utf-8',
    )

    // Point the ingest at the BUILT bundle with an isolated --home so the
    // background ingest writes into our temp grove home.
    const ingestCmd = `node ${JSON.stringify(builtBundle).replace(/^"|"$/g, "'")} statusline-ingest --home ${tmpHome}`
    const result = installStatusline(settingsPath, wrapperPath, ingestCmd)
    expect(result.action).toBe('installed')
    expect(fs.existsSync(wrapperPath)).toBe(true)

    // A realistic subscription payload (rate_limits present → energy.known=true).
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600
    const payload = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: futureEpoch },
        seven_day: { used_percentage: 10, resets_at: futureEpoch + 86400 },
      },
      session_id: 'e2e-sl',
      model: 'claude-sonnet-4-6',
    })

    // EXECUTE the generated wrapper through /bin/sh with the payload on stdin.
    const stdout = execFileSync('/bin/sh', [wrapperPath], {
      input: payload,
      encoding: 'utf-8',
    })

    // (1) BYTE-PASSTHROUGH: the wrapper's stdout is exactly the original's stdout.
    expect(stdout).toBe(HUD)

    // (2) GROVE INGEST FIRED: the background pipe wrote state under tmpHome. The
    // ingest is backgrounded (&) so poll briefly for the state file to appear.
    const dir = stateDir(tmpHome)
    const stateFile = path.join(dir, 'state.json')
    const landed = waitFor(() => fs.existsSync(stateFile))
    expect(landed).toBe(true)

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as { energy: { known: boolean } }
    // Subscription payload → energy is now KNOWN (the ingest parsed it).
    expect(state.energy.known).toBe(true)
  }, 30000)

  it('with an EMPTY original command the wrapper still ingests and produces empty passthrough', () => {
    // No prior statusLine command → original defaults to `true` (no-op, empty out).
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }, null, 2), 'utf-8')

    const ingestCmd = `node ${JSON.stringify(builtBundle).replace(/^"|"$/g, "'")} statusline-ingest --home ${tmpHome}`
    installStatusline(settingsPath, wrapperPath, ingestCmd)

    const payload = JSON.stringify({ session_id: 'e2e-sl-api', model: 'claude-sonnet-4-6' }) // no rate_limits → Wellspring

    const stdout = execFileSync('/bin/sh', [wrapperPath], { input: payload, encoding: 'utf-8' })
    // Empty original → empty passthrough.
    expect(stdout).toBe('')

    // Ingest still fired: an API payload sets energy.known=false (Wellspring).
    const stateFile = path.join(stateDir(tmpHome), 'state.json')
    const landed = waitFor(() => fs.existsSync(stateFile))
    expect(landed).toBe(true)
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as { energy: { known: boolean } }
    expect(state.energy.known).toBe(false)
  }, 30000)
})

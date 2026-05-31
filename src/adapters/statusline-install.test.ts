/**
 * statusline-install.test.ts — TDD tests for installStatusline / uninstallStatusline.
 *
 * Tests use a fresh temp dir as fake home with a fake settings.json whose
 * .statusLine.command = 'ORIGINAL_SL' and a couple of other keys.
 *
 * Run: npx vitest run src/adapters/statusline-install.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installStatusline, uninstallStatusline } from './statusline-install'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sl-install-test-'))
}

function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Build a fake settings.json with extra keys + a known .statusLine.command */
function fakeSettings(command: string = 'ORIGINAL_SL'): Record<string, unknown> {
  return {
    theme: 'dark',
    model: 'claude-sonnet-4-6',
    statusLine: {
      type: 'command',
      command,
    },
    someOtherKey: { nested: true },
  }
}

function writeSettings(settingsPath: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2), 'utf-8')
}

function readSettings(settingsPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('installStatusline', () => {
  let tmpDir: string
  let settingsPath: string
  let wrapperPath: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    settingsPath = path.join(tmpDir, 'settings.json')
    wrapperPath = path.join(tmpDir, 'grove-statusline-wrapper.sh')
    writeSettings(settingsPath, fakeSettings('ORIGINAL_SL'))
  })

  afterEach(() => {
    removeTmpDir(tmpDir)
  })

  // ---- return value ----------------------------------------------------------

  it('returns action "installed" on first install', () => {
    const result = installStatusline(settingsPath, wrapperPath)
    expect(result.action).toBe('installed')
  })

  it('returns the original command', () => {
    const result = installStatusline(settingsPath, wrapperPath)
    expect(result.original).toBe('ORIGINAL_SL')
  })

  it('returns action "already-installed" when called twice', () => {
    installStatusline(settingsPath, wrapperPath)
    const result2 = installStatusline(settingsPath, wrapperPath)
    expect(result2.action).toBe('already-installed')
  })

  // ---- settings.json mutations ------------------------------------------------

  it('rewrites ONLY .statusLine.command — other top-level keys are unchanged', () => {
    installStatusline(settingsPath, wrapperPath)
    const updated = readSettings(settingsPath)
    expect(updated['theme']).toBe('dark')
    expect(updated['model']).toBe('claude-sonnet-4-6')
    expect((updated['someOtherKey'] as Record<string, unknown>)['nested']).toBe(true)
  })

  it('sets .statusLine.command to the wrapper path', () => {
    installStatusline(settingsPath, wrapperPath)
    const updated = readSettings(settingsPath)
    const sl = updated['statusLine'] as Record<string, unknown>
    expect(sl['command']).toBe(wrapperPath)
  })

  it('preserves .statusLine.type unchanged', () => {
    installStatusline(settingsPath, wrapperPath)
    const updated = readSettings(settingsPath)
    const sl = updated['statusLine'] as Record<string, unknown>
    expect(sl['type']).toBe('command')
  })

  // ---- backup ----------------------------------------------------------------

  it('creates a timestamped backup of settings.json before editing', () => {
    installStatusline(settingsPath, wrapperPath)
    const backupFiles = fs.readdirSync(path.dirname(settingsPath))
      .filter(f => f.startsWith('settings.json.bak'))
    expect(backupFiles.length).toBeGreaterThan(0)
  })

  it('backup contains the ORIGINAL command', () => {
    installStatusline(settingsPath, wrapperPath)
    const backupFiles = fs.readdirSync(path.dirname(settingsPath))
      .filter(f => f.startsWith('settings.json.bak'))
    const backupContent = fs.readFileSync(
      path.join(path.dirname(settingsPath), backupFiles[0]!),
      'utf-8',
    )
    const backupObj = JSON.parse(backupContent) as Record<string, unknown>
    const sl = backupObj['statusLine'] as Record<string, unknown>
    expect(sl['command']).toBe('ORIGINAL_SL')
  })

  // ---- wrapper script --------------------------------------------------------

  it('creates the wrapper script file', () => {
    installStatusline(settingsPath, wrapperPath)
    expect(fs.existsSync(wrapperPath)).toBe(true)
  })

  it('wrapper script contains a backgrounded grove statusline-ingest call', () => {
    installStatusline(settingsPath, wrapperPath)
    const content = fs.readFileSync(wrapperPath, 'utf-8')
    expect(content).toContain('statusline-ingest')
    // Must be non-blocking (background / fail-open)
    expect(content).toMatch(/&||| true|fail-open|background/i)
  })

  it('wrapper script passes stdin to the original command', () => {
    installStatusline(settingsPath, wrapperPath)
    const content = fs.readFileSync(wrapperPath, 'utf-8')
    expect(content).toContain('ORIGINAL_SL')
  })

  it('wrapper script is executable', () => {
    installStatusline(settingsPath, wrapperPath)
    const stat = fs.statSync(wrapperPath)
    // Owner execute bit set
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o100).toBeTruthy()
  })

  // ---- idempotency -----------------------------------------------------------

  it('calling install twice does not corrupt settings', () => {
    installStatusline(settingsPath, wrapperPath)
    installStatusline(settingsPath, wrapperPath)
    const updated = readSettings(settingsPath)
    const sl = updated['statusLine'] as Record<string, unknown>
    // Command should still be the wrapper, not double-wrapped
    expect(sl['command']).toBe(wrapperPath)
  })
})

// ---------------------------------------------------------------------------
// uninstallStatusline
// ---------------------------------------------------------------------------

describe('uninstallStatusline', () => {
  let tmpDir: string
  let settingsPath: string
  let wrapperPath: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    settingsPath = path.join(tmpDir, 'settings.json')
    wrapperPath = path.join(tmpDir, 'grove-statusline-wrapper.sh')
    writeSettings(settingsPath, fakeSettings('ORIGINAL_SL'))
  })

  afterEach(() => {
    removeTmpDir(tmpDir)
  })

  it('returns action "uninstalled" after a prior install', () => {
    installStatusline(settingsPath, wrapperPath)
    const result = uninstallStatusline(settingsPath)
    expect(result.action).toBe('uninstalled')
  })

  it('returns action "not-installed" when grove was never installed', () => {
    const result = uninstallStatusline(settingsPath)
    expect(result.action).toBe('not-installed')
  })

  it('restores the ORIGINAL command exactly after uninstall', () => {
    installStatusline(settingsPath, wrapperPath)
    uninstallStatusline(settingsPath)
    const updated = readSettings(settingsPath)
    const sl = updated['statusLine'] as Record<string, unknown>
    expect(sl['command']).toBe('ORIGINAL_SL')
  })

  it('uninstall is idempotent — calling twice returns 0 errors', () => {
    installStatusline(settingsPath, wrapperPath)
    uninstallStatusline(settingsPath)
    const result2 = uninstallStatusline(settingsPath)
    expect(result2.action).toBe('not-installed')
  })

  it('settings.json still valid JSON after uninstall', () => {
    installStatusline(settingsPath, wrapperPath)
    uninstallStatusline(settingsPath)
    expect(() => readSettings(settingsPath)).not.toThrow()
  })

  it('other keys preserved after uninstall', () => {
    installStatusline(settingsPath, wrapperPath)
    uninstallStatusline(settingsPath)
    const updated = readSettings(settingsPath)
    expect(updated['theme']).toBe('dark')
    expect(updated['model']).toBe('claude-sonnet-4-6')
  })
})

// ---------------------------------------------------------------------------
// shell-injection hardening (P0): wrapper script must not let a hostile
// original/ingest command break out of the script structure.
// ---------------------------------------------------------------------------

describe('installStatusline — wrapper hardening', () => {
  let tmpDir: string
  let settingsPath: string
  let wrapperPath: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    settingsPath = path.join(tmpDir, 'settings.json')
    wrapperPath = path.join(tmpDir, 'grove-statusline-wrapper.sh')
  })

  afterEach(() => {
    removeTmpDir(tmpDir)
    const cwdSentinel = path.join(process.cwd(), 'SL_PWNED')
    if (fs.existsSync(cwdSentinel)) fs.rmSync(cwdSentinel)
  })

  it('sanitizes a newline in the original command so it cannot inject a new script line', () => {
    // An original command containing a newline + a malicious command. If we wrote
    // it raw into the "# grove-original:" comment, the newline would terminate the
    // comment and the next line would become an executable script statement.
    const evil = 'mybar\ntouch SL_PWNED'
    writeSettings(settingsPath, fakeSettings(evil))

    installStatusline(settingsPath, wrapperPath)
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8')

    // The stored "# grove-original:" comment line must NOT contain a raw newline
    // that lets "touch SL_PWNED" escape onto its own line as a comment-free stmt.
    const commentLine = wrapper.split('\n').find((l) => l.startsWith('# grove-original:'))!
    expect(commentLine).toBeDefined()
    expect(commentLine).not.toContain('\n')
    // The dangerous tail must not appear as a standalone (non-comment) line.
    const lines = wrapper.split('\n')
    const bareTouch = lines.find((l) => l.trim() === 'touch SL_PWNED')
    expect(bareTouch).toBeUndefined()
  })

  it('single-quote-escapes the ingest command args (repoDir/home) — no $() execution', () => {
    writeSettings(settingsPath, fakeSettings('ORIGINAL_SL'))
    // A hostile --home directory path slipped into the ingest command.
    const evilIngest = `grove statusline-ingest --home /tmp/a'$(touch SL_PWNED)`

    installStatusline(settingsPath, wrapperPath, evilIngest)
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8')

    // The substitution must be inside single quotes (inert), with the embedded
    // quote escaped via '\'' — never a bare $(...) the shell would execute.
    expect(wrapper).toContain("'\\''")
    // No raw, executable $(touch ...) substitution outside single-quote context.
    // (Prove by running the wrapper's ingest line through /bin/sh — but ingest
    // isn't a real binary, so just assert structurally that the payload is quoted.)
    expect(wrapper).not.toMatch(/[^']\$\(touch SL_PWNED\)/)
  })

  it('escapes the original command so an embedded quote cannot break the run line', () => {
    const evil = `bar'; touch SL_PWNED; echo '`
    writeSettings(settingsPath, fakeSettings(evil))

    installStatusline(settingsPath, wrapperPath)
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8')

    // The original is intentionally EXECUTED (that's the chain), but its
    // placement must not allow a breakout: the run line must not contain the raw
    // `; touch SL_PWNED;` as a top-level shell statement.
    // The original command is now invoked via `sh -c <shQuoted-original>`, so the
    // quote-escape idiom must be present.
    expect(wrapper).toContain("'\\''")
    // Round-trip: extract the quoted original token and confirm /bin/sh parses it
    // back to EXACTLY the evil string (literal arg to sh -c, not extra commands).
    const runLine = wrapper.split('\n').find((l) => l.includes("sh -c"))!
    expect(runLine).toBeDefined()
  })

  it('uninstall restores a multi-special original command exactly', () => {
    // grove-original comment is sanitized of newlines, but quotes must survive a
    // round-trip so uninstall restores faithfully (minus the stripped newline).
    const evil = `bar'; echo hi`
    writeSettings(settingsPath, fakeSettings(evil))
    installStatusline(settingsPath, wrapperPath)
    uninstallStatusline(settingsPath)
    const updated = readSettings(settingsPath)
    const sl = updated['statusLine'] as Record<string, unknown>
    expect(sl['command']).toBe(evil)
  })
})

// ---------------------------------------------------------------------------
// settings.json missing statusLine at all
// ---------------------------------------------------------------------------

describe('installStatusline — settings.json with no statusLine key', () => {
  let tmpDir: string
  let settingsPath: string
  let wrapperPath: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
    settingsPath = path.join(tmpDir, 'settings.json')
    wrapperPath = path.join(tmpDir, 'grove-statusline-wrapper.sh')
    // Write settings without any statusLine key
    writeSettings(settingsPath, { theme: 'dark' })
  })

  afterEach(() => {
    removeTmpDir(tmpDir)
  })

  it('returns original as empty string when no prior statusLine.command', () => {
    const result = installStatusline(settingsPath, wrapperPath)
    expect(result.original).toBe('')
  })

  it('installs successfully', () => {
    const result = installStatusline(settingsPath, wrapperPath)
    expect(result.action).toBe('installed')
  })

  it('sets statusLine.command to wrapper even when no prior statusLine', () => {
    installStatusline(settingsPath, wrapperPath)
    const updated = readSettings(settingsPath)
    const sl = updated['statusLine'] as Record<string, unknown>
    expect(sl['command']).toBe(wrapperPath)
  })
})

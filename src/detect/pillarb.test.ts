import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { scanRepo } from './pillarb'

// ---------------------------------------------------------------------------
// Helper: create a fresh temp dir for each test scenario
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-pillarb-'))
}

function rmRf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@grove.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Grove Test"', { cwd: dir, stdio: 'pipe' })
}

function gitCommit(dir: string, msg = 'initial'): void {
  execSync('git add -A', { cwd: dir, stdio: 'pipe' })
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: 'pipe' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanRepo — GRIMOIRE detection', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('detects a lean CLAUDE.md and emits file_presence present:true with lines <= 80', () => {
    tmp = mkTmp()
    // Write a lean CLAUDE.md (under GRIMOIRE_LEAN_MAX_LINES)
    const lines = Array.from({ length: 20 }, (_, i) => `# line ${i + 1}`).join('\n')
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), lines)

    const result = scanRepo(tmp, { sessionId: 'test-session', ts: '2026-01-01T00:00:00Z' })

    const event = result.events.find(
      (e) => e.type === 'file_presence' && (e.meta as Record<string, unknown>)['present'] === true,
    )
    expect(event).toBeDefined()
    expect(event!.meta).toMatchObject({ document: 'CLAUDE.md', present: true })
    expect((event!.meta as Record<string, unknown>)['lines']).toBeLessThanOrEqual(80)
    expect(event!.source).toBe('detect')
    expect(event!.sessionId).toBe('test-session')
    expect(event!.ts).toBe('2026-01-01T00:00:00Z')
  })

  it('stops after finding the first grimoire file (does not emit duplicates)', () => {
    tmp = mkTmp()
    // Write both CLAUDE.md and AGENTS.md
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# Project\nShort file.\n')
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# Agents\nAnother file.\n')

    const result = scanRepo(tmp, { sessionId: 'test-stop', ts: '2026-01-01T00:00:00Z' })

    const presenceEvents = result.events.filter((e) => e.type === 'file_presence')
    expect(presenceEvents).toHaveLength(1)
    expect((presenceEvents[0]!.meta as Record<string, unknown>)['document']).toBe('CLAUDE.md')
  })

  it('emits file_presence present:false when no grimoire files exist', () => {
    tmp = mkTmp()
    // Empty repo directory — no grimoire files

    const result = scanRepo(tmp, { sessionId: 'test-absent', ts: '2026-01-01T00:00:00Z' })

    const event = result.events.find((e) => e.type === 'file_presence')
    expect(event).toBeDefined()
    expect(event!.meta).toMatchObject({ document: 'CLAUDE.md', present: false })
  })

  it('records correct line count for a grimoire file', () => {
    tmp = mkTmp()
    // Exactly 10 lines
    const content = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n')
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), content)

    const result = scanRepo(tmp, { sessionId: 'lines-test', ts: '2026-01-01T00:00:00Z' })

    const event = result.events.find((e) => e.type === 'file_presence')
    expect(event).toBeDefined()
    expect((event!.meta as Record<string, unknown>)['lines']).toBe(10)
  })
})

describe('scanRepo — git last-commit diff classification', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('emits test_added when a commit adds a file under tests/', () => {
    tmp = mkTmp()
    gitInit(tmp)

    // Create a baseline commit
    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const x = 1')
    gitCommit(tmp, 'initial')

    // Second commit adds a test file
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'main.test.ts'), 'it("works", () => {})')
    gitCommit(tmp, 'add test')

    const result = scanRepo(tmp, { sessionId: 'git-test', ts: '2026-01-01T00:00:00Z' })

    const testEvent = result.events.find((e) => e.type === 'test_added')
    expect(testEvent).toBeDefined()
    expect(testEvent!.magnitude).toBeGreaterThanOrEqual(1)
    expect(testEvent!.magnitude).toBeLessThanOrEqual(10)
  })

  it('stores only a COUNT for test_added — never the file PATHS (isolation · R-safety)', () => {
    tmp = mkTmp()
    gitInit(tmp)
    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const x = 1')
    gitCommit(tmp, 'initial')
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    // A revealing path: the file name is work content that must NOT be persisted.
    fs.writeFileSync(path.join(testsDir, 'secret-feature.test.ts'), 'it("x", () => {})')
    gitCommit(tmp, 'add test')

    const result = scanRepo(tmp, { sessionId: 'iso', ts: '2026-01-01T00:00:00Z' })
    const ev = result.events.find((e) => e.type === 'test_added')!
    const meta = ev.meta as Record<string, unknown>

    expect(meta['count']).toBe(1)
    expect(meta['files']).toBeUndefined() // no path list persisted
    // the revealing path must not appear ANYWHERE in the event record
    expect(JSON.stringify(ev)).not.toContain('secret-feature')
  })

  it('classifies files in the INITIAL (root, parentless) commit — regression for missing --root', () => {
    // A fresh repo's first commit has no parent; `diff-tree HEAD` without --root
    // is empty, so a user's very first `sq scan` used to miss test/doc signals.
    tmp = mkTmp()
    gitInit(tmp)
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 1')
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'a.test.ts'), 'it("works", () => {})')
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Readme')
    gitCommit(tmp, 'initial') // the ONLY commit — root

    const result = scanRepo(tmp, { sessionId: 'root-commit', ts: '2026-01-01T00:00:00Z' })

    expect(result.events.some((e) => e.type === 'test_added')).toBe(true)
    expect(result.events.some((e) => e.type === 'doc_updated')).toBe(true)
  })

  it('emits test_added for a .spec.ts file', () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'app.ts'), 'export const y = 2')
    gitCommit(tmp, 'initial')

    fs.writeFileSync(path.join(tmp, 'app.spec.ts'), 'it("spec works", () => {})')
    gitCommit(tmp, 'add spec')

    const result = scanRepo(tmp, { sessionId: 'spec-test', ts: '2026-01-01T00:00:00Z' })

    expect(result.events.some((e) => e.type === 'test_added')).toBe(true)
  })

  it('emits doc_updated synced:true when a commit changes a .ts file AND README.md', () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'index.ts'), 'export const a = 1')
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Initial')
    gitCommit(tmp, 'initial')

    // Update both code and docs
    fs.writeFileSync(path.join(tmp, 'index.ts'), 'export const a = 2')
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Updated')
    gitCommit(tmp, 'update code and docs')

    const result = scanRepo(tmp, { sessionId: 'synced-test', ts: '2026-01-01T00:00:00Z' })

    const docEvent = result.events.find((e) => e.type === 'doc_updated')
    expect(docEvent).toBeDefined()
    expect((docEvent!.meta as Record<string, unknown>)['synced']).toBe(true)
  })

  it('emits doc_updated drift:true when only a .ts file changes and ARCHITECTURE.md exists', () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'main.ts'), 'export const b = 1')
    fs.writeFileSync(path.join(tmp, 'ARCHITECTURE.md'), '# Arch')
    gitCommit(tmp, 'initial')

    // Only update code — docs not updated (drift!)
    fs.writeFileSync(path.join(tmp, 'main.ts'), 'export const b = 2')
    gitCommit(tmp, 'update only code')

    const result = scanRepo(tmp, { sessionId: 'drift-test', ts: '2026-01-01T00:00:00Z' })

    const docEvent = result.events.find((e) => e.type === 'doc_updated')
    expect(docEvent).toBeDefined()
    expect((docEvent!.meta as Record<string, unknown>)['drift']).toBe(true)
  })

  it('emits spec_written when a .spec.md file is in the commit', () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'app.ts'), 'export const c = 1')
    gitCommit(tmp, 'initial')

    fs.writeFileSync(path.join(tmp, 'SPEC.md'), '# Acceptance Criteria\n- Must work')
    gitCommit(tmp, 'add spec doc')

    const result = scanRepo(tmp, { sessionId: 'spec-written-test', ts: '2026-01-01T00:00:00Z' })

    expect(result.events.some((e) => e.type === 'spec_written')).toBe(true)
  })

  it('does NOT emit doc_updated drift when only a .ts file changes but NO arch doc exists', () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'util.ts'), 'export const d = 1')
    gitCommit(tmp, 'initial')

    fs.writeFileSync(path.join(tmp, 'util.ts'), 'export const d = 2')
    gitCommit(tmp, 'update util')

    const result = scanRepo(tmp, { sessionId: 'no-drift-test', ts: '2026-01-01T00:00:00Z' })

    const docEvent = result.events.find((e) => e.type === 'doc_updated')
    expect(docEvent).toBeUndefined()
  })
})

describe('scanRepo — non-git directory', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('still performs grimoire detection in a non-git directory', () => {
    tmp = mkTmp()
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# Non-git project\nShort content.\n')

    const result = scanRepo(tmp, { sessionId: 'no-git', ts: '2026-01-01T00:00:00Z' })

    const event = result.events.find((e) => e.type === 'file_presence')
    expect(event).toBeDefined()
    expect((event!.meta as Record<string, unknown>)['present']).toBe(true)
  })

  it('records a note when git is not available (non-git dir)', () => {
    tmp = mkTmp()

    const result = scanRepo(tmp, { sessionId: 'no-git-note', ts: '2026-01-01T00:00:00Z' })

    expect(result.notes.length).toBeGreaterThan(0)
    expect(result.notes.some((n) => /git/i.test(n))).toBe(true)
  })

  it('produces no git-derived events for a non-git directory', () => {
    tmp = mkTmp()

    const result = scanRepo(tmp, { sessionId: 'no-git-events', ts: '2026-01-01T00:00:00Z' })

    // Only file_presence events may be emitted (no test_added, doc_updated, spec_written)
    const gitDerived = result.events.filter((e) =>
      ['test_added', 'doc_updated', 'spec_written'].includes(e.type),
    )
    expect(gitDerived).toHaveLength(0)
  })
})

describe('scanRepo — event structure validation', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('uses default sessionId "scan" when none provided', () => {
    tmp = mkTmp()

    const result = scanRepo(tmp)

    result.events.forEach((e) => {
      expect(e.sessionId).toBe('scan')
    })
  })

  it('uses provided sessionId on all events', () => {
    tmp = mkTmp()

    const result = scanRepo(tmp, { sessionId: 'my-session' })

    result.events.forEach((e) => {
      expect(e.sessionId).toBe('my-session')
    })
  })

  it('uses provided ts on all events', () => {
    tmp = mkTmp()

    const result = scanRepo(tmp, { ts: '2025-12-25T00:00:00Z' })

    result.events.forEach((e) => {
      expect(e.ts).toBe('2025-12-25T00:00:00Z')
    })
  })

  it('all emitted events have source = "detect"', () => {
    tmp = mkTmp()
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# Project\n')

    const result = scanRepo(tmp, { sessionId: 'src-test', ts: '2026-01-01T00:00:00Z' })

    result.events.forEach((e) => {
      expect(e.source).toBe('detect')
    })
  })

  it('all emitted events pass GroveEvent zod schema validation', async () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# Project\n')
    fs.writeFileSync(path.join(tmp, 'index.ts'), 'export const x = 1')
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'index.test.ts'), 'it("ok", () => {})')
    gitCommit(tmp, 'initial with test')

    const result = scanRepo(tmp, { sessionId: 'valid-test', ts: '2026-01-01T00:00:00Z' })

    // Should not throw — each event passes zod
    const { parseEvent } = await import('../core/events')
    result.events.forEach((e) => {
      expect(() => parseEvent(e)).not.toThrow()
    })
  })
})

describe('scanRepo — deletion does NOT trigger test_added', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('does NOT emit test_added when a test file is DELETED alongside a code change', () => {
    tmp = mkTmp()
    gitInit(tmp)

    // Commit 1: add a test file and a code file
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'foo.test.ts'), 'it("foo", () => {})')
    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const x = 1')
    gitCommit(tmp, 'initial with test')

    // Commit 2: DELETE the test file, modify the code file
    fs.rmSync(path.join(testsDir, 'foo.test.ts'))
    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const x = 2')
    gitCommit(tmp, 'delete test, update code')

    const result = scanRepo(tmp, { sessionId: 'del-test', ts: '2026-01-01T00:00:00Z' })

    const testEvent = result.events.find((e) => e.type === 'test_added')
    expect(testEvent).toBeUndefined()
  })

  it('does NOT emit test_added when ONLY a test file is deleted', () => {
    tmp = mkTmp()
    gitInit(tmp)

    // Commit 1: add a test file
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'bar.test.ts'), 'it("bar", () => {})')
    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const y = 1')
    gitCommit(tmp, 'initial with test')

    // Commit 2: only DELETE the test file
    fs.rmSync(path.join(testsDir, 'bar.test.ts'))
    gitCommit(tmp, 'delete test only')

    const result = scanRepo(tmp, { sessionId: 'del-only-test', ts: '2026-01-01T00:00:00Z' })

    const testEvent = result.events.find((e) => e.type === 'test_added')
    expect(testEvent).toBeUndefined()
  })

  it('does NOT double-count test_added when a test file is RENAMED (R100)', () => {
    tmp = mkTmp()
    gitInit(tmp)

    // Commit 1: add a test file and a code file
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'old.test.ts'), 'it("old", () => {})')
    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const z = 1')
    gitCommit(tmp, 'initial')

    // Commit 2: rename the test file (git mv = delete old + add new)
    execSync(`git -C "${tmp}" mv tests/old.test.ts tests/new.test.ts`, { stdio: 'pipe' })
    gitCommit(tmp, 'rename test file')

    const result = scanRepo(tmp, { sessionId: 'rename-test', ts: '2026-01-01T00:00:00Z' })

    const testEvents = result.events.filter((e) => e.type === 'test_added')
    // A rename should emit at most ONE test_added (for the destination), not two
    expect(testEvents.length).toBeLessThanOrEqual(1)
  })
})

describe('scanRepo — shell-injection safety (P0)', () => {
  let parent: string

  // A single-component directory name (no `/`) that, under a shell-string exec,
  // would: close a single-quoted arg with `'`, then run `$(touch PILLARB_PWNED)`.
  // The sentinel is a BARE filename so the substitution payload contains no path
  // separators (a path component cannot contain `/`). If a shell ever ran it the
  // file would land in the process cwd or the repo parent — we check both.
  const INJECTED_NAME = "evil'$(touch PILLARB_PWNED)"
  const SENTINEL = 'PILLARB_PWNED'

  function scrubSentinels(dirs: string[]): void {
    for (const d of dirs) {
      const f = path.join(d, SENTINEL)
      if (fs.existsSync(f)) fs.rmSync(f)
    }
  }

  afterEach(() => {
    scrubSentinels([process.cwd(), parent ?? os.tmpdir()])
    if (parent) rmRf(parent)
  })

  it('does NOT execute injected shell when the repo PATH contains a quote and $()', () => {
    parent = mkTmp()
    const repoDir = path.join(parent, INJECTED_NAME)
    fs.mkdirSync(repoDir)
    gitInit(repoDir)
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const x = 1')
    const testsDir = path.join(repoDir, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, 'a.test.ts'), 'it("ok", () => {})')
    gitCommit(repoDir, 'initial')

    // scanRepo exercises isGitRepo + hasAtLeastOneCommit + diff-tree against the
    // adversarial path. With execFileSync (no shell) the substitution is inert.
    const result = scanRepo(repoDir, { sessionId: 'inj', ts: '2026-01-01T00:00:00Z' })

    // The sentinel must NEVER be created anywhere — proof nothing was executed.
    expect(fs.existsSync(path.join(process.cwd(), SENTINEL))).toBe(false)
    expect(fs.existsSync(path.join(parent, SENTINEL))).toBe(false)
    expect(fs.existsSync(path.join(repoDir, SENTINEL))).toBe(false)

    // And it should STILL work: the git diff is read correctly through the
    // hostile path, so test_added is detected.
    expect(result.events.some((e) => e.type === 'test_added')).toBe(true)
  })

  it('safely handles a non-existent / weird path without executing anything', () => {
    parent = mkTmp()
    const weird = path.join(parent, INJECTED_NAME)
    // Directory does not exist — git should just fail and notes should record it,
    // never execute the substitution.
    const result = scanRepo(weird, { sessionId: 'weird', ts: '2026-01-01T00:00:00Z' })
    expect(fs.existsSync(path.join(process.cwd(), SENTINEL))).toBe(false)
    expect(fs.existsSync(path.join(parent, SENTINEL))).toBe(false)
    // Non-git path → a note about git, no git-derived events.
    const gitDerived = result.events.filter((e) =>
      ['test_added', 'doc_updated', 'spec_written'].includes(e.type),
    )
    expect(gitDerived).toHaveLength(0)
  })
})

describe('scanRepo — magnitude capping for test_added', () => {
  let tmp: string

  afterEach(() => {
    if (tmp) rmRf(tmp)
  })

  it('caps test_added magnitude at 10 even with many test files', () => {
    tmp = mkTmp()
    gitInit(tmp)

    fs.writeFileSync(path.join(tmp, 'src.ts'), 'export const z = 0')
    gitCommit(tmp, 'initial')

    // Add 15 test files in one commit
    const testsDir = path.join(tmp, 'tests')
    fs.mkdirSync(testsDir)
    for (let i = 0; i < 15; i++) {
      fs.writeFileSync(path.join(testsDir, `test${i}.test.ts`), `it("test ${i}", () => {})`)
    }
    gitCommit(tmp, 'add many tests')

    const result = scanRepo(tmp, { sessionId: 'cap-test', ts: '2026-01-01T00:00:00Z' })

    const testEvent = result.events.find((e) => e.type === 'test_added')
    expect(testEvent).toBeDefined()
    expect(testEvent!.magnitude).toBe(10)
  })
})

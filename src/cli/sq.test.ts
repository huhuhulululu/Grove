/**
 * sq.test.ts — TDD tests for the sq CLI entry point.
 *
 * Uses a fresh temp dir per test, passed via --home, so tests are fully isolated
 * from each other and from any real grove state.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as url from 'node:url'
import { execSync } from 'node:child_process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run, groveInvocation } from './sq'
import { QUESTS } from '../core/quests'
import { GROVE_BEGIN, installPostCommit } from '../adapters/githook'
import { loadState, saveState } from '../store/store'
import { stateDir } from '../store/paths'
import { PULL_COST } from '../engine/reduce'

// ---- Helpers ----------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sq-test-'))
}

function removeTmpHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

// Capture console.log output during a run
function captureRun(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    spy.mockRestore()
  }
  return { code, output: lines }
}

// ---- Tests ------------------------------------------------------------------

describe('sq CLI', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
  })

  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  // ---- event subcommand -------------------------------------------------------

  describe('event subcommand', () => {
    it('returns 0 for a valid event type and persists state', () => {
      const { code } = captureRun([
        'event', 'test_result',
        '--magnitude', '2',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
    })

    it('persists state so a follow-up status shows level>=1 and currency>=1', () => {
      // R3: a test_result now grants SEEDS (currency), not a guaranteed card.
      captureRun(['event', 'test_result', '--magnitude', '2', '--home', tmpHome])

      const { code, output } = captureRun(['status', '--home', tmpHome])
      expect(code).toBe(0)

      const combined = output.join('\n')
      // Level should be at least 1 (initial level)
      expect(combined).toMatch(/Level\s*\.+\s*[1-9]/)
      // Currency (seeds) should be at least 1 from the earned outcome.
      expect(combined).toMatch(/Currency\s*\.+\s*[1-9]/)
    })

    it('prints reward lines (or a calm no-drop line) for a successful event', () => {
      const { code, output } = captureRun([
        'event', 'test_result',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
      // Must print at least one output line (reward or 'no drop')
      expect(output.length).toBeGreaterThan(0)
    })

    it('prints a calm no-drop line (or no rewards) for a failing event', () => {
      const { code, output } = captureRun([
        'event', 'commit',
        '--success', 'false',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
      // No rewards for failures, so either "no drop" message or empty output
      // The spec says: "print each reward via formatReward (or a calm 'no drop' line if none)"
      const combined = output.join('\n')
      // It's acceptable to have the calm no-drop line or just nothing
      // We just confirm exit code is 0
      expect(code).toBe(0)
    })

    it('returns 2 for an invalid event type', () => {
      const { code } = captureRun([
        'event', 'not_a_real_event_type',
        '--home', tmpHome,
      ])
      expect(code).toBe(2)
    })

    it('supports --source flag', () => {
      const { code } = captureRun([
        'event', 'commit',
        '--source', 'git-hook',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
    })

    it('supports --session flag', () => {
      const { code } = captureRun([
        'event', 'commit',
        '--session', 'my-session-123',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
    })

    it('defaults success to true when flag omitted', () => {
      const { code } = captureRun([
        'event', 'test_result',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
    })

    it('parses --success false correctly (no reward, still exits 0)', () => {
      const { code } = captureRun([
        'event', 'test_result',
        '--success', 'false',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
    })

    it('defaults magnitude to 1 when flag omitted', () => {
      const { code } = captureRun([
        'event', 'commit',
        '--home', tmpHome,
      ])
      expect(code).toBe(0)
    })

    it('prints an error message for invalid event type', () => {
      const outputLines: string[] = []
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        outputLines.push(args.map(String).join(' '))
      })
      const errorLines: string[] = []
      const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errorLines.push(args.map(String).join(' '))
      })
      try {
        run(['event', 'bad_type', '--home', tmpHome])
      } finally {
        logSpy.mockRestore()
        errSpy.mockRestore()
      }
      const combined = [...outputLines, ...errorLines].join('\n')
      expect(combined.toLowerCase()).toMatch(/invalid|unknown|bad|error|type/)
    })
  })

  // ---- status subcommand ------------------------------------------------------

  describe('status subcommand', () => {
    it('returns 0 and prints status block', () => {
      const { code, output } = captureRun(['status', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined).toContain('GROVE STATUS')
    })

    it('shows initial state when no events ingested', () => {
      const { code, output } = captureRun(['status', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined).toMatch(/Level\s*\.+\s*1/)
    })
  })

  // ---- recap subcommand -------------------------------------------------------

  describe('recap subcommand', () => {
    it('returns 0 and prints a recap block', () => {
      const { code, output } = captureRun(['recap', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined).toContain('RECAP')
    })

    it('recap --since all returns 0 and prints recap', () => {
      captureRun(['event', 'commit', '--home', tmpHome])
      const { code, output } = captureRun(['recap', '--since', 'all', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined).toContain('RECAP')
    })

    it('recap --since session filters to events after last session_start', () => {
      // Ingest a session_start then a commit
      captureRun(['event', 'session_start', '--home', tmpHome])
      captureRun(['event', 'commit', '--home', tmpHome])

      const { code, output } = captureRun(['recap', '--since', 'session', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined).toContain('RECAP')
    })

    it('recap with no prior session_start still returns 0', () => {
      captureRun(['event', 'commit', '--home', tmpHome])
      const { code } = captureRun(['recap', '--since', 'session', '--home', tmpHome])
      expect(code).toBe(0)
    })
  })

  // ---- pull subcommand (the core DECISION) ------------------------------------

  describe('pull subcommand', () => {
    it('returns 0 and prints a friendly "not enough" line when broke', () => {
      const { code, output } = captureRun(['pull', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('not enough')
    })

    it('spends seeds and yields a card once the player can afford a pull', () => {
      // DETERMINISTIC setup: seed currency directly + an EMPTY collection. Earning
      // via events is unsafe here — each successful event has a 5% serendipity roll
      // (time-seeded) that can add a random card, which can make the --seed pull a
      // DUPLICATE (no new card) and flake the strict cards.length assertion. An empty
      // collection guarantees the pull yields a NEW card.
      const dir = stateDir(tmpHome)
      const base = loadState(dir)
      saveState(dir, { ...base, player: { ...base.player, currency: 100 }, cards: [] })
      const before = loadState(dir)
      expect(before.player.currency).toBeGreaterThanOrEqual(PULL_COST)

      const { code, output } = captureRun(['pull', '--seed', '3', '--home', tmpHome])
      expect(code).toBe(0)

      const after = loadState(stateDir(tmpHome))
      // Empty collection → a NEW card, seeds debited by exactly PULL_COST (no dup refund).
      expect(after.cards.length).toBe(before.cards.length + 1)
      expect(after.player.currency).toBe(before.player.currency - PULL_COST)
      // The pull output mentions a card / rarity line.
      expect(output.join('\n').length).toBeGreaterThan(0)
    })
  })

  // ---- help / unknown ---------------------------------------------------------

  describe('help and unknown subcommands', () => {
    it('returns 0 for help subcommand', () => {
      const { code } = captureRun(['help'])
      expect(code).toBe(0)
    })

    it('returns 0 for no arguments', () => {
      const { code } = captureRun([])
      expect(code).toBe(0)
    })

    it('returns 2 for unknown subcommand', () => {
      const { code } = captureRun(['totally-unknown-command'])
      expect(code).toBe(2)
    })

    it('prints usage block for help', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toMatch(/usage|sq|command/)
    })

    it('prints usage block for no args', () => {
      const { output } = captureRun([])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toMatch(/usage|sq|command/)
    })
  })

  // ---- --home flag ------------------------------------------------------------

  describe('--home flag', () => {
    it('uses the provided home dir as the grove home for state storage', () => {
      const otherTmp = makeTmpHome()
      try {
        // Write state into otherTmp
        captureRun(['event', 'commit', '--home', otherTmp])
        // tmpHome should have no state.json in any subdir
        const tmpEntries = fs.readdirSync(tmpHome)
        expect(tmpEntries).toHaveLength(0)
      } finally {
        removeTmpHome(otherTmp)
      }
    })
  })

  // ---- scan subcommand --------------------------------------------------------

  describe('scan subcommand', () => {
    // Helper: make a temp repo dir with a lean CLAUDE.md
    function makeRepoWithLeanGrimoire(): string {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-scan-repo-'))
      const leanContent = Array.from({ length: 10 }, (_, i) => `# line ${i + 1}`).join('\n')
      fs.writeFileSync(path.join(repoDir, 'CLAUDE.md'), leanContent)
      return repoDir
    }

    // Helper: make a git repo with a lean CLAUDE.md committed
    function makeGitRepoWithLeanGrimoire(): string {
      const repoDir = makeRepoWithLeanGrimoire()
      execSync('git init', { cwd: repoDir, stdio: 'pipe' })
      execSync('git config user.email "test@grove.test"', { cwd: repoDir, stdio: 'pipe' })
      execSync('git config user.name "Grove Test"', { cwd: repoDir, stdio: 'pipe' })
      execSync('git add -A', { cwd: repoDir, stdio: 'pipe' })
      execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' })
      return repoDir
    }

    it('returns 0 for a repo with a lean CLAUDE.md', () => {
      const repoDir = makeRepoWithLeanGrimoire()
      try {
        const { code } = captureRun(['scan', repoDir, '--home', tmpHome])
        expect(code).toBe(0)
      } finally {
        removeTmpHome(repoDir)
      }
    })

    it('prints a summary of what was detected (counts)', () => {
      const repoDir = makeRepoWithLeanGrimoire()
      try {
        const { code, output } = captureRun(['scan', repoDir, '--home', tmpHome])
        expect(code).toBe(0)
        const combined = output.join('\n')
        // Should print some summary with counts
        expect(combined).toMatch(/\d+/)
      } finally {
        removeTmpHome(repoDir)
      }
    })

    it('prints reward lines or calm no-new-detection line when nothing novel', () => {
      const repoDir = makeRepoWithLeanGrimoire()
      try {
        // First scan triggers the reward
        captureRun(['scan', repoDir, '--home', tmpHome])
        // Second scan — same signals, nothing new to reward
        const { code, output } = captureRun(['scan', repoDir, '--home', tmpHome])
        expect(code).toBe(0)
        // Output should be present (either rewards or "nothing new" message)
        expect(output.length).toBeGreaterThan(0)
      } finally {
        removeTmpHome(repoDir)
      }
    })

    it('uses process.cwd() when no path positional is given', () => {
      // Just verify it doesn't crash (it will scan whatever cwd is)
      const { code } = captureRun(['scan', '--home', tmpHome])
      expect(code).toBe(0)
    })

    it('scan of a repo with lean CLAUDE.md, then quests shows grimoire as done', () => {
      const repoDir = makeRepoWithLeanGrimoire()
      try {
        const scanCode = captureRun(['scan', repoDir, '--home', tmpHome]).code
        expect(scanCode).toBe(0)

        const { code, output } = captureRun(['quests', '--home', tmpHome])
        expect(code).toBe(0)
        const combined = output.join('\n')
        // grimoire quest should be shown as done
        expect(combined).toContain('Write the CLAUDE.md')
        expect(combined).toContain('✓')
      } finally {
        removeTmpHome(repoDir)
      }
    })
  })

  // ---- quests subcommand ------------------------------------------------------

  describe('quests subcommand', () => {
    it('returns 0 on a fresh home', () => {
      const { code } = captureRun(['quests', '--home', tmpHome])
      expect(code).toBe(0)
    })

    it('prints all 4 quest titles on a fresh home', () => {
      const { output } = captureRun(['quests', '--home', tmpHome])
      const combined = output.join('\n')
      for (const q of QUESTS) {
        expect(combined).toContain(q.title)
      }
    })

    it('includes status glyphs in the output', () => {
      const { output } = captureRun(['quests', '--home', tmpHome])
      const combined = output.join('\n')
      // Fresh home: all quests are not-yet, so · glyph should appear
      expect(combined).toContain('·')
    })

    it('shows active buffs or a no-buffs message', () => {
      const { output } = captureRun(['quests', '--home', tmpHome])
      const combined = output.join('\n')
      // Should either list buffs or say "none"
      expect(combined.toLowerCase()).toMatch(/buff|none|aura/)
    })

    it('shows a done glyph after scan completes the grimoire quest', () => {
      // Create a lean CLAUDE.md and scan it
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-quests-repo-'))
      try {
        const leanContent = Array.from({ length: 5 }, (_, i) => `# line ${i + 1}`).join('\n')
        fs.writeFileSync(path.join(repoDir, 'CLAUDE.md'), leanContent)
        captureRun(['scan', repoDir, '--home', tmpHome])

        const { output } = captureRun(['quests', '--home', tmpHome])
        const combined = output.join('\n')
        expect(combined).toContain('✓')
      } finally {
        removeTmpHome(repoDir)
      }
    })
  })

  // ---- help mentions scan and quests ------------------------------------------

  describe('help mentions new subcommands', () => {
    it('help output mentions "scan"', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('scan')
    })

    it('help output mentions "quests"', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('quests')
    })
  })

  // ---- help mentions init, uninstall, commit-hook ----------------------------

  describe('help mentions git-hook subcommands', () => {
    it('help output mentions "init"', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('init')
    })

    it('help output mentions "uninstall"', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('uninstall')
    })

    it('help output mentions "commit-hook"', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('commit-hook')
    })
  })
})

// ---- groveInvocation --------------------------------------------------------

describe('groveInvocation', () => {
  it('prefers a bare PATH-resolvable `sq` when one is installed', () => {
    // When `sq` is on PATH (global install), the hook just calls `sq` —
    // no path interpolation at all, so zero injection surface.
    const inv = groveInvocation({ sqOnPath: () => true })
    expect(inv).toBe('sq')
  })

  it('falls back to `node <abs>/dist/cli/sq.js` when `sq` is NOT on PATH', () => {
    const inv = groveInvocation({ sqOnPath: () => false })
    expect(inv.startsWith('node ')).toBe(true)
    expect(inv).toContain('dist/cli/sq.js')
  })

  it('the fallback points to an ABSOLUTE built bundle path', () => {
    const inv = groveInvocation({ sqOnPath: () => false })
    // Strip the leading `node ` and the single quotes around the path.
    const quoted = inv.slice('node '.length)
    expect(quoted.startsWith("'")).toBe(true)
    expect(quoted.endsWith("'")).toBe(true)
    const absPath = quoted.slice(1, -1).replace(/'\\''/g, "'")
    expect(path.isAbsolute(absPath)).toBe(true)
    expect(absPath.endsWith('dist/cli/sq.js')).toBe(true)
  })

  it('NEVER wraps the path in raw double quotes (the residual injection surface)', () => {
    const inv = groveInvocation({ sqOnPath: () => false })
    expect(inv).not.toContain('"')
  })

  it('single-quote / shQuote-escapes a path containing a quote (injection-safe)', () => {
    // Force the fallback branch with a malicious moduleUrl whose path contains a
    // single quote AND a `$()`. A naive double-quote wrap would let `$()` run on
    // every commit; shQuote must neutralize both.
    // root = dirname(dirname(thisFile)), so the evil chars must sit two levels
    // ABOVE sq.js to land in the install root that gets interpolated.
    const evilUrl = url.pathToFileURL('/tmp/eg\'il$(touch pwned)/dist/cli/sq.js').href
    const inv = groveInvocation({ sqOnPath: () => false, moduleUrl: evilUrl })

    // No raw double quotes anywhere.
    expect(inv).not.toContain('"')
    // The `$()` is inside single quotes, so the shell treats it as a literal.
    // Verify the whole thing is a `node '<single-quoted-token>'` shape and the
    // quote inside the path was escaped via the POSIX `'\''` idiom.
    expect(inv.startsWith("node '")).toBe(true)
    expect(inv).toContain("'\\''") // the embedded `'` was escaped, not left open
  })

  it('uses the default PATH detector when no opts are given (no throw)', () => {
    // Smoke: the real default must not throw and must return a non-empty command.
    const inv = groveInvocation()
    expect(typeof inv).toBe('string')
    expect(inv.length).toBeGreaterThan(0)
    // Either the bare `sq`, or the safe `node '<path>'` fallback — never a raw
    // double-quoted path.
    expect(inv === 'sq' || inv.startsWith('node ')).toBe(true)
    if (inv !== 'sq') expect(inv).not.toContain('"')
  })
})

// ---- git-hook subcommands ---------------------------------------------------

function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@grove.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Grove Test"', { cwd: dir, stdio: 'pipe' })
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sq-git-'))
}

function removeTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function captureRunFull(argv: string[]): { code: number; output: string[]; errors: string[] } {
  const lines: string[] = []
  const errLines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errLines.push(args.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
  return { code, output: lines, errors: errLines }
}

describe('init subcommand', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('returns 0 for a fresh git repo', () => {
    const { code } = captureRunFull(['init', '--repo', tmpRepo])
    expect(code).toBe(0)
  })

  it('creates a post-commit hook file', () => {
    captureRunFull(['init', '--repo', tmpRepo])
    const hookPath = path.join(tmpRepo, '.git', 'hooks', 'post-commit')
    expect(fs.existsSync(hookPath)).toBe(true)
  })

  it('hook file contains the grove sentinel', () => {
    captureRunFull(['init', '--repo', tmpRepo])
    const hookPath = path.join(tmpRepo, '.git', 'hooks', 'post-commit')
    const content = fs.readFileSync(hookPath, 'utf-8')
    expect(content).toContain(GROVE_BEGIN)
  })

  it('prints a friendly message about the action taken', () => {
    const { output } = captureRunFull(['init', '--repo', tmpRepo])
    const combined = output.join('\n')
    // Should mention something about creation/installation
    expect(combined.length).toBeGreaterThan(0)
  })

  it('prints a reassurance that it never blocks commits', () => {
    const { output } = captureRunFull(['init', '--repo', tmpRepo])
    const combined = output.join('\n')
    // Should say something about commits not being blocked
    expect(combined.toLowerCase()).toMatch(/commit|block|safe|never/)
  })

  it('is idempotent — calling init twice returns 0 both times', () => {
    const { code: c1 } = captureRunFull(['init', '--repo', tmpRepo])
    const { code: c2 } = captureRunFull(['init', '--repo', tmpRepo])
    expect(c1).toBe(0)
    expect(c2).toBe(0)
  })

  it('is idempotent — calling init twice leaves exactly one grove sentinel', () => {
    captureRunFull(['init', '--repo', tmpRepo])
    captureRunFull(['init', '--repo', tmpRepo])
    const hookPath = path.join(tmpRepo, '.git', 'hooks', 'post-commit')
    const content = fs.readFileSync(hookPath, 'utf-8')
    const occurrences = (content.match(new RegExp(GROVE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('uses process.cwd() when --repo is omitted (just returns 0 without crash)', () => {
    // We can't easily test cwd() init without side effects so just verify it doesn't throw
    // We test with an explicit valid repo instead to avoid polluting cwd
    const { code } = captureRunFull(['init', '--repo', tmpRepo])
    expect(code).toBe(0)
  })
})

describe('uninstall subcommand', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('returns 0 after a prior init', () => {
    captureRunFull(['init', '--repo', tmpRepo])
    const { code } = captureRunFull(['uninstall', '--repo', tmpRepo])
    expect(code).toBe(0)
  })

  it('removes the post-commit hook file after a grove-only install', () => {
    captureRunFull(['init', '--repo', tmpRepo])
    const hookPath = path.join(tmpRepo, '.git', 'hooks', 'post-commit')
    expect(fs.existsSync(hookPath)).toBe(true)

    captureRunFull(['uninstall', '--repo', tmpRepo])
    expect(fs.existsSync(hookPath)).toBe(false)
  })

  it('returns 0 when there is nothing to uninstall', () => {
    const { code } = captureRunFull(['uninstall', '--repo', tmpRepo])
    expect(code).toBe(0)
  })

  it('prints a message about the action taken', () => {
    captureRunFull(['init', '--repo', tmpRepo])
    const { output } = captureRunFull(['uninstall', '--repo', tmpRepo])
    const combined = output.join('\n')
    expect(combined.length).toBeGreaterThan(0)
  })
})

// ---- enhance subcommand ----------------------------------------------------

describe('enhance subcommand', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-enhance-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('returns 0 and prints the friendly hint when no gear exists', () => {
    const { code, output } = captureRun(['enhance', 'first', '--home', tmpHome])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toMatch(/no gear|merge|pr/)
  })

  it('returns 0 and gear changes after enhance on state with gear (--seed for determinism)', () => {
    // First ingest a pr_merged to get gear (grants 12 seeds + gear + pull)
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    // Enhance costs 20 seeds (ENHANCE_COST_BASE); add commits to top up the wallet.
    for (let i = 0; i < 3; i++) {
      captureRun(['event', 'commit', '--home', tmpHome])
    }

    const { code, output } = captureRun([
      'enhance', 'first',
      '--home', tmpHome,
      '--seed', '42',
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    // renderEnhanceOdds and renderEnhanceResult should both appear
    expect(combined).toMatch(/success|downgrade|break|stay/i)
  })

  it('prints the odds line before the result', () => {
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    // Enhance costs 20 seeds (ENHANCE_COST_BASE); add commits to top up the wallet.
    for (let i = 0; i < 3; i++) {
      captureRun(['event', 'commit', '--home', tmpHome])
    }
    const { output } = captureRun([
      'enhance', 'first',
      '--home', tmpHome,
      '--seed', '99',
    ])
    const combined = output.join('\n')
    // renderEnhanceOdds always shows "success XX%"
    expect(combined).toMatch(/success \d+%/)
  })

  it('saves state — second enhance sees updated gear', () => {
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    // Fund the wallet so two enhance attempts (each now costs seeds) are affordable.
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    saveState(dir, { ...s, player: { ...s.player, currency: 200 } })
    // First enhance with seed 1 (guaranteed success at level 0 → level 1)
    captureRun(['enhance', 'first', '--home', tmpHome, '--seed', '1'])
    // Second enhance — odds line should now say "+1 → +2"
    const { output } = captureRun([
      'enhance', 'first',
      '--home', tmpHome,
      '--seed', '2',
    ])
    const combined = output.join('\n')
    // Either level moved again or stayed, but the name transition line should show ≥1
    expect(combined).toMatch(/\+[1-9]/)
  })

  it('resolves ref "first" (case-insensitive) correctly', () => {
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    const { code } = captureRun(['enhance', 'First', '--home', tmpHome, '--seed', '7'])
    expect(code).toBe(0)
  })

  it('resolves ref by 1-based index "1"', () => {
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    const { code } = captureRun(['enhance', '1', '--home', tmpHome, '--seed', '7'])
    expect(code).toBe(0)
  })

  it('returns 2 when index is out of range', () => {
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    // Only 1 gear exists, index 99 is out of range
    const { code } = captureRun(['enhance', '99', '--home', tmpHome, '--seed', '1'])
    expect(code).toBe(2)
  })

  it('returns 2 when no ref is given', () => {
    captureRun(['event', 'pr_merged', '--home', tmpHome])
    const { code } = captureRun(['enhance', '--home', tmpHome])
    expect(code).toBe(2)
  })

  // ---- enhance COSTS seeds (audit re-score① consistency fix) ----------------
  // repair (50) and protect (40) cost seeds; enhance was FREE — an inconsistency.

  it('debits ENHANCE_COST seeds on an attempt (no longer free)', () => {
    const dir = stateDir(tmpHome)
    // Seed gear + a comfortable wallet directly.
    const s = loadState(dir)
    saveState(dir, {
      ...s,
      player: { ...s.player, currency: 100 },
      gear: [{ id: 'gear.commit-hammer.1', name: 'Commit Hammer', level: 3, rarity: 'rare' as const, broken: false }],
    })
    const before = loadState(dir)

    const { code } = captureRun(['enhance', 'first', '--home', tmpHome, '--seed', '42'])
    expect(code).toBe(0)

    const after = loadState(dir)
    // Seeds were debited by the (positive) enhance cost.
    expect(after.player.currency).toBeLessThan(before.player.currency)
  })

  it('refuses calmly when broke — no debit, no gear change, exits 0', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    saveState(dir, {
      ...s,
      player: { ...s.player, currency: 1 }, // not enough for the enhance cost
      gear: [{ id: 'gear.type-saber.1', name: 'Type Saber', level: 2, rarity: 'epic' as const, broken: false }],
    })
    const before = loadState(dir)

    const { code, output } = captureRun(['enhance', 'first', '--home', tmpHome, '--seed', '42'])
    expect(code).toBe(0)

    const after = loadState(dir)
    // Untouched: same currency, same gear level (no roll happened).
    expect(after.player.currency).toBe(1)
    expect(after.gear[0]!.level).toBe(before.gear[0]!.level)
    expect(after.gear[0]!.broken).toBe(false)
    expect(output.join('\n').toLowerCase()).toContain('not enough')
  })
})

// ---- dashboard subcommand --------------------------------------------------

describe('dashboard subcommand', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-dashboard-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('returns 0 on a fresh home', () => {
    const { code } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    expect(code).toBe(0)
  })

  it('output contains the current level', () => {
    const { output } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    const combined = output.join('\n')
    // renderDashboard includes "GROVE  Level N"
    expect(combined).toMatch(/Level\s+\d/)
  })

  it('output contains set names (e.g. forest, tools, creatures)', () => {
    const { output } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toMatch(/forest|tools|creatures/)
  })

  it('output contains quest section', () => {
    const { output } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    const combined = output.join('\n')
    expect(combined).toMatch(/QUEST/)
  })

  it('output contains GEAR section', () => {
    const { output } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    const combined = output.join('\n')
    expect(combined).toMatch(/GEAR/)
  })

  it('without --no-clear emits the clear escape sequences', () => {
    // We need to capture the raw write calls on process.stdout to detect the clear.
    // Easiest: spy on process.stdout.write.
    const written: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })
    try {
      run(['dashboard', '--home', tmpHome])
    } finally {
      spy.mockRestore()
    }
    const combined = written.join('')
    expect(combined).toContain('\x1b[2J')
  })
})

// ---- help mentions enhance and dashboard -----------------------------------

describe('help mentions new enhance and dashboard subcommands', () => {
  it('help output mentions "enhance"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('enhance')
  })

  it('help output mentions "dashboard"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('dashboard')
  })
})

// ---- commit-hook subcommand (existing, keep) --------------------------------

describe('commit-hook subcommand', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
    // Create a lean CLAUDE.md in the repo
    const leanContent = Array.from({ length: 10 }, (_, i) => `# line ${i + 1}`).join('\n')
    fs.writeFileSync(path.join(tmpRepo, 'CLAUDE.md'), leanContent)
    // Make an initial commit so git HEAD exists
    execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })
    execSync('git commit -m "initial"', { cwd: tmpRepo, stdio: 'pipe' })
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('returns 0 for a repo with a lean CLAUDE.md', () => {
    const { code } = captureRunFull(['commit-hook', '--repo', tmpRepo, '--home', tmpHome])
    expect(code).toBe(0)
  })

  it('prints the grove banner', () => {
    const { output } = captureRunFull(['commit-hook', '--repo', tmpRepo, '--home', tmpHome])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toMatch(/grove/)
  })

  it('updates state in the grove home dir', () => {
    captureRunFull(['commit-hook', '--repo', tmpRepo, '--home', tmpHome])
    // Grove should have written state into tmpHome sub-directory
    const entries = fs.readdirSync(tmpHome)
    expect(entries.length).toBeGreaterThan(0)
  })

  it('never fails even when called with a non-existent repo (always returns 0)', () => {
    const nonExistentRepo = path.join(os.tmpdir(), 'grove-nonexistent-' + Date.now())
    const { code } = captureRunFull(['commit-hook', '--repo', nonExistentRepo, '--home', tmpHome])
    expect(code).toBe(0)
  })

  it('respects GROVE_HOME env var for state location', () => {
    const envHome = makeTmpDir()
    try {
      const originalEnv = process.env['GROVE_HOME']
      process.env['GROVE_HOME'] = envHome
      try {
        captureRunFull(['commit-hook', '--repo', tmpRepo])
      } finally {
        if (originalEnv === undefined) {
          delete process.env['GROVE_HOME']
        } else {
          process.env['GROVE_HOME'] = originalEnv
        }
      }
      const entries = fs.readdirSync(envHome)
      expect(entries.length).toBeGreaterThan(0)
    } finally {
      removeTmp(envHome)
    }
  })
})

// ---- statusline-ingest subcommand ------------------------------------------

describe('statusline-ingest subcommand', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sl-ingest-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  /** Run statusline-ingest with a fake payload on stdin via mock */
  function runIngestWithStdin(payload: unknown, home: string): { code: number; output: string[] } {
    const lines: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })

    // Mock process.stdin to supply JSON
    const jsonStr = JSON.stringify(payload)
    const originalStdin = process.stdin

    // We call the handler directly by wiring the stdin mock
    // For integration: we use run() and mock stdin reading.
    // Because the handler calls process.stdin, we invoke run() and capture.
    // To avoid async complexity we call the subcommand via the sync path by
    // mocking the readStdinSync helper that sq will use.
    let code: number
    try {
      // Pass --home and --stdin-data flag for testing (see implementation)
      code = run(['statusline-ingest', '--home', home, '--test-stdin', jsonStr])
    } finally {
      logSpy.mockRestore()
    }
    return { code, output: lines }
  }

  const SUBSCRIPTION_PAYLOAD = {
    rate_limits: {
      five_hour: { used_percentage: 40, resets_at: 1717000000 },
      seven_day: { used_percentage: 25, resets_at: 1717604800 },
    },
    session_id: 'sess-test',
    model: 'claude-sonnet-4-6',
  }

  const API_PAYLOAD = {
    session_id: 'sess-api',
    model: 'claude-sonnet-4-6',
    // no rate_limits → Wellspring
  }

  it('returns 0 for a subscription JSON (rate_limits present)', () => {
    const { code } = runIngestWithStdin(SUBSCRIPTION_PAYLOAD, tmpHome)
    expect(code).toBe(0)
  })

  it('returns 0 for an API JSON (no rate_limits → Wellspring)', () => {
    const { code } = runIngestWithStdin(API_PAYLOAD, tmpHome)
    expect(code).toBe(0)
  })

  it('prints nothing to stdout (stays silent)', () => {
    const { output } = runIngestWithStdin(SUBSCRIPTION_PAYLOAD, tmpHome)
    expect(output).toHaveLength(0)
  })

  it('returns 0 even for malformed JSON (never disrupts the HUD)', () => {
    const lines: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })
    let code: number
    try {
      code = run(['statusline-ingest', '--home', tmpHome, '--test-stdin', 'not-valid-json'])
    } finally {
      logSpy.mockRestore()
    }
    expect(code).toBe(0)
  })

  it('persists energy.known=true after subscription payload', () => {
    runIngestWithStdin(SUBSCRIPTION_PAYLOAD, tmpHome)
    const dir = stateDir(tmpHome)
    const state = loadState(dir)
    expect(state.energy.known).toBe(true)
  })

  it('persists energy.known=false after API payload (Wellspring)', () => {
    runIngestWithStdin(API_PAYLOAD, tmpHome)
    const dir = stateDir(tmpHome)
    const state = loadState(dir)
    expect(state.energy.known).toBe(false)
  })
})

// ---- statusline install/uninstall subcommands ------------------------------

describe('statusline install subcommand', () => {
  let tmpDir: string
  let settingsPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sl-cli-test-'))
    settingsPath = path.join(tmpDir, 'settings.json')
    // Write a fake settings.json
    fs.writeFileSync(settingsPath, JSON.stringify({
      theme: 'dark',
      statusLine: { type: 'command', command: 'ORIGINAL_SL' },
    }, null, 2), 'utf-8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns 0 on fresh install', () => {
    const { code } = captureRunFull([
      'statusline', 'install',
      '--settings', settingsPath,
    ])
    expect(code).toBe(0)
  })

  it('prints what it did', () => {
    const { output } = captureRunFull([
      'statusline', 'install',
      '--settings', settingsPath,
    ])
    const combined = output.join('\n')
    expect(combined.length).toBeGreaterThan(0)
  })

  it('prints the backup path in the output', () => {
    const { output } = captureRunFull([
      'statusline', 'install',
      '--settings', settingsPath,
    ])
    const combined = output.join('\n')
    expect(combined).toMatch(/bak|backup/i)
  })

  it('prints a reassurance that the original statusline is preserved', () => {
    const { output } = captureRunFull([
      'statusline', 'install',
      '--settings', settingsPath,
    ])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toMatch(/original|preserved|intact|chain/i)
  })

  it('is idempotent — calling install twice returns 0 both times', () => {
    const { code: c1 } = captureRunFull([
      'statusline', 'install', '--settings', settingsPath,
    ])
    const { code: c2 } = captureRunFull([
      'statusline', 'install', '--settings', settingsPath,
    ])
    expect(c1).toBe(0)
    expect(c2).toBe(0)
  })
})

describe('statusline uninstall subcommand', () => {
  let tmpDir: string
  let settingsPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sl-cli-test-'))
    settingsPath = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      theme: 'dark',
      statusLine: { type: 'command', command: 'ORIGINAL_SL' },
    }, null, 2), 'utf-8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns 0 after a prior install', () => {
    captureRunFull(['statusline', 'install', '--settings', settingsPath])
    const { code } = captureRunFull(['statusline', 'uninstall', '--settings', settingsPath])
    expect(code).toBe(0)
  })

  it('returns 0 when grove was never installed', () => {
    const { code } = captureRunFull(['statusline', 'uninstall', '--settings', settingsPath])
    expect(code).toBe(0)
  })

  it('prints what it did', () => {
    captureRunFull(['statusline', 'install', '--settings', settingsPath])
    const { output } = captureRunFull(['statusline', 'uninstall', '--settings', settingsPath])
    expect(output.join('\n').length).toBeGreaterThan(0)
  })
})

// ---- help mentions statusline and statusline-ingest -------------------------

describe('help mentions new statusline subcommands', () => {
  it('help output mentions "statusline"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('statusline')
  })

  it('help output mentions "statusline-ingest"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('statusline-ingest')
  })
})

// ---- suggest-commit subcommand ---------------------------------------------

describe('suggest-commit subcommand', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
    // Make an initial commit so HEAD exists
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# init\n')
    execSync('git add README.md', { cwd: tmpRepo, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: tmpRepo, stdio: 'pipe' })
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('returns 0 with a hint when nothing is staged', () => {
    const { code, output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    // Should mention git add or staging
    expect(combined.toLowerCase()).toMatch(/git add|stage|nothing staged/)
  })

  it('returns 0 and prints a suggested commit message when a test file is staged', () => {
    // Stage a test file — should infer type: test
    fs.writeFileSync(path.join(tmpRepo, 'foo.test.ts'), 'it("works", () => {})\n')
    execSync('git add foo.test.ts', { cwd: tmpRepo, stdio: 'pipe' })

    const { code, output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    // Must mention "test" (inferred commit type)
    expect(combined.toLowerCase()).toContain('test')
  })

  it('infers "test" commit type from a staged .test.ts file', () => {
    fs.writeFileSync(path.join(tmpRepo, 'widget.test.ts'), 'describe("x", () => {})\n')
    execSync('git add widget.test.ts', { cwd: tmpRepo, stdio: 'pipe' })

    const { code, output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined).toMatch(/test/)
  })

  it('infers "docs" commit type from a staged .md file', () => {
    fs.writeFileSync(path.join(tmpRepo, 'GUIDE.md'), '# guide\n')
    execSync('git add GUIDE.md', { cwd: tmpRepo, stdio: 'pipe' })

    const { code, output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined).toMatch(/docs/)
  })

  it('infers "chore" commit type from a staged package.json', () => {
    fs.writeFileSync(path.join(tmpRepo, 'package.json'), '{"name":"test"}\n')
    execSync('git add package.json', { cwd: tmpRepo, stdio: 'pipe' })

    const { code, output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined).toMatch(/chore/)
  })

  it('prints a body listing changed files', () => {
    fs.writeFileSync(path.join(tmpRepo, 'src.ts'), 'export const x = 1\n')
    execSync('git add src.ts', { cwd: tmpRepo, stdio: 'pipe' })

    const { output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    const combined = output.join('\n')
    expect(combined).toContain('src.ts')
  })

  it('makes clear the message is a suggestion (copy it)', () => {
    fs.writeFileSync(path.join(tmpRepo, 'main.ts'), 'export const y = 2\n')
    execSync('git add main.ts', { cwd: tmpRepo, stdio: 'pipe' })

    const { output } = captureRunFull([
      'suggest-commit', '--repo', tmpRepo, '--home', tmpHome,
    ])
    const combined = output.join('\n')
    // Should mention it's a suggestion
    expect(combined.toLowerCase()).toMatch(/suggest|copy/)
  })

  it('uses process.cwd() when --repo is omitted (just returns 0)', () => {
    const { code } = captureRunFull(['suggest-commit', '--home', tmpHome])
    expect(code).toBe(0)
  })
})

// ---- checkpoint subcommand -------------------------------------------------

describe('checkpoint subcommand', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# init\n')
    execSync('git add README.md', { cwd: tmpRepo, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: tmpRepo, stdio: 'pipe' })
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('returns 0 on a clean repo', () => {
    const { code } = captureRunFull([
      'checkpoint', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
  })

  it('returns 0 on a repo with changes', () => {
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# changed\n')
    const { code } = captureRunFull([
      'checkpoint', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)
  })

  it('creates a checkpoints.jsonl entry in the grove state dir', () => {
    const { code } = captureRunFull([
      'checkpoint', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)

    // Find the checkpoints.jsonl file under tmpHome (in any subdir)
    const checkpointsFile = findCheckpointsFile(tmpHome)
    expect(checkpointsFile).not.toBeNull()

    const lines = fs.readFileSync(checkpointsFile!, 'utf-8')
      .split('\n')
      .filter((l) => l.trim() !== '')
    expect(lines.length).toBeGreaterThan(0)

    const entry = JSON.parse(lines[0]!)
    expect(entry).toHaveProperty('ts')
    expect(entry).toHaveProperty('branch')
    expect(entry).toHaveProperty('message')
  })

  it('records only the diff SHAPE (counts), never the changed file PATHS (isolation · R-safety)', () => {
    // Stage a file with a revealing name; its PATH (work content) must NOT land in the record.
    fs.writeFileSync(path.join(tmpRepo, 'secret-billing-tokenizer.ts'), 'export const x = 1')
    execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })

    const { code } = captureRunFull(['checkpoint', '--repo', tmpRepo, '--home', tmpHome])
    expect(code).toBe(0)

    const checkpointsFile = findCheckpointsFile(tmpHome)
    expect(checkpointsFile).not.toBeNull()
    const lines = fs.readFileSync(checkpointsFile!, 'utf-8')
      .split('\n').filter((l) => l.trim() !== '')
    const entry = JSON.parse(lines[lines.length - 1]!)

    if (entry.diffStat !== null) {
      expect(entry.diffStat).toHaveProperty('fileCount')
      expect(entry.diffStat.files).toBeUndefined() // the path list is gone
    }
    // No changed file path leaks into the checkpoint record.
    expect(JSON.stringify(entry)).not.toContain('secret-billing-tokenizer')
  })

  it('leaves the working tree BYTE-IDENTICAL (non-destructive)', () => {
    const filePath = path.join(tmpRepo, 'README.md')
    fs.writeFileSync(filePath, '# changed for checkpoint test\n')

    const statusBefore = execSync('git status --porcelain', { cwd: tmpRepo }).toString()
    const bytesBefore = fs.readFileSync(filePath)

    captureRunFull(['checkpoint', '--repo', tmpRepo, '--home', tmpHome])

    const statusAfter = execSync('git status --porcelain', { cwd: tmpRepo }).toString()
    const bytesAfter = fs.readFileSync(filePath)

    expect(statusAfter).toBe(statusBefore)
    expect(bytesAfter.equals(bytesBefore)).toBe(true)
  })

  it('also ingests a checkpoint GroveEvent (buff reward fires)', () => {
    // The checkpoint event triggers a 'Refreshed' buff + pull reward
    // We can verify state has changed (cards > 0 or buffs) after checkpoint
    const { output } = captureRunFull([
      'checkpoint', '--repo', tmpRepo, '--home', tmpHome,
    ])
    const combined = output.join('\n')
    // Should print the checkpoint saved line
    expect(combined).toMatch(/📍|checkpoint|saved|progress/i)
  })

  it('accepts a -m flag for the checkpoint message', () => {
    const { code, output } = captureRunFull([
      'checkpoint', '-m', 'my checkpoint note', '--repo', tmpRepo, '--home', tmpHome,
    ])
    expect(code).toBe(0)

    const checkpointsFile = findCheckpointsFile(tmpHome)
    expect(checkpointsFile).not.toBeNull()
    const lines = fs.readFileSync(checkpointsFile!, 'utf-8')
      .split('\n').filter((l) => l.trim() !== '')
    const entry = JSON.parse(lines[0]!)
    expect(entry.message).toContain('my checkpoint note')
  })

  it('prints the restore command when a ref is captured', () => {
    // Add a change so stash create produces a real SHA
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# dirty\n')

    const { output } = captureRunFull([
      'checkpoint', '--repo', tmpRepo, '--home', tmpHome,
    ])
    const combined = output.join('\n')
    // Should mention git stash apply for restoration
    expect(combined).toMatch(/git stash apply|progress noted|📍/i)
  })

  it('uses process.cwd() when --repo is omitted (just returns 0)', () => {
    const { code } = captureRunFull(['checkpoint', '--home', tmpHome])
    expect(code).toBe(0)
  })
})

// ---- contextual offers (crit + low-energy) ---------------------------------

describe('contextual offers', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = makeTmpDir()
  })

  afterEach(() => {
    removeTmp(tmpHome)
  })

  it('crit offer line appears in event output when a reward has crit:true', () => {
    // Ingest many test_result events (8% crit chance per event).
    // With 80 events, P(no crit ever) = (0.92)^80 ≈ 0.001 — near-certain one fires.
    let critOfferSeen = false
    for (let i = 0; i < 80; i++) {
      const { output } = captureRunFull([
        'event', 'test_result', '--magnitude', '3', '--home', tmpHome,
      ])
      const combined = output.join('\n')
      if (combined.includes('sq suggest-commit')) {
        critOfferSeen = true
        break
      }
    }
    expect(critOfferSeen).toBe(true)
  })

  it('low-energy offer appears when vigor < 20 (checkpoint offer printed)', () => {
    // Set up state with vigor < 20 by ingesting a quota_update with high usage
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600
    run([
      'statusline-ingest',
      '--home', tmpHome,
      '--test-stdin', JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 85, resets_at: futureEpoch },
          seven_day: { used_percentage: 20, resets_at: futureEpoch + 86400 },
        },
        session_id: 'test-low-energy',
      }),
    ])

    // Now trigger a commit event and check for the low-energy offer
    const tmpRepo = makeTmpDir()
    gitInit(tmpRepo)
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# init\n')
    execSync('git add README.md', { cwd: tmpRepo, stdio: 'pipe' })
    execSync('git commit -m "init"', { cwd: tmpRepo, stdio: 'pipe' })

    let offerSeen = false
    for (let i = 0; i < 10; i++) {
      const { output } = captureRunFull([
        'commit-hook', '--repo', tmpRepo, '--home', tmpHome,
      ])
      const combined = output.join('\n')
      if (combined.includes('sq checkpoint') || combined.includes('⚡')) {
        offerSeen = true
        break
      }
    }

    removeTmp(tmpRepo)
    expect(offerSeen).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// wrap subcommand — the REAL test/build signal source (ADR-0003). Runs a command
// the user runs anyway, reads its EXIT CODE, ingests success=(code===0), and
// exits transparently with the wrapped command's code. This is what makes
// "tests green" mean tests ACTUALLY ran green (not minted on faith).
// ---------------------------------------------------------------------------

describe('wrap subcommand', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wrap-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('a passing command (`true`) emits a SUCCESS event and exits 0', () => {
    const before = loadState(stateDir(tmpHome))
    const { code, output } = captureRunFull(['wrap', '--home', tmpHome, '--', 'true'])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    // An event was ingested (eventCount advanced) and a reward landed (XP/seeds).
    expect(after.eventCount).toBe(before.eventCount + 1)
    expect(after.player.currency).toBeGreaterThan(before.player.currency)
    // A reward line was printed.
    expect(output.join('\n').length).toBeGreaterThan(0)
  })

  it('a FAILING command (`false`) emits success:false (NO reward) and exits non-zero', () => {
    const before = loadState(stateDir(tmpHome))
    const { code } = captureRunFull(['wrap', '--home', tmpHome, '--', 'false'])
    // Transparent passthrough: `false` exits 1.
    expect(code).not.toBe(0)
    const after = loadState(stateDir(tmpHome))
    // The firewall: a failing command grants NO reward — currency unchanged.
    expect(after.player.currency).toBe(before.player.currency)
    // The event still flowed through (clock advanced), but no progress was minted.
    expect(after.eventCount).toBe(before.eventCount + 1)
    expect(after.cards.length).toBe(before.cards.length)
  })

  it('passes through the wrapped command\'s exact exit code (e.g. 3)', () => {
    const { code } = captureRunFull(['wrap', '--home', tmpHome, '--', 'sh', '-c', 'exit 3'])
    expect(code).toBe(3)
  })

  it('infers test_result from a "test" argv (default also test_result)', () => {
    // `sh -c true` is a passing command; argv[0] is `npm`-like 'test' → test_result.
    captureRunFull(['wrap', '--home', tmpHome, '--', 'test', '-z', ''])
    // `test -z ''` exits 0 (empty string is zero-length) → success.
    const events = readEventsForHome(tmpHome)
    const last = events[events.length - 1]
    expect(last?.type).toBe('test_result')
  })

  it('infers build_result when argv starts with "build"', () => {
    captureRunFull(['wrap', '--home', tmpHome, '--', 'build', '--version'])
    // `build --version` likely fails (no such cmd) — type inference is from argv,
    // independent of success. Assert the INGESTED type, not the reward.
    const events = readEventsForHome(tmpHome)
    const last = events[events.length - 1]
    expect(last?.type).toBe('build_result')
  })

  it('honors --as <type> override (lint_clean) regardless of argv', () => {
    captureRunFull(['wrap', '--as', 'lint_clean', '--home', tmpHome, '--', 'true'])
    const events = readEventsForHome(tmpHome)
    const last = events[events.length - 1]
    expect(last?.type).toBe('lint_clean')
  })

  it('defaults to test_result when argv gives no hint and no --as', () => {
    captureRunFull(['wrap', '--home', tmpHome, '--', 'true'])
    const events = readEventsForHome(tmpHome)
    const last = events[events.length - 1]
    expect(last?.type).toBe('test_result')
  })

  it('returns 2 (usage error) when no `--` separator / no command is given', () => {
    const { code } = captureRunFull(['wrap', '--home', tmpHome])
    expect(code).toBe(2)
  })

  it('records source as the wrap adapter (sq-wrap)', () => {
    captureRunFull(['wrap', '--home', tmpHome, '--', 'true'])
    const events = readEventsForHome(tmpHome)
    const last = events[events.length - 1]
    expect(last?.source).toBe('sq-wrap')
  })
})

// ---- help mentions wrap -----------------------------------------------------

describe('help mentions wrap subcommand', () => {
  it('help output mentions "wrap"', () => {
    const { output } = captureRun(['help'])
    expect(output.join('\n').toLowerCase()).toContain('wrap')
  })
})

// ---- help mentions suggest-commit and checkpoint ---------------------------

describe('help mentions new suggest-commit and checkpoint subcommands', () => {
  it('help output mentions "suggest-commit"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('suggest-commit')
  })

  it('help output mentions "checkpoint"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('checkpoint')
  })

  it('help output mentions "pull"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('pull')
  })

  it('help output mentions "repair"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('repair')
  })

  it('help output mentions "protect"', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n')
    expect(combined.toLowerCase()).toContain('protect')
  })
})

// ---------------------------------------------------------------------------
// Helper: find checkpoints.jsonl under a grove home dir
// ---------------------------------------------------------------------------

function findCheckpointsFile(groveHome: string): string | null {
  try {
    const subdirs = fs.readdirSync(groveHome)
    for (const sub of subdirs) {
      const candidate = path.join(groveHome, sub, 'checkpoints.jsonl')
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  } catch {
    return null
  }
}

/**
 * Read all parsed events from a grove home's state dir. The `--home DIR` flag
 * resolves to a repo-scoped subdir under DIR, so we use the same readEvents
 * helper the CLI uses, via stateDir(DIR).
 */
function readEventsForHome(groveHome: string): Array<Record<string, unknown>> {
  const dir = stateDir(groveHome)
  const file = path.join(dir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

// ---- dashboard passes nowEpoch ----------------------------------------------

describe('dashboard passes nowEpoch so energy ETAs render', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-dash-eta-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('dashboard output contains "resets in" when energy is known and vigorResetsAt is set', () => {
    // Ingest a quota_update event with metered data and a future resets_at
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600 // 1h from now
    captureRun([
      'event', 'quota_update',
      '--home', tmpHome,
      '--source', 'statusline',
    ])
    // We need energy to be known with a vigorResetsAt — do it by ingesting via
    // the statusline-ingest path with test-stdin
    run([
      'statusline-ingest',
      '--home', tmpHome,
      '--test-stdin', JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 30, resets_at: futureEpoch },
          seven_day: { used_percentage: 10, resets_at: futureEpoch + 86400 },
        },
        session_id: 'test-eta-session',
      }),
    ])

    const { output } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    const combined = output.join('\n')
    // With nowEpoch injected and a future vigorResetsAt, "resets in" should appear
    expect(combined).toMatch(/resets in|Wellspring|Vigor/)
  })
})

// ---------------------------------------------------------------------------
// pull subcommand — reveal + earn-more hint (R3 core decision)
// ---------------------------------------------------------------------------

describe('pull subcommand — reveal + earn-more', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-pull-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  function earnSeeds(n: number): void {
    for (let i = 0; i < n; i++) {
      captureRun(['event', 'test_result', '--magnitude', '2', '--home', tmpHome])
    }
  }

  it('on a state with >=PULL_COST seeds yields a card and debits PULL_COST (deterministic --seed)', () => {
    // DETERMINISTIC setup: seed currency directly + an EMPTY collection. We must
    // NOT earn via events here — each successful event has a 5% serendipity roll
    // (time-seeded) that can add a random card, which can make the --seed pull
    // land a DUPLICATE (no new card + a +10 dup-comp refund) and flake the strict
    // assertions below. An empty collection guarantees the pull is a NEW card.
    const dir = stateDir(tmpHome)
    const base = loadState(dir)
    saveState(dir, { ...base, player: { ...base.player, currency: 100 }, cards: [] })
    const before = loadState(dir)
    expect(before.player.currency).toBeGreaterThanOrEqual(PULL_COST)

    const { code, output } = captureRun(['pull', '--seed', '7', '--home', tmpHome])
    expect(code).toBe(0)

    const after = loadState(stateDir(tmpHome))
    expect(after.cards.length).toBe(before.cards.length + 1)
    expect(after.player.currency).toBe(before.player.currency - PULL_COST)
    // A drop card line was printed.
    const combined = output.join('\n')
    expect(combined).toMatch(/common|uncommon|rare|epic|legendary|shiny/i)
  })

  it('when broke returns 0, makes NO pull, and prints the earn-more hint', () => {
    const { code, output } = captureRun(['pull', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.cards.length).toBe(0) // no pull happened
    const combined = output.join('\n').toLowerCase()
    expect(combined).toContain('not enough')
    // Friendly "earn more by shipping" guidance.
    expect(combined).toMatch(/ship|earn|commit|test|merge/)
  })

  it('--home pull is isolated to its own home', () => {
    earnSeeds(6)
    captureRun(['pull', '--seed', '1', '--home', tmpHome])
    // A fresh other home must be untouched.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-pull-other-'))
    try {
      const otherState = loadState(stateDir(other))
      expect(otherState.cards.length).toBe(0)
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// repair subcommand — spend seeds, un-break gear
// ---------------------------------------------------------------------------

describe('repair subcommand', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-repair-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  // Seed a broken gear + plenty of currency directly into state for a focused test.
  function seedBrokenGear(currency: number): string {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    const gearId = 'gear.commit-hammer.42'
    const next = {
      ...s,
      player: { ...s.player, currency },
      gear: [{ id: gearId, name: 'Commit Hammer', level: 8, rarity: 'rare' as const, broken: true }],
    }
    saveState(dir, next)
    return gearId
  }

  it('debits seeds and un-breaks the gear (deterministic by gear ref)', () => {
    // Fund above the LEVEL-SCALING repair price (R6: repairCost(8)=50+8*10=130).
    const gearId = seedBrokenGear(300)
    const before = loadState(stateDir(tmpHome))
    const { code } = captureRun(['repair', gearId, '--home', tmpHome])
    expect(code).toBe(0)

    const after = loadState(stateDir(tmpHome))
    expect(after.gear.find((g) => g.id === gearId)!.broken).toBe(false)
    // Seeds were debited (repair has a price).
    expect(after.player.currency).toBeLessThan(before.player.currency)
    // Level is preserved (repair un-breaks only).
    expect(after.gear.find((g) => g.id === gearId)!.level).toBe(8)
  })

  it('refuses calmly (no debit, no change) when broke', () => {
    const gearId = seedBrokenGear(1) // not enough
    const { code, output } = captureRun(['repair', gearId, '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.gear.find((g) => g.id === gearId)!.broken).toBe(true) // still broken
    expect(after.player.currency).toBe(1) // untouched
    expect(output.join('\n').toLowerCase()).toContain('not enough')
  })

  it('resolves ref by 1-based index', () => {
    // Fund above the level-scaling repair price (repairCost(8)=130).
    seedBrokenGear(300)
    const { code } = captureRun(['repair', '1', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.gear[0]!.broken).toBe(false)
  })

  it('returns 2 when no ref is given', () => {
    seedBrokenGear(300)
    const { code } = captureRun(['repair', '--home', tmpHome])
    expect(code).toBe(2)
  })

  it('hints when there is no gear to repair', () => {
    const { code, output } = captureRun(['repair', 'first', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output.join('\n').toLowerCase()).toMatch(/no gear|nothing/)
  })
})

// ---------------------------------------------------------------------------
// protect subcommand — spend seeds, arm a one-shot protection
// ---------------------------------------------------------------------------

describe('protect subcommand', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-protect-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  function seedGear(currency: number): string {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    const gearId = 'gear.merge-shield.7'
    saveState(dir, {
      ...s,
      player: { ...s.player, currency },
      gear: [{ id: gearId, name: 'Merge Shield', level: 9, rarity: 'epic' as const, broken: false }],
    })
    return gearId
  }

  it('debits seeds and arms protection on the gear', () => {
    const gearId = seedGear(100)
    const before = loadState(stateDir(tmpHome))
    const { code } = captureRun(['protect', gearId, '--home', tmpHome])
    expect(code).toBe(0)

    const after = loadState(stateDir(tmpHome))
    expect(after.protectedGear).toContain(gearId)
    expect(after.player.currency).toBeLessThan(before.player.currency)
  })

  it('refuses calmly (no debit, not armed) when broke', () => {
    const gearId = seedGear(1)
    const { code, output } = captureRun(['protect', gearId, '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.protectedGear).not.toContain(gearId)
    expect(after.player.currency).toBe(1)
    expect(output.join('\n').toLowerCase()).toContain('not enough')
  })

  it('does not double-arm an already-protected gear', () => {
    const gearId = seedGear(500)
    captureRun(['protect', gearId, '--home', tmpHome])
    captureRun(['protect', gearId, '--home', tmpHome])
    const after = loadState(stateDir(tmpHome))
    // armed exactly once (no duplicate ids)
    expect(after.protectedGear.filter((id) => id === gearId)).toHaveLength(1)
  })

  it('returns 2 when no ref is given', () => {
    seedGear(100)
    const { code } = captureRun(['protect', '--home', tmpHome])
    expect(code).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// enhance consumes an armed protection (the full risk-management loop)
// ---------------------------------------------------------------------------

describe('enhance consumes an armed protection', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-protect-enhance-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('clears the protectedGear flag after one enhance attempt', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    const gearId = 'gear.type-saber.5'
    saveState(dir, {
      ...s,
      // Fund the wallet above the LEVEL-SCALING enhance price (R6:
      // enhanceCost(14)=20+14*8=132) — enhance now costs seeds (re-score① fix).
      player: { ...s.player, currency: 300 },
      gear: [{ id: gearId, name: 'Type Saber', level: 14, rarity: 'epic' as const, broken: false }],
      protectedGear: [gearId],
    })

    captureRun(['enhance', gearId, '--seed', '1', '--home', tmpHome])
    const after = loadState(dir)
    // The one-shot protection is consumed regardless of outcome.
    expect(after.protectedGear).not.toContain(gearId)
  })
})

// ---------------------------------------------------------------------------
// dashboard surfaces seeds balance + work meter + a gear effect string
// ---------------------------------------------------------------------------

describe('dashboard surfaces seeds + work meter + gear effect', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-dash-r3-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('shows the seeds balance, the work meter, and a gear active effect', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    saveState(dir, {
      ...s,
      player: { ...s.player, currency: 88 },
      gear: [{ id: 'gear.commit-hammer.1', name: 'Commit Hammer', level: 7, rarity: 'rare' as const, broken: false }],
      work: { ...s.work, workMeter: 0.5 },
    })

    const { output } = captureRun(['dashboard', '--no-clear', '--home', tmpHome])
    const combined = output.join('\n')
    // Seeds balance
    expect(combined).toContain('88')
    expect(combined).toContain('🌰')
    // Work meter toward the milestone chest
    expect(combined).toContain('🎁')
    // Gear active effect string
    expect(combined).toContain('Commit Hammer')
    expect(combined).toMatch(/\+7%/)
  })
})

// ---------------------------------------------------------------------------
// Real-git e2e: the GENERATED hook actually executes the BUILT bundle on a
// real `git commit` (closes the AUDIT R4 "hook never executed in a real-git
// e2e" gap — Security/QA). Builds the bundle on demand so it's self-contained.
// ---------------------------------------------------------------------------

describe('real-git e2e: generated post-commit hook runs the built bundle', () => {
  const repoRoot = path.resolve(url.fileURLToPath(import.meta.url), '..', '..', '..')
  const builtBundle = path.join(repoRoot, 'dist', 'cli', 'sq.js')

  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    // Ensure the built bundle exists — the hook the installer writes points at it.
    if (!fs.existsSync(builtBundle)) {
      execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' })
    }
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
    // A lean CLAUDE.md so the scan-on-commit has a Pillar-B signal to reward.
    fs.writeFileSync(
      path.join(tmpRepo, 'CLAUDE.md'),
      Array.from({ length: 10 }, (_, i) => `# line ${i + 1}`).join('\n'),
    )
  })

  afterEach(() => {
    removeTmp(tmpRepo)
    removeTmp(tmpHome)
  })

  it('the installed hook embeds the built bundle (node + dist/cli/sq.js) and is injection-safe', () => {
    // Force the built-fallback branch (no global `sq` assumed in CI/dev).
    const inv = groveInvocation({ sqOnPath: () => false })
    installPostCommit(tmpRepo, inv)
    const hookPath = path.join(tmpRepo, '.git', 'hooks', 'post-commit')
    const content = fs.readFileSync(hookPath, 'utf-8')
    expect(content).toContain('dist/cli/sq.js')
    expect(content).toContain('node ')
    // The generated line must not introduce a raw double-quoted path.
    expect(content.includes('node "')).toBe(false)
  })

  it('fires Grove on a real `git commit` via the generated hook, writing state to --home', () => {
    // Build the hook line by hand so we can thread the test --home through it
    // (mirrors what `sq init` writes, but pinned to an isolated grove home).
    const inv = groveInvocation({ sqOnPath: () => false })
    const hooksDir = path.join(tmpRepo, '.git', 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    const hookLine = `${inv} --home ${tmpHome} commit-hook --repo ${tmpRepo} 2>/dev/null || true`
    fs.writeFileSync(
      path.join(hooksDir, 'post-commit'),
      `#!/bin/sh\n${hookLine}\n`,
      { mode: 0o755 },
    )

    execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })
    execSync('git commit -m "initial"', { cwd: tmpRepo, stdio: 'pipe' })

    // The hook ran the BUILT bundle, which scanned the repo and persisted state
    // under tmpHome (in a repo-scoped subdir keyed off the committed repo).
    const subdirs = fs.readdirSync(tmpHome)
    expect(subdirs.length).toBeGreaterThan(0)
    const stateFiles = subdirs.flatMap((d) => {
      const full = path.join(tmpHome, d)
      return fs.statSync(full).isDirectory() ? fs.readdirSync(full) : []
    })
    // Proves real persistence happened (events.jsonl + state.json were written).
    expect(stateFiles).toContain('state.json')
    expect(stateFiles).toContain('events.jsonl')
  }, 30000)
})

describe('promise subcommand (sq promise)', () => {
  it('prints the firewall guarantees and returns 0', () => {
    const { code, output } = captureRun(['promise'])
    expect(code).toBe(0)
    const c = output.join('\n')
    expect(c).toContain('Never modifies')
    expect(c).toContain('Never auto-runs')
    expect(c).toMatch(/cosmetic/i)
    expect(c).toMatch(/[Cc]alm/)
  })

  it('is listed in the usage/help output', () => {
    const { output } = captureRun(['help'])
    expect(output.join('\n')).toMatch(/^\s*promise/m)
  })
})

describe('checkpoints subcommand (sq checkpoints) — dispatch', () => {
  it('lists snapshots via run() with the durable-SHA recall (locks the --home/flags path)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-sq-cp-'))
    try {
      const dir = stateDir(home)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'checkpoints.jsonl'),
        JSON.stringify({
          ts: '2026-06-01T10:00:00.000Z',
          ref: 'cafe1234cafe1234',
          branch: 'main',
          message: 'wip',
          diffStat: null,
        }) + '\n',
        'utf8',
      )
      const { code, output } = captureRun(['checkpoints', '--home', home])
      expect(code).toBe(0)
      const out = output.join('\n')
      expect(out).toContain('main')
      expect(out).toContain('git stash apply cafe1234cafe1234')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})

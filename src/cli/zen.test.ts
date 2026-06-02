/**
 * zen.test.ts — TDD tests for the global `--zen` calm mode.
 *
 * CLAUDE.md / ADR-0005 claim a `--zen` calm mode that strips randomness / loot
 * spectacle / offers — commands print a plain, calm, terse confirmation, NO
 * gacha/crit/serendipity/contextual-offer lines, NO drops. The engine STILL
 * records state; only the RENDER is calm.
 *
 * These tests assert the ABSENCE of every spectacle marker under --zen (and the
 * env GROVE_ZEN), that a calm confirmation is printed, that the exit code stays
 * 0, AND that without --zen the normal spectacle remains. Each test uses a fresh
 * temp --home so it is fully isolated.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from './sq'
import { loadState, saveState } from '../store/store'
import { stateDir } from '../store/paths'

// ---- Helpers ----------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-zen-test-'))
}

function removeTmpHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function captureRun(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let code: number
  try {
    code = run(argv)
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
  return { code, output: lines }
}

/**
 * Every "spectacle" marker that calm mode MUST suppress: loot-reward emoji
 * (formatReward output), the crit tag, the serendipity (奇遇) tag, the milestone
 * chest, and the two contextual-offer lines. A calm run must contain NONE of these.
 */
const SPECTACLE_MARKERS = [
  '✨', // xp reward / serendipity prefix
  '🃏', // card drop
  '⚔️', // gear drop
  '🪙', // currency reward
  '🌿', // buff reward
  '🌅', // first-light reward
  '🆙', // levelup
  '✦', // serendipity / celebratory mark
  '💥', // CRIT tag + crit offer
  'CRIT',
  '奇遇', // serendipity
  '🎁', // milestone chest
  'sq suggest-commit', // crit contextual offer
  'sq checkpoint', // low-energy contextual offer
  '(no drop)',
]

function assertNoSpectacle(output: string[]): void {
  const combined = output.join('\n')
  for (const marker of SPECTACLE_MARKERS) {
    expect(combined, `calm output must not contain "${marker}"`).not.toContain(marker)
  }
}

// ---- Tests ------------------------------------------------------------------

describe('--zen calm mode', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
  })

  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  // ---- event ----------------------------------------------------------------

  describe('event subcommand under --zen', () => {
    it('prints NO loot/crit/serendipity/offer lines yet still returns 0', () => {
      // Run many crit-eligible events so a crit/serendipity is near-certain to
      // fire in the engine — but calm mode must never RENDER any of it.
      for (let i = 0; i < 60; i++) {
        const { code, output } = captureRun([
          'event', 'test_result', '--magnitude', '3', '--zen', '--home', tmpHome,
        ])
        expect(code).toBe(0)
        assertNoSpectacle(output)
      }
    })

    it('prints a calm, terse confirmation line', () => {
      const { code, output } = captureRun([
        'event', 'test_result', '--zen', '--home', tmpHome,
      ])
      expect(code).toBe(0)
      const combined = output.join('\n')
      // A calm confirmation is present (a single quiet ✓ line), not silence.
      expect(combined).toMatch(/✓/)
    })

    it('STILL records engine state (only the render is calm)', () => {
      const before = loadState(stateDir(tmpHome))
      captureRun(['event', 'test_result', '--magnitude', '2', '--zen', '--home', tmpHome])
      const after = loadState(stateDir(tmpHome))
      // The engine ran: clock advanced and seeds were earned, identical to a
      // non-zen run — calm mode does not disable the engine, only the spectacle.
      expect(after.eventCount).toBe(before.eventCount + 1)
      expect(after.player.currency).toBeGreaterThan(before.player.currency)
    })

    it('GROVE_ZEN=1 env enables calm mode without the flag', () => {
      const prev = process.env['GROVE_ZEN']
      process.env['GROVE_ZEN'] = '1'
      try {
        for (let i = 0; i < 40; i++) {
          const { code, output } = captureRun([
            'event', 'test_result', '--magnitude', '3', '--home', tmpHome,
          ])
          expect(code).toBe(0)
          assertNoSpectacle(output)
        }
      } finally {
        if (prev === undefined) delete process.env['GROVE_ZEN']
        else process.env['GROVE_ZEN'] = prev
      }
    })

    it('a red→green comeback renders NO 🌿 line under --zen, yet still clears the bit', () => {
      // A failing test_result records the red bit (calmly, no spectacle)...
      const red = captureRun([
        'event', 'test_result', '--success', 'false', '--zen', '--home', tmpHome,
      ])
      expect(red.code).toBe(0)
      assertNoSpectacle(red.output)
      expect(loadState(stateDir(tmpHome)).lastTestFailed).toBe(true)
      // ...and the green-after-red comeback fires in the engine but is suppressed.
      const green = captureRun([
        'event', 'test_result', '--success', 'true', '--zen', '--home', tmpHome,
      ])
      expect(green.code).toBe(0)
      assertNoSpectacle(green.output) // SPECTACLE_MARKERS includes 🌿
      // The engine still ran: the comeback bit was cleared by the green.
      expect(loadState(stateDir(tmpHome)).lastTestFailed).toBe(false)
    })

    it('a first green build renders NO 🌅 first-light line under --zen, yet records the marker', () => {
      const { code, output } = captureRun([
        'event', 'build_result', '--success', 'true', '--zen', '--home', tmpHome,
      ])
      expect(code).toBe(0)
      assertNoSpectacle(output) // SPECTACLE_MARKERS includes 🌅
      // The engine still ran: first-light was recognized and persisted.
      expect(loadState(stateDir(tmpHome)).firstLightSeen).toBe(true)
    })
  })

  // ---- the non-zen contrast (spectacle MUST remain) -------------------------

  describe('WITHOUT --zen the normal spectacle remains', () => {
    it('a crit eventually RENDERS the crit tag in normal mode', () => {
      let critSeen = false
      for (let i = 0; i < 80; i++) {
        const { output } = captureRun([
          'event', 'test_result', '--magnitude', '3', '--home', tmpHome,
        ])
        if (output.join('\n').includes('CRIT')) {
          critSeen = true
          break
        }
      }
      expect(critSeen).toBe(true)
    })

    it('normal mode prints loot reward emoji', () => {
      const { output } = captureRun(['event', 'test_result', '--home', tmpHome])
      const combined = output.join('\n')
      // Some loot/reward emoji is present in normal mode.
      expect(combined).toMatch(/[✨🃏⚔🪙🌿🆙]/)
    })
  })

  // ---- pull (drops + reveal) ------------------------------------------------

  describe('pull subcommand under --zen', () => {
    it('still spends seeds + lands a card but prints NO drop/loot spectacle', () => {
      // Fund the wallet so a pull is affordable.
      const dir = stateDir(tmpHome)
      const s = loadState(dir)
      saveState(dir, { ...s, player: { ...s.player, currency: 200 } })
      const before = loadState(dir)

      const { code, output } = captureRun([
        'pull', '--seed', '3', '--zen', '--home', tmpHome,
      ])
      expect(code).toBe(0)
      assertNoSpectacle(output)

      const after = loadState(dir)
      // Engine still ran: a card landed and seeds were debited.
      expect(after.cards.length).toBe(before.cards.length + 1)
      expect(after.player.currency).toBeLessThan(before.player.currency)
      // A calm confirmation is present.
      expect(output.join('\n')).toMatch(/✓/)
    })

    it('refuses calmly when broke (no spectacle, exits 0)', () => {
      const { code, output } = captureRun(['pull', '--zen', '--home', tmpHome])
      expect(code).toBe(0)
      assertNoSpectacle(output)
    })
  })

  // ---- scan -----------------------------------------------------------------

  describe('scan subcommand under --zen', () => {
    it('prints NO loot spectacle, a calm confirmation, exits 0', () => {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-zen-scan-'))
      try {
        const lean = Array.from({ length: 10 }, (_, i) => `# line ${i + 1}`).join('\n')
        fs.writeFileSync(path.join(repoDir, 'CLAUDE.md'), lean)

        const { code, output } = captureRun(['scan', repoDir, '--zen', '--home', tmpHome])
        expect(code).toBe(0)
        assertNoSpectacle(output)
        expect(output.join('\n')).toMatch(/✓/)
      } finally {
        removeTmpHome(repoDir)
      }
    })
  })

  // ---- checkpoint -----------------------------------------------------------

  describe('checkpoint subcommand under --zen', () => {
    let tmpRepo: string

    beforeEach(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-zen-cp-'))
      execSync('git init', { cwd: tmpRepo, stdio: 'pipe' })
      execSync('git config user.email "t@grove.test"', { cwd: tmpRepo, stdio: 'pipe' })
      execSync('git config user.name "Grove Test"', { cwd: tmpRepo, stdio: 'pipe' })
      fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# init\n')
      execSync('git add -A', { cwd: tmpRepo, stdio: 'pipe' })
      execSync('git commit -m "init"', { cwd: tmpRepo, stdio: 'pipe' })
    })

    afterEach(() => {
      removeTmpHome(tmpRepo)
    })

    it('prints NO loot/offer spectacle but still confirms the checkpoint, exits 0', () => {
      const { code, output } = captureRun([
        'checkpoint', '--repo', tmpRepo, '--zen', '--home', tmpHome,
      ])
      expect(code).toBe(0)
      assertNoSpectacle(output)
      // The checkpoint confirmation itself (its safety-net purpose) still prints.
      expect(output.join('\n')).toMatch(/checkpoint|📍/i)
    })
  })

  // ---- wrap -----------------------------------------------------------------

  describe('wrap subcommand under --zen', () => {
    it('a passing command still ingests but prints NO loot, exits 0', () => {
      const before = loadState(stateDir(tmpHome))
      const { code, output } = captureRun(['wrap', '--zen', '--home', tmpHome, '--', 'true'])
      expect(code).toBe(0)
      assertNoSpectacle(output)
      const after = loadState(stateDir(tmpHome))
      // Engine still ran on the real green exit code.
      expect(after.eventCount).toBe(before.eventCount + 1)
    })

    it('preserves the wrapped command exit code (transparent passthrough)', () => {
      const { code } = captureRun(['wrap', '--zen', '--home', tmpHome, '--', 'false'])
      expect(code).toBe(1)
    })
  })

  // ---- status: a quiet variant ----------------------------------------------

  describe('status subcommand under --zen', () => {
    it('prints a calm status and exits 0', () => {
      const { code, output } = captureRun(['status', '--zen', '--home', tmpHome])
      expect(code).toBe(0)
      // Some quiet status text is present.
      expect(output.join('\n').length).toBeGreaterThan(0)
    })
  })

  // ---- help mentions --zen --------------------------------------------------

  describe('help mentions --zen', () => {
    it('usage output documents the --zen calm mode', () => {
      const { output } = captureRun(['help'])
      expect(output.join('\n').toLowerCase()).toContain('--zen')
    })
  })
})

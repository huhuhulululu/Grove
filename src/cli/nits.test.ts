/**
 * nits.test.ts — code-review CLI nit fixes (audit re-score② cluster B).
 *
 *  (a) handleEnhance: a bounds-guard inside the lock (the second, fresh load can
 *      resolve a DIFFERENT / out-of-range index than the pre-lock check).
 *  (b) enhance / repair / protect honor `--zen`: success lines are suppressed to
 *      a single calm confirmation (the calm-refusal path was already terse).
 *  (c) `--magnitude` with a non-numeric value defaults to 1 (no NaN poisoning).
 *  (e) the reveal delay is non-blocking and SKIPPED in non-TTY / tests.
 *
 * (d) (run-as-script guard) is exercised in run-guard.test.ts.
 *
 * Run: npx vitest run src/cli/nits.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from './sq'
import { loadState, saveState } from '../store/store'
import { stateDir } from '../store/paths'

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-nits-'))
}

function captureRun(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
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

const SPECTACLE = ['✓ success', '↓ +', '✗ SHATTERED', 'success ', 'downgrade ', '🔧 REPAIRED', '🛡 PROTECTED']

describe('(c) magnitude NaN guard', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { fs.rmSync(tmpHome, { recursive: true, force: true }) })

  it('a non-numeric --magnitude defaults to 1 (not NaN), event still rewards', () => {
    const before = loadState(stateDir(tmpHome))
    const { code } = captureRun([
      'event', 'test_result', '--magnitude', 'abc', '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    // With NaN magnitude the engine would mint 0/NaN seeds; defaulting to 1 means
    // a green test still earns currency. Assert progress actually happened.
    expect(after.player.currency).toBeGreaterThan(before.player.currency)
    expect(Number.isNaN(after.player.currency)).toBe(false)
  })

  it('an empty --magnitude= defaults to 1', () => {
    const { code } = captureRun([
      'event', 'commit', '--magnitude=', '--home', tmpHome,
    ])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(Number.isNaN(after.player.currency)).toBe(false)
  })

  it('a valid numeric --magnitude is still honored', () => {
    const { code } = captureRun([
      'event', 'test_result', '--magnitude', '3', '--home', tmpHome,
    ])
    expect(code).toBe(0)
  })
})

describe('(b) enhance / repair / protect honor --zen', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { fs.rmSync(tmpHome, { recursive: true, force: true }) })

  function seedGear(currency: number, broken = false): string {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    const id = 'gear.commit-hammer.1'
    saveState(dir, {
      ...s,
      player: { ...s.player, currency },
      gear: [{ id, name: 'Commit Hammer', level: 5, rarity: 'rare' as const, broken }],
    })
    return id
  }

  it('enhance --zen: a single calm ✓ line, NO odds/result spectacle', () => {
    seedGear(200)
    const { code, output } = captureRun(['enhance', 'first', '--seed', '1', '--zen', '--home', tmpHome])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined).toMatch(/✓/)
    for (const m of SPECTACLE) expect(combined).not.toContain(m)
  })

  it('repair --zen: a single calm ✓ line, NO 🔧 REPAIRED spectacle', () => {
    const id = seedGear(200, true)
    const { code, output } = captureRun(['repair', id, '--zen', '--home', tmpHome])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined).toMatch(/✓/)
    expect(combined).not.toContain('🔧 REPAIRED')
  })

  it('protect --zen: a single calm ✓ line, NO 🛡 PROTECTED spectacle', () => {
    const id = seedGear(200)
    const { code, output } = captureRun(['protect', id, '--zen', '--home', tmpHome])
    expect(code).toBe(0)
    const combined = output.join('\n')
    expect(combined).toMatch(/✓/)
    expect(combined).not.toContain('🛡 PROTECTED')
  })

  it('enhance WITHOUT --zen still shows the full odds + result (regression)', () => {
    seedGear(200)
    const { output } = captureRun(['enhance', 'first', '--seed', '1', '--home', tmpHome])
    const combined = output.join('\n')
    // Normal mode keeps the suspense: an odds line and a result line.
    expect(combined).toMatch(/success \d+%/)
  })
})

describe('(a) handleEnhance bounds-guard inside the lock', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { fs.rmSync(tmpHome, { recursive: true, force: true }) })

  it('an out-of-range index is rejected (exit 2), no debit, no crash', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    saveState(dir, {
      ...s,
      player: { ...s.player, currency: 200 },
      gear: [{ id: 'g.1', name: 'Commit Hammer', level: 1, rarity: 'rare' as const, broken: false }],
    })
    const before = loadState(dir)
    const { code } = captureRun(['enhance', '99', '--seed', '1', '--home', tmpHome])
    expect(code).toBe(2)
    const after = loadState(dir)
    // No roll, no debit when the ref doesn't resolve to a real gear.
    expect(after.player.currency).toBe(before.player.currency)
    expect(after.gear[0]!.level).toBe(before.gear[0]!.level)
  })

  it('a valid enhance still debits + rolls (the guard does not block the happy path)', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    saveState(dir, {
      ...s,
      player: { ...s.player, currency: 200 },
      gear: [{ id: 'g.1', name: 'Commit Hammer', level: 1, rarity: 'rare' as const, broken: false }],
    })
    const before = loadState(dir)
    const { code } = captureRun(['enhance', 'first', '--seed', '1', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(dir)
    expect(after.player.currency).toBeLessThan(before.player.currency)
  })
})

describe('(e) reveal is non-blocking + skipped when not a TTY', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { fs.rmSync(tmpHome, { recursive: true, force: true }) })

  it('a pull in a non-TTY (test) does NOT busy-wait — returns fast', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    saveState(dir, { ...s, player: { ...s.player, currency: 200 } })

    // process.stdout.isTTY is false under vitest → the reveal must be skipped
    // entirely, so the call returns near-instantly (no ~720ms of frame spinning).
    const start = Date.now()
    const { code } = captureRun(['pull', '--seed', '3', '--home', tmpHome])
    const elapsed = Date.now() - start
    expect(code).toBe(0)
    // A busy-wait of 6 frames × 120ms = 720ms; skipping it keeps us well under.
    expect(elapsed).toBeLessThan(300)
  })
})

describe('(f) enhance on a BROKEN gear refuses without debit (bugs-2)', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { fs.rmSync(tmpHome, { recursive: true, force: true }) })

  it('a broken gear is not charged seeds and keeps its protect flag (no-op enhance)', () => {
    const dir = stateDir(tmpHome)
    const s = loadState(dir)
    const id = 'gear.commit-hammer.1'
    saveState(dir, {
      ...s,
      player: { ...s.player, currency: 200 },
      gear: [{ id, name: 'Commit Hammer', level: 5, rarity: 'rare' as const, broken: true }],
      protectedGear: [id],
    })
    const { code } = captureRun(['enhance', id, '--seed', '1', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(dir)
    // No debit: enhancing a broken piece is a no-op (the engine short-circuits to 'stay').
    expect(after.player.currency).toBe(200)
    // The one-shot protection flag must NOT be consumed for a no-op.
    expect(after.protectedGear).toContain(id)
    // Gear unchanged (still broken, same level).
    expect(after.gear[0]!.broken).toBe(true)
    expect(after.gear[0]!.level).toBe(5)
  })
})

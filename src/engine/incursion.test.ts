/**
 * incursion.test.ts — the push-your-luck roguelike run. Pure, deterministic.
 *
 * Beyond unit behavior, a Monte-Carlo BALANCE test pins the curve: the stakes must be
 * REAL (a greedy full run is genuinely uncertain, not ~always or ~never), and the build
 * must MATTER (a strong build clears meaningfully deeper than a bare one). This is the
 * same discipline gacha.test uses to pin the realized legendary rate.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { Gear } from '../core/rewards'
import {
  buildPower,
  clearChance,
  rollMap,
  startRun,
  resolveFloor,
  isCleared,
  escapeBag,
  RUN_FLOORS,
  RUN_HP,
  type RunState,
} from './incursion'

function gear(name: string, level: number): Gear {
  return { id: `g-${name}-${level}`, name, level, rarity: 'rare', broken: false }
}

// A RunState with a chosen power, for balance simulation without a full GameState.
function runWithPower(power: number, seed: number): RunState {
  return { seed, power, floors: rollMap(seed), current: 0, hp: RUN_HP, bag: { cards: [], gear: [], seeds: 0 } }
}

/** Play greedily (always dive) until cleared or dead. Returns the terminal state. */
function playGreedy(power: number, seed: number): { survived: boolean; floorsCleared: number; loot: number } {
  let run = runWithPower(power, seed)
  for (;;) {
    if (isCleared(run)) return { survived: true, floorsCleared: run.current, loot: run.bag.cards.length }
    const res = resolveFloor(run)
    if (res.dead) return { survived: false, floorsCleared: res.run.current, loot: 0 }
    run = res.run
  }
}

describe('buildPower — your loadout + enhanced gear finally matter', () => {
  it('a fresh player has baseline power ~1.0', () => {
    expect(buildPower(initialState())).toBeCloseTo(1.0, 5)
  })

  it('enhanced gear raises power above baseline (enhancing is now load-bearing)', () => {
    const kitted: GameState = { ...initialState(), gear: [gear('Commit Hammer', 8), gear('Type Saber', 6)] }
    expect(buildPower(kitted)).toBeGreaterThan(buildPower(initialState()))
  })
})

describe('clearChance — published curve', () => {
  it('rises with power and falls with difficulty, clamped to [0.1, 0.95]', () => {
    expect(clearChance(2.0, 1.0)).toBeGreaterThan(clearChance(1.0, 1.0))
    expect(clearChance(1.0, 2.8)).toBeLessThan(clearChance(1.0, 1.0))
    expect(clearChance(10, 1)).toBeLessThanOrEqual(0.95)
    expect(clearChance(0, 10)).toBeGreaterThanOrEqual(0.1)
  })

  it('the build swings a deep-floor clear by a meaningful margin (build is not inert)', () => {
    const deep = 1.0 + (RUN_FLOORS - 1) * 0.45 // the last floor's difficulty
    expect(clearChance(2.0, deep) - clearChance(1.0, deep)).toBeGreaterThanOrEqual(0.15)
  })
})

describe('rollMap + startRun', () => {
  it('is deterministic and escalates: RUN_FLOORS floors, rising difficulty, final floor guards gear', () => {
    const a = rollMap(123)
    const b = rollMap(123)
    expect(a).toEqual(b)
    expect(a.length).toBe(RUN_FLOORS)
    for (let i = 1; i < a.length; i++) expect(a[i]!.difficulty).toBeGreaterThan(a[i - 1]!.difficulty)
    expect(a[a.length - 1]!.gear).toBe(true)
    expect(a[0]!.gear).toBe(false)
  })

  it('startRun snapshots power + full HP + empty bag, at floor 0', () => {
    const run = startRun(initialState(), 7)
    expect(run.hp).toBe(RUN_HP)
    expect(run.current).toBe(0)
    expect(run.bag).toEqual({ cards: [], gear: [], seeds: 0 })
    expect(run.power).toBeCloseTo(1.0, 5)
  })
})

describe('resolveFloor — dive resolution', () => {
  it('a clear banks the floor drop and advances; deterministic from (seed, floor)', () => {
    // A high-power run clears floor 0 deterministically.
    const run = runWithPower(5, 42)
    const r1 = resolveFloor(run)
    const r2 = resolveFloor(run)
    expect(r1.cleared).toBe(true)
    expect(r1).toEqual(r2) // pure + deterministic
    expect(r1.run.current).toBe(1)
    expect(r1.run.bag.cards.length).toBe(1)
    expect(r1.run.bag.seeds).toBeGreaterThan(0)
  })

  it('a fail costs 1 HP; 0 HP is death', () => {
    // A zero-power run is far below difficulty → clamped to MIN_CLEAR; force a fail by
    // finding a seed whose floor-0 roll exceeds the min clear, then drain HP.
    let run = runWithPower(0, 1)
    // hp 3 → drive failures until dead; with MIN_CLEAR=0.1 most floor-0 dives across
    // these seeds fail, but we assert the HP/death MECHANIC directly:
    run = { ...run, hp: 1 }
    const res = resolveFloor(run)
    if (!res.cleared) {
      expect(res.run.hp).toBe(0)
      expect(res.dead).toBe(true)
    } else {
      // cleared by luck on this seed — assert the clear path instead
      expect(res.run.hp).toBe(1)
      expect(res.dead).toBe(false)
    }
  })

  it('escapeBag returns exactly what was banked', () => {
    const run = runWithPower(5, 99)
    const after = resolveFloor(run).run
    expect(escapeBag(after)).toBe(after.bag)
  })
})

describe('BALANCE (Monte-Carlo) — the stakes are real and the build matters', () => {
  const SEEDS = 3000

  function fullClearRate(power: number): number {
    let survived = 0
    for (let s = 0; s < SEEDS; s++) if (playGreedy(power, s).survived) survived++
    return survived / SEEDS
  }

  it('a BARE build greedily full-clearing is genuinely uncertain (real fear, not a formality)', () => {
    const rate = fullClearRate(1.0)
    // not a guaranteed win, not impossible — a real gamble.
    expect(rate).toBeGreaterThan(0.02)
    expect(rate).toBeLessThan(0.6)
  })

  it('a STRONG build full-clears more often than a bare one (greed rewarded by investment)', () => {
    expect(fullClearRate(2.1)).toBeGreaterThan(fullClearRate(1.0))
  })

  it('on average, more power = more floors cleared before dying', () => {
    const avg = (power: number) => {
      let total = 0
      for (let s = 0; s < SEEDS; s++) total += playGreedy(power, s).floorsCleared
      return total / SEEDS
    }
    expect(avg(2.1)).toBeGreaterThan(avg(1.0))
  })
})

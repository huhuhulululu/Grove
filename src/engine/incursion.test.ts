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
  EMPTY_KIT,
  SHIELD_CAP,
  RUN_FLOORS,
  RUN_HP,
  type RunState,
  type RunKit,
} from './incursion'

function gear(name: string, level: number): Gear {
  return { id: `g-${name}-${level}`, name, level, rarity: 'rare', broken: false }
}

// A RunState with a chosen power, for balance simulation without a full GameState.
// An optional kit arms the run with consumables (omitted → a kit-less legacy run).
function runWithPower(power: number, seed: number, kit?: RunKit): RunState {
  const base: RunState = { seed, power, floors: rollMap(seed), current: 0, hp: RUN_HP, bag: { cards: [], gear: [], seeds: 0 } }
  return kit ? { ...base, kit } : base
}

/** Play greedily (always dive) until cleared or dead. Returns the terminal state. */
function playGreedy(power: number, seed: number, kit?: RunKit): { survived: boolean; floorsCleared: number; loot: number } {
  let run = runWithPower(power, seed, kit)
  for (;;) {
    if (isCleared(run)) return { survived: true, floorsCleared: run.current, loot: run.bag.cards.length }
    const res = resolveFloor(run)
    if (res.dead) return { survived: false, floorsCleared: res.run.current, loot: 0 }
    run = res.run
  }
}

/** The first seed whose floor-0 dive FAILS at this power (deterministic across runs). */
function failingSeed(power: number): number {
  for (let s = 0; s < 500; s++) if (!resolveFloor(runWithPower(power, s)).cleared) return s
  throw new Error('no failing seed found')
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

describe('floor archetypes — ELITE floors are the mid-run greed fork', () => {
  it('every floor carries a valid kind, and elites show up across runs', () => {
    let sawElite = false
    for (let s = 0; s < 100; s++) {
      const m = rollMap(s)
      for (const f of m) expect(['combat', 'elite']).toContain(f.kind)
      if (m.some((f) => f.kind === 'elite')) sawElite = true
    }
    expect(sawElite).toBe(true) // the archetype actually fires
  })

  it('the FINAL floor is NEVER elite — the boss stays the depth-bias + gear climax', () => {
    for (let s = 0; s < 200; s++) expect(rollMap(s)[RUN_FLOORS - 1]!.kind).toBe('combat')
  })

  it('an ELITE floor is HARDER and FATTER than the same-depth combat baseline (risk → reward)', () => {
    for (let s = 0; s < 200; s++) {
      const m = rollMap(s)
      const idx = m.findIndex((f, i) => f.kind === 'elite' && i < RUN_FLOORS - 1)
      if (idx < 0) continue
      const baseDifficulty = 1.0 + idx * 0.45
      const baseSeeds = 8 + idx * 6
      expect(m[idx]!.difficulty).toBeGreaterThan(baseDifficulty) // a tougher gamble
      expect(m[idx]!.seeds).toBeGreaterThan(baseSeeds) // …for fatter loot
      return
    }
    throw new Error('no elite floor found across 200 seeds')
  })

  it('the modest elite mult keeps difficulty STRICTLY rising across all seeds (no out-of-order spike)', () => {
    for (let s = 0; s < 200; s++) {
      const m = rollMap(s)
      for (let i = 1; i < m.length; i++) expect(m[i]!.difficulty).toBeGreaterThan(m[i - 1]!.difficulty)
    }
  })

  it('rollMap stays deterministic with archetypes (same seed → same kinds)', () => {
    expect(rollMap(123).map((f) => f.kind)).toEqual(rollMap(123).map((f) => f.kind))
  })
})

describe('BALANCE (Monte-Carlo) — elite floors keep the run a real gamble', () => {
  const SEEDS = 3000
  const fullClearRate = (power: number): number => {
    let survived = 0
    for (let s = 0; s < SEEDS; s++) if (playGreedy(power, s).survived) survived++
    return survived / SEEDS
  }

  it('a bare greedy full-clear is a real gamble with elites in the mix (calibrated band)', () => {
    // Deterministic over seeds 0..2999: measured 0.171 (elites pulled it down from the
    // vanilla 0.203). A tight band brackets it — far tighter than the legacy 0.02..0.6.
    const bare = fullClearRate(1.0)
    expect(bare).toBeGreaterThan(0.12)
    expect(bare).toBeLessThan(0.22)
  })

  it('a strong build still full-clears MEANINGFULLY more than a bare one (investment pays)', () => {
    expect(fullClearRate(2.1)).toBeGreaterThan(fullClearRate(1.0) + 0.2)
  })

  it('the boss floor (never elite) still swings on build by a meaningful margin', () => {
    const boss = 1.0 + (RUN_FLOORS - 1) * 0.45
    expect(clearChance(2.0, boss) - clearChance(1.0, boss)).toBeGreaterThanOrEqual(0.12)
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

describe('run kit — a single-use SHIELD bought at start', () => {
  it('startRun snapshots an empty kit by default and clamps a bought shield to SHIELD_CAP', () => {
    expect(startRun(initialState(), 7).kit).toEqual(EMPTY_KIT)
    expect(startRun(initialState(), 7, RUN_FLOORS, { shield: 1 }).kit).toEqual({ shield: 1 })
    // the per-item cap is the load-bearing balance constant — 2 shields would flip the
    // run to always-dive (tension dead), so a request above the cap is clamped down.
    expect(startRun(initialState(), 7, RUN_FLOORS, { shield: 9 }).kit).toEqual({ shield: SHIELD_CAP })
  })

  it('a shield ABSORBS a failed dive: HP held, one shield spent, shielded flag set', () => {
    const s = failingSeed(0)
    const bare = resolveFloor(runWithPower(0, s))
    expect(bare.cleared).toBe(false)
    expect(bare.run.hp).toBe(RUN_HP - 1) // bare: the fail chips 1 HP
    expect(bare.shielded).toBeFalsy()

    const shielded = resolveFloor(runWithPower(0, s, { shield: 1 }))
    expect(shielded.cleared).toBe(false)
    expect(shielded.shielded).toBe(true)
    expect(shielded.run.hp).toBe(RUN_HP) // HP UNCHANGED — the shield soaked it
    expect(shielded.run.kit?.shield).toBe(0) // the shield is consumed
    expect(shielded.dead).toBe(false)
  })

  it('a shield PREVENTS death at 1 HP', () => {
    const s = failingSeed(0)
    expect(resolveFloor({ ...runWithPower(0, s), hp: 1 }).dead).toBe(true) // bare dies
    const saved = resolveFloor({ ...runWithPower(0, s, { shield: 1 }), hp: 1 })
    expect(saved.dead).toBe(false) // the shield saves the run
    expect(saved.run.hp).toBe(1) // HP held
    expect(saved.shielded).toBe(true)
  })

  it('a spent shield no longer protects — the NEXT fail chips HP as normal', () => {
    const s = failingSeed(0)
    const first = resolveFloor(runWithPower(0, s, { shield: 1 }))
    expect(first.run.kit?.shield).toBe(0)
    // the run at its next floor with an empty kit behaves exactly like a bare run
    const next = resolveFloor({ ...first.run, current: 0 })
    expect(next.shielded).toBeFalsy()
    expect(next.run.hp).toBe(RUN_HP - 1)
  })

  it('BACK-COMPAT: a kit-less RunState resolves byte-identically to today', () => {
    const s = failingSeed(0)
    const noKit = resolveFloor(runWithPower(0, s)) // no kit field at all
    const emptyKit = resolveFloor(runWithPower(0, s, { shield: 0 }))
    expect(noKit.run.hp).toBe(emptyKit.run.hp)
    expect(noKit.dead).toBe(emptyKit.dead)
    expect(noKit.cleared).toBe(emptyKit.cleared)
    expect(noKit.shielded).toBeFalsy()
  })
})

describe('BALANCE (Monte-Carlo) — the shield helps, the cap keeps the gamble real', () => {
  const SEEDS = 3000

  const fullClearRate = (power: number, kit?: RunKit): number => {
    let survived = 0
    for (let s = 0; s < SEEDS; s++) if (playGreedy(power, s, kit).survived) survived++
    return survived / SEEDS
  }

  // Expected BANKED seeds for the strategy "attempt `depth` floors, then escape".
  // A death forfeits the whole bag (contributes 0) — the genuine downside of greed.
  const evToDepth = (power: number, kit: RunKit, depth: number): number => {
    let total = 0
    for (let s = 0; s < SEEDS; s++) {
      let run = runWithPower(power, s, kit)
      let dead = false
      while (!isCleared(run) && run.current < depth) {
        const res = resolveFloor(run)
        run = res.run
        if (res.dead) { dead = true; break }
      }
      if (!dead) total += run.bag.seeds
    }
    return total / SEEDS
  }

  it('a 1-shield bare build full-clears MORE than no shield, yet stays under the 0.6 bare ceiling', () => {
    const noShield = fullClearRate(1.0)
    const oneShield = fullClearRate(1.0, { shield: 1 })
    expect(oneShield).toBeGreaterThan(noShield) // the shield is a real help
    expect(oneShield).toBeLessThan(0.6) // …but the strongest legal kit doesn't trivialize the run
  })

  it('with the strongest legal kit (1 shield), ALWAYS-DIVE is not strictly optimal — escape-early still pays (tension alive)', () => {
    const kit: RunKit = { shield: 1 }
    const evAllIn = evToDepth(1.0, kit, RUN_FLOORS) // dive every floor
    const evEscapeEarly = Math.max(evToDepth(1.0, kit, RUN_FLOORS - 1), evToDepth(1.0, kit, RUN_FLOORS - 2))
    // banking before the last floor(s) yields at least as many seeds in expectation as
    // diving all the way — i.e. the escape-vs-dive call remains a real decision.
    expect(evEscapeEarly).toBeGreaterThanOrEqual(evAllIn)
  })
})

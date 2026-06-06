/**
 * incursion.ts — "The Incursion": a push-your-luck roguelike RUN built on Grove's
 * existing build (loadout + gear) and loot primitives. THE DUNGEON Grove was missing.
 *
 * The fantasy: pack your build, dive a seeded gauntlet, and every floor you clear the
 * loot in your bag gets heavier — but it is only YOURS if you ESCAPE alive. Dive too
 * deep and DIE: the run-bag is forfeit. Greed vs. fear, "one more floor", war stories.
 *
 * FIREWALL (ADR-0005): this module is PURE — no fs, no wall-clock, no global RNG; all
 * randomness is derived deterministically from the run SEED (so each CLI invocation
 * re-resolves a floor identically without a live rng closure). The RUN-BAG lives in an
 * ephemeral RunState (run.json, NOT in GameStateSchema) and is committed to the real
 * cosmetic GameState ONLY on escape. A dead run is discarded and touches nothing —
 * and real code/commits/git are never involved at any point. Stakes are cosmetic; a
 * lost run costs only loot you never banked, and a new run is always free.
 */

import type { GameState } from '../core/state'
import type { Card, Gear, Rarity } from '../core/rewards'
import { mulberry32, hashStringToSeed } from '../core/rng'
import { computeLoadoutEffect } from './loadout'
import { activeGearBonus, makeGear } from './gear'
import { makeCard } from './gacha'

// ---------------------------------------------------------------------------
// Tuning (published / inspectable, ADR-0002). A balance test pins the curve.
// ---------------------------------------------------------------------------

export const RUN_FLOORS = 5
/** A tight mistake-budget (2) keeps the escape-vs-dive gamble real: a bare build only
 *  full-clears ~20% of greedy runs, so banking early is a smart play, not a formality. */
export const RUN_HP = 2

/** Per-floor difficulty rises with depth: floor i = BASE_DIFF + i*DIFF_STEP. */
const BASE_DIFF = 1.0
const DIFF_STEP = 0.45
/** clear% = clamp(CLEAR_BASE + (power - difficulty)*CLEAR_SLOPE, MIN, MAX). */
const CLEAR_BASE = 0.85
const CLEAR_SLOPE = 0.35
const MIN_CLEAR = 0.1
const MAX_CLEAR = 0.95
/** Each enhancement level on your best-of-name gear adds this to run power. */
const GEAR_LEVEL_POWER = 0.04

// ---------------------------------------------------------------------------
// Types — the ephemeral run (never persisted into GameState)
// ---------------------------------------------------------------------------

export interface RunFloor {
  /** difficulty number the dive check is measured against */
  difficulty: number
  /** the loot this floor guards (pre-rolled so the player sees the stakes before diving) */
  cardRarity: Rarity
  seeds: number
  /** the deepest floor also guards a gear drop */
  gear: boolean
}

export interface RunBag {
  cards: Card[]
  gear: Gear[]
  seeds: number
}

export interface RunState {
  /** the run's deterministic seed (every dive/drop is derived from it) */
  seed: number
  /** snapshot of the player's build power at start (loadout + gear), so mid-run gear changes don't matter */
  power: number
  floors: RunFloor[]
  /** index of the NEXT floor to dive (0-based); === floors.length means the run is cleared */
  current: number
  hp: number
  bag: RunBag
  /**
   * Firewall tombstone, owned by the CLI shell — the engine NEVER sets or reads this.
   * On death the shell flags `dead: true` before deleting run.json, so that even if the
   * delete fails (locked file, full disk) a later `escape` can never bank a forfeit bag.
   */
  dead?: boolean
}

/** The outcome of a single dive. */
export interface DiveResult {
  run: RunState
  cleared: boolean
  /** true when this dive dropped HP to 0 — the run is over, bag forfeit */
  dead: boolean
}

// ---------------------------------------------------------------------------
// Build power — makes your loadout + gear (and ENHANCING it) finally matter
// ---------------------------------------------------------------------------

/**
 * Snapshot the player's build into a single "power" number. A fresh player is ~1.0;
 * a fully-kitted, enhanced player is ~2.0+. Power is the ONLY thing that lets you
 * dive deep — so equipping a synergy loadout and enhancing gear is now load-bearing,
 * not flavor. PURE (reads state, no rng).
 */
export function buildPower(state: GameState): number {
  const eff = computeLoadoutEffect(state)
  const gb = activeGearBonus(state)

  const loadoutPart = (eff.xpMult - 1) + (eff.seedMult - 1) + eff.critBonus * 2
  const gearBonusPart = gb.xpPct + gb.currencyPct + gb.critPct

  // Best (highest) un-broken level per gear name → reward enhancing your kit.
  const bestByName = new Map<string, number>()
  for (const g of state.gear) {
    if (g.broken) continue
    const prev = bestByName.get(g.name)
    if (prev === undefined || g.level > prev) bestByName.set(g.name, g.level)
  }
  let gearLevels = 0
  for (const lvl of bestByName.values()) gearLevels += lvl
  const gearLevelPart = gearLevels * GEAR_LEVEL_POWER

  return 1.0 + loadoutPart + gearBonusPart + gearLevelPart
}

/** The clear probability of a floor for a given build power. Published (ADR-0002). */
export function clearChance(power: number, difficulty: number): number {
  const raw = CLEAR_BASE + (power - difficulty) * CLEAR_SLOPE
  return Math.max(MIN_CLEAR, Math.min(MAX_CLEAR, raw))
}

// ---------------------------------------------------------------------------
// Map + run construction (deterministic from the seed)
// ---------------------------------------------------------------------------

/** A small deterministic rng for a labelled aspect of a run (no live closure needed). */
function runRng(seed: number, label: string): () => number {
  return mulberry32(hashStringToSeed(`${seed}:${label}`))
}

/** Depth-weighted card rarity: deeper floors guard better loot (the greed pull). */
function floorCardRarity(seed: number, i: number): Rarity {
  const r = runRng(seed, `rarity:${i}`)()
  // shift the rarity window upward with depth (0..RUN_FLOORS-1)
  const depth = i / Math.max(1, RUN_FLOORS - 1) // 0..1
  const roll = r * 0.6 + depth * 0.4 // 0..1, biased up with depth
  if (roll > 0.92) return 'legendary'
  if (roll > 0.78) return 'epic'
  if (roll > 0.58) return 'rare'
  if (roll > 0.33) return 'uncommon'
  return 'common'
}

export function rollMap(seed: number, floors = RUN_FLOORS): RunFloor[] {
  const out: RunFloor[] = []
  for (let i = 0; i < floors; i++) {
    out.push({
      difficulty: BASE_DIFF + i * DIFF_STEP,
      cardRarity: floorCardRarity(seed, i),
      seeds: 8 + i * 6, // deeper floors bank more seeds
      gear: i === floors - 1, // the final floor also guards a gear piece
    })
  }
  return out
}

export function startRun(state: GameState, seed: number, floors = RUN_FLOORS): RunState {
  return {
    seed,
    power: buildPower(state),
    floors: rollMap(seed, floors),
    current: 0,
    hp: RUN_HP,
    bag: { cards: [], gear: [], seeds: 0 },
  }
}

// ---------------------------------------------------------------------------
// Dive — the core decision's resolution (deterministic from seed + floor index)
// ---------------------------------------------------------------------------

function mergeDrop(bag: RunBag, floor: RunFloor, seed: number, i: number): RunBag {
  const card = makeCard(floor.cardRarity, runRng(seed, `card:${i}`))
  const next: RunBag = {
    cards: [...bag.cards, card],
    gear: floor.gear ? [...bag.gear, makeGear(runRng(seed, `gear:${i}`))] : [...bag.gear],
    seeds: bag.seeds + floor.seeds,
  }
  return next
}

/**
 * Dive the current floor. Clear → bank the floor's drop and advance. Fail → lose 1 HP;
 * at 0 HP the run is DEAD (caller discards the bag). Deterministic from (seed, current),
 * so re-running the same dive yields the same result (resumable across CLI calls). PURE.
 */
export function resolveFloor(run: RunState): DiveResult {
  const floor = run.floors[run.current]
  if (floor === undefined) return { run, cleared: false, dead: false } // already cleared

  const chance = clearChance(run.power, floor.difficulty)
  const roll = runRng(run.seed, `dive:${run.current}`)()
  const cleared = roll < chance

  if (cleared) {
    const bag = mergeDrop(run.bag, floor, run.seed, run.current)
    return { run: { ...run, current: run.current + 1, bag }, cleared: true, dead: false }
  }

  // A fail chips 1 HP and you push PAST the floor bloodied (no loot). Advancing is
  // essential: each floor's outcome is sealed by the seed, so you cannot "retry" the
  // same floor — HP is your budget of mistakes across the run, not per-floor retries.
  const hp = run.hp - 1
  return { run: { ...run, current: run.current + 1, hp }, cleared: false, dead: hp <= 0 }
}

/** Whether the run has cleared every floor (the player should escape to bank it). */
export function isCleared(run: RunState): boolean {
  return run.current >= run.floors.length
}

/** The bag to commit on escape (the caller folds it into the real GameState). PURE. */
export function escapeBag(run: RunState): RunBag {
  return run.bag
}

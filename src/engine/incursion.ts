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

/** A single-use SHIELD bought (with banked seeds) at `start`: it soaks ONE failed dive
 *  (no HP lost) at the moment of your choosing. Cosmetic seeds only (ADR-0005). */
export const SHIELD_COST = 30
/** The per-item cap is LOAD-BEARING balance, not a limit for tidiness: a Monte-Carlo pin
 *  shows 1 shield keeps banking-before-the-last-floor optimal (tension alive), while 2 would
 *  flip the run to always-dive (tension dead). The strongest LEGAL kit is one shield. */
export const SHIELD_CAP = 1

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

/** Floor archetypes. ELITE = a harder gamble for fatter loot (the risky-richer fork);
 *  TREASURE = a safe jackpot, fatter loot at NORMAL odds (the safe-richer fork). (A REST
 *  archetype is a deliberate later follow-up.) */
export type FloorKind = 'combat' | 'elite' | 'treasure'
/** How often a non-final floor rolls ELITE. This is the RATE knob (tune frequency, not the
 *  mult) so the bare run stays a real gamble; pinned by the balance test. ELITE is rolled
 *  FIRST and its window is fixed, so adding TREASURE never shifts the elite set or the rate. */
const ELITE_CHANCE = 0.3
/** An elite floor's difficulty multiplier. Deliberately MODEST: at 1.15 the elite bump is
 *  smaller than a depth step, so difficulty stays strictly rising (no out-of-order spike),
 *  and the boss floor — which is never elite — remains the climax via depth-bias + gear. */
const ELITE_DIFF_MULT = 1.15
/** An elite floor banks this multiple of the depth's base seeds — the reward for the risk. */
const ELITE_SEED_MULT = 2
/** How often a non-final floor rolls TREASURE (carved from the combat window, AFTER elite —
 *  so it leaves difficulty untouched and the bare full-clear rate unchanged). */
const TREASURE_CHANCE = 0.22
/** A treasure floor banks this multiple of base seeds — the fattest bank, at normal odds. */
const TREASURE_SEED_MULT = 2.5

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
  /** archetype (absent on a legacy run.json → treated as 'combat' at every read site) */
  kind?: FloorKind
}

export interface RunBag {
  cards: Card[]
  gear: Gear[]
  seeds: number
}

/** The single-use consumables packed for a run (bought at start, spent mid-run). Lives
 *  only in the ephemeral RunState — never in GameStateSchema. */
export interface RunKit {
  /** remaining shields (each soaks one failed dive); capped at SHIELD_CAP when bought */
  shield: number
}

export const EMPTY_KIT: RunKit = { shield: 0 }

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
  /** consumables packed for this run (absent on a legacy run.json → treated as empty) */
  kit?: RunKit
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
  /** true when a fail was absorbed by a shield (no HP lost, one shield spent) */
  shielded?: boolean
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

/** Archetype on a fresh rng stream (label `kind:i`, so it never perturbs rarity/card/gear/dive).
 *  ELITE is tested FIRST on a fixed window, so its set (and the bare rate) is invariant to adding
 *  TREASURE; treasure is carved from the remaining combat window. The final floor is NEVER special
 *  — it is already the climax (depth-bias + the gear guard). */
function floorKind(seed: number, i: number, floors: number): FloorKind {
  if (i === floors - 1) return 'combat'
  const r = runRng(seed, `kind:${i}`)()
  if (r < ELITE_CHANCE) return 'elite'
  if (r < ELITE_CHANCE + TREASURE_CHANCE) return 'treasure'
  return 'combat'
}

export function rollMap(seed: number, floors = RUN_FLOORS): RunFloor[] {
  const out: RunFloor[] = []
  for (let i = 0; i < floors; i++) {
    const kind = floorKind(seed, i, floors)
    const baseDifficulty = BASE_DIFF + i * DIFF_STEP
    const baseSeeds = 8 + i * 6 // deeper floors bank more seeds
    out.push({
      // elite raises difficulty; treasure leaves it at baseline (a real dive, not free money)
      difficulty: kind === 'elite' ? baseDifficulty * ELITE_DIFF_MULT : baseDifficulty,
      cardRarity: floorCardRarity(seed, i),
      seeds:
        kind === 'elite'
          ? baseSeeds * ELITE_SEED_MULT
          : kind === 'treasure'
            ? Math.round(baseSeeds * TREASURE_SEED_MULT)
            : baseSeeds,
      gear: i === floors - 1, // the final floor also guards a gear piece
      kind,
    })
  }
  return out
}

export function startRun(state: GameState, seed: number, floors = RUN_FLOORS, kit: RunKit = EMPTY_KIT): RunState {
  return {
    seed,
    power: buildPower(state),
    floors: rollMap(seed, floors),
    current: 0,
    hp: RUN_HP,
    bag: { cards: [], gear: [], seeds: 0 },
    // snapshot the kit, clamping the shield to the load-bearing cap
    kit: { shield: Math.max(0, Math.min(SHIELD_CAP, kit.shield)) },
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

  // A SHIELD soaks this fail: advance past the floor with no HP lost and no loot, spending
  // one shield. It can save a run from death, but never grants loot — it only buys you one
  // more wrong guess at the same escape-vs-dive crux.
  const shield = run.kit?.shield ?? 0
  if (shield > 0) {
    const kit: RunKit = { ...(run.kit ?? EMPTY_KIT), shield: shield - 1 }
    return { run: { ...run, current: run.current + 1, kit }, cleared: false, dead: false, shielded: true }
  }

  // A fail chips 1 HP and you push PAST the floor bloodied (no loot). Advancing is
  // essential: each floor's outcome is sealed by the seed, so you cannot "retry" the
  // same floor — HP is your budget of mistakes across the run, not per-floor retries.
  const hp = run.hp - 1
  return { run: { ...run, current: run.current + 1, hp }, cleared: false, dead: hp <= 0, shielded: false }
}

/** Whether the run has cleared every floor (the player should escape to bank it). */
export function isCleared(run: RunState): boolean {
  return run.current >= run.floors.length
}

/** The bag to commit on escape (the caller folds it into the real GameState). PURE. */
export function escapeBag(run: RunState): RunBag {
  return run.bag
}

// ---------------------------------------------------------------------------
// Run history — an honest, cosmetic war-story record (sibling ephemeral file)
// ---------------------------------------------------------------------------

/** One past run, for the cosmetic `sq incursion history` log (a sibling ephemeral file —
 *  NEVER GameState). floorsCleared is derived from the BAG, so it stays honest even when a
 *  fail/shield advanced the run past a floor without clearing it. */
export interface RunRecord {
  outcome: 'escaped' | 'died'
  /** floors actually cleared = bag.cards.length (NOT run.current, which advances on a fail too) */
  floorsCleared: number
  /** the 1-based floor that ended the run (death only); null on escape */
  diedOn: number | null
  /** what reached your real collection on escape; null on death (a forfeit bag is never banked) */
  banked: { cards: number; gear: number; seeds: number } | null
  seed: number
}

/**
 * Derive an honest run record. PURE. The death caller passes the PRE-resolve run so diedOn
 * is the floor being dived; the bag is the source of truth for floorsCleared either way, and
 * a death banks NULL (the forfeit bag never reached real state — no firewall leak).
 */
export function runOutcomeRecord(run: RunState, outcome: 'escaped' | 'died'): RunRecord {
  return {
    outcome,
    floorsCleared: run.bag.cards.length,
    diedOn: outcome === 'died' ? run.current + 1 : null,
    banked:
      outcome === 'escaped'
        ? { cards: run.bag.cards.length, gear: run.bag.gear.length, seeds: run.bag.seeds }
        : null,
    seed: run.seed,
  }
}

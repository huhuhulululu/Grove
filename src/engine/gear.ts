/**
 * Gear enhancement mechanic — RISK + REWARD.
 *
 * ADR-0005 FIREWALL: 'break' and 'downgrade' are COSMETIC-ONLY visual states.
 * They NEVER represent real loss of work, code, commits, or any external artefact.
 * This module is a pure function; it has no I/O and cannot touch the filesystem.
 */

import type { Gear, Rarity } from '../core/rewards'
import type { GameState } from '../core/state'
import type { Rng } from '../core/rng'
import { weightedPick } from '../core/rng'
import { t } from '../i18n/t'

// ---------------------------------------------------------------------------
// Gear name pool
// ---------------------------------------------------------------------------

export const GEAR_NAMES = [
  'Refactor Blade',
  'Debug Lantern',
  'Commit Hammer',
  'Merge Shield',
  'Lint Razor',
  'Build Anvil',
  'Type Saber',
  'Cache Charm',
] as const

export type GearName = (typeof GEAR_NAMES)[number]

/**
 * Create a fresh cosmetic gear piece at level 0.
 *
 * Deterministic: the name is picked via `rng`, then the numeric id suffix is
 * drawn from a second `rng()` call. Same rng state → same gear.
 *
 * @param rng    - Injected deterministic RNG (no Math.random).
 * @param rarity - Defaults to 'rare' (a merit drop from a pr_merged is worth that).
 */
export function makeGear(rng: Rng, rarity: Rarity = 'rare'): Gear {
  const index = Math.floor(rng() * GEAR_NAMES.length)
  const name = GEAR_NAMES[index]!
  const slug = name.toLowerCase().replace(/\s+/g, '-')
  const suffix = Math.floor(rng() * 1_000_000)
  return {
    id: `gear.${slug}.${suffix}`,
    name,
    level: 0,
    rarity,
    broken: false,
  }
}

/** The four possible outcomes of an enhance attempt. */
export type EnhanceResult = 'success' | 'downgrade' | 'break' | 'stay'

/**
 * Returns the probability table for an enhancement attempt at the given gear level.
 *
 * Each band's three probabilities sum to exactly 1.
 *
 * | Level  | success | downgrade | break |
 * |--------|---------|-----------|-------|
 * | 0–1    | 1.00    | 0.00      | 0.00  |
 * | 2–6    | 0.90    | 0.10      | 0.00  |
 * | 7–9    | 0.70    | 0.25      | 0.05  |
 * | 10–12  | 0.50    | 0.35      | 0.15  |
 * | ≥13    | 0.30    | 0.40      | 0.30  |
 *
 * The risk-free band is the first TWO levels only (game-design P3): the old 0–3
 * band was four no-decision "free" clicks; risk (a downgrade chance) now arrives
 * at +2 so an enhance is a real choice sooner.
 */
export function enhanceTable(level: number): { success: number; downgrade: number; break: number } {
  if (level <= 1)  return { success: 1,    downgrade: 0,    break: 0    }
  if (level <= 6)  return { success: 0.9,  downgrade: 0.1,  break: 0    }
  if (level <= 9)  return { success: 0.7,  downgrade: 0.25, break: 0.05 }
  if (level <= 12) return { success: 0.5,  downgrade: 0.35, break: 0.15 }
  /* level >= 13 */ return { success: 0.3,  downgrade: 0.4,  break: 0.3  }
}

/**
 * Attempt to enhance a piece of cosmetic gear.
 *
 * Rules:
 * - If the gear is already broken, return a new copy with result='stay' (no change).
 * - Otherwise, draw from the enhanceTable for the gear's current level:
 *   - 'success'   → level + 1
 *   - 'downgrade' → level = Math.max(0, level - 1)
 *   - 'break'     → broken = true  (level unchanged — COSMETIC ONLY; never real loss)
 *
 * The input gear object is NEVER mutated; a new object is always returned.
 *
 * @param gear    - The current cosmetic gear (not mutated).
 * @param rng     - Injected deterministic RNG (no wall-clock or Math.random usage).
 * @param protect - If true (one-shot), a would-be 'break' is SOFTENED into a
 *                  'downgrade' instead — the risk is reduced, never erased. The
 *                  rng draw is identical, so determinism holds. The break risk
 *                  otherwise stays real (ADR-0007 risk/tension loop).
 */
export function enhance(
  gear: Gear,
  rng: Rng,
  protect = false,
): { gear: Gear; result: EnhanceResult } {
  // Broken gear: cosmetic terminal state — no further enhancement possible.
  // 'stay' means nothing changes visually or mechanically.
  if (gear.broken) {
    return { gear: { ...gear }, result: 'stay' }
  }

  const table = enhanceTable(gear.level)

  const result = weightedPick<EnhanceResult>(rng, [
    { value: 'success',   weight: table.success   },
    { value: 'downgrade', weight: table.downgrade },
    { value: 'break',     weight: table.break     },
  ])

  if (result === 'success') {
    return { gear: { ...gear, level: gear.level + 1 }, result }
  }

  if (result === 'downgrade') {
    return { gear: { ...gear, level: Math.max(0, gear.level - 1) }, result }
  }

  // result === 'break'.
  // With protect armed: SOFTEN the break into a downgrade (level -1, never broken).
  // The protection is consumed by the CALLER (it clears the protectedGear flag);
  // this pure fn only reports the softened outcome.
  if (protect) {
    return { gear: { ...gear, level: Math.max(0, gear.level - 1) }, result: 'downgrade' }
  }

  // COSMETIC-ONLY: sets broken=true, level unchanged. Never real loss (ADR-0005).
  return { gear: { ...gear, broken: true }, result }
}

// ---------------------------------------------------------------------------
// activeGearBonus — gear LEVEL now confers a REAL, ADR-0008-safe workflow effect
// ---------------------------------------------------------------------------

/** Per-point bonus each gear's level contributes, with a sensible cap. */
const GEAR_EFFECTS: Partial<Record<GearName, { field: 'xpPct' | 'currencyPct' | 'critPct'; perLevel: number; cap: number }>> = {
  'Commit Hammer':  { field: 'currencyPct', perLevel: 1,   cap: 20 },
  'Type Saber':     { field: 'critPct',     perLevel: 0.5, cap: 15 },
  'Build Anvil':    { field: 'xpPct',       perLevel: 1,   cap: 20 },
  'Refactor Blade': { field: 'xpPct',       perLevel: 1,   cap: 20 },
}

/** The active workflow bonus conferred by OWNED, un-broken gear (ADR-0008). */
export interface GearBonus {
  /** +N% XP on positive-XP grants (Build Anvil / Refactor Blade). */
  xpPct: number
  /** +N% seeds on currency grants (Commit Hammer). */
  currencyPct: number
  /** +N percentage-points to crit chance (Type Saber). */
  critPct: number
}

/**
 * Read the active gear bonus from OWNED gear (ADR-0008 — gear level finally MATTERS):
 *  - Commit Hammer +N  → +N% currency on outcomes (cap +20%).
 *  - Type Saber +N     → +N*0.5 percentage-points crit chance (cap +15pp).
 *  - Build Anvil +N    → +N% XP (cap +20%).
 *  - Refactor Blade +N → +N% XP (cap +20%), stacking with Build Anvil.
 *
 * Broken gear confers NOTHING. When duplicates of the same gear are owned, only
 * the BEST level counts (no double-count). Each field is capped per the table so
 * a runaway +50 can never trivialise the economy. PURE: reads state, no mutation.
 */
export function activeGearBonus(state: GameState): GearBonus {
  const bonus: GearBonus = { xpPct: 0, currencyPct: 0, critPct: 0 }

  // Best (highest) level per gear NAME among un-broken owned gear.
  const bestByName = new Map<string, number>()
  for (const g of state.gear) {
    if (g.broken) continue
    const prev = bestByName.get(g.name)
    if (prev === undefined || g.level > prev) bestByName.set(g.name, g.level)
  }

  for (const [name, level] of bestByName) {
    const effect = GEAR_EFFECTS[name as GearName]
    if (!effect) continue
    const raw = level * effect.perLevel
    bonus[effect.field] += Math.min(effect.cap, raw)
  }

  return bonus
}

/**
 * The gear level at which this gear's cosmetic effect reaches its CAP — beyond it,
 * further enhancing adds NO effect (higher levels are flair only). null when the
 * gear has no mapped effect. Game-design P3: lets the UI surface the dead zone so
 * a player isn't taking pure break-risk for zero benefit. PURE; reads the table.
 */
export function gearEffectCapLevel(name: string): number | null {
  const effect = GEAR_EFFECTS[name as GearName]
  if (!effect) return null
  return Math.ceil(effect.cap / effect.perLevel)
}

/**
 * Terse per-gear ACTIVE-EFFECT label for display (ADR-0008 — gear level MATTERS).
 * Returns e.g. "+7% commit seeds" / "+5% XP" / "+5pp crit", reading the SAME
 * GEAR_EFFECTS table the engine applies (no drift). Returns `null` when the gear
 * is broken (confers nothing) or has no mapped effect. Capped per the table.
 * PURE: reads the gear, no mutation, no I/O.
 */
export function gearEffectText(gear: Gear): string | null {
  if (gear.broken) return null
  const effect = GEAR_EFFECTS[gear.name as GearName]
  if (!effect) return null
  const value = Math.min(effect.cap, gear.level * effect.perLevel)
  if (value <= 0) return null
  // Round to at most one decimal (Type Saber's 0.5/level can be fractional).
  const n = Math.round(value * 10) / 10
  switch (effect.field) {
    case 'currencyPct':
      return t('en', 'ui.gear.effect.seeds', { n })
    case 'xpPct':
      return t('en', 'ui.gear.effect.xp', { n })
    case 'critPct':
      return t('en', 'ui.gear.effect.crit', { n })
  }
}

// ---------------------------------------------------------------------------
// ESCALATING SINK COSTS (R5 economy P1 — restore save-vs-spend) — pricing is a
// PURE engine concern so the faucet≫sink rebalance has a single source of truth.
// Enhance/repair grow with gear level so high-level gear is a deepening seed sink
// (a flat price let late-game seeds pile up with nowhere to go). Cosmetic-only
// (ADR-0005); published / inspectable (ADR-0002). The CLI debits these.
// ---------------------------------------------------------------------------

/** Base seed cost to ATTEMPT an enhance (level 0). */
export const ENHANCE_COST_BASE = 20
/** Each gear level adds this many seeds to the next enhance attempt. */
export const ENHANCE_COST_PER_LEVEL = 8
/** Base seed cost to repair a broken gear. */
export const REPAIR_COST_BASE = 50
/** Each gear level adds this many seeds to a repair. */
export const REPAIR_COST_PER_LEVEL = 10

/**
 * Seed cost to attempt enhancing gear currently at `level`. Escalates linearly
 * so chasing a high +N is a real, deepening sink (was a flat 20). Level is
 * clamped at 0 so a negative is never charged. PURE.
 */
export function enhanceCost(level: number): number {
  return ENHANCE_COST_BASE + Math.max(0, Math.floor(level)) * ENHANCE_COST_PER_LEVEL
}

/**
 * Seed cost to repair a broken gear. Scales with the gear's level — a broken +12
 * costs far more to restore than a broken +1, so deep gear is a deep sink. PURE.
 */
export function repairCost(gear: Gear): number {
  return REPAIR_COST_BASE + Math.max(0, Math.floor(gear.level)) * REPAIR_COST_PER_LEVEL
}

// ---------------------------------------------------------------------------
// repairGear — clear a COSMETIC broken state (the CLI prices this via repairCost)
// ---------------------------------------------------------------------------

/**
 * Clear the `broken` flag on the gear with the given id. Level is UNCHANGED — a
 * repair only un-breaks, it does not refund the lost levels. No-op (repaired:false)
 * if the id is unknown or the gear is not broken. PURE & IMMUTABLE: returns a NEW
 * gear array; the input state is never mutated.
 */
export function repairGear(
  state: GameState,
  gearId: string,
): { gear: Gear[]; repaired: boolean } {
  let repaired = false
  const gear = state.gear.map((g) => {
    if (g.id === gearId && g.broken) {
      repaired = true
      return { ...g, broken: false }
    }
    return g
  })
  return { gear, repaired }
}

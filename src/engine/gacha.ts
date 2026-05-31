import type { Rarity, Card } from '../core/rewards'
import { rarityRank } from '../core/rewards'
import type { Rng } from '../core/rng'
import { weightedPick } from '../core/rng'
import type { PityState } from '../core/state'
import { cardDefsByRarity, cardFromDef } from '../core/cards'

// ---------------------------------------------------------------------------
// Published odds (must sum to 1.0)
// ---------------------------------------------------------------------------

/**
 * The BASE single-roll rarity table — the chance of each rarity on ONE pull with
 * NO pity active. Published / inspectable (ADR-0002).
 *
 * NOTE (ADR-0002 HONESTY, R5): this is the *base roll* only. A pity floor (soft
 * ramp + a hard guarantee) BY CONSTRUCTION raises the rate a player actually
 * realizes over a long pity-threaded session — a hard guarantee at HARD_PITY
 * alone injects ~1/HARD_PITY extra top-tier pulls that the base table can never
 * express. So the honest *player-facing* legendary+shiny chance is NOT this
 * table's `legendary + shiny` (1.7%) but the pity-inclusive REALIZED rate
 * (`REALIZED_LEGENDARY_SHINY_RATE` below), which the engine actually produces and
 * a statistical test pins down. We publish BOTH: the base table (per-roll truth)
 * and the realized rate (long-run truth), so neither number is a lie.
 */
export const RARITY_ODDS: Record<Rarity, number> = {
  common: 0.60,
  uncommon: 0.25,
  rare: 0.093,
  epic: 0.04,
  legendary: 0.01,
  shiny: 0.007,
}

/**
 * The HONEST, pity-inclusive legendary+shiny rate a player realizes over a long
 * session (ADR-0002 honesty fix, R5 economy P2). The audit found the realized
 * rate (~3.14%) was ~1.85x the naively-published base 1.7% — because pity
 * mathematically raises it. Rather than pretend pity does not exist (impossible:
 * a hard guarantee floors the rate above the base table), we PUBLISH the realized
 * rate so the player-facing number is TRUE. `gacha.test.ts` asserts the engine's
 * measured realized rate sits within ±10% of this constant over many pulls.
 *
 * Player-facing copy (cluster B) should surface this as the real legendary+shiny
 * chance, with the base table shown as the per-roll odds.
 */
export const REALIZED_LEGENDARY_SHINY_RATE = 0.03

// ---------------------------------------------------------------------------
// PREMIUM BANNER (R5 escalating seed SINK) — a higher-tier pull at a much higher
// seed price with materially better odds. Gives accumulated seeds somewhere to
// go (restores save-vs-spend opportunity cost); cosmetic-only (ADR-0005), odds
// published/inspectable (ADR-0002). The mass is shifted UP from common toward
// rare/epic/legendary/shiny — the same six rarities, no new tier, must sum to 1.
// ---------------------------------------------------------------------------

export const PREMIUM_RARITY_ODDS: Record<Rarity, number> = {
  common: 0.20,
  uncommon: 0.30,
  rare: 0.28,
  epic: 0.15,
  legendary: 0.045,
  shiny: 0.025,
}

// ---------------------------------------------------------------------------
// Pity thresholds
// ---------------------------------------------------------------------------

/**
 * Pull index at which the legendary/shiny weights start ramping up.
 *
 * Raised from 8→40 in R3: with pulls now a deliberate CHOICE (they cost seeds)
 * and no longer auto-granted on every green test, the audit-measured realized
 * legendary+shiny rate (~8.8% vs the published 1.7%) is restored to scarcity by
 * pushing soft pity far back.
 */
export const SOFT_PITY = 40

/**
 * Pull index at which legendary-or-shiny is guaranteed (forced).
 *
 * Raised from 14→60 in R3 so a legendary feels genuinely RARE — guaranteed only
 * by the 60th consecutive non-legendary pull, not the 14th.
 */
export const HARD_PITY = 60

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the weighted-pick entry list from a rarity-odds table. */
function baseEntries(odds: Record<Rarity, number>): Array<{ value: Rarity; weight: number }> {
  return (Object.keys(odds) as Rarity[]).map((r) => ({
    value: r,
    weight: odds[r],
  }))
}

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

/**
 * Perform one gacha pull.
 *
 * - **Hard pity**: if `pity.sinceLegendary + 1 >= HARD_PITY` the result is
 *   forced to legendary-or-shiny (weightedPick between just those two).
 * - **Soft pity**: once `pity.sinceLegendary >= SOFT_PITY`, add +0.06 per pull
 *   beyond SOFT_PITY split proportionally onto legendary+shiny weights while
 *   keeping all other weights at their base values.
 * - Otherwise: use base RARITY_ODDS.
 *
 * After rolling: if the rarity is legendary-or-better, reset sinceLegendary to
 * 0; otherwise increment by 1.
 *
 * `odds` selects the rarity table (default `RARITY_ODDS`; pass
 * `PREMIUM_RARITY_ODDS` for the premium banner). Pity is threaded identically on
 * the same counter regardless of which table is active.
 *
 * Returns a new `PityState` object — the input is never mutated.
 */
export function pull(
  pity: PityState,
  rng: Rng,
  odds: Record<Rarity, number> = RARITY_ODDS,
): { rarity: Rarity; pity: PityState } {
  const nextCount = pity.sinceLegendary + 1

  let rarity: Rarity

  if (nextCount >= HARD_PITY) {
    // Hard pity: force legendary or shiny only (weighted by the active table's top tiers)
    rarity = weightedPick(rng, [
      { value: 'legendary' as Rarity, weight: odds.legendary },
      { value: 'shiny' as Rarity, weight: odds.shiny },
    ])
  } else if (pity.sinceLegendary >= SOFT_PITY) {
    // Soft pity: boost legendary+shiny with a ramp of +0.06 per pull beyond SOFT_PITY
    const rampPulls = pity.sinceLegendary - SOFT_PITY + 1 // 1 on the first boosted pull
    const boost = 0.06 * rampPulls

    // Split boost proportionally onto legendary+shiny
    const baseL = odds.legendary
    const baseS = odds.shiny
    const baseTop = baseL + baseS
    const newL = baseL + boost * (baseL / baseTop)
    const newS = baseS + boost * (baseS / baseTop)

    const entries: Array<{ value: Rarity; weight: number }> = [
      { value: 'common', weight: odds.common },
      { value: 'uncommon', weight: odds.uncommon },
      { value: 'rare', weight: odds.rare },
      { value: 'epic', weight: odds.epic },
      { value: 'legendary', weight: newL },
      { value: 'shiny', weight: newS },
    ]

    rarity = weightedPick(rng, entries)
  } else {
    // Base odds (the active table — standard or premium banner)
    rarity = weightedPick(rng, baseEntries(odds))
  }

  // Update pity counter
  const newSinceLegendary =
    rarityRank(rarity) >= rarityRank('legendary') ? 0 : nextCount

  return {
    rarity,
    pity: { sinceLegendary: newSinceLegendary },
  }
}

// ---------------------------------------------------------------------------
// makeCard
// ---------------------------------------------------------------------------

/**
 * Construct a cosmetic Card of the given rarity.
 *
 * Picks one CardDef from `cardDefsByRarity(rarity, level)` using the rng. When
 * `level` is provided the pool is scoped to the player's UNLOCKED sets, so level
 * thresholds genuinely gate which cards can drop (R5: leveling matters — higher
 * level → richer pulls). When omitted, the full pool is used (back-compat).
 *
 * Fallback chain (always lands a card): the level-scoped defs for `rarity` →
 * level-scoped commons → all-level commons. The level-1 pool covers every rarity,
 * so the first fallback essentially never triggers, but it keeps makeCard total.
 */
export function makeCard(rarity: Rarity, rng: Rng, level?: number): Card {
  let defs = cardDefsByRarity(rarity, level)
  if (defs.length === 0) {
    defs = cardDefsByRarity('common', level)
  }
  if (defs.length === 0) {
    defs = cardDefsByRarity('common')
  }
  const index = Math.floor(rng() * defs.length)
  const def = defs[index]!
  return cardFromDef(def)
}

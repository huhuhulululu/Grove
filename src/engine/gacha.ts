import type { Rarity, Card } from '../core/rewards'
import { rarityRank } from '../core/rewards'
import type { Rng } from '../core/rng'
import { weightedPick } from '../core/rng'
import type { PityState } from '../core/state'
import { cardDefsByRarity, cardFromDef } from '../core/cards'

// ---------------------------------------------------------------------------
// Published odds (must sum to 1.0)
// ---------------------------------------------------------------------------

export const RARITY_ODDS: Record<Rarity, number> = {
  common: 0.60,
  uncommon: 0.25,
  rare: 0.093,
  epic: 0.04,
  legendary: 0.01,
  shiny: 0.007,
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

/** Build the weighted-pick entry list from RARITY_ODDS. */
function baseEntries(): Array<{ value: Rarity; weight: number }> {
  return (Object.keys(RARITY_ODDS) as Rarity[]).map((r) => ({
    value: r,
    weight: RARITY_ODDS[r],
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
 * Returns a new `PityState` object — the input is never mutated.
 */
export function pull(
  pity: PityState,
  rng: Rng,
): { rarity: Rarity; pity: PityState } {
  const nextCount = pity.sinceLegendary + 1

  let rarity: Rarity

  if (nextCount >= HARD_PITY) {
    // Hard pity: force legendary or shiny only
    rarity = weightedPick(rng, [
      { value: 'legendary' as Rarity, weight: RARITY_ODDS.legendary },
      { value: 'shiny' as Rarity, weight: RARITY_ODDS.shiny },
    ])
  } else if (pity.sinceLegendary >= SOFT_PITY) {
    // Soft pity: boost legendary+shiny with a ramp of +0.06 per pull beyond SOFT_PITY
    const rampPulls = pity.sinceLegendary - SOFT_PITY + 1 // 1 on the first boosted pull
    const boost = 0.06 * rampPulls

    // Split boost proportionally onto legendary+shiny
    const baseL = RARITY_ODDS.legendary
    const baseS = RARITY_ODDS.shiny
    const baseTop = baseL + baseS
    const newL = baseL + boost * (baseL / baseTop)
    const newS = baseS + boost * (baseS / baseTop)

    const entries: Array<{ value: Rarity; weight: number }> = [
      { value: 'common', weight: RARITY_ODDS.common },
      { value: 'uncommon', weight: RARITY_ODDS.uncommon },
      { value: 'rare', weight: RARITY_ODDS.rare },
      { value: 'epic', weight: RARITY_ODDS.epic },
      { value: 'legendary', weight: newL },
      { value: 'shiny', weight: newS },
    ]

    rarity = weightedPick(rng, entries)
  } else {
    // Base odds
    rarity = weightedPick(rng, baseEntries())
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
 * Picks one CardDef from `cardDefsByRarity(rarity)` using the rng.
 * If the rarity has no defs (edge case), falls back to a common def.
 */
export function makeCard(rarity: Rarity, rng: Rng): Card {
  let defs = cardDefsByRarity(rarity)
  if (defs.length === 0) {
    defs = cardDefsByRarity('common')
  }
  const index = Math.floor(rng() * defs.length)
  const def = defs[index]!
  return cardFromDef(def)
}

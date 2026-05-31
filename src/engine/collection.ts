import type { Card, Rarity } from '../core/rewards'
import type { GameState } from '../core/state'
import type { Reward } from '../core/rewards'
import { cardIdsInSet } from '../core/cards'

// ---------------------------------------------------------------------------
// DUP TAIL (R5) — a duplicate pull is never worthless: it accrues cosmetic
// "shards" scaled by rarity, and SHARDS_PER_CRAFT shards craft a chosen missing
// card. So even a finished collection keeps a horizon. All published /
// inspectable (ADR-0002); cosmetic-only (ADR-0005). The shard BALANCE (exact
// numbers) is A2's to tune later — these are deliberately simple seams.
// ---------------------------------------------------------------------------

/** Shards a duplicate yields, by the duplicate's rarity (escalating, never flat). */
export const SHARDS_BY_RARITY: Record<Rarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 4,
  epic: 8,
  legendary: 16,
  shiny: 24,
}

/**
 * Shards required to craft one chosen missing card.
 *
 * R7 CRAFT HORIZON (economy P3): raised 40→60. Against a common-heavy dupe mix the
 * average dupe banks only ~2.4 shards, so a 40-shard craft closed the collection in
 * ~17 dupe-pulls — too fast a tail. At 60 a craft takes ~25 dupe-pulls, stretching
 * the craft horizon ~1.5x so a finished collection's dup tail sustains a goal longer.
 * The low-rarity shard values (common 1 / uncommon 2) are already minimal, so the
 * craft cost is the cleaner lever. Published / inspectable (ADR-0002).
 */
export const SHARDS_PER_CRAFT = 60

/** Shards a duplicate of the given rarity is worth (rarer dupe → more shards). */
export function shardsForDuplicate(rarity: Rarity): number {
  return SHARDS_BY_RARITY[rarity]
}

/**
 * Seeds one shard converts into (P3 dead-shard-tail). When the collection is
 * craftable-complete, banked shards have nothing left to spend on; `convertShards`
 * trades them back into seeds at THIS published rate so they never become dead
 * weight. Set below SHARDS_PER_CRAFT's implied value so crafting stays the better
 * deal — conversion is the relief valve, not the optimal path. Published (ADR-0002).
 */
export const SHARD_TO_SEED = 2

/**
 * Convert banked shards into seeds at SHARD_TO_SEED (the dead-shard-tail relief
 * valve, P3). A craftable-complete player's shards are otherwise unspendable; this
 * trades them back into the cosmetic seed economy so the dup tail always advances.
 *
 *  - `n` omitted → convert ALL banked shards.
 *  - `n` given   → convert exactly min(n, banked) shards (clamped; never overdraws).
 *  - `n <= 0` or zero shards → calm refusal: NO debit, NO credit, never shaming
 *    (ADR-0005 / ADR-0009).
 *
 * Returns a NEW state and pushes one terse 'currency' reward. PURE & IMMUTABLE —
 * no I/O, no wall-clock, no rng. Rate published (ADR-0002); cosmetic-only (ADR-0005).
 */
export function convertShards(
  state: GameState,
  n?: number,
): { state: GameState; rewards: Reward[] } {
  const rewards: Reward[] = []
  const haveShards = state.player.shards ?? 0

  // How many to convert: all when n omitted; clamped into [0, haveShards] otherwise.
  const want = n === undefined ? haveShards : Math.floor(n)
  const convert = Math.max(0, Math.min(haveShards, want))

  if (convert <= 0) {
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message: `no shards to convert — have ${haveShards}`,
    })
    return { state: { ...state, player: { ...state.player } }, rewards }
  }

  const seeds = convert * SHARD_TO_SEED
  rewards.push({
    kind: 'currency',
    amount: seeds,
    message: `+${seeds} 🌰 · ${convert} shards → seeds`,
  })
  return {
    state: {
      ...state,
      player: {
        ...state.player,
        currency: state.player.currency + seeds,
        shards: haveShards - convert,
      },
    },
    rewards,
  }
}

/** Compensation seeds granted when a pull yields an already-owned (duplicate) card. */
export const DUP_COMP_SEEDS = 10

/**
 * Compensate a duplicate pull (audit P1 + R5 dup tail). THE single shared helper
 * (R6 dedup: was copy-pasted verbatim in reduce.ts and quests.ts). A dupe is never
 * worthless:
 *  - DUP_COMP_SEEDS seeds (flat, immediate), and
 *  - rarity-scaled SHARDS banked toward crafting a chosen missing card (the
 *    endgame horizon — a completed collection still advances).
 * Returns a NEW state and pushes one terse, non-shaming 'currency' reward. PURE
 * & IMMUTABLE. Cosmetic-only (ADR-0005); shard scale published (ADR-0002).
 */
export function grantDupComp(state: GameState, rarity: Rarity, rewards: Reward[]): GameState {
  const shards = shardsForDuplicate(rarity)
  rewards.push({
    kind: 'currency',
    amount: DUP_COMP_SEEDS,
    message: `+${DUP_COMP_SEEDS} 🌰 · +${shards} shards · dupe`,
  })
  return {
    ...state,
    player: {
      ...state.player,
      currency: state.player.currency + DUP_COMP_SEEDS,
      shards: (state.player.shards ?? 0) + shards,
    },
  }
}

/**
 * Card ids the player does NOT yet own, restricted to the supplied `sets` (e.g.
 * the player's unlocked sets). Pure & deterministic — preserves set/def order so
 * a craft target is stable. A locked set's cards are not reported as "missing".
 */
export function missingCardIds(cards: Card[], sets: string[]): string[] {
  const owned = new Set(cards.map((c) => c.id))
  const out: string[] = []
  for (const set of sets) {
    for (const id of cardIdsInSet(set)) {
      if (!owned.has(id)) out.push(id)
    }
  }
  return out
}

/**
 * The card id a craft would produce given `shards` banked and the player's
 * `cards` + unlocked `sets`: the FIRST missing id when `shards >= SHARDS_PER_CRAFT`,
 * else null. null also when nothing is left to craft (collection complete). Pure
 * & deterministic (no rng — the player chooses; this just reports the target).
 */
export function craftableCardId(cards: Card[], sets: string[], shards: number): string | null {
  if (shards < SHARDS_PER_CRAFT) return null
  const missing = missingCardIds(cards, sets)
  return missing[0] ?? null
}

/**
 * Append a card to the collection immutably and detect set completion + duplicates.
 *
 * A set is considered complete when every card id listed in cardIdsInSet(card.set)
 * appears at least once among the NEW collection's ids (duplicates are allowed but
 * do not count as extra distinct entries).
 *
 * `duplicate` is true when the card's id was ALREADY owned before this add — it
 * drives R3 dup-compensation (a dupe still pays out seeds, so it never feels
 * worthless; audit P1 / PRIOR-ART Pandora dup-comp).
 *
 * @returns
 *   - cards          — new array with card appended
 *   - completedSets  — new array (clone or extended) reflecting completion state
 *   - newlyCompleted — the set id if it was just completed for the first time; null otherwise
 *   - duplicate      — true if the card id was already in the collection
 */
export function addCard(
  cards: Card[],
  completedSets: string[],
  card: Card,
): { cards: Card[]; completedSets: string[]; newlyCompleted: string | null; duplicate: boolean } {
  // Was this exact card id already owned? (checked BEFORE the append)
  const duplicate = cards.some((c) => c.id === card.id)

  // Immutably append the new card
  const newCards = [...cards, card]

  // Determine if the card's set is now complete for the first time
  const setAlreadyCompleted = completedSets.includes(card.set)

  if (!setAlreadyCompleted) {
    const required = cardIdsInSet(card.set)

    if (required.length > 0) {
      // Collect distinct ids present in newCards for this set
      const presentIds = new Set(newCards.filter((c) => c.set === card.set).map((c) => c.id))
      const isComplete = required.every((id) => presentIds.has(id))

      if (isComplete) {
        return {
          cards: newCards,
          completedSets: [...completedSets, card.set],
          newlyCompleted: card.set,
          duplicate,
        }
      }
    }
  }

  return {
    cards: newCards,
    completedSets: [...completedSets],
    newlyCompleted: null,
    duplicate,
  }
}

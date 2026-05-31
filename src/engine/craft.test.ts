/**
 * craft.test.ts — R6 CRAFT SINK (P0: shards were write-only/unspendable).
 *
 * `craftCard` is the SPEND side of the dup tail: shards accrue on duplicate pulls
 * (collection.ts) but had no engine path to spend them. This pins down a PURE
 * craftCard(state, cardId?, rng?) → { state, rewards } that:
 *  - debits SHARDS_PER_CRAFT shards,
 *  - validates a chosen cardId against the player's missing/unlocked cards,
 *  - defaults to the cheapest (first) missing card when none is given,
 *  - appends the crafted card with set-completion handling (same as a pull),
 *  - refuses calmly (no debit, never shaming) when too few shards or nothing to craft.
 *
 * Cosmetic-only (ADR-0005); shards/craft cost published & inspectable (ADR-0002).
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { mulberry32 } from '../core/rng'
import { craftCard } from './reduce'
import { SHARDS_PER_CRAFT } from './collection'
import { unlockedSets, ALL_CARD_DEFS, cardIdsInSet } from '../core/cards'

/** A state funded with `shards`, owning `owned` cards. */
function withShards(shards: number, owned: GameState['cards'] = []): GameState {
  return {
    ...initialState(),
    cards: owned,
    player: { xp: 0, level: 1, currency: 0, shards },
  }
}

/** All level-1 card defs as owned Card instances. */
function lvl1Owned(): GameState['cards'] {
  const lvl1Sets = new Set(unlockedSets(1))
  return ALL_CARD_DEFS.filter((d) => lvl1Sets.has(d.set)).map((d) => ({
    id: d.id,
    name: d.name,
    rarity: d.rarity,
    set: d.set,
  }))
}

describe('craftCard — spends shards for a chosen missing card (the craft SINK)', () => {
  it('debits SHARDS_PER_CRAFT and appends the cheapest missing card by default', () => {
    const { state, rewards } = craftCard(withShards(SHARDS_PER_CRAFT + 5), undefined, mulberry32(1))
    expect((state.player.shards ?? 0)).toBe(5)
    expect(state.cards.length).toBe(1)
    // The default target is the FIRST missing id within unlocked sets.
    const expected = cardIdsInSet(unlockedSets(1)[0]!)[0]!
    expect(state.cards[0]!.id).toBe(expected)
    // a 'card' reward fired, tagged as crafted
    expect(rewards.some((r) => r.kind === 'card' && /craft/i.test(r.message))).toBe(true)
    // a shard-spend reward fired with the negative amount
    expect(rewards.some((r) => /shard/i.test(r.message) && /-/.test(r.message))).toBe(true)
  })

  it('crafts the EXACT card requested when a valid missing cardId is given', () => {
    const target = cardIdsInSet('tools')[2]!
    const { state } = craftCard(withShards(SHARDS_PER_CRAFT), target, mulberry32(1))
    expect(state.cards.some((c) => c.id === target)).toBe(true)
    expect((state.player.shards ?? 0)).toBe(0)
  })

  it('refuses (no debit, no card) when shards are insufficient — never shaming', () => {
    const { state, rewards } = craftCard(withShards(SHARDS_PER_CRAFT - 1), undefined, mulberry32(1))
    expect((state.player.shards ?? 0)).toBe(SHARDS_PER_CRAFT - 1)
    expect(state.cards.length).toBe(0)
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg.toLowerCase()).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid|worthless/i)
  })

  it('refuses an INVALID cardId (already-owned or locked/unknown) without debiting', () => {
    const owned = lvl1Owned()
    // owned id → not missing → invalid craft target
    const ownedId = owned[0]!.id
    const { state, rewards } = craftCard(
      withShards(SHARDS_PER_CRAFT, owned),
      ownedId,
      mulberry32(1),
    )
    // no debit, no extra card appended (still exactly the owned set)
    expect((state.player.shards ?? 0)).toBe(SHARDS_PER_CRAFT)
    expect(state.cards.length).toBe(owned.length)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/can.?t|cannot|already|not craftable|invalid|nothing/i)
  })

  it('refuses a LOCKED-set cardId (level gating respected) without debiting', () => {
    const locked = ALL_CARD_DEFS.find((d) => !unlockedSets(1).includes(d.set))!
    const { state } = craftCard(withShards(SHARDS_PER_CRAFT), locked.id, mulberry32(1))
    // locked-set card is not "missing" at level 1 → refused, no debit
    expect((state.player.shards ?? 0)).toBe(SHARDS_PER_CRAFT)
    expect(state.cards.some((c) => c.id === locked.id)).toBe(false)
  })

  it('refuses calmly when the collection (unlocked sets) is already complete', () => {
    const { state, rewards } = craftCard(
      withShards(SHARDS_PER_CRAFT * 9, lvl1Owned()),
      undefined,
      mulberry32(1),
    )
    // nothing missing in unlocked sets → no debit, friendly refusal
    expect((state.player.shards ?? 0)).toBe(SHARDS_PER_CRAFT * 9)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/nothing|complete|no.+craft/i)
  })

  it('crafting the last missing card of a set triggers set completion + bonus', () => {
    // Own all but ONE level-1 card → crafting it completes that set.
    const owned = lvl1Owned()
    const setOfMissing = unlockedSets(1)[0]!
    const missingId = cardIdsInSet(setOfMissing).find(
      (id) => !owned.some((c) => c.id === id),
    )
    // ensure there IS a single missing card to target
    const reduced = owned.filter((c) => c.id !== cardIdsInSet(setOfMissing)[0]!)
    const target = cardIdsInSet(setOfMissing)[0]!
    void missingId
    const { state, rewards } = craftCard(
      withShards(SHARDS_PER_CRAFT, reduced),
      target,
      mulberry32(1),
    )
    expect(state.cards.some((c) => c.id === target)).toBe(true)
    // set completion fires a set-bonus buff reward
    expect(rewards.some((r) => r.kind === 'buff' && /set/i.test(r.message))).toBe(true)
    expect(state.completedSets).toContain(setOfMissing)
  })

  it('never mutates the input state (purity)', () => {
    const s0 = withShards(SHARDS_PER_CRAFT + 1)
    const snap = JSON.parse(JSON.stringify(s0))
    craftCard(s0, undefined, mulberry32(1))
    expect(s0).toEqual(snap)
  })

  it('is deterministic for the same inputs', () => {
    const a = craftCard(withShards(SHARDS_PER_CRAFT), undefined, mulberry32(7))
    const b = craftCard(withShards(SHARDS_PER_CRAFT), undefined, mulberry32(7))
    expect(a.state.cards).toEqual(b.state.cards)
  })
})

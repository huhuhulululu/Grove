/**
 * spark-craft.test.ts — R9 ECONOMY → A: SHARPEN spark vs craft.
 *
 * Both spark and craft can "get a chosen missing card", and craft is the cheaper of
 * the two for that bare outcome — so spark had no niche. R9 gives spark a niche craft
 * CANNOT replicate: the spark GUARANTEE delivers the chosen card already FOILED (a
 * shiny/premium finish), whereas a crafted card lands plain (un-foiled). So saving
 * for a spark buys a strictly DIFFERENT, higher-finish outcome — not a worse-priced
 * duplicate of craft.
 *
 * Cosmetic-only (ADR-0005). PURE — the guarantee + foil-finish are deterministic
 * given the spark counter; rng never alters the chosen target.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { Card } from '../core/rewards'
import { mulberry32 } from '../core/rng'
import { pullPremium, craftCard, SPARK_THRESHOLD, PREMIUM_PULL_COST } from './reduce'
import { unlockedSets, ALL_CARD_DEFS } from '../core/cards'
import { missingCardIds, SHARDS_PER_CRAFT } from './collection'

/** A state funded with seeds + shards, owning `owned`, with a spark count + target. */
function withState(
  seeds: number,
  shards: number,
  owned: Card[] = [],
  spark = 0,
  sparkTarget?: string,
): GameState {
  return {
    ...initialState(),
    cards: owned,
    spark,
    sparkTarget,
    player: { xp: 0, level: 1, currency: seeds, shards },
  }
}

describe('spark vs craft — spark has a niche craft CANNOT replicate', () => {
  it('the spark GUARANTEE delivers the chosen card already FOILED', () => {
    const target = missingCardIds([], unlockedSets(1))[2]!
    const { state, rewards } = pullPremium(
      withState(PREMIUM_PULL_COST, 0, [], SPARK_THRESHOLD, target),
      mulberry32(42),
    )
    // target landed …
    expect(state.cards.some((c) => c.id === target)).toBe(true)
    // … AND it is foiled (the finish craft can't give)
    expect(state.foiled ?? []).toContain(target)
    // a reward names the foil finish on the spark guarantee
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/spark|guarantee/)
    expect(msg).toMatch(/foil/)
  })

  it('a CRAFTED card lands PLAIN (un-foiled) — the contrast that makes spark distinct', () => {
    const target = missingCardIds([], unlockedSets(1))[2]!
    const { state } = craftCard(withState(0, SHARDS_PER_CRAFT, [], 0, undefined), target, mulberry32(1))
    expect(state.cards.some((c) => c.id === target)).toBe(true)
    // craft does NOT foil — that is precisely spark's exclusive niche
    expect(state.foiled ?? []).not.toContain(target)
  })

  it('a NON-guaranteed premium pull does NOT foil its drop (only the guarantee carries the finish)', () => {
    // spark below threshold → ordinary premium roll, no foil finish
    const target = missingCardIds([], unlockedSets(1))[0]!
    const { state } = pullPremium(
      withState(PREMIUM_PULL_COST, 0, [], 0, target),
      mulberry32(5),
    )
    // whatever dropped, the spark guarantee did NOT fire, so nothing was foil-finished
    // (a non-guarantee pull never adds to foiled[])
    expect(state.foiled ?? []).toHaveLength(0)
  })

  it('the spark guarantee foil-finish can complete a fully-foiled-set capstone', () => {
    // own all of `forest` except the spark target, with every other forest card foiled;
    // the foil-finished guarantee should close the foiled set.
    const all = unlockedSets(1)
    const forestMissing = missingCardIds([], ['forest'])
    const target = forestMissing[forestMissing.length - 1]! // last forest id
    // build owned = all forest defs except target
    const owned: Card[] = ALL_CARD_DEFS
      .filter((d) => d.set === 'forest' && d.id !== target)
      .map((d) => ({ id: d.id, name: d.name, rarity: d.rarity, set: d.set }))
    const preFoiled = owned.map((c) => c.id)
    void all
    const seeded: GameState = {
      ...withState(PREMIUM_PULL_COST, 0, owned, SPARK_THRESHOLD, target),
      foiled: preFoiled,
    }
    const { state } = pullPremium(seeded, mulberry32(11))
    expect(state.foiled ?? []).toContain(target)
    expect(state.buffs.some((b) => b.id === 'foiled-set:forest')).toBe(true)
  })

  it('spark guarantee still resets the counter to 0 after firing', () => {
    const target = missingCardIds([], unlockedSets(1))[1]!
    const { state } = pullPremium(
      withState(PREMIUM_PULL_COST, 0, [], SPARK_THRESHOLD, target),
      mulberry32(7),
    )
    expect(state.spark).toBe(0)
  })

  it('purity — the spark foil-finish never mutates the input state', () => {
    const target = missingCardIds([], unlockedSets(1))[0]!
    const s0 = withState(PREMIUM_PULL_COST, 0, [], SPARK_THRESHOLD, target)
    const snap = JSON.parse(JSON.stringify(s0))
    pullPremium(s0, mulberry32(3))
    expect(s0).toEqual(snap)
  })
})

/**
 * foil.test.ts — R8 RENEWABLE CONTENT AXIS (economy A-blocker).
 *
 * A completed collection used to be "done" — every owned card a dead slot. `foilCard`
 * adds a COSMETIC foil-upgrade shard SINK: spend FOIL_COST shards to mark an OWNED
 * card 'foiled' (tracked as `foiled: string[]` in state). So every owned card gains a
 * further sink target and the content runway never runs out.
 *
 * Cosmetic-only (ADR-0005): foil is pure flair, confers no power. Cost published
 * (ADR-0002). PURE — no I/O, no wall-clock; rng never consulted (deterministic).
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { Card } from '../core/rewards'
import { foilCard, FOIL_COST } from './reduce'
import { unlockedSets, ALL_CARD_DEFS } from '../core/cards'

/** A state funded with `shards`, owning `owned` cards (and pre-existing `foiled`). */
function withState(
  shards: number,
  owned: Card[] = [],
  foiled: string[] = [],
): GameState {
  return {
    ...initialState(),
    cards: owned,
    foiled,
    player: { xp: 0, level: 1, currency: 0, shards },
  }
}

/** All level-1 card defs as owned Card instances. */
function lvl1Owned(): Card[] {
  const lvl1Sets = new Set(unlockedSets(1))
  return ALL_CARD_DEFS.filter((d) => lvl1Sets.has(d.set)).map((d) => ({
    id: d.id,
    name: d.name,
    rarity: d.rarity,
    set: d.set,
  }))
}

describe('foilCard — cosmetic FOIL upgrade shard SINK (renewable content axis)', () => {
  it('FOIL_COST is a published positive integer', () => {
    expect(Number.isInteger(FOIL_COST)).toBe(true)
    expect(FOIL_COST).toBeGreaterThan(0)
  })

  it('debits FOIL_COST and flags the chosen owned card foiled', () => {
    const owned = lvl1Owned()
    const target = owned[0]!.id
    const { state, rewards } = foilCard(withState(FOIL_COST + 7, owned), target)
    expect(state.player.shards ?? 0).toBe(7)
    expect(state.foiled).toContain(target)
    // a foil reward fired naming the foiled state, with the negative shard amount
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg.toLowerCase()).toMatch(/foil/)
    expect(rewards.some((r) => /shard/i.test(r.message) && /-/.test(r.message))).toBe(true)
  })

  it('foils the FIRST not-yet-foiled owned card by default when no id is given', () => {
    const owned = lvl1Owned()
    const { state } = foilCard(withState(FOIL_COST, owned), undefined)
    expect(state.foiled).toHaveLength(1)
    expect(state.foiled).toContain(owned[0]!.id)
  })

  it('refuses (no debit, no flag) when shards are insufficient — never shaming', () => {
    const owned = lvl1Owned()
    const { state, rewards } = foilCard(withState(FOIL_COST - 1, owned), owned[0]!.id)
    expect(state.player.shards ?? 0).toBe(FOIL_COST - 1)
    expect(state.foiled ?? []).toHaveLength(0)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid|worthless/i)
  })

  it('refuses an UNOWNED cardId without debiting', () => {
    const owned = lvl1Owned()
    // a locked-set / unowned id
    const unowned = ALL_CARD_DEFS.find((d) => !owned.some((c) => c.id === d.id))!.id
    const { state, rewards } = foilCard(withState(FOIL_COST, owned), unowned)
    expect(state.player.shards ?? 0).toBe(FOIL_COST)
    expect(state.foiled ?? []).not.toContain(unowned)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/can.?t|cannot|don.?t own|not owned|unowned|own/i)
  })

  it('refuses an ALREADY-foiled cardId without debiting (idempotent flag)', () => {
    const owned = lvl1Owned()
    const target = owned[0]!.id
    const { state, rewards } = foilCard(withState(FOIL_COST, owned, [target]), target)
    expect(state.player.shards ?? 0).toBe(FOIL_COST)
    // still exactly one entry, not double-added
    expect(state.foiled!.filter((id) => id === target)).toHaveLength(1)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/already/)
  })

  it('refuses calmly when every owned card is already foiled (default target)', () => {
    const owned = lvl1Owned()
    const allFoiled = owned.map((c) => c.id)
    const { state, rewards } = foilCard(withState(FOIL_COST * 5, owned, allFoiled), undefined)
    expect(state.player.shards ?? 0).toBe(FOIL_COST * 5)
    expect(state.foiled).toHaveLength(owned.length)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/nothing|all|complete|no.+foil/)
  })

  it('refuses calmly when the player owns no cards at all', () => {
    const { state, rewards } = foilCard(withState(FOIL_COST * 5, []), undefined)
    expect(state.player.shards ?? 0).toBe(FOIL_COST * 5)
    expect(state.foiled ?? []).toHaveLength(0)
    expect(rewards.length).toBeGreaterThan(0)
  })

  it('never mutates the input state (purity)', () => {
    const owned = lvl1Owned()
    const s0 = withState(FOIL_COST + 1, owned)
    const snap = JSON.parse(JSON.stringify(s0))
    foilCard(s0, owned[0]!.id)
    expect(s0).toEqual(snap)
  })

  it('confers no power: only shards + foiled change (xp/level/currency/buffs intact)', () => {
    const owned = lvl1Owned()
    const { state } = foilCard(withState(FOIL_COST, owned), owned[0]!.id)
    expect(state.player.xp).toBe(0)
    expect(state.player.level).toBe(1)
    expect(state.player.currency).toBe(0)
    expect(state.buffs).toHaveLength(0)
    expect(state.cards).toEqual(owned) // cards array itself untouched (flag lives in foiled[])
  })
})

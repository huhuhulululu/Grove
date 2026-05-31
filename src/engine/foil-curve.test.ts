/**
 * foil-curve.test.ts — R9 ECONOMY → A.
 *
 * Two A-blockers for the foil sink:
 *  1) FOIL is a CURVE, not a flat drain. The shard cost scales by the foiled card's
 *     rarity (mirroring SHARDS_BY_RARITY — commons cheap, legendary/shiny dear), so
 *     foiling a finished collection is a shaped late-game CLIMB, not a uniform sink.
 *  2) A 'fully-foiled set' COSMETIC capstone — a distinct flair that fires ONCE when
 *     every card in a set is foiled — so post-completion players have a visible GOAL.
 *
 * Cosmetic-only (ADR-0005): foil + capstone confer ZERO power. Costs published
 * (ADR-0002). PURE — no I/O, no wall-clock, no rng.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { Card, Rarity } from '../core/rewards'
import { RARITIES, rarityRank } from '../core/rewards'
import { foilCard, foilCost, FOIL_COST_BY_RARITY } from './reduce'
import { SHARDS_BY_RARITY } from './collection'
import { CARD_SETS, cardIdsInSet, ALL_CARD_DEFS } from '../core/cards'

/** A state funded with `shards`, owning `owned` cards (and pre-existing `foiled`). */
function withState(shards: number, owned: Card[] = [], foiled: string[] = []): GameState {
  return {
    ...initialState(),
    cards: owned,
    foiled,
    player: { xp: 0, level: 1, currency: 0, shards },
  }
}

function defCard(id: string): Card {
  const d = ALL_CARD_DEFS.find((x) => x.id === id)!
  return { id: d.id, name: d.name, rarity: d.rarity, set: d.set }
}

describe('foilCost — a CURVE scaled by rarity (not a flat drain)', () => {
  it('FOIL_COST_BY_RARITY covers every rarity with a positive integer cost', () => {
    for (const r of RARITIES) {
      expect(Number.isInteger(FOIL_COST_BY_RARITY[r])).toBe(true)
      expect(FOIL_COST_BY_RARITY[r]).toBeGreaterThan(0)
    }
  })

  it('cost is monotonically NON-DECREASING up the rarity ladder (commons cheap → shiny dear)', () => {
    const ordered = [...RARITIES].sort((a, b) => rarityRank(a) - rarityRank(b))
    for (let i = 1; i < ordered.length; i++) {
      expect(foilCost(ordered[i]!)).toBeGreaterThanOrEqual(foilCost(ordered[i - 1]!))
    }
  })

  it('is STRICTLY a climb end-to-end: the top tier costs more than the bottom', () => {
    expect(foilCost('shiny')).toBeGreaterThan(foilCost('common'))
    expect(foilCost('legendary')).toBeGreaterThan(foilCost('common'))
  })

  it('MIRRORS the SHARDS_BY_RARITY shape — same monotonic ordering by rarity', () => {
    const ordered = [...RARITIES].sort((a, b) => rarityRank(a) - rarityRank(b))
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!
      const b = ordered[i]!
      // wherever a dupe is worth strictly more shards, foiling that rarity costs strictly more too
      if (SHARDS_BY_RARITY[b] > SHARDS_BY_RARITY[a]) {
        expect(foilCost(b)).toBeGreaterThan(foilCost(a))
      }
    }
  })

  it('foilCost(rarity) equals the published table entry', () => {
    for (const r of RARITIES) {
      expect(foilCost(r)).toBe(FOIL_COST_BY_RARITY[r])
    }
  })
})

describe('foilCard — debits the RARITY-SCALED cost of the chosen card', () => {
  it('foiling a COMMON debits the (cheap) common cost', () => {
    const c = defCard('forest.sapling') // common
    expect(c.rarity).toBe<Rarity>('common')
    const cost = foilCost('common')
    const { state } = foilCard(withState(cost + 3, [c]), c.id)
    expect(state.foiled).toContain(c.id)
    expect(state.player.shards ?? 0).toBe(3)
  })

  it('foiling an EPIC debits MORE than foiling a common (the curve bites)', () => {
    const epic = defCard('forest.elder') // epic
    expect(epic.rarity).toBe<Rarity>('epic')
    const common = defCard('forest.sapling')
    const epicCost = foilCost('epic')
    const commonCost = foilCost('common')
    expect(epicCost).toBeGreaterThan(commonCost)

    const { state: afterEpic } = foilCard(withState(1000, [epic]), epic.id)
    const { state: afterCommon } = foilCard(withState(1000, [common]), common.id)
    const epicSpent = 1000 - (afterEpic.player.shards ?? 0)
    const commonSpent = 1000 - (afterCommon.player.shards ?? 0)
    expect(epicSpent).toBe(epicCost)
    expect(commonSpent).toBe(commonCost)
    expect(epicSpent).toBeGreaterThan(commonSpent)
  })

  it('refuses an epic foil when shards cover only a common (cost is the card-specific one)', () => {
    const epic = defCard('forest.elder')
    const justUnderEpic = foilCost('epic') - 1
    // enough for a common, NOT for this epic
    expect(justUnderEpic).toBeGreaterThanOrEqual(foilCost('common'))
    const { state, rewards } = foilCard(withState(justUnderEpic, [epic]), epic.id)
    expect(state.foiled ?? []).toHaveLength(0)
    expect(state.player.shards ?? 0).toBe(justUnderEpic)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame/i)
  })

  it('the foil reward message reflects the card-specific cost', () => {
    const rare = defCard('forest.willow') // rare
    const cost = foilCost('rare')
    const { rewards } = foilCard(withState(cost, [rare]), rare.id)
    const debit = rewards.find((r) => r.amount === -cost)
    expect(debit).toBeDefined()
    expect(debit!.message).toContain(String(cost))
  })
})

describe('fully-foiled-set capstone — a distinct flair that fires ONCE', () => {
  /** Build every card def of a set as owned cards. */
  function ownSet(set: string): Card[] {
    return cardIdsInSet(set).map(defCard)
  }

  it('grants a capstone buff when the LAST card of a set is foiled', () => {
    const set = 'forest'
    const ids = cardIdsInSet(set)
    const owned = ownSet(set)
    // pre-foil all but the last card
    const preFoiled = ids.slice(0, -1)
    const last = ids[ids.length - 1]!
    const { state, rewards } = foilCard(
      withState(10_000, owned, preFoiled),
      last,
    )
    // last card foiled
    expect(state.foiled).toContain(last)
    // a distinct capstone buff for this set now exists
    expect(state.buffs.some((b) => b.id === `foiled-set:${set}`)).toBe(true)
    // and a celebratory capstone reward fired
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/foiled.*set|set.*foiled|capstone|fully.foiled|all foiled/)
  })

  it('does NOT grant the capstone while the set is only PARTIALLY foiled', () => {
    const set = 'forest'
    const owned = ownSet(set)
    const { state } = foilCard(withState(10_000, owned, []), cardIdsInSet(set)[0]!)
    expect(state.buffs.some((b) => b.id === `foiled-set:${set}`)).toBe(false)
  })

  it('fires the capstone exactly ONCE (idempotent — no second buff, no re-fire)', () => {
    // Two different sets fully foiled across two distinct foil calls would each fire
    // once; here we prove a single set never double-fires. Build a state already
    // holding the capstone buff, with one card left unfoiled, then foil it: because
    // the capstone already exists it must not be appended again.
    const set = 'forest'
    const ids = cardIdsInSet(set)
    const owned = ownSet(set)
    const allButLast = ids.slice(0, -1)
    const seeded: GameState = {
      ...withState(10_000, owned, allButLast),
      buffs: [{ id: `foiled-set:${set}`, label: `${set} foiled`, kind: 'rest' }],
    }
    const { state } = foilCard(seeded, ids[ids.length - 1]!)
    const capstones = state.buffs.filter((b) => b.id === `foiled-set:${set}`)
    expect(capstones).toHaveLength(1)
  })

  it('the capstone is COSMETIC-only: kind is rest (read by no xp/seed/crit selector)', () => {
    const set = 'tools'
    const ids = cardIdsInSet(set)
    const owned = ids.map(defCard)
    const { state } = foilCard(
      withState(10_000, owned, ids.slice(0, -1)),
      ids[ids.length - 1]!,
    )
    const cap = state.buffs.find((b) => b.id === `foiled-set:${set}`)!
    expect(cap.kind).toBe('rest')
    expect(cap.factor).toBeUndefined()
    // no power leaked
    expect(state.player.xp).toBe(0)
    expect(state.player.level).toBe(1)
    expect(state.player.currency).toBe(0)
  })

  it('a foil that does NOT complete a set leaves buffs untouched', () => {
    const set = 'creatures'
    const ids = cardIdsInSet(set)
    const owned = ids.map(defCard)
    // foil only the first; far from complete
    const { state } = foilCard(withState(10_000, owned, []), ids[0]!)
    expect(state.buffs).toHaveLength(0)
  })

  it('never mutates the input state when firing the capstone (purity)', () => {
    const set = 'forest'
    const ids = cardIdsInSet(set)
    const owned = ids.map(defCard)
    const s0 = withState(10_000, owned, ids.slice(0, -1))
    const snap = JSON.parse(JSON.stringify(s0))
    foilCard(s0, ids[ids.length - 1]!)
    expect(s0).toEqual(snap)
  })
})

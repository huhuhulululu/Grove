import { describe, it, expect } from 'vitest'
import { RARITIES } from './rewards'
import type { Rarity } from './rewards'
import {
  CARD_SETS,
  ALL_CARD_DEFS,
  cardDefsByRarity,
  setIds,
  cardIdsInSet,
  cardFromDef,
  unlockedSets,
  SET_UNLOCK_LEVEL,
  setUnlockLevel,
  nextSetUnlock,
} from './cards'

// ---------------------------------------------------------------------------
// Content depth — kill the 15-card cliff (R5 ENGINE depth).
// ---------------------------------------------------------------------------

describe('card content depth', () => {
  it('ships at least 30 cards (was 15 — content cliff killed)', () => {
    expect(ALL_CARD_DEFS.length).toBeGreaterThanOrEqual(30)
  })

  it('spreads across at least 6 sets', () => {
    expect(setIds().length).toBeGreaterThanOrEqual(6)
  })

  it('every rarity has at least one card (full rarity coverage)', () => {
    for (const r of RARITIES) {
      expect(cardDefsByRarity(r as Rarity).length).toBeGreaterThan(0)
    }
  })

  it('every card id is globally unique', () => {
    const ids = ALL_CARD_DEFS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("each card's set field matches the set it is listed under", () => {
    for (const [set, defs] of Object.entries(CARD_SETS)) {
      for (const d of defs) expect(d.set).toBe(set)
    }
  })

  it('each card id is namespaced by its set (set.x)', () => {
    for (const d of ALL_CARD_DEFS) {
      expect(d.id.startsWith(`${d.set}.`)).toBe(true)
    }
  })

  it('cardFromDef carries id/name/rarity/set through unchanged', () => {
    const def = ALL_CARD_DEFS[0]!
    expect(cardFromDef(def)).toEqual({ id: def.id, name: def.name, rarity: def.rarity, set: def.set })
  })
})

// ---------------------------------------------------------------------------
// Leveling MUST matter — set unlock thresholds (R5 game-design P1).
// ---------------------------------------------------------------------------

describe('set unlock thresholds (level gates pulls)', () => {
  it('every set has a declared unlock level', () => {
    for (const set of setIds()) {
      expect(typeof setUnlockLevel(set)).toBe('number')
    }
  })

  it('the three original sets unlock at level 1 (no regression for early players)', () => {
    expect(setUnlockLevel('forest')).toBe(1)
    expect(setUnlockLevel('tools')).toBe(1)
    expect(setUnlockLevel('creatures')).toBe(1)
  })

  it('at least one set is gated behind a higher level (>1)', () => {
    const gated = setIds().filter((s) => setUnlockLevel(s) > 1)
    expect(gated.length).toBeGreaterThanOrEqual(3)
  })

  it('SET_UNLOCK_LEVEL has an entry for every set', () => {
    for (const set of setIds()) {
      expect(SET_UNLOCK_LEVEL[set]).toBeDefined()
    }
  })

  it('an unknown set defaults to unlock level 1 (never silently un-pullable)', () => {
    expect(setUnlockLevel('does-not-exist')).toBe(1)
  })
})

describe('unlockedSets(level)', () => {
  it('a level-1 player sees only the level-1 sets', () => {
    const sets = unlockedSets(1)
    expect(sets).toContain('forest')
    expect(sets).toContain('tools')
    expect(sets).toContain('creatures')
    // no set whose unlock level is > 1
    for (const s of sets) expect(setUnlockLevel(s)).toBeLessThanOrEqual(1)
  })

  it('higher level unlocks strictly more (or equal) sets — richer pulls', () => {
    const lo = unlockedSets(1).length
    const hi = unlockedSets(99).length
    expect(hi).toBeGreaterThan(lo)
  })

  it('level 99 unlocks every set', () => {
    expect(new Set(unlockedSets(99))).toEqual(new Set(setIds()))
  })

  it('is monotonic: a higher level never removes a set you already had', () => {
    for (let lvl = 1; lvl < 20; lvl++) {
      const cur = new Set(unlockedSets(lvl))
      const nxt = new Set(unlockedSets(lvl + 1))
      for (const s of cur) expect(nxt.has(s)).toBe(true)
    }
  })

  it('a level-0 / negative level is treated as level 1 (never empty pool)', () => {
    expect(unlockedSets(0)).toEqual(unlockedSets(1))
    expect(unlockedSets(-5)).toEqual(unlockedSets(1))
  })

  it('the level-1 unlocked sets cover EVERY rarity (makeCard never starves at level 1)', () => {
    const lvl1 = new Set(unlockedSets(1))
    const lvl1Defs = ALL_CARD_DEFS.filter((d) => lvl1.has(d.set))
    for (const r of RARITIES) {
      expect(lvl1Defs.some((d) => d.rarity === r)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// level-aware cardDefsByRarity — gacha respects unlocked sets.
// ---------------------------------------------------------------------------

describe('cardDefsByRarity(rarity, level?)', () => {
  it('with no level: returns ALL defs of that rarity (back-compat)', () => {
    const all = cardDefsByRarity('common')
    const everyCommon = ALL_CARD_DEFS.filter((d) => d.rarity === 'common')
    expect(all.map((d) => d.id).sort()).toEqual(everyCommon.map((d) => d.id).sort())
  })

  it('with a level: only returns defs from sets unlocked at that level', () => {
    const lvl1 = cardDefsByRarity('common', 1)
    const lvl1Sets = new Set(unlockedSets(1))
    for (const d of lvl1) expect(lvl1Sets.has(d.set)).toBe(true)
  })

  it('a higher level can expose more cards of a rarity than level 1', () => {
    const lo = cardDefsByRarity('common', 1).length
    const hi = cardDefsByRarity('common', 99).length
    expect(hi).toBeGreaterThanOrEqual(lo)
  })

  it('never returns an empty list for a rarity present in the level-1 pool', () => {
    for (const r of RARITIES) {
      // every rarity is covered at level 1 (asserted above), so level-1 list is non-empty
      expect(cardDefsByRarity(r as Rarity, 1).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// nextSetUnlock — surfaces the "horizon" (what the next level unlocks).
// ---------------------------------------------------------------------------

describe('nextSetUnlock(level)', () => {
  it('returns the soonest set gated above the given level', () => {
    const next = nextSetUnlock(1)
    expect(next).not.toBeNull()
    expect(next!.level).toBeGreaterThan(1)
    expect(setUnlockLevel(next!.set)).toBe(next!.level)
  })

  it('returns null once every set is unlocked', () => {
    expect(nextSetUnlock(99)).toBeNull()
  })
})

/**
 * model.test.ts — the PURE view-model derivation for the navigable Ink TUI.
 *
 * tuiModel(state) maps a GameState into a flat, render-ready view-model: the
 * header (level / xp bar fraction / seeds / shards / prestige), the collection
 * grid, the gear list with active effects, the quest board, and the economy
 * (affordable actions). It re-uses the EXISTING engine selectors — it never
 * re-implements game logic. Pure: no I/O, deterministic, immutable input.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { cardFromDef, ALL_CARD_DEFS, CARD_SETS } from '../core/cards'
import { makeGear } from '../engine/gear'
import { mulberry32 } from '../core/rng'
import { PULL_COST, PREMIUM_PULL_COST } from '../engine/reduce'
import { tuiModel, PANELS } from './model'

/** A card instance for a given def id (validated against the catalogue). */
function card(id: string) {
  const def = ALL_CARD_DEFS.find((d) => d.id === id)!
  return cardFromDef(def)
}

describe('tuiModel — header derivation', () => {
  it('maps level / xp / seeds / shards from a known state', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 30, level: 2, currency: 120, shards: 7 },
    }
    const m = tuiModel(state)

    expect(m.header.level).toBe(2)
    expect(m.header.xp).toBe(30)
    // xpForLevel(2) = round(50 * 2^1.5) = 141
    expect(m.header.xpForLevel).toBe(141)
    // The bar fraction is xp/needed clamped to [0,1].
    expect(m.header.xpFraction).toBeCloseTo(30 / 141, 5)
    expect(m.header.seeds).toBe(120)
    expect(m.header.shards).toBe(7)
  })

  it('reads shards as 0 when the (optional) field is absent', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 0 } }
    const m = tuiModel(state)
    expect(m.header.shards).toBe(0)
  })

  it('surfaces prestige rank + the NEXT rank cost via the engine selectors', () => {
    const state: GameState = {
      ...initialState(),
      buffs: [{ id: 'prestige:mark', label: 'Prestige 1', kind: 'rest' }],
    }
    const m = tuiModel(state)
    expect(m.header.prestigeRank).toBe(1)
    // prestigeCost(1) = 500 + 1*250 = 750
    expect(m.header.nextPrestigeCost).toBe(750)
  })
})

describe('tuiModel — collection grid', () => {
  it('reports owned/total per UNLOCKED set and locks gated sets', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 0, shards: 0 },
      cards: [card('forest.sapling'), card('forest.fern')],
    }
    const m = tuiModel(state)

    const forest = m.collection.find((s) => s.set === 'forest')!
    expect(forest.owned).toBe(2)
    expect(forest.total).toBe(CARD_SETS['forest']!.length)
    expect(forest.locked).toBe(false)

    // relics unlocks at L10 — locked for a level-1 player.
    const relics = m.collection.find((s) => s.set === 'relics')!
    expect(relics.locked).toBe(true)
    expect(relics.unlockLevel).toBe(10)
  })

  it('marks a fully-owned set complete', () => {
    const forestCards = CARD_SETS['forest']!.map((d) => cardFromDef(d))
    const state: GameState = { ...initialState(), cards: forestCards }
    const m = tuiModel(state)
    const forest = m.collection.find((s) => s.set === 'forest')!
    expect(forest.owned).toBe(forest.total)
    expect(forest.complete).toBe(true)
  })

  it('exposes a representative rarity per set (the highest-rarity card OWNED) for colour', () => {
    // Own forest.sapling (common) + forest.elder (epic) → the row rarity is epic.
    const state: GameState = {
      ...initialState(),
      cards: [card('forest.sapling'), card('forest.elder')],
    }
    const forest = tuiModel(state).collection.find((s) => s.set === 'forest')!
    expect(forest.rarity).toBe('epic')
  })

  it('a set with no cards owned reports the lowest rarity (common) — a neutral tint', () => {
    const forest = tuiModel(initialState()).collection.find((s) => s.set === 'forest')!
    expect(forest.owned).toBe(0)
    expect(forest.rarity).toBe('common')
  })
})

describe('tuiModel — gear list with active effects', () => {
  it('lists gear with its effect text and broken/protected flags', () => {
    const rng = mulberry32(1)
    const hammer = { ...makeGear(rng), name: 'Commit Hammer', level: 5, broken: false }
    const brokenSaber = { ...makeGear(rng), name: 'Type Saber', level: 8, broken: true }
    const state: GameState = {
      ...initialState(),
      gear: [hammer, brokenSaber],
      protectedGear: [hammer.id],
    }
    const m = tuiModel(state)

    expect(m.gear).toHaveLength(2)
    expect(m.gear[0]!.name).toBe('Commit Hammer')
    expect(m.gear[0]!.level).toBe(5)
    // Commit Hammer +5 → +5% commit seeds (perLevel 1).
    expect(m.gear[0]!.effect).toContain('5')
    expect(m.gear[0]!.protectedNow).toBe(true)
    expect(m.gear[0]!.broken).toBe(false)

    expect(m.gear[1]!.broken).toBe(true)
    // Broken gear confers nothing.
    expect(m.gear[1]!.effect).toBeNull()
  })

  it('exposes each gear row rarity (for the rarity-as-colour tint)', () => {
    const rng = mulberry32(1)
    const hammer = { ...makeGear(rng), name: 'Commit Hammer', level: 5, broken: false, rarity: 'legendary' as const }
    const state: GameState = { ...initialState(), gear: [hammer] }
    const m = tuiModel(state)
    expect(m.gear[0]!.rarity).toBe('legendary')
  })

  it('is empty when no gear is owned', () => {
    const m = tuiModel(initialState())
    expect(m.gear).toEqual([])
  })
})

describe('tuiModel — quest board', () => {
  it('lists every quest with its status glyph state', () => {
    const state: GameState = {
      ...initialState(),
      quests: [
        { id: 'grimoire', status: 'done', completions: 1 },
        { id: 'precast-spec', status: 'active', completions: 0 },
      ],
    }
    const m = tuiModel(state)

    const grimoire = m.quests.find((q) => q.id === 'grimoire')!
    expect(grimoire.status).toBe('done')
    const spec = m.quests.find((q) => q.id === 'precast-spec')!
    expect(spec.status).toBe('active')
    // A quest with no progress is 'todo'.
    const untouched = m.quests.find((q) => q.id === 'test-warden')!
    expect(untouched.status).toBe('todo')
  })
})

describe('tuiModel — economy / affordable actions', () => {
  it('flags which actions the current seed balance affords', () => {
    const rich: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: PREMIUM_PULL_COST, shards: 0 },
    }
    const me = tuiModel(rich).economy
    expect(me.canPull).toBe(true)
    expect(me.canPremium).toBe(true)
    expect(me.pullCost).toBe(PULL_COST)
    expect(me.premiumCost).toBe(PREMIUM_PULL_COST)

    const broke = tuiModel(initialState()).economy
    expect(broke.canPull).toBe(false)
    expect(broke.canPremium).toBe(false)
  })

  it('flags craftable when shards meet the craft cost', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 0, shards: 60 },
    }
    const m = tuiModel(state)
    expect(m.economy.canCraft).toBe(true)
    // A craft target is a missing card id within an unlocked set.
    expect(m.economy.craftTarget).not.toBeNull()
  })
})

describe('tuiModel — panel order', () => {
  it('exposes the navigable panel ids in a stable order', () => {
    expect(PANELS).toEqual(['Collection', 'Gear', 'Quests', 'Economy'])
  })
})

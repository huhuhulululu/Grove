import { describe, it, expect } from 'vitest'
import type { Card, Rarity } from '../core/rewards'
import { cardIdsInSet, ALL_CARD_DEFS } from '../core/cards'
import {
  addCard,
  shardsForDuplicate,
  SHARDS_BY_RARITY,
  SHARDS_PER_CRAFT,
  missingCardIds,
  craftableCardId,
} from './collection'

// Helper: build a Card from a known card id in a set.
// Accepts `string | undefined` so call sites can index the id arrays directly under
// `noUncheckedIndexedAccess`; the ids are always present at runtime, so undefined is a bug.
function makeCard(id: string | undefined, set: string): Card {
  if (id === undefined) throw new Error('makeCard: missing card id')
  return { id, name: id, rarity: 'common', set }
}

// All forest card ids
const forestIds = cardIdsInSet('forest')
// All tools card ids
const toolsIds = cardIdsInSet('tools')

describe('addCard', () => {
  it('appends the new card to the collection', () => {
    const cards: Card[] = []
    const completedSets: string[] = []
    const card = makeCard(forestIds[0], 'forest')

    const result = addCard(cards, completedSets, card)

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]).toEqual(card)
  })

  it('appends when collection already has cards', () => {
    const existing = makeCard(forestIds[0], 'forest')
    const cards: Card[] = [existing]
    const card = makeCard(forestIds[1], 'forest')

    const result = addCard(cards, [], card)

    expect(result.cards).toHaveLength(2)
    expect(result.cards[1]).toEqual(card)
  })

  it('sets newlyCompleted to the set id when the last missing card is added', () => {
    // Build up a collection with all but the last forest card
    const allButLast = forestIds.slice(0, -1).map((id) => makeCard(id, 'forest'))
    const lastCard = makeCard(forestIds[forestIds.length - 1], 'forest')

    const result = addCard(allButLast, [], lastCard)

    expect(result.newlyCompleted).toBe('forest')
    expect(result.completedSets).toContain('forest')
  })

  it('adds set to completedSets when it becomes complete', () => {
    const allButLast = forestIds.slice(0, -1).map((id) => makeCard(id, 'forest'))
    const lastCard = makeCard(forestIds[forestIds.length - 1], 'forest')

    const result = addCard(allButLast, [], lastCard)

    expect(result.completedSets).toEqual(['forest'])
  })

  it('returns newlyCompleted=null when adding a card that does not complete a set', () => {
    const card = makeCard(forestIds[0], 'forest')

    const result = addCard([], [], card)

    expect(result.newlyCompleted).toBeNull()
  })

  it('returns newlyCompleted=null when set was already in completedSets', () => {
    // All forest cards already in collection; set already marked complete
    const allForest = forestIds.map((id) => makeCard(id, 'forest'))
    // Add one more forest card (duplicate) — set was already completed
    const extraCard = makeCard(forestIds[0], 'forest')

    const result = addCard(allForest, ['forest'], extraCard)

    expect(result.newlyCompleted).toBeNull()
  })

  it('does NOT add set to completedSets again when it was already completed', () => {
    const allForest = forestIds.map((id) => makeCard(id, 'forest'))
    const extraCard = makeCard(forestIds[0], 'forest')

    const result = addCard(allForest, ['forest'], extraCard)

    // completedSets should still only have 'forest' once
    expect(result.completedSets.filter((s) => s === 'forest')).toHaveLength(1)
  })

  it('duplicate cards (same id added twice) do not falsely complete a set', () => {
    // Only have the first forest card twice — that is NOT a complete set
    const dupCard = makeCard(forestIds[0], 'forest')
    const existingCards: Card[] = [dupCard]

    const result = addCard(existingCards, [], dupCard)

    expect(result.newlyCompleted).toBeNull()
    // The set should NOT appear in completedSets
    expect(result.completedSets).not.toContain('forest')
  })

  it('completing a set only fires once — subsequent cards yield newlyCompleted=null', () => {
    // Fully complete the forest set for the first time
    const allButLast = forestIds.slice(0, -1).map((id) => makeCard(id, 'forest'))
    const lastCard = makeCard(forestIds[forestIds.length - 1], 'forest')
    const firstResult = addCard(allButLast, [], lastCard)

    expect(firstResult.newlyCompleted).toBe('forest')

    // Now add yet another card to the already-complete collection
    const anotherCard = makeCard(toolsIds[0], 'tools')
    const secondResult = addCard(firstResult.cards, firstResult.completedSets, anotherCard)

    expect(secondResult.newlyCompleted).toBeNull()
  })

  it('can complete a different set independently', () => {
    // Complete the forest set first
    const allForest = forestIds.map((id) => makeCard(id, 'forest'))
    // Then complete the tools set
    const allButLastTool = toolsIds.slice(0, -1).map((id) => makeCard(id, 'tools'))
    const lastTool = makeCard(toolsIds[toolsIds.length - 1], 'tools')

    const combined = [...allForest, ...allButLastTool]
    const result = addCard(combined, ['forest'], lastTool)

    expect(result.newlyCompleted).toBe('tools')
    expect(result.completedSets).toContain('forest')
    expect(result.completedSets).toContain('tools')
  })

  it('does not mutate the input cards array', () => {
    const cards: Card[] = [makeCard(forestIds[0], 'forest')]
    const originalLength = cards.length
    const card = makeCard(forestIds[1], 'forest')

    addCard(cards, [], card)

    expect(cards).toHaveLength(originalLength)
  })

  it('does not mutate the input completedSets array', () => {
    const allButLast = forestIds.slice(0, -1).map((id) => makeCard(id, 'forest'))
    const lastCard = makeCard(forestIds[forestIds.length - 1], 'forest')
    const completedSets: string[] = []

    addCard(allButLast, completedSets, lastCard)

    expect(completedSets).toHaveLength(0)
  })

  it('returns new array references (not the same objects)', () => {
    const cards: Card[] = []
    const completedSets: string[] = []
    const card = makeCard(forestIds[0], 'forest')

    const result = addCard(cards, completedSets, card)

    expect(result.cards).not.toBe(cards)
    expect(result.completedSets).not.toBe(completedSets)
  })

  // -------------------------------------------------------------------------
  // duplicate detection (drives R3 dup-compensation — dupes never feel worthless)
  // -------------------------------------------------------------------------

  it('flags duplicate=false for a brand-new card id', () => {
    const result = addCard([], [], makeCard(forestIds[0], 'forest'))
    expect(result.duplicate).toBe(false)
  })

  it('flags duplicate=true when the same card id is already owned', () => {
    const owned = [makeCard(forestIds[0], 'forest')]
    const result = addCard(owned, [], makeCard(forestIds[0], 'forest'))
    expect(result.duplicate).toBe(true)
  })

  it('duplicate is independent of set completion (a dup that completes nothing is still a dup)', () => {
    const owned = [makeCard(forestIds[0], 'forest')]
    const result = addCard(owned, [], makeCard(forestIds[0], 'forest'))
    expect(result.duplicate).toBe(true)
    expect(result.newlyCompleted).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// DUP TAIL — duplicates accrue SHARDS, a craftable sink so a completed
// collection still has a horizon (R5 ENGINE depth, dup-conversion sink).
// ---------------------------------------------------------------------------

describe('shardsForDuplicate', () => {
  it('grants shards scaled by rarity (rarer dupe → more shards)', () => {
    expect(shardsForDuplicate('common')).toBe(SHARDS_BY_RARITY.common)
    expect(shardsForDuplicate('legendary')).toBe(SHARDS_BY_RARITY.legendary)
  })

  it('is escalating: a higher rarity never grants fewer shards than a lower one', () => {
    const order: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'shiny']
    for (let i = 1; i < order.length; i++) {
      expect(shardsForDuplicate(order[i]!)).toBeGreaterThanOrEqual(shardsForDuplicate(order[i - 1]!))
    }
  })

  it('every rarity grants a positive shard count (a dup is never worthless)', () => {
    const order: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'shiny']
    for (const r of order) expect(shardsForDuplicate(r)).toBeGreaterThan(0)
  })

  it('SHARDS_PER_CRAFT is a published, positive integer cost', () => {
    expect(Number.isInteger(SHARDS_PER_CRAFT)).toBe(true)
    expect(SHARDS_PER_CRAFT).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// CRAFT HORIZON (R7 economy P3) — a craft must cost enough that a common-heavy
// dupe tail sustains. The audit found 40 shards/craft closed the collection too
// fast (against a mix where the average dupe banks only ~2.4 shards, a craft was
// ~17 dupe-pulls). SHARDS_PER_CRAFT was stretched (40→60) so the tail lasts longer.
// Low-rarity shard values are already minimal (common 1 / uncommon 2), so the craft
// cost is the lever. This guards the horizon against a future shrink.
// ---------------------------------------------------------------------------

describe('craft horizon — the dup tail sustains (R7 economy P3)', () => {
  it('SHARDS_PER_CRAFT was stretched above the old 40 (a longer tail)', () => {
    expect(SHARDS_PER_CRAFT).toBeGreaterThan(40)
  })

  it('keeps the low-rarity shard values minimal (common 1 / uncommon 2)', () => {
    // The other lever is to lower low-rarity shards; they are already at the floor,
    // so the craft cost carries the horizon. Pin them so they cannot creep up.
    expect(SHARDS_BY_RARITY.common).toBe(1)
    expect(SHARDS_BY_RARITY.uncommon).toBe(2)
  })

  it('a common-heavy dupe tail needs many dupes per craft (no fast close)', () => {
    // Model a common-heavy mix: mostly common/uncommon dupes with a thin rare tail.
    // The average dupe banks well under half a craft's worth, so a craft is many
    // dupes — the tail does not collapse in a handful of pulls.
    const mix: Record<Rarity, number> = {
      common: 60,
      uncommon: 25,
      rare: 10,
      epic: 4,
      legendary: 1,
      shiny: 0,
    }
    let totalShards = 0
    let totalDupes = 0
    for (const [rarity, n] of Object.entries(mix) as [Rarity, number][]) {
      totalShards += shardsForDuplicate(rarity) * n
      totalDupes += n
    }
    const avgShardsPerDupe = totalShards / totalDupes
    const dupesPerCraft = SHARDS_PER_CRAFT / avgShardsPerDupe
    // A common-heavy dupe averages well under half a craft's cost in shards…
    expect(avgShardsPerDupe).toBeLessThan(SHARDS_PER_CRAFT / 2)
    // …so a single craft takes a sustaining number of dupes (the stretched horizon).
    expect(dupesPerCraft).toBeGreaterThanOrEqual(20)
  })
})

describe('missingCardIds', () => {
  it('returns every card id not yet owned, within the given unlocked sets', () => {
    const owned: Card[] = []
    const missing = missingCardIds(owned, ['forest'])
    expect(missing.sort()).toEqual(cardIdsInSet('forest').sort())
  })

  it('excludes ids the player already owns', () => {
    const owned = [makeCard(forestIds[0], 'forest')]
    const missing = missingCardIds(owned, ['forest'])
    expect(missing).not.toContain(forestIds[0])
    expect(missing).toContain(forestIds[1])
  })

  it('returns empty when the player owns every card in the unlocked sets', () => {
    const owned = forestIds.map((id) => makeCard(id, 'forest'))
    expect(missingCardIds(owned, ['forest'])).toEqual([])
  })

  it('only considers cards in the supplied sets (a locked set is not "missing")', () => {
    const owned: Card[] = []
    const missing = missingCardIds(owned, ['forest'])
    // tools cards are not in the supplied unlocked-set list → not reported missing
    for (const id of cardIdsInSet('tools')) expect(missing).not.toContain(id)
  })
})

describe('craftableCardId', () => {
  it('picks a missing card id when enough shards are banked', () => {
    const owned: Card[] = []
    const id = craftableCardId(owned, ['forest'], SHARDS_PER_CRAFT)
    expect(id).not.toBeNull()
    expect(cardIdsInSet('forest')).toContain(id!)
  })

  it('returns null when shards are insufficient', () => {
    const owned: Card[] = []
    expect(craftableCardId(owned, ['forest'], SHARDS_PER_CRAFT - 1)).toBeNull()
  })

  it('returns null when there is nothing left to craft (collection complete)', () => {
    const allOwned = ALL_CARD_DEFS.map((d) => ({ id: d.id, name: d.name, rarity: d.rarity, set: d.set }))
    const allSets = [...new Set(ALL_CARD_DEFS.map((d) => d.set))]
    expect(craftableCardId(allOwned, allSets, SHARDS_PER_CRAFT * 99)).toBeNull()
  })

  it('is deterministic for the same inputs (picks the first missing id)', () => {
    const owned: Card[] = []
    const a = craftableCardId(owned, ['forest'], SHARDS_PER_CRAFT)
    const b = craftableCardId(owned, ['forest'], SHARDS_PER_CRAFT)
    expect(a).toBe(b)
  })
})

import { describe, it, expect } from 'vitest'
import type { Card } from '../core/rewards'
import { cardIdsInSet } from '../core/cards'
import { addCard } from './collection'

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

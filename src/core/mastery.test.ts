import { describe, it, expect } from 'vitest'
import { isMastered, MASTERY_LEVEL } from './mastery'
import { ALL_SET_IDS } from './achievements'
import { initialState } from './state'
import type { GameState } from './state'
import { ALL_CARD_DEFS, cardIdsInSet, cardFromDef } from './cards'

// Build a state that satisfies ALL FOUR mastery conjuncts at once:
//   1. every built-in set complete
//   2. player level >= MASTERY_LEVEL
//   3. prestige rank >= 1
//   4. at least one fully-foiled set
// One set ('forest') is owned in full and entirely foiled to satisfy (4); the
// rest are recorded as complete to satisfy (1) without inflating the card list.
function masteredState(): GameState {
  const setId = ALL_SET_IDS[0]! // 'forest'
  const cardIds = cardIdsInSet(setId)
  const ownedOfSet = ALL_CARD_DEFS.filter((d) => cardIds.includes(d.id)).map(cardFromDef)
  return {
    ...initialState(),
    player: { xp: 0, level: MASTERY_LEVEL, currency: 0, shards: 0 },
    completedSets: [...ALL_SET_IDS],
    cards: ownedOfSet,
    foiled: [...cardIds],
    buffs: [{ id: 'prestige:mark', label: 'Prestige 1', kind: 'rest' }],
  }
}

describe('isMastered — the four-conjunct mastery arrival (pure)', () => {
  it('is false on a fresh state (nothing crossed yet)', () => {
    expect(isMastered(initialState())).toBe(false)
  })

  it('is true exactly when all four conjuncts hold', () => {
    expect(isMastered(masteredState())).toBe(true)
  })

  // Drop each conjunct one at a time → proves it is a conjunction, not an OR.
  it('is false if the player is below the mastery level', () => {
    const s = masteredState()
    expect(
      isMastered({ ...s, player: { ...s.player, level: MASTERY_LEVEL - 1 } }),
    ).toBe(false)
  })

  it('is false if any set is still incomplete', () => {
    expect(isMastered({ ...masteredState(), completedSets: ALL_SET_IDS.slice(1) })).toBe(false)
  })

  it('is false without a prestige rank', () => {
    expect(isMastered({ ...masteredState(), buffs: [] })).toBe(false)
  })

  it('is false without a fully-foiled set', () => {
    expect(isMastered({ ...masteredState(), foiled: [] })).toBe(false)
  })
})

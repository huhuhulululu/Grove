import { describe, it, expect } from 'vitest'
import {
  QUESTS,
  questById,
  allQuestIds,
  RENEWABLE_QUEST_IDS,
  isRenewable,
  DOC_STREAK_TIERS,
  docStreakTier,
} from './quests'

// ---------------------------------------------------------------------------
// Quest catalog depth — 8 Pillar-B quests (was 4) + a renewable variant (R5).
// ---------------------------------------------------------------------------

describe('quest catalog depth', () => {
  it('ships at least 8 quests (the remaining 4 Pillar-B quests shipped)', () => {
    expect(QUESTS.length).toBeGreaterThanOrEqual(8)
  })

  it('every quest has a non-empty id/title/description and a valid pillar', () => {
    for (const q of QUESTS) {
      expect(q.id.length).toBeGreaterThan(0)
      expect(q.title.length).toBeGreaterThan(0)
      expect(q.description.length).toBeGreaterThan(0)
      expect(['A', 'B']).toContain(q.pillar)
    }
  })

  it('quest ids are unique', () => {
    const ids = allQuestIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the original four quests (no regression)', () => {
    for (const id of ['grimoire', 'precast-spec', 'living-map', 'test-warden']) {
      expect(questById(id)).toBeDefined()
    }
  })

  it('quest titles avoid 中二 spellbook cosplay (terse, dev-grounded — ADR-0009)', () => {
    const banned = /grimoire|spell|warden|forge the|pre-cast the/i
    for (const q of QUESTS) {
      expect(q.title).not.toMatch(banned)
    }
  })

  it('questById returns undefined for an unknown id', () => {
    expect(questById('nope')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Renewable quests — a refreshing board, not a static one (R5).
// ---------------------------------------------------------------------------

describe('renewable quests', () => {
  it('declares at least one renewable quest id', () => {
    expect(RENEWABLE_QUEST_IDS.length).toBeGreaterThanOrEqual(1)
  })

  it('every renewable id is a real quest', () => {
    for (const id of RENEWABLE_QUEST_IDS) {
      expect(questById(id)).toBeDefined()
    }
  })

  it('isRenewable distinguishes renewable from one-shot quests', () => {
    expect(isRenewable(RENEWABLE_QUEST_IDS[0]!)).toBe(true)
    expect(isRenewable('grimoire')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Doc-freshness streak — a tiered, weekly, renewable variant.
// ---------------------------------------------------------------------------

describe('docStreakTier (tiered weekly doc-freshness streak)', () => {
  it('has at least 3 ascending tiers', () => {
    expect(DOC_STREAK_TIERS.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < DOC_STREAK_TIERS.length; i++) {
      expect(DOC_STREAK_TIERS[i]!.at).toBeGreaterThan(DOC_STREAK_TIERS[i - 1]!.at)
    }
  })

  it('tier 0 (no streak yet) maps to the lowest reward', () => {
    expect(docStreakTier(0)).toBe(0)
  })

  it('a longer streak reaches a higher tier index', () => {
    const last = DOC_STREAK_TIERS[DOC_STREAK_TIERS.length - 1]!
    expect(docStreakTier(last.at)).toBe(DOC_STREAK_TIERS.length - 1)
  })

  it('caps at the top tier no matter how long the streak runs', () => {
    const top = DOC_STREAK_TIERS.length - 1
    expect(docStreakTier(9999)).toBe(top)
  })

  it('the doc-streak quest is one of the renewable quests', () => {
    expect(RENEWABLE_QUEST_IDS).toContain('doc-streak')
    expect(isRenewable('doc-streak')).toBe(true)
  })
})

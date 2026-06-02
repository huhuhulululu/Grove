import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { Buff } from '../core/state'
import type { Card } from '../core/rewards'
import { ACHIEVEMENTS } from '../core/achievements'
import { checkAchievements } from './achievements'
import { reduce } from './reduce'
import type { GroveEvent } from '../core/events'
import { mulberry32 } from '../core/rng'
import { ALL_CARD_DEFS, cardFromDef, cardIdsInSet, setIds } from '../core/cards'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev(over: Partial<GroveEvent> & Pick<GroveEvent, 'type'>): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    magnitude: over.magnitude ?? 1,
    success: over.success ?? true,
    ts: '2026-06-01T00:00:00.000Z',
    meta: over.meta ?? {},
    ...over,
  }
}

/** N distinct owned cards (drawn from the published defs). */
function ownCards(n: number): Card[] {
  return ALL_CARD_DEFS.slice(0, n).map(cardFromDef)
}

/** A prestige rank buff (kind 'rest', same id shape reduce.ts uses). */
function prestigeBuff(rank: number): Buff {
  const id = rank <= 1 ? 'prestige:mark' : `prestige:mark:${rank}`
  return { id, label: `Prestige ${rank}`, kind: 'rest' }
}

// ---------------------------------------------------------------------------
// The published table — derivable-only, disjoint, no time predicate
// ---------------------------------------------------------------------------

describe('ACHIEVEMENTS table (ADR-0015 rev.2)', () => {
  it('has ~12 entries with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10)
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(15)
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a non-empty id, name, desc and a function predicate', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.id.length).toBeGreaterThan(0)
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.desc.length).toBeGreaterThan(0)
      expect(typeof a.when).toBe('function')
    }
  })

  it('no achievement uses an em-dash in copy (tone: terse, · not —)', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.includes('—')).toBe(false)
      expect(a.desc.includes('—')).toBe(false)
    }
  })

  // STRUCTURAL anti-FOMO: a predicate must derive only from the existing
  // cumulative fields. We assert no predicate's SOURCE references a time/elapsed/
  // inactivity concept (the purity test bans the clock; this bans the concept).
  it('no predicate source references an elapsed/time/inactivity concept', () => {
    const banned = /elapsed|Date|now|time|inactiv|idle|sinceLast|wall|clock/i
    for (const a of ACHIEVEMENTS) {
      expect(banned.test(a.when.toString()), `${a.id} predicate reads a time concept`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// DISJOINT from existing recognitions (quests + foiled-set capstone)
// ---------------------------------------------------------------------------

describe('achievements are disjoint from quests + the foiled-set capstone', () => {
  // The quest ids and the capstone buff-id shape the engine already grants.
  const QUEST_IDS = [
    'aura:grimoire',
    'mult:precast',
    'buff:living-map',
    'streak:tests',
    'buff:review-loop',
    'aura:clean-build',
    'buff:merge-momentum',
  ]
  const capstoneIds = setIds().map((s) => `foiled-set:${s}`)

  it('no achievement id collides with a quest id', () => {
    for (const a of ACHIEVEMENTS) {
      expect(QUEST_IDS.includes(a.id), `${a.id} collides with a quest id`).toBe(false)
    }
  })

  it('no achievement id collides with a foiled-set capstone buff id', () => {
    for (const a of ACHIEVEMENTS) {
      expect(capstoneIds.includes(a.id), `${a.id} collides with a capstone id`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// checkAchievements — pure, derivable, idempotency gate
// ---------------------------------------------------------------------------

describe('checkAchievements (PURE)', () => {
  it('an empty initial state unlocks nothing', () => {
    expect(checkAchievements(initialState())).toEqual([])
  })

  it('does not mutate the input state', () => {
    const s: GameState = { ...initialState(), player: { ...initialState().player, level: 10 } }
    const snap = JSON.parse(JSON.stringify(s))
    checkAchievements(s)
    expect(s).toEqual(snap)
  })

  it('reaching level 5 unlocks the L5 milestone (and only it at L5)', () => {
    const s: GameState = { ...initialState(), player: { ...initialState().player, level: 5 } }
    const unlocked = checkAchievements(s)
    expect(unlocked).toContain('ach:level-5')
    expect(unlocked).not.toContain('ach:level-10')
  })

  it('owning 10 distinct cards unlocks the cards-10 recognition', () => {
    const s: GameState = { ...initialState(), cards: ownCards(10) }
    expect(checkAchievements(s)).toContain('ach:cards-10')
  })

  it('owning 20 distinct cards unlocks ach:cards-25 (P2: threshold lowered 25→20)', () => {
    const s: GameState = { ...initialState(), cards: ownCards(20) }
    expect(checkAchievements(s)).toContain('ach:cards-25')
  })

  it('owning 19 distinct cards does NOT yet unlock ach:cards-25 (boundary)', () => {
    const s: GameState = { ...initialState(), cards: ownCards(19) }
    expect(checkAchievements(s)).not.toContain('ach:cards-25')
  })

  it('the ach:cards-25 desc copy stays in sync with its lowered threshold', () => {
    expect(ACHIEVEMENTS.find((a) => a.id === 'ach:cards-25')!.desc).toBe('Own 20 distinct cards.')
  })

  it('first foil unlocks first-foil', () => {
    const s: GameState = { ...initialState(), cards: ownCards(1), foiled: [ALL_CARD_DEFS[0]!.id] }
    expect(checkAchievements(s)).toContain('ach:first-foil')
  })

  it('a fully-foiled set unlocks foiled-set', () => {
    const set = 'forest'
    const ids = cardIdsInSet(set)
    const s: GameState = {
      ...initialState(),
      cards: ids.map((id) => cardFromDef(ALL_CARD_DEFS.find((d) => d.id === id)!)),
      foiled: [...ids],
    }
    expect(checkAchievements(s)).toContain('ach:foiled-set')
  })

  it('first prestige unlocks prestige-1; rank 3 unlocks prestige-3', () => {
    const s1: GameState = { ...initialState(), buffs: [prestigeBuff(1)] }
    expect(checkAchievements(s1)).toContain('ach:prestige-1')
    expect(checkAchievements(s1)).not.toContain('ach:prestige-3')

    const s3: GameState = {
      ...initialState(),
      buffs: [prestigeBuff(1), prestigeBuff(2), prestigeBuff(3)],
    }
    expect(checkAchievements(s3)).toContain('ach:prestige-3')
  })

  it('owning 5 gear unlocks gear-5', () => {
    const gear = Array.from({ length: 5 }, (_, i) => ({
      id: `gear.x.${i}`,
      name: 'Build Anvil',
      level: 0,
      rarity: 'rare' as const,
      broken: false,
    }))
    const s: GameState = { ...initialState(), gear }
    expect(checkAchievements(s)).toContain('ach:gear-5')
  })

  it('IDEMPOTENCY GATE: an already-recorded id is never re-emitted', () => {
    const s: GameState = {
      ...initialState(),
      player: { ...initialState().player, level: 5 },
      achievements: ['ach:level-5'],
    }
    expect(checkAchievements(s)).not.toContain('ach:level-5')
  })
})

// ---------------------------------------------------------------------------
// reduce() wiring — append + cosmetic reward, idempotent on the 2nd pass
// ---------------------------------------------------------------------------

describe('reduce — achievement wiring (ADR-0015)', () => {
  it('crossing a threshold via reduce records the id + pushes a cosmetic reward', () => {
    // A near-L5 state that levels up on a high-magnitude doc event.
    const s0: GameState = { ...initialState(), player: { xp: 0, level: 4, currency: 0, shards: 0 } }
    const { state, rewards } = reduce(s0, ev({ type: 'doc_updated', magnitude: 50 }), mulberry32(1))

    // It crossed at least L5.
    expect(state.player.level).toBeGreaterThanOrEqual(5)
    expect(state.achievements).toContain('ach:level-5')
    // A cosmetic unlock reward was pushed for it (kind buff, our key).
    const ach = rewards.find((r) => r.buff === 'ach:level-5')
    expect(ach).toBeTruthy()
    expect(ach!.kind).toBe('buff')
    expect(ach!.msgKey).toBe('reward.achievement')
  })

  it('IDEMPOTENT: reducing the SAME satisfying state twice yields ZERO new unlocks/rewards on the 2nd pass', () => {
    // A state already at L5. The first reduce records ach:level-5; a second reduce
    // on the RESULT must emit no new achievement reward.
    const s0: GameState = { ...initialState(), player: { xp: 0, level: 5, currency: 0, shards: 0 } }
    const r1 = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    expect(r1.state.achievements).toContain('ach:level-5')

    const r2 = reduce(r1.state, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    // No achievement reward on the 2nd pass.
    const newAch = r2.rewards.filter((r) => r.msgKey === 'reward.achievement')
    expect(newAch).toEqual([])
    // And the recorded list did not grow with a duplicate.
    expect(r2.state.achievements).toEqual(r1.state.achievements)
  })

  it('cloneState preserves achievements through a no-op (success:false) reduce', () => {
    const s0: GameState = { ...initialState(), achievements: ['ach:level-5', 'ach:first-set'] }
    const { state } = reduce(s0, ev({ type: 'commit', success: false }), mulberry32(1))
    expect(state.achievements).toEqual(s0.achievements)
    // Deep copy: not the same array reference.
    expect(state.achievements).not.toBe(s0.achievements)
  })
})

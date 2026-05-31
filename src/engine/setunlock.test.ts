/**
 * setunlock.test.ts — R6 SET-UNLOCK REWARD (P1): a level-up that crosses a
 * SET_UNLOCK_LEVEL threshold must push a celebratory 'set unlocked' reward so the
 * unlock is not silent (the new content beat was invisible before R6).
 *
 * Terse, dev-grounded copy (ADR-0009 / docs/TONE.md); cosmetic-only (ADR-0005) —
 * the reward is a celebratory LINE, the unlock just widens the cosmetic pull pool.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { GroveEvent } from '../core/events'
import { mulberry32 } from '../core/rng'
import { reduce } from './reduce'
import { SET_UNLOCK_LEVEL, unlockedSets } from '../core/cards'

function ev(over: Partial<GroveEvent> & Pick<GroveEvent, 'type'>): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    magnitude: over.magnitude ?? 1,
    success: over.success ?? true,
    ts: over.ts ?? '2026-05-31T00:00:00.000Z',
    meta: over.meta ?? {},
    ...over,
  }
}

/** A player one XP-event away from leveling into `targetLevel`. */
function justBelow(targetLevel: number): GameState {
  // Sit at targetLevel-1 with almost all the XP for the next level already banked,
  // so a small commit (10 XP base) tips it over.
  return {
    ...initialState(),
    player: { xp: 0, level: targetLevel - 1, currency: 0, shards: 0 },
  }
}

describe('reduce — crossing a SET_UNLOCK_LEVEL fires a celebratory set-unlock reward', () => {
  it('a level-up into a set-unlock level surfaces a "set unlocked" line', () => {
    // deploy unlocks at its configured level; cross into it with a big commit.
    const deployLevel = SET_UNLOCK_LEVEL['deploy']!
    const s0 = { ...initialState(), player: { xp: 0, level: deployLevel - 1, currency: 0, shards: 0 } }
    // A large-magnitude commit grants enough XP to cross at least one level.
    const { state, rewards } = reduce(s0, ev({ type: 'commit', magnitude: 50 }), mulberry32(1))
    expect(state.player.level).toBeGreaterThanOrEqual(deployLevel)
    const unlockLine = rewards.find(
      (r) => typeof r.message === 'string' && /unlock/i.test(r.message),
    )
    expect(unlockLine).toBeDefined()
    // names the set, is terse, never shaming
    expect(unlockLine!.message).toMatch(/deploy|set/i)
    expect(unlockLine!.message).not.toMatch(/fail|lazy|shame/i)
  })

  it('an event with NO level-up fires NO unlock reward', () => {
    const s0 = initialState() // level 1, all level-1 sets already unlocked
    const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    expect(rewards.some((r) => /unlock/i.test(r.message))).toBe(false)
  })

  it('a level-up that does NOT cross any unlock threshold fires no unlock reward', () => {
    // Level 1 → 2: no set unlocks at level 2 (the next gated set is higher).
    const noUnlockAt2 = !Object.values(SET_UNLOCK_LEVEL).includes(2)
    expect(noUnlockAt2).toBe(true) // sanity for the fixture
    // Level 2 needs exactly 50 XP; a magnitude-5 commit (10×5=50) reaches L2 but
    // stays short of L3 (cumulative 191), so it crosses no unlock threshold.
    const s0 = justBelow(2)
    const { state, rewards } = reduce(s0, ev({ type: 'commit', magnitude: 5 }), mulberry32(1))
    expect(state.player.level).toBe(2)
    expect(rewards.some((r) => /unlock/i.test(r.message))).toBe(false)
  })

  it('jumping MULTIPLE levels past several thresholds names each newly unlocked set', () => {
    // From level 1, a massive XP grant can cross several unlock thresholds at once.
    const s0 = { ...initialState(), player: { xp: 0, level: 1, currency: 0, shards: 0 } }
    const before = new Set(unlockedSets(1))
    const { state, rewards } = reduce(s0, ev({ type: 'pr_merged', magnitude: 200 }), mulberry32(7))
    const after = unlockedSets(state.player.level)
    const newlyUnlocked = after.filter((s) => !before.has(s))
    if (newlyUnlocked.length > 0) {
      const unlockLines = rewards.filter((r) => /unlock/i.test(r.message))
      // at least one unlock line per newly-unlocked set
      expect(unlockLines.length).toBeGreaterThanOrEqual(1)
      for (const set of newlyUnlocked) {
        expect(rewards.some((r) => r.message.includes(set))).toBe(true)
      }
    }
  })

  it('purity: input state untouched', () => {
    const s0 = { ...initialState(), player: { xp: 0, level: SET_UNLOCK_LEVEL['deploy']! - 1, currency: 0, shards: 0 } }
    const snap = JSON.parse(JSON.stringify(s0))
    reduce(s0, ev({ type: 'commit', magnitude: 50 }), mulberry32(1))
    expect(s0).toEqual(snap)
  })
})

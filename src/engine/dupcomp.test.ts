/**
 * dupcomp.test.ts — R6 DEDUP (code P2): grantDupComp was duplicated verbatim in
 * reduce.ts and quests.ts. It now lives once in collection.ts. This pins down the
 * shared helper's contract so both call sites stay identical by construction.
 *
 * A duplicate pull is never worthless: DUP_COMP_SEEDS seeds (flat) PLUS
 * rarity-scaled SHARDS banked toward a craftable card. Cosmetic-only (ADR-0005).
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { Reward } from '../core/rewards'
import { grantDupComp, shardsForDuplicate } from './collection'
import { DUP_COMP_SEEDS } from './quests'

describe('grantDupComp (shared helper) — seeds + rarity-scaled shards, never shaming', () => {
  it('credits DUP_COMP_SEEDS seeds and rarity-scaled shards', () => {
    const s0 = { ...initialState(), player: { xp: 0, level: 1, currency: 0, shards: 0 } }
    const rewards: Reward[] = []
    const next = grantDupComp(s0, 'epic', rewards)
    expect(next.player.currency).toBe(DUP_COMP_SEEDS)
    expect(next.player.shards).toBe(shardsForDuplicate('epic'))
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg).toMatch(/dupe/i)
    expect(msg).toContain(`+${shardsForDuplicate('epic')} shards`)
    expect(msg).not.toMatch(/fail|lazy|shame|worthless/i)
  })

  it('accumulates onto existing seeds/shards (immutably)', () => {
    const s0 = { ...initialState(), player: { xp: 0, level: 1, currency: 100, shards: 5 } }
    const rewards: Reward[] = []
    const next = grantDupComp(s0, 'legendary', rewards)
    expect(next.player.currency).toBe(100 + DUP_COMP_SEEDS)
    expect(next.player.shards).toBe(5 + shardsForDuplicate('legendary'))
    // input not mutated
    expect(s0.player.currency).toBe(100)
    expect(s0.player.shards).toBe(5)
  })

  it('treats an absent shards field as 0 (legacy state)', () => {
    const s0 = { ...initialState(), player: { xp: 0, level: 1, currency: 0 } }
    const rewards: Reward[] = []
    const next = grantDupComp(s0, 'common', rewards)
    expect(next.player.shards).toBe(shardsForDuplicate('common'))
  })
})

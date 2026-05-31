/**
 * prestige.test.ts — R6 TIERED / RENEWABLE PRESTIGE (game-design P2).
 *
 * R5 prestige was a ONE-TIME idempotent buff: once bought, the late-game seed
 * sink was spent forever. R6 makes it RENEWABLE — prestige rank N at an escalating
 * cost, each a DISTINCT cosmetic flair — so the late-game seed sink recurs and a
 * finished collection always has a target.
 *
 * Cosmetic-only (ADR-0005): prestige confers ZERO economic power (no xp/seed/crit/
 * streak effect). Costs published & inspectable (ADR-0002).
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import {
  buyPrestige,
  prestigeRank,
  prestigeCost,
  prestigeBuffId,
  PRESTIGE_COST,
  PREMIUM_PULL_COST,
  PRESTIGE_BUFF_ID,
} from './reduce'
import {
  activeMultiplier,
  activeSeedBonus,
  activeStreakMultiplier,
  activeFreshnessBonus,
} from './quests'

function fund(currency: number): GameState {
  return { ...initialState(), player: { xp: 0, level: 1, currency, shards: 0 } }
}

describe('tiered prestige — renewable, escalating cosmetic ranks', () => {
  it('rank 0 on a fresh state; first rank costs PRESTIGE_COST (> premium pull)', () => {
    expect(prestigeRank(initialState())).toBe(0)
    expect(prestigeCost(0)).toBe(PRESTIGE_COST)
    expect(PRESTIGE_COST).toBeGreaterThan(PREMIUM_PULL_COST)
  })

  it('the cost ESCALATES with each rank (a recurring, deepening sink)', () => {
    expect(prestigeCost(1)).toBeGreaterThan(prestigeCost(0))
    expect(prestigeCost(2)).toBeGreaterThan(prestigeCost(1))
  })

  it('buying rank 1 debits prestigeCost(0) and grants the first distinct flair', () => {
    const { state, rewards } = buyPrestige(fund(prestigeCost(0) + 100))
    expect(state.player.currency).toBe(100)
    expect(prestigeRank(state)).toBe(1)
    // the first buff keeps the legacy PRESTIGE_BUFF_ID for back-compat
    expect(state.buffs.some((b) => b.id === PRESTIGE_BUFF_ID)).toBe(true)
    expect(state.buffs.some((b) => b.id === prestigeBuffId(1))).toBe(true)
    expect(rewards.some((r) => r.kind === 'currency' && r.amount === -prestigeCost(0))).toBe(true)
  })

  it('is RENEWABLE: a second purchase grants rank 2 at the higher cost (no idempotent block)', () => {
    const seeds = prestigeCost(0) + prestigeCost(1) + 10
    const first = buyPrestige(fund(seeds))
    const second = buyPrestige(first.state)
    expect(prestigeRank(second.state)).toBe(2)
    // each rank is a DISTINCT flair
    expect(second.state.buffs.some((b) => b.id === prestigeBuffId(1))).toBe(true)
    expect(second.state.buffs.some((b) => b.id === prestigeBuffId(2))).toBe(true)
    // the second purchase debited the escalated cost
    expect(second.state.player.currency).toBe(seeds - prestigeCost(0) - prestigeCost(1))
  })

  it('confers ZERO economic power at any rank (cosmetic-only, ADR-0005)', () => {
    let state = fund(prestigeCost(0) + prestigeCost(1) + prestigeCost(2))
    for (let i = 0; i < 3; i++) state = buyPrestige(state).state
    expect(prestigeRank(state)).toBe(3)
    expect(activeMultiplier(state)).toBe(1)
    expect(activeSeedBonus(state)).toBe(0)
    expect(activeStreakMultiplier(state)).toBe(1)
    expect(activeFreshnessBonus(state)).toBe(0)
  })

  it('refuses (no debit, no rank) when broke — friendly, never shaming', () => {
    const { state, rewards } = buyPrestige(fund(prestigeCost(0) - 1))
    expect(prestigeRank(state)).toBe(0)
    expect(state.player.currency).toBe(prestigeCost(0) - 1)
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg.toLowerCase()).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid/i)
  })

  it('refuses the NEXT rank when funds only cover the previous (escalation enforced)', () => {
    // fund exactly rank-1 cost; rank 2 needs more → refused after the first buy
    const first = buyPrestige(fund(prestigeCost(0)))
    expect(prestigeRank(first.state)).toBe(1)
    expect(first.state.player.currency).toBe(0)
    const second = buyPrestige(first.state)
    expect(prestigeRank(second.state)).toBe(1) // unchanged
  })

  it('never mutates the input state', () => {
    const s0 = fund(prestigeCost(0) + 5)
    const snap = JSON.parse(JSON.stringify(s0))
    buyPrestige(s0)
    expect(s0).toEqual(snap)
  })
})

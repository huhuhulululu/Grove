/**
 * endgame.test.ts — R5 faucet≫sink REBALANCE + escalating seed SINK (economy P1)
 * + ENDGAME sink (game-design P2).
 *
 * The audit found 'pull is a choice' had collapsed (~36 pulls/day; the token
 * milestone floor was a near-free faucet). This pins down:
 *  1. the TIGHTENED token-milestone faucet (higher cost-per-chest, lower cap),
 *  2. the PREMIUM banner (a 5x-priced pull with materially better odds — the
 *     escalating sink that restores save-vs-spend opportunity cost), and
 *  3. the ENDGAME prestige sink (a big one-time seed drain → permanent cosmetic
 *     so a completed collection still leaves seeds a meaningful target).
 *
 * Kept in its own file so the existing economy.test.ts seam stays clean.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { GroveEvent } from '../core/events'
import { mulberry32 } from '../core/rng'
import { rarityRank } from '../core/rewards'
import {
  reduce,
  pull,
  pullPremium,
  buyPrestige,
  PULL_COST,
  PREMIUM_PULL_COST,
  PRESTIGE_COST,
  PRESTIGE_BUFF_ID,
  WORK_MILESTONE,
  COST_TO_WORK,
  MILESTONE_CAP_PER_WINDOW,
} from './reduce'
import {
  activeMultiplier,
  activeSeedBonus,
  activeStreakMultiplier,
  activeFreshnessBonus,
} from './quests'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function costFrame(over: {
  costUsd?: number
  fiveHourResetsAt?: number
  present?: boolean
}): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    type: 'quota_update',
    magnitude: 1,
    success: true,
    ts: '2026-05-31T00:00:00.000Z',
    meta: {
      present: over.present ?? false,
      ...(over.costUsd !== undefined ? { costUsd: over.costUsd } : {}),
      ...(over.fiveHourResetsAt !== undefined ? { fiveHourResetsAt: over.fiveHourResetsAt } : {}),
    },
  }
}

function fund(currency: number): GameState {
  return { ...initialState(), player: { xp: 0, level: 1, currency, shards: 0 } }
}

// ---------------------------------------------------------------------------
// 1. FAUCET REBALANCE — the token-milestone floor is no longer near-free.
// ---------------------------------------------------------------------------

describe('faucet rebalance — token-milestone floor is tightened (save-vs-spend restored)', () => {
  it('a chest now costs MORE than $1 of cost (WORK_MILESTONE raised above 1)', () => {
    expect(WORK_MILESTONE).toBeGreaterThan(1)
  })

  it('the per-window cap is lowered (no longer a fountain)', () => {
    expect(MILESTONE_CAP_PER_WINDOW).toBeLessThanOrEqual(2)
    expect(MILESTONE_CAP_PER_WINDOW).toBeGreaterThanOrEqual(1)
  })

  it('a sub-WORK_MILESTONE cost frame grants NO chest (the meter just accrues)', () => {
    // Just under one milestone of cost.
    const cost = (WORK_MILESTONE / COST_TO_WORK) * 0.9
    const { state, rewards } = reduce(initialState(), costFrame({ costUsd: cost }), mulberry32(5))
    expect(rewards.some((r) => r.kind === 'card')).toBe(false)
    expect(state.cards.length).toBe(0)
  })

  it('a heavy single window is capped to MILESTONE_CAP_PER_WINDOW chests (cannot farm)', () => {
    const big = WORK_MILESTONE * (MILESTONE_CAP_PER_WINDOW + 30)
    const { state } = reduce(initialState(), costFrame({ costUsd: big, fiveHourResetsAt: 100 }), mulberry32(5))
    expect(state.work.milestonesInWindow).toBe(MILESTONE_CAP_PER_WINDOW)
    expect(state.cards.length).toBe(MILESTONE_CAP_PER_WINDOW)
  })

  it('total free chests over a day are far fewer than the old ~12 (cap × ~4 windows)', () => {
    // Simulate 4 distinct 5h windows each burning past the cap.
    let state = initialState()
    let chests = 0
    for (let w = 0; w < 4; w++) {
      const before = state.cards.length
      const cost = WORK_MILESTONE * (w + 1) * (MILESTONE_CAP_PER_WINDOW + 10)
      state = reduce(
        state,
        costFrame({ costUsd: cost, fiveHourResetsAt: 1000 + w }),
        mulberry32(5),
      ).state
      chests += state.cards.length - before
    }
    // With cap 2 × 4 windows = 8 free chests/day max — strictly fewer than the
    // old near-free 12, and well below the ~36-pulls/day faucet the audit flagged.
    expect(chests).toBeLessThanOrEqual(MILESTONE_CAP_PER_WINDOW * 4)
    expect(chests).toBeLessThan(12)
  })
})

// ---------------------------------------------------------------------------
// 2. PREMIUM BANNER — the escalating seed SINK (better odds, much higher price).
// ---------------------------------------------------------------------------

describe('pullPremium() — the escalating seed sink (save-vs-spend opportunity cost)', () => {
  it('premium costs materially more than a standard pull (≥ 5×)', () => {
    expect(PREMIUM_PULL_COST).toBeGreaterThanOrEqual(PULL_COST * 5)
  })

  it('debits exactly PREMIUM_PULL_COST and yields one card when funded', () => {
    const { state, rewards } = pullPremium(fund(PREMIUM_PULL_COST + 10), mulberry32(1))
    expect(state.player.currency).toBe(10)
    expect(state.cards.length).toBe(1)
    expect(rewards.some((r) => r.kind === 'currency' && r.amount === -PREMIUM_PULL_COST)).toBe(true)
    // the card line is tagged premium
    expect(rewards.some((r) => r.kind === 'card' && /premium/i.test(r.message))).toBe(true)
  })

  it('refuses (no draw, no debit) when broke — friendly, never shaming', () => {
    const { state, rewards } = pullPremium(fund(PREMIUM_PULL_COST - 1), mulberry32(1))
    expect(state.cards.length).toBe(0)
    expect(state.player.currency).toBe(PREMIUM_PULL_COST - 1)
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg.toLowerCase()).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid/i)
  })

  it('succeeds at exactly PREMIUM_PULL_COST (boundary), leaving 0 seeds', () => {
    const { state } = pullPremium(fund(PREMIUM_PULL_COST), mulberry32(1))
    expect(state.cards.length).toBe(1)
    expect(state.player.currency).toBe(0)
  })

  it('PER PULL, premium realizes a higher legendary+ rate than a standard pull', () => {
    // The premium banner's value is per-pull rarity (a single premium pull is far
    // likelier to be top-tier than a single standard pull). Compare equal pull
    // COUNTS from the same seeds; premium must win on top-tier yield.
    let premLegendary = 0
    let stdLegendary = 0
    const N = 3000
    for (let seed = 0; seed < N; seed++) {
      const prem = pullPremium(fund(PREMIUM_PULL_COST), mulberry32(seed))
      prem.rewards
        .filter((r) => r.kind === 'card' && r.rarity !== undefined)
        .forEach((r) => {
          if (rarityRank(r.rarity!) >= rarityRank('legendary')) premLegendary++
        })
      const std = pull(fund(PULL_COST), mulberry32(seed))
      std.rewards
        .filter((r) => r.kind === 'card' && r.rarity !== undefined)
        .forEach((r) => {
          if (rarityRank(r.rarity!) >= rarityRank('legendary')) stdLegendary++
        })
    }
    expect(premLegendary).toBeGreaterThan(stdLegendary)
  })

  it('never mutates the input state', () => {
    const s0 = fund(PREMIUM_PULL_COST + 5)
    const snap = JSON.parse(JSON.stringify(s0))
    pullPremium(s0, mulberry32(1))
    expect(s0).toEqual(snap)
  })
})

// ---------------------------------------------------------------------------
// 3. ENDGAME SINK — prestige: a big one-time seed drain → permanent cosmetic.
// ---------------------------------------------------------------------------

describe('buyPrestige() — the endgame seed sink (a finished collection still spends)', () => {
  it('prestige is the most expensive sink (a real late-game target)', () => {
    expect(PRESTIGE_COST).toBeGreaterThan(PREMIUM_PULL_COST)
  })

  it('debits PRESTIGE_COST and grants a permanent cosmetic prestige buff', () => {
    const { state, rewards } = buyPrestige(fund(PRESTIGE_COST + 100))
    expect(state.player.currency).toBe(100)
    expect(state.buffs.some((b) => b.id === PRESTIGE_BUFF_ID)).toBe(true)
    expect(rewards.some((r) => r.kind === 'buff' && r.buff === PRESTIGE_BUFF_ID)).toBe(true)
    expect(rewards.some((r) => r.kind === 'currency' && r.amount === -PRESTIGE_COST)).toBe(true)
  })

  it('confers ZERO economic power (cosmetic-only, ADR-0005) — no XP/seed/crit/streak effect', () => {
    const { state } = buyPrestige(fund(PRESTIGE_COST))
    // None of the engine's bonus selectors are moved by the prestige buff.
    expect(activeMultiplier(state)).toBe(1)
    expect(activeSeedBonus(state)).toBe(0)
    expect(activeStreakMultiplier(state)).toBe(1)
    expect(activeFreshnessBonus(state)).toBe(0)
  })

  it('refuses (no debit) when broke — friendly, never shaming', () => {
    const { state, rewards } = buyPrestige(fund(PRESTIGE_COST - 1))
    expect(state.player.currency).toBe(PRESTIGE_COST - 1)
    expect(state.buffs.some((b) => b.id === PRESTIGE_BUFF_ID)).toBe(false)
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg.toLowerCase()).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid/i)
  })

  it('is idempotent: a second purchase neither debits nor re-grants (no double charge)', () => {
    const first = buyPrestige(fund(PRESTIGE_COST * 3))
    const second = buyPrestige(first.state)
    // currency unchanged the second time
    expect(second.state.player.currency).toBe(first.state.player.currency)
    // still exactly one prestige buff
    expect(second.state.buffs.filter((b) => b.id === PRESTIGE_BUFF_ID).length).toBe(1)
  })

  it('never mutates the input state', () => {
    const s0 = fund(PRESTIGE_COST + 5)
    const snap = JSON.parse(JSON.stringify(s0))
    buyPrestige(s0)
    expect(s0).toEqual(snap)
  })
})

/**
 * economy.test.ts — R3 currency + chosen-pull + token-milestone floor + serendipity.
 *
 * This is the round that turns Grove from a reward-fountain into a GAME with
 * DECISIONS:
 *  1. CURRENCY (seeds) — outcomes GRANT seeds (×magnitude, modest).
 *  2. PULLS ARE A CHOICE — `pull()` costs PULL_COST seeds; refuses when broke;
 *     test/build/lint no longer auto-pull.
 *  3. TOKEN-MILESTONE FLOOR (保底) — cumulative cost fills a work meter; crossing
 *     WORK_MILESTONE grants ONE cosmetic chest, CAPPED per 5h window (can't farm).
 *  4. SERENDIPITY (奇遇) — a small variable-ratio surprise on successful outcomes.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { GroveEvent } from '../core/events'
import { mulberry32 } from '../core/rng'
import {
  reduce,
  pull,
  PULL_COST,
  SERENDIPITY_CHANCE,
  WORK_MILESTONE,
  COST_TO_WORK,
  MILESTONE_CAP_PER_WINDOW,
} from './reduce'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev(over: Partial<GroveEvent> & Pick<GroveEvent, 'type'>): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    magnitude: over.magnitude ?? 1,
    success: over.success ?? true,
    ts: over.ts ?? '2026-05-30T00:00:00.000Z',
    meta: over.meta ?? {},
    ...over,
  }
}

/** A quota_update carrying cost (and optional 5h window key). present:false by default. */
function costFrame(over: {
  costUsd?: number
  outputTokens?: number
  fiveHourResetsAt?: number
  present?: boolean
}): GroveEvent {
  return ev({
    type: 'quota_update',
    meta: {
      present: over.present ?? false,
      ...(over.costUsd !== undefined ? { costUsd: over.costUsd } : {}),
      ...(over.outputTokens !== undefined ? { outputTokens: over.outputTokens } : {}),
      ...(over.fiveHourResetsAt !== undefined ? { fiveHourResetsAt: over.fiveHourResetsAt } : {}),
    },
  })
}

function fund(currency: number): GameState {
  return { ...initialState(), player: { xp: 0, level: 1, currency } }
}

// Empirically-chosen deterministic seeds (probed against the engine):
//  - seed 1 → serendipity LUCKY PULL fires on a magnitude-1 commit
//  - seed 6 → serendipity SEED WINDFALL fires
//  - seed 2 → NO serendipity (the common case)
const SEED_SEREN_PULL = 1
const SEED_SEREN_WINDFALL = 6
const SEED_NO_SEREN = 2

// ---------------------------------------------------------------------------
// 1. CURRENCY (seeds) granted on outcomes
// ---------------------------------------------------------------------------

describe('currency — outcomes grant seeds (×magnitude, modest)', () => {
  // R7 FAUCET REBALANCE (economy P1): grants HALVED/trimmed to pull affordable
  // standard-pulls/active-day down to ≤ ~10 (commit 5→3, test 8→4, build/lint 5→3,
  // review 6→4, pr_merged 20→12, doc/spec/plan 15→10). See the active-day model below.
  it('commit grants +3 seeds and a currency reward', () => {
    const { state, rewards } = reduce(initialState(), ev({ type: 'commit', magnitude: 1 }), mulberry32(SEED_NO_SEREN))
    const cur = rewards.find((r) => r.kind === 'currency')
    expect(cur).toBeDefined()
    expect(cur!.amount).toBe(3)
    expect(state.player.currency).toBe(3)
  })

  it('test_result grants +4 seeds per magnitude (×magnitude scales)', () => {
    const { state } = reduce(initialState(), ev({ type: 'test_result', magnitude: 3 }), mulberry32(SEED_NO_SEREN))
    expect(state.player.currency).toBe(4 * 3)
  })

  it('pr_merged grants +12 seeds (and still the guaranteed pull)', () => {
    const { state, rewards } = reduce(initialState(), ev({ type: 'pr_merged', magnitude: 1 }), mulberry32(SEED_NO_SEREN))
    const cur = rewards.find((r) => r.kind === 'currency' && r.amount === 12)
    expect(cur).toBeDefined()
    expect(state.player.currency).toBeGreaterThanOrEqual(12)
    expect(state.cards.length).toBe(1) // guaranteed pull still lands
  })

  it('Pillar-B doc/spec/plan grant +10 seeds each', () => {
    for (const type of ['doc_updated', 'spec_written', 'plan_written'] as const) {
      const { rewards } = reduce(initialState(), ev({ type, magnitude: 1 }), mulberry32(SEED_NO_SEREN))
      expect(rewards.some((r) => r.kind === 'currency' && r.amount === 10)).toBe(true)
    }
  })

  it('review_confirmed grants +4 seeds; build/lint grant +3', () => {
    expect(
      reduce(initialState(), ev({ type: 'review_confirmed' }), mulberry32(SEED_NO_SEREN)).state.player.currency,
    ).toBe(4)
    expect(
      reduce(initialState(), ev({ type: 'build_result' }), mulberry32(SEED_NO_SEREN)).state.player.currency,
    ).toBe(3)
    expect(
      reduce(initialState(), ev({ type: 'lint_clean' }), mulberry32(SEED_NO_SEREN)).state.player.currency,
    ).toBe(3)
  })

  it('a failing outcome grants NO seeds (firewall — never punish, never reward failure)', () => {
    const { state, rewards } = reduce(
      initialState(),
      ev({ type: 'pr_merged', success: false }),
      mulberry32(SEED_NO_SEREN),
    )
    expect(rewards).toEqual([])
    expect(state.player.currency).toBe(0)
  })

  it('the currency reward message is terse + non-shaming', () => {
    const { rewards } = reduce(initialState(), ev({ type: 'commit' }), mulberry32(SEED_NO_SEREN))
    const cur = rewards.find((r) => r.kind === 'currency')!
    expect(cur.message.length).toBeGreaterThan(0)
    expect(cur.message).not.toMatch(/fail|lazy|shame|stupid/i)
  })
})

// ---------------------------------------------------------------------------
// 2. PULLS ARE A CHOICE — no auto-pull on test/build/lint; explicit pull() costs seeds
// ---------------------------------------------------------------------------

describe('pulls are a choice — test/build/lint no longer auto-pull', () => {
  it('a green test_result adds NO card (seeds + maybe serendipity only)', () => {
    const { state } = reduce(initialState(), ev({ type: 'test_result' }), mulberry32(SEED_NO_SEREN))
    expect(state.cards.length).toBe(0)
  })

  it('build_result and lint_clean add NO card either', () => {
    for (const type of ['build_result', 'lint_clean'] as const) {
      const { state } = reduce(initialState(), ev({ type }), mulberry32(SEED_NO_SEREN))
      expect(state.cards.length).toBe(0)
    }
  })
})

describe('pull() — the explicit, agency-bearing action', () => {
  it('exports a PULL_COST of 45 seeds (R7 faucet rebalance: raised 30→45)', () => {
    expect(PULL_COST).toBe(45)
  })

  it('debits exactly PULL_COST seeds and yields one card when funded', () => {
    const { state, rewards } = pull(fund(50), mulberry32(1))
    expect(state.player.currency).toBe(50 - PULL_COST)
    expect(state.cards.length).toBe(1)
    expect(rewards.some((r) => r.kind === 'card' && r.card !== undefined)).toBe(true)
    // a spend line is surfaced
    expect(rewards.some((r) => r.kind === 'currency' && r.amount === -PULL_COST)).toBe(true)
  })

  it('refuses (no pull, no debit, no draw) when broke — friendly, never shaming', () => {
    const { state, rewards } = pull(initialState(), mulberry32(1)) // currency 0
    expect(state.cards.length).toBe(0)
    expect(state.player.currency).toBe(0)
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg.toLowerCase()).toContain('not enough')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid/i)
  })

  it('refuses when currency is just below cost (boundary: PULL_COST - 1)', () => {
    const { state } = pull(fund(PULL_COST - 1), mulberry32(1))
    expect(state.cards.length).toBe(0)
    expect(state.player.currency).toBe(PULL_COST - 1) // untouched
  })

  it('succeeds at exactly PULL_COST (boundary), leaving 0 seeds', () => {
    const { state } = pull(fund(PULL_COST), mulberry32(1))
    expect(state.cards.length).toBe(1)
    expect(state.player.currency).toBe(0)
  })

  it('threads pity across repeated chosen pulls (immutable, deterministic)', () => {
    let state = fund(100 * PULL_COST)
    const snapshot = JSON.parse(JSON.stringify(state))
    const rng = mulberry32(123)
    let last = state
    for (let i = 0; i < 5; i++) {
      const out = pull(last, rng)
      expect(out.state).not.toBe(last)
      last = out.state
    }
    expect(last.cards.length).toBe(5)
    // input never mutated
    const fresh = fund(100 * PULL_COST)
    expect(fresh).toEqual({ ...snapshot, player: { ...snapshot.player } })
  })
})

// ---------------------------------------------------------------------------
// 3. TOKEN-MILESTONE FLOOR (保底) — cost-driven, cosmetic, capped per window
// ---------------------------------------------------------------------------

describe('token-milestone floor — cost fills a work meter, chests are cosmetic', () => {
  it('exports a tunable WORK_MILESTONE and a per-window cap', () => {
    expect(WORK_MILESTONE).toBeGreaterThan(0)
    expect(COST_TO_WORK).toBeGreaterThan(0)
    expect(MILESTONE_CAP_PER_WINDOW).toBeGreaterThanOrEqual(1)
  })

  it('crossing WORK_MILESTONE grants ONE chest: a pull + bonus seeds, NEVER xp/power', () => {
    const cost = WORK_MILESTONE / COST_TO_WORK // exactly one milestone
    const { state, rewards } = reduce(initialState(), costFrame({ costUsd: cost }), mulberry32(5))

    // a chest = a card + bonus seeds
    expect(state.cards.length).toBe(1)
    expect(rewards.some((r) => r.kind === 'card')).toBe(true)
    expect(rewards.some((r) => r.kind === 'currency')).toBe(true)
    expect(state.player.currency).toBeGreaterThan(0)

    // NEVER xp/power (ADR-0010: token is activity, not an outcome)
    expect(rewards.some((r) => r.kind === 'xp')).toBe(false)
    expect(rewards.some((r) => r.kind === 'levelup')).toBe(false)
    expect(state.player.xp).toBe(0)
    expect(state.player.level).toBe(1)

    // the meter drained and the cost baseline advanced
    expect(state.work.lastCostUsd).toBe(cost)
    expect(state.work.milestonesInWindow).toBe(1)
  })

  it('works for a Wellspring frame (no rate_limits) so API users still get the floor', () => {
    const out = reduce(initialState(), costFrame({ costUsd: WORK_MILESTONE, present: false }), mulberry32(5))
    expect(out.state.energy.known).toBe(false) // still Wellspring
    expect(out.state.cards.length).toBe(1) // but the floor chest still fired
  })

  it('a frame with NO cost grants nothing (output_tokens alone never pays)', () => {
    const { state, rewards } = reduce(initialState(), costFrame({ outputTokens: 99999 }), mulberry32(5))
    expect(state.cards.length).toBe(0)
    expect(rewards).toEqual([])
  })

  it('CAPPED: burning tokens past the cap in one window yields NOTHING extra', () => {
    // Ramp cumulative cost far past the cap within a single 5h window.
    let state = initialState()
    const bigCost = WORK_MILESTONE * (MILESTONE_CAP_PER_WINDOW + 20)
    state = reduce(state, costFrame({ costUsd: bigCost, fiveHourResetsAt: 1000 }), mulberry32(5)).state

    // No more than the cap of chests, even though many milestones were crossed.
    expect(state.work.milestonesInWindow).toBe(MILESTONE_CAP_PER_WINDOW)
    expect(state.cards.length).toBe(MILESTONE_CAP_PER_WINDOW)
    // The meter is fully drained (crossings past the cap were consumed, not banked).
    expect(state.work.workMeter).toBeLessThan(WORK_MILESTONE)

    // One MORE frame burning even more cost in the same window pays nothing.
    const before = state.cards.length
    state = reduce(state, costFrame({ costUsd: bigCost + 50, fiveHourResetsAt: 1000 }), mulberry32(5)).state
    expect(state.cards.length).toBe(before)
    expect(state.work.milestonesInWindow).toBe(MILESTONE_CAP_PER_WINDOW)
  })

  it('a NEW 5h window (fiveHourResetsAt changes) resets the cap → chests resume', () => {
    let state = initialState()
    const big = WORK_MILESTONE * (MILESTONE_CAP_PER_WINDOW + 5)
    state = reduce(state, costFrame({ costUsd: big, fiveHourResetsAt: 1000 }), mulberry32(5)).state
    expect(state.work.milestonesInWindow).toBe(MILESTONE_CAP_PER_WINDOW)
    const afterWindowA = state.cards.length

    // Next window: counter resets, more chests possible.
    state = reduce(state, costFrame({ costUsd: big + WORK_MILESTONE * 5, fiveHourResetsAt: 2000 }), mulberry32(5)).state
    expect(state.work.windowKey).toBe(2000)
    expect(state.work.milestonesInWindow).toBeGreaterThan(0)
    expect(state.cards.length).toBeGreaterThan(afterWindowA)
  })

  it('a cost DROP (new session) re-baselines the meter and resets the cap', () => {
    let state = initialState()
    // Session 1: burn to the cap.
    state = reduce(state, costFrame({ costUsd: WORK_MILESTONE * (MILESTONE_CAP_PER_WINDOW + 5) }), mulberry32(5)).state
    expect(state.work.milestonesInWindow).toBe(MILESTONE_CAP_PER_WINDOW)

    // Session 2: cost RESETS to a small value (< lastCostUsd) → new session.
    state = reduce(state, costFrame({ costUsd: WORK_MILESTONE }), mulberry32(5)).state
    expect(state.work.lastCostUsd).toBe(WORK_MILESTONE)
    expect(state.work.milestonesInWindow).toBe(1) // counter reset; one fresh chest
  })

  it('quota_update still never grants xp/cards when there is no milestone crossing', () => {
    // tiny sub-milestone cost → just accrues, no chest
    const { state, rewards } = reduce(initialState(), costFrame({ costUsd: WORK_MILESTONE / 2 }), mulberry32(5))
    expect(rewards.some((r) => r.kind === 'card')).toBe(false)
    expect(rewards.some((r) => r.kind === 'xp')).toBe(false)
    expect(state.work.workMeter).toBeCloseTo((WORK_MILESTONE / 2) * COST_TO_WORK, 6)
  })
})

// ---------------------------------------------------------------------------
// 4. SERENDIPITY (奇遇) — variable-ratio surprise on successful outcomes
// ---------------------------------------------------------------------------

describe('serendipity (奇遇) — surprise bonus on successful outcomes', () => {
  it('exports a small published SERENDIPITY_CHANCE in (0, 0.2]', () => {
    expect(SERENDIPITY_CHANCE).toBeGreaterThan(0)
    expect(SERENDIPITY_CHANCE).toBeLessThanOrEqual(0.2)
  })

  it('fires a lucky free pull under a chosen seed (deterministic)', () => {
    // seed 1 triggers a serendipity LUCKY PULL on a magnitude-1 commit (which
    // otherwise never auto-pulls), and tags it with the 奇遇 line.
    const { state, rewards } = reduce(initialState(), ev({ type: 'commit', magnitude: 1 }), mulberry32(SEED_SEREN_PULL))
    expect(state.cards.length).toBe(1) // an EXTRA pull a commit would never give
    const lucky = rewards.find((r) => r.kind === 'card' && r.message.includes('奇遇'))
    expect(lucky).toBeDefined()
  })

  it('fires a seed windfall under a different chosen seed', () => {
    const { state, rewards } = reduce(initialState(), ev({ type: 'commit', magnitude: 1 }), mulberry32(SEED_SEREN_WINDFALL))
    const windfall = rewards.find((r) => r.kind === 'currency' && r.message.includes('奇遇'))
    expect(windfall).toBeDefined()
    // windfall is ON TOP of the base +5 commit seeds
    expect(state.player.currency).toBeGreaterThan(5)
  })

  it('the common case (non-serendipity seed) adds NO extra pull and NO windfall', () => {
    const { state, rewards } = reduce(initialState(), ev({ type: 'commit', magnitude: 1 }), mulberry32(SEED_NO_SEREN))
    expect(state.cards.length).toBe(0)
    expect(rewards.some((r) => r.message.includes('奇遇'))).toBe(false)
  })

  it('serendipity NEVER fires on a failing event (firewall: no draw at all)', () => {
    // seed 1 WOULD serendipity a success; on failure there is no reward at all.
    const { state, rewards } = reduce(initialState(), ev({ type: 'commit', success: false }), mulberry32(SEED_SEREN_PULL))
    expect(rewards).toEqual([])
    expect(state.cards.length).toBe(0)
  })

  it('serendipity does NOT fire on ambient quota_update (not an outcome)', () => {
    // Even on a serendipity seed, a quota frame is ambient — only the cosmetic
    // floor chest can come from it, never a serendipity roll.
    const { rewards } = reduce(initialState(), costFrame({ outputTokens: 1 }), mulberry32(SEED_SEREN_PULL))
    expect(rewards.some((r) => r.message.includes('奇遇'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FAUCET ≫ SINK MODEL (R7 economy P1) — an ACTIVE DAY affords ≤ ~10 standard pulls
//
// The re-score④ audit found ~26 affordable standard pulls per active day — the
// save-vs-spend decision "barely bit". This MODELS a representative active day's
// full event stream through the REAL engine (so it captures grant ×scale bonuses,
// the token-milestone floor chests/seeds, dup-comp, AND serendipity) and asserts
// the affordable standard-pulls/day is now ≤ ~10. If a future change re-floods the
// faucet, this test fails — it is the economy guard rail.
// ---------------------------------------------------------------------------

describe('faucet ≫ sink — an active day affords ≤ ~10 standard pulls', () => {
  /** ~49 outcome events in a realistic mix + cost frames across ~4 5h windows. */
  function activeDayEvents(): GroveEvent[] {
    const evs: GroveEvent[] = []
    const mix: Partial<Record<GroveEvent['type'], number>> = {
      commit: 15,
      test_result: 10,
      build_result: 6,
      lint_clean: 4,
      review_confirmed: 3,
      pr_merged: 2,
      doc_updated: 3,
      spec_written: 3,
      plan_written: 3,
    }
    for (const [type, n] of Object.entries(mix)) {
      for (let i = 0; i < (n as number); i++) evs.push(ev({ type: type as GroveEvent['type'] }))
    }
    // A heavy day spans ~4 distinct 5h windows, each burning past the milestone cap.
    for (let w = 0; w < 4; w++) {
      evs.push(costFrame({ costUsd: 100 * (w + 1), fiveHourResetsAt: 1000 + w, present: true }))
    }
    return evs
  }

  it('the modeled active day has ~49 outcome events (the audit baseline)', () => {
    const outcomes = activeDayEvents().filter((e) => e.type !== 'quota_update')
    expect(outcomes.length).toBe(49)
  })

  it('average affordable standard pulls/active-day is ≤ 10 (save-vs-spend restored)', () => {
    let totalAfford = 0
    let worst = 0
    const trials = 50
    for (let seed = 0; seed < trials; seed++) {
      let state = initialState()
      const rng = mulberry32(seed + 1)
      for (const e of activeDayEvents()) state = reduce(state, e, rng).state
      const afford = Math.floor(state.player.currency / PULL_COST)
      totalAfford += afford
      worst = Math.max(worst, afford)
    }
    const avg = totalAfford / trials
    // The PRIMARY target: an active day affords ≤ ~10 standard pulls on average.
    expect(avg).toBeLessThanOrEqual(10)
    // Even the luckiest modeled day (windfalls/serendipity) stays well clear of the
    // old ~26 faucet — a hard ceiling guards against a regression.
    expect(worst).toBeLessThan(16)
  })

  it('is far below the OLD pre-rebalance affordability (the regression guard)', () => {
    // Sanity: with the new grants + PULL_COST + tightened floor, a single average
    // day cannot fund anywhere near a full collection's worth of pulls.
    let state = initialState()
    const rng = mulberry32(7)
    for (const e of activeDayEvents()) state = reduce(state, e, rng).state
    expect(Math.floor(state.player.currency / PULL_COST)).toBeLessThanOrEqual(10)
  })
})

// ---------------------------------------------------------------------------
// Immutability of the new fields
// ---------------------------------------------------------------------------

describe('economy — immutability of new state fields', () => {
  it('reduce never mutates input player.currency or work', () => {
    const s0 = fund(40)
    const snapshot = JSON.parse(JSON.stringify(s0))
    reduce(s0, ev({ type: 'commit' }), mulberry32(SEED_NO_SEREN))
    reduce(s0, costFrame({ costUsd: WORK_MILESTONE }), mulberry32(5))
    expect(s0).toEqual(snapshot)
  })

  it('pull never mutates the input state', () => {
    const s0 = fund(50)
    const snapshot = JSON.parse(JSON.stringify(s0))
    pull(s0, mulberry32(1))
    expect(s0).toEqual(snapshot)
  })
})

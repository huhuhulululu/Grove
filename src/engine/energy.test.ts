/**
 * energy.test.ts — the Vigor/Sap "energy" system driven by `quota_update`.
 *
 * Asserts the 4 anti-burnout fixes explicitly (see the feature spec / ADR-0005):
 *   1. quota_update is AMBIENT info — it NEVER grants xp or cards in any case.
 *   2. A reset (Second Wind) is detected ONLY from fresh data (a big upward
 *      jump in vigor), grants a 'rest'-kind buff ONLY — no card, no xp.
 *   3. The rest buff fires regardless of the FINAL vigor level (never gated on
 *      low energy — rest is celebrated, not shamed).
 *   4. present:false → Wellspring (known:false); we NEVER fabricate vigor=100.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { GroveEvent } from '../core/events'
import { mulberry32 } from '../core/rng'
import { reduce } from './reduce'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid GroveEvent with sensible defaults; override per-test. */
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

/** A present quota frame. fiveHourPct/sevenDayPct are USED percentages (0-100). */
function quota(over: {
  fiveHourPct?: number
  fiveHourResetsAt?: number
  sevenDayPct?: number
  sevenDayResetsAt?: number
}): GroveEvent {
  return ev({
    type: 'quota_update',
    meta: {
      present: true,
      fiveHourPct: over.fiveHourPct,
      fiveHourResetsAt: over.fiveHourResetsAt,
      sevenDayPct: over.sevenDayPct,
      sevenDayResetsAt: over.sevenDayResetsAt,
    },
  })
}

function totalXp(state: GameState): number {
  return state.player.level * 1_000_000 + state.player.xp
}

// ---------------------------------------------------------------------------
// FIX 1 — a present:true first frame sets energy.known and grants NOTHING
// ---------------------------------------------------------------------------

describe('energy — first present frame (FIX: ambient, grants nothing)', () => {
  it('present:true sets energy.known=true with correct vigor/sap and grants NOTHING', () => {
    const s0 = initialState()
    expect(s0.energy.known).toBe(false) // Wellspring by default

    const { state, rewards } = reduce(
      s0,
      quota({
        fiveHourPct: 30, // 30% used → 70 vigor remaining
        sevenDayPct: 10, // 10% used → 90 sap remaining
        fiveHourResetsAt: 1717,
        sevenDayResetsAt: 9999,
      }),
      mulberry32(1),
    )

    expect(state.energy.known).toBe(true)
    expect(state.energy.vigor).toBe(70)
    expect(state.energy.sap).toBe(90)
    expect(state.energy.vigorResetsAt).toBe(1717)
    expect(state.energy.sapResetsAt).toBe(9999)

    // Ambient info → no outcome of any kind.
    expect(rewards).toEqual([])
    expect(state.cards).toEqual(s0.cards)
    expect(totalXp(state)).toBe(totalXp(s0))
  })

  it('clamps vigor/sap into [0,100] (over/under percentages never escape)', () => {
    const s0 = initialState()
    const { state } = reduce(
      s0,
      quota({ fiveHourPct: 150, sevenDayPct: -20 }),
      mulberry32(1),
    )
    expect(state.energy.vigor).toBe(0)
    expect(state.energy.sap).toBe(100)
  })

  it('quota_update NEVER grants xp or cards, even on a fresh first frame at 0% used', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, quota({ fiveHourPct: 0, sevenDayPct: 0 }), mulberry32(1))
    expect(rewards.some((r) => r.kind === 'xp')).toBe(false)
    expect(rewards.some((r) => r.kind === 'card')).toBe(false)
    expect(state.cards).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// FIX 2 — a fresh frame with vigor jumping up grants a 'rest' buff ONLY
// ---------------------------------------------------------------------------

describe('energy — Second Wind on reset (FIX: rest buff only, no card, no xp)', () => {
  it('a later fresh frame jumping 60→100 grants a "rest" buff and ZERO cards and ZERO xp', () => {
    let state = initialState()

    // Establish a known baseline at vigor 60 (40% used).
    state = reduce(state, quota({ fiveHourPct: 40, sevenDayPct: 20 }), mulberry32(1)).state
    expect(state.energy.vigor).toBe(60)

    // 5h window reset arrives: 0% used → 100 vigor (jump of 40).
    const out = reduce(state, quota({ fiveHourPct: 0, sevenDayPct: 20 }), mulberry32(1))

    const rest = out.rewards.find((r) => r.kind === 'buff')
    expect(rest).toBeDefined()
    expect(out.state.buffs.some((b) => b.id === 'rest:second-wind' && b.kind === 'rest')).toBe(true)
    expect(out.state.buffs.find((b) => b.id === 'rest:second-wind')?.label).toBe('Second Wind')

    // MUST NOT grant any card/pull and MUST NOT grant xp.
    expect(out.rewards.some((r) => r.kind === 'card')).toBe(false)
    expect(out.rewards.some((r) => r.kind === 'xp')).toBe(false)
    expect(out.rewards.some((r) => r.kind === 'levelup')).toBe(false)
    expect(out.state.cards).toHaveLength(0)
    expect(totalXp(out.state)).toBe(totalXp(state))
  })

  it('the rest buff fires even though vigor ended HIGH (FIX: not gated on low energy)', () => {
    let state = initialState()
    state = reduce(state, quota({ fiveHourPct: 50 }), mulberry32(1)).state // vigor 50
    const out = reduce(state, quota({ fiveHourPct: 0 }), mulberry32(1)) // vigor 100 (high!)

    expect(out.state.energy.vigor).toBe(100) // ended HIGH
    expect(out.state.buffs.some((b) => b.id === 'rest:second-wind')).toBe(true)
  })

  it('the rest buff has kind:"rest" exactly (consumable by a rest-aware renderer)', () => {
    let state = initialState()
    state = reduce(state, quota({ fiveHourPct: 45 }), mulberry32(1)).state
    const out = reduce(state, quota({ fiveHourPct: 0 }), mulberry32(1))
    const buff = out.state.buffs.find((b) => b.id === 'rest:second-wind')
    expect(buff?.kind).toBe('rest')
  })
})

// ---------------------------------------------------------------------------
// FIX 4 — present:false is Wellspring; NEVER fabricate vigor=100
// ---------------------------------------------------------------------------

describe('energy — Wellspring (FIX: present:false hides bar, no fabrication)', () => {
  it('a present:false frame sets known=false, grants nothing, and never sets vigor to 100', () => {
    // Start from a KNOWN low state so we can prove vigor is NOT bumped to 100.
    let state = initialState()
    state = reduce(state, quota({ fiveHourPct: 90 }), mulberry32(1)).state // vigor 10, known
    expect(state.energy.known).toBe(true)
    expect(state.energy.vigor).toBe(10)

    const out = reduce(state, ev({ type: 'quota_update', meta: { present: false } }), mulberry32(1))

    expect(out.state.energy.known).toBe(false) // Wellspring → UI hides the bar
    expect(out.state.energy.vigor).not.toBe(100) // NEVER fabricate full energy
    expect(out.rewards).toEqual([]) // grant NOTHING
  })

  it('present:false from the very start stays Wellspring and grants nothing', () => {
    const s0 = initialState()
    const out = reduce(s0, ev({ type: 'quota_update', meta: { present: false } }), mulberry32(1))
    expect(out.state.energy.known).toBe(false)
    expect(out.rewards).toEqual([])
    expect(out.state.cards).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// FIX 3 (no fabrication) — no spurious reset from stale/identical/small data
// ---------------------------------------------------------------------------

describe('energy — reset detection only from real fresh jumps', () => {
  it('two identical consecutive frames do NOT grant a second rest buff', () => {
    let state = initialState()
    const frame = quota({ fiveHourPct: 30, sevenDayPct: 10 })

    const out1 = reduce(state, frame, mulberry32(1))
    state = out1.state
    // First frame is the baseline: known flips false→true, so NO reset detected.
    expect(out1.state.buffs.some((b) => b.id === 'rest:second-wind')).toBe(false)

    const out2 = reduce(state, frame, mulberry32(1)) // identical → no jump
    expect(out2.rewards.some((r) => r.kind === 'buff')).toBe(false)
    expect(out2.state.buffs.some((b) => b.id === 'rest:second-wind')).toBe(false)
  })

  it('a small vigor change (70→75) is NOT a reset (no rest buff)', () => {
    let state = initialState()
    state = reduce(state, quota({ fiveHourPct: 30 }), mulberry32(1)).state // vigor 70
    const out = reduce(state, quota({ fiveHourPct: 25 }), mulberry32(1)) // vigor 75 (+5)

    expect(out.state.energy.vigor).toBe(75)
    expect(out.rewards.some((r) => r.kind === 'buff')).toBe(false)
    expect(out.state.buffs.some((b) => b.id === 'rest:second-wind')).toBe(false)
  })

  it('the very first known frame never triggers a reset (no prior known data)', () => {
    // Even a "high" first frame (vigor 100) must not synthesize Second Wind:
    // there is no prior known baseline to jump FROM.
    const s0 = initialState()
    const out = reduce(s0, quota({ fiveHourPct: 0 }), mulberry32(1))
    expect(out.state.energy.vigor).toBe(100)
    expect(out.state.buffs.some((b) => b.id === 'rest:second-wind')).toBe(false)
    expect(out.rewards).toEqual([])
  })

  it('a known→present:false→present frame does NOT count the re-appearance as a reset', () => {
    let state = initialState()
    state = reduce(state, quota({ fiveHourPct: 50 }), mulberry32(1)).state // known, vigor 50
    state = reduce(state, ev({ type: 'quota_update', meta: { present: false } }), mulberry32(1)).state // Wellspring
    expect(state.energy.known).toBe(false)

    // Re-appears at high vigor. Since prior known === false, this is a fresh
    // baseline, NOT a reset — no Second Wind fabricated from a gap.
    const out = reduce(state, quota({ fiveHourPct: 0 }), mulberry32(1))
    expect(out.state.energy.known).toBe(true)
    expect(out.state.buffs.some((b) => b.id === 'rest:second-wind')).toBe(false)
    expect(out.rewards).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// quota_update still advances the clock + expires buffs like every event
// ---------------------------------------------------------------------------

describe('energy — quota_update is a normal clock tick', () => {
  it('advances eventCount like any event', () => {
    const s0 = initialState()
    const out = reduce(s0, quota({ fiveHourPct: 10 }), mulberry32(1))
    expect(out.state.eventCount).toBe(s0.eventCount + 1)
  })

  it('expires lapsed buffs on a quota_update tick (silently)', () => {
    let state = initialState()
    // Arm a short multiplier via spec_written (expires at eventCount+6).
    state = reduce(state, ev({ type: 'spec_written' }), mulberry32(1)).state
    expect(state.buffs.some((b) => b.id === 'mult:precast')).toBe(true)

    // Tick the clock past the window with quota_update frames (ambient, no reward churn).
    for (let i = 0; i < 8; i++) {
      state = reduce(state, ev({ type: 'quota_update', meta: { present: false } }), mulberry32(1)).state
    }
    expect(state.buffs.some((b) => b.id === 'mult:precast')).toBe(false)
  })
})

/**
 * statusline.test.ts — TDD tests for parseStatuslinePayload.
 *
 * Run: npx vitest run src/adapters/statusline.test.ts
 *
 * Covers:
 *  1. Full subscription payload (rate_limits with both windows, epoch resets_at)
 *     → present:true with correct pcts + epoch resets_at in MILLISECONDS.
 *  2. ISO-8601 resets_at is converted to epoch MILLISECONDS (Date.parse value).
 *  3. Payload with NO rate_limits → present:false (Wellspring).
 *  4. Payload with only five_hour → present:true, sevenDay fields absent/undefined.
 *  5. Edge: rate_limits present but both windows missing → present:false.
 *  6. sessionId precedence: payload.session_id > opts.sessionId > 'statusline'.
 *  7. The emitted event is a valid GroveEvent (parseable by zod schema).
 *  8. Exactly one event is emitted per call.
 *  9. notes array is always returned (may be empty).
 * 10. Non-numeric / non-string resets_at is tolerated (undefined result).
 * 11. normaliseResetsAt: numeric Unix-SECONDS input is scaled to milliseconds.
 * 12. normaliseResetsAt: numeric value already > 1e12 (ms) is passed through as-is.
 * 13. ISO-8601 string resets_at yields Date.parse() value directly (ms).
 */

import { describe, it, expect } from 'vitest'
import { parseStatuslinePayload } from './statusline'
import { GroveEvent } from '../core/events'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a well-formed rate_limits window. */
function window_(used_percentage: number, resets_at: number | string | null | object) {
  return { used_percentage, resets_at }
}

// Arbitrary Unix seconds timestamps (as Claude Code emits)
const EPOCH_5H_SEC = 1717000000   // arbitrary Unix seconds
const EPOCH_7D_SEC = 1717604800   // arbitrary Unix seconds

// Expected millisecond values (what normaliseResetsAt must now return)
const EPOCH_5H_MS = EPOCH_5H_SEC * 1000
const EPOCH_7D_MS = EPOCH_7D_SEC * 1000

// ISO-8601 strings representing the same instants
const ISO_5H = new Date(EPOCH_5H_MS).toISOString()
const ISO_7D = new Date(EPOCH_7D_MS).toISOString()

/** Convenience: parse and return the single emitted event (asserted non-null). */
function firstEvent(payload: unknown, opts?: { sessionId?: string }) {
  const { events } = parseStatuslinePayload(payload, opts)
  if (events.length !== 1) throw new Error(`Expected 1 event, got ${events.length}`)
  return events[0] as GroveEvent
}

// ---------------------------------------------------------------------------
// 1. Full subscription payload — both windows, epoch resets_at → present:true
//    resets_at is Unix-SECONDS (as Claude Code emits) → must be in MS in meta
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — full subscription payload', () => {
  const payload = {
    rate_limits: {
      five_hour: window_(40, EPOCH_5H_SEC),
      seven_day: window_(25, EPOCH_7D_SEC),
    },
    session_id: 'sess-abc',
    model: 'claude-sonnet-4-6',
  }

  it('emits exactly one event', () => {
    const { events } = parseStatuslinePayload(payload)
    expect(events).toHaveLength(1)
  })

  it('event type is quota_update', () => {
    expect(firstEvent(payload).type).toBe('quota_update')
  })

  it('meta.present is true', () => {
    expect(firstEvent(payload).meta.present).toBe(true)
  })

  it('meta.fiveHourPct equals used_percentage', () => {
    expect(firstEvent(payload).meta.fiveHourPct).toBe(40)
  })

  it('meta.sevenDayPct equals used_percentage', () => {
    expect(firstEvent(payload).meta.sevenDayPct).toBe(25)
  })

  it('meta.fiveHourResetsAt is in MILLISECONDS (Unix-sec input × 1000)', () => {
    expect(firstEvent(payload).meta.fiveHourResetsAt).toBe(EPOCH_5H_MS)
  })

  it('meta.sevenDayResetsAt is in MILLISECONDS (Unix-sec input × 1000)', () => {
    expect(firstEvent(payload).meta.sevenDayResetsAt).toBe(EPOCH_7D_MS)
  })

  it('event sessionId comes from payload.session_id', () => {
    expect(firstEvent(payload).sessionId).toBe('sess-abc')
  })

  it('event source is "statusline"', () => {
    expect(firstEvent(payload).source).toBe('statusline')
  })

  it('event success is true', () => {
    expect(firstEvent(payload).success).toBe(true)
  })

  it('event magnitude is 1', () => {
    expect(firstEvent(payload).magnitude).toBe(1)
  })

  it('emitted event passes the GroveEvent zod schema', () => {
    expect(() => GroveEvent.parse(firstEvent(payload))).not.toThrow()
  })

  it('returns a notes array', () => {
    const { notes } = parseStatuslinePayload(payload)
    expect(Array.isArray(notes)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. ISO-8601 resets_at is converted to epoch MILLISECONDS (Date.parse value)
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — ISO-8601 resets_at normalization', () => {
  const payload = {
    rate_limits: {
      five_hour: window_(40, ISO_5H),
      seven_day: window_(25, ISO_7D),
    },
  }

  it('fiveHourResetsAt equals Date.parse() of the ISO string (milliseconds)', () => {
    expect(firstEvent(payload).meta.fiveHourResetsAt).toBe(Date.parse('2025-05-30T18:00:00Z') !== 0
      ? EPOCH_5H_MS
      : EPOCH_5H_MS)
    // Simpler: just confirm it equals the ms value, not the seconds value
    expect(firstEvent(payload).meta.fiveHourResetsAt).toBe(EPOCH_5H_MS)
    expect(firstEvent(payload).meta.fiveHourResetsAt).not.toBe(EPOCH_5H_SEC)
  })

  it('sevenDayResetsAt equals Date.parse() of the ISO string (milliseconds)', () => {
    expect(firstEvent(payload).meta.sevenDayResetsAt).toBe(EPOCH_7D_MS)
    expect(firstEvent(payload).meta.sevenDayResetsAt).not.toBe(EPOCH_7D_SEC)
  })

  it('meta.present is still true', () => {
    expect(firstEvent(payload).meta.present).toBe(true)
  })

  it('ISO string yields the canonical Date.parse value directly', () => {
    const isoStr = '2025-05-30T18:00:00Z'
    const p = {
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: isoStr },
      },
    }
    expect(firstEvent(p).meta.fiveHourResetsAt).toBe(Date.parse(isoStr))
  })
})

// ---------------------------------------------------------------------------
// 3. No rate_limits → Wellspring (present:false)
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — no rate_limits (Wellspring)', () => {
  it('payload without rate_limits emits present:false', () => {
    const ev = firstEvent({ session_id: 'sess-free', cost: 0.02 })
    expect(ev.meta.present).toBe(false)
  })

  it('empty object emits present:false', () => {
    expect(firstEvent({}).meta.present).toBe(false)
  })

  it('null payload emits present:false without throwing', () => {
    expect(firstEvent(null).meta.present).toBe(false)
  })

  it('non-object payload emits present:false without throwing', () => {
    expect(firstEvent('not-an-object').meta.present).toBe(false)
  })

  it('sessionId falls back to opts.sessionId when no payload.session_id', () => {
    expect(firstEvent({}, { sessionId: 'fallback-id' }).sessionId).toBe('fallback-id')
  })

  it('sessionId falls back to "statusline" when no opts.sessionId either', () => {
    expect(firstEvent({}).sessionId).toBe('statusline')
  })

  it('event passes the GroveEvent zod schema', () => {
    expect(() => GroveEvent.parse(firstEvent({}))).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 4. Only five_hour present → present:true, sevenDay fields absent/undefined
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — only five_hour window', () => {
  const payload = {
    rate_limits: {
      five_hour: window_(60, EPOCH_5H_SEC),
    },
  }

  it('meta.present is true', () => {
    expect(firstEvent(payload).meta.present).toBe(true)
  })

  it('meta.fiveHourPct is set', () => {
    expect(firstEvent(payload).meta.fiveHourPct).toBe(60)
  })

  it('meta.sevenDayPct is undefined (absent)', () => {
    expect(firstEvent(payload).meta.sevenDayPct).toBeUndefined()
  })

  it('meta.sevenDayResetsAt is undefined (absent)', () => {
    expect(firstEvent(payload).meta.sevenDayResetsAt).toBeUndefined()
  })

  it('meta.fiveHourResetsAt is set to epoch MILLISECONDS', () => {
    expect(firstEvent(payload).meta.fiveHourResetsAt).toBe(EPOCH_5H_MS)
  })

  it('event passes zod schema', () => {
    expect(() => GroveEvent.parse(firstEvent(payload))).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 5. rate_limits present but BOTH windows missing → present:false (Wellspring)
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — rate_limits object but both windows absent', () => {
  it('emits present:false when rate_limits is an empty object', () => {
    expect(firstEvent({ rate_limits: {} }).meta.present).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. sessionId precedence: payload > opts > default
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — sessionId precedence', () => {
  it('payload.session_id wins over opts.sessionId', () => {
    expect(
      firstEvent({ session_id: 'from-payload' }, { sessionId: 'from-opts' }).sessionId,
    ).toBe('from-payload')
  })

  it('opts.sessionId is used when payload has no session_id', () => {
    expect(firstEvent({}, { sessionId: 'from-opts' }).sessionId).toBe('from-opts')
  })

  it('default "statusline" used when neither provides a sessionId', () => {
    expect(firstEvent({}).sessionId).toBe('statusline')
  })
})

// ---------------------------------------------------------------------------
// 7. resets_at edge: non-numeric / garbage value → undefined (no crash)
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — resets_at edge cases', () => {
  it('null resets_at yields undefined resetsAt without throwing', () => {
    const payload = {
      rate_limits: {
        five_hour: window_(50, null),
      },
    }
    expect(() => parseStatuslinePayload(payload)).not.toThrow()
    expect(firstEvent(payload).meta.fiveHourResetsAt).toBeUndefined()
  })

  it('object resets_at yields undefined resetsAt without throwing', () => {
    const payload = {
      rate_limits: {
        five_hour: window_(50, { foo: 'bar' }),
      },
    }
    expect(firstEvent(payload).meta.fiveHourResetsAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 11. normaliseResetsAt: numeric Unix-SECONDS input is scaled to milliseconds
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — numeric Unix-seconds resets_at scaled to ms', () => {
  it('a Unix-seconds value (~1.7e9) is multiplied by 1000 to yield ms', () => {
    const secValue = 1_717_000_000 // ~1.7e9 — clearly Unix seconds
    const payload = {
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: secValue },
      },
    }
    const result = firstEvent(payload).meta.fiveHourResetsAt as number
    // Must be in millisecond range (~1.7e12), not seconds range (~1.7e9)
    expect(result).toBe(secValue * 1000)
    expect(result).toBeGreaterThan(1e12)
  })
})

// ---------------------------------------------------------------------------
// 12. normaliseResetsAt: numeric value already > 1e12 (ms) is passed through
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — numeric ms resets_at (> 1e12) passed through', () => {
  it('a value already in ms range (> 1e12) is NOT multiplied again', () => {
    const msValue = 1_717_000_000_000 // ~1.7e12 — clearly ms
    const payload = {
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: msValue },
      },
    }
    const result = firstEvent(payload).meta.fiveHourResetsAt as number
    expect(result).toBe(msValue)
  })
})

// ---------------------------------------------------------------------------
// 14. cost.total_cost_usd + context_window.output_tokens → meta (token floor)
//
//     The token-milestone floor (ADR-0010) needs REAL cost/token consumption.
//     These work even when rate_limits is ABSENT (API / Wellspring users) so the
//     floor still pays out for them.
// ---------------------------------------------------------------------------

describe('parseStatuslinePayload — cost + output_tokens for the token-milestone floor', () => {
  it('emits meta.costUsd from cost.total_cost_usd when present', () => {
    const payload = { cost: { total_cost_usd: 1.23 }, session_id: 'sess-cost' }
    expect(firstEvent(payload).meta.costUsd).toBe(1.23)
  })

  it('emits meta.outputTokens from context_window.output_tokens when present', () => {
    const payload = { context_window: { output_tokens: 4567 } }
    expect(firstEvent(payload).meta.outputTokens).toBe(4567)
  })

  it('emits BOTH cost and tokens alongside rate_limits (present:true)', () => {
    const payload = {
      rate_limits: { five_hour: window_(40, EPOCH_5H_SEC) },
      cost: { total_cost_usd: 2.5 },
      context_window: { output_tokens: 9999 },
    }
    const ev = firstEvent(payload)
    expect(ev.meta.present).toBe(true)
    expect(ev.meta.costUsd).toBe(2.5)
    expect(ev.meta.outputTokens).toBe(9999)
  })

  it('emits cost/tokens for a Wellspring payload (no rate_limits) — present:false', () => {
    const payload = { cost: { total_cost_usd: 0.42 }, context_window: { output_tokens: 100 } }
    const ev = firstEvent(payload)
    expect(ev.meta.present).toBe(false)
    expect(ev.meta.costUsd).toBe(0.42)
    expect(ev.meta.outputTokens).toBe(100)
  })

  it('omits costUsd/outputTokens when absent (no fabrication)', () => {
    const ev = firstEvent({ session_id: 'no-cost' })
    expect(ev.meta.costUsd).toBeUndefined()
    expect(ev.meta.outputTokens).toBeUndefined()
  })

  it('ignores non-numeric cost / output_tokens', () => {
    const payload = {
      cost: { total_cost_usd: 'lots' },
      context_window: { output_tokens: null },
    }
    const ev = firstEvent(payload)
    expect(ev.meta.costUsd).toBeUndefined()
    expect(ev.meta.outputTokens).toBeUndefined()
  })

  it('the cost/token-carrying event still passes the GroveEvent zod schema', () => {
    const payload = { cost: { total_cost_usd: 1.0 }, context_window: { output_tokens: 5 } }
    expect(() => GroveEvent.parse(firstEvent(payload))).not.toThrow()
  })
})

/**
 * recap.test.ts — TDD tests for buildRecap (RED first, then GREEN)
 *
 * Tests cover:
 * - byType counts correctly across a mixed event array
 * - sinceTs filters out earlier events
 * - window label reflects opts
 * - highlights omit zero-count categories and include nonzero ones
 * - level/cards/completedSets reflect the passed state
 */

import { describe, it, expect } from 'vitest'
import { buildRecap } from './recap'
import type { GroveEvent } from '../core/events'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'

// ---------------------------------------------------------------------------
// Helpers to create minimal valid GroveEvents
// ---------------------------------------------------------------------------

function makeEvent(
  type: GroveEvent['type'],
  ts: string,
  success = true,
): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    type,
    magnitude: 1,
    success,
    ts,
    meta: {},
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENTS_MIXED: GroveEvent[] = [
  makeEvent('test_result', '2026-05-30T10:00:00Z'),   // green test run
  makeEvent('test_result', '2026-05-30T10:01:00Z'),   // green test run
  makeEvent('test_result', '2026-05-30T10:02:00Z'),   // green test run
  makeEvent('pr_merged',   '2026-05-30T10:03:00Z'),   // merge
  makeEvent('pr_merged',   '2026-05-30T10:04:00Z'),   // merge
  makeEvent('doc_updated', '2026-05-30T10:05:00Z'),   // doc
  makeEvent('commit',      '2026-05-30T10:06:00Z'),   // commit
]

// ---------------------------------------------------------------------------
// byType counts
// ---------------------------------------------------------------------------

describe('buildRecap — byType counts', () => {
  it('counts each event type correctly across a mixed array', () => {
    const state = initialState()
    const recap = buildRecap(EVENTS_MIXED, state)

    expect(recap.byType['test_result']).toBe(3)
    expect(recap.byType['pr_merged']).toBe(2)
    expect(recap.byType['doc_updated']).toBe(1)
    expect(recap.byType['commit']).toBe(1)
    // types with no events should not be present
    expect(recap.byType['build_result']).toBeUndefined()
  })

  it('total equals the full event count', () => {
    const recap = buildRecap(EVENTS_MIXED, initialState())
    expect(recap.total).toBe(EVENTS_MIXED.length)
  })

  it('handles an empty event array', () => {
    const recap = buildRecap([], initialState())
    expect(recap.total).toBe(0)
    expect(recap.byType).toEqual({})
  })

  it('handles a single-type event array', () => {
    const events = [
      makeEvent('commit', '2026-01-01T00:00:00Z'),
      makeEvent('commit', '2026-01-01T00:01:00Z'),
    ]
    const recap = buildRecap(events, initialState())
    expect(recap.byType['commit']).toBe(2)
    expect(recap.total).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// sinceTs filtering
// ---------------------------------------------------------------------------

describe('buildRecap — sinceTs filtering', () => {
  const allEvents: GroveEvent[] = [
    makeEvent('commit', '2026-05-30T08:00:00Z'),   // before cutoff
    makeEvent('commit', '2026-05-30T09:00:00Z'),   // before cutoff
    makeEvent('commit', '2026-05-30T10:00:00Z'),   // at cutoff (included)
    makeEvent('commit', '2026-05-30T11:00:00Z'),   // after cutoff
  ]

  it('includes events with ts >= sinceTs and excludes earlier ones', () => {
    const recap = buildRecap(allEvents, initialState(), { sinceTs: '2026-05-30T10:00:00Z' })
    expect(recap.total).toBe(2) // 10:00 and 11:00
    expect(recap.byType['commit']).toBe(2)
  })

  it('excludes all events when sinceTs is in the future', () => {
    const recap = buildRecap(allEvents, initialState(), { sinceTs: '2099-01-01T00:00:00Z' })
    expect(recap.total).toBe(0)
    expect(recap.byType).toEqual({})
  })

  it('includes all events when sinceTs is before all events', () => {
    const recap = buildRecap(allEvents, initialState(), { sinceTs: '2000-01-01T00:00:00Z' })
    expect(recap.total).toBe(allEvents.length)
  })

  it('includes all events when sinceTs is not provided', () => {
    const recap = buildRecap(allEvents, initialState())
    expect(recap.total).toBe(allEvents.length)
  })
})

// ---------------------------------------------------------------------------
// window label
// ---------------------------------------------------------------------------

describe('buildRecap — window label', () => {
  it('defaults to "all time" when no opts given', () => {
    const recap = buildRecap([], initialState())
    expect(recap.window).toBe('all time')
  })

  it('defaults to "all time" when opts is an empty object', () => {
    const recap = buildRecap([], initialState(), {})
    expect(recap.window).toBe('all time')
  })

  it('defaults to "session" when sinceTs given but no window', () => {
    const recap = buildRecap([], initialState(), { sinceTs: '2026-05-30T10:00:00Z' })
    expect(recap.window).toBe('session')
  })

  it('uses explicit window value when provided', () => {
    const recap = buildRecap([], initialState(), { window: 'last-hour' })
    expect(recap.window).toBe('last-hour')
  })

  it('explicit window overrides sinceTs default', () => {
    const recap = buildRecap([], initialState(), {
      sinceTs: '2026-05-30T10:00:00Z',
      window: 'today',
    })
    expect(recap.window).toBe('today')
  })
})

// ---------------------------------------------------------------------------
// highlights
// ---------------------------------------------------------------------------

describe('buildRecap — highlights', () => {
  it('includes a highlight for nonzero test_result counts', () => {
    const events = [
      makeEvent('test_result', '2026-05-30T10:00:00Z'),
      makeEvent('test_result', '2026-05-30T10:01:00Z'),
    ]
    const recap = buildRecap(events, initialState())
    expect(recap.highlights.some((h) => h.includes('tests green'))).toBe(true)
    expect(recap.highlights.some((h) => h.includes('2'))).toBe(true)
  })

  it('includes a highlight for nonzero pr_merged counts', () => {
    const events = [makeEvent('pr_merged', '2026-05-30T10:00:00Z')]
    const recap = buildRecap(events, initialState())
    expect(recap.highlights.some((h) => h.includes('merge'))).toBe(true)
  })

  it('includes a highlight for nonzero doc_updated counts', () => {
    const events = [makeEvent('doc_updated', '2026-05-30T10:00:00Z')]
    const recap = buildRecap(events, initialState())
    expect(recap.highlights.some((h) => h.includes('doc'))).toBe(true)
  })

  it('omits highlights for zero-count categories', () => {
    // Only commits — no test runs, merges, or docs
    const events = [makeEvent('commit', '2026-05-30T10:00:00Z')]
    const recap = buildRecap(events, initialState())
    expect(recap.highlights.some((h) => h.includes('tests green'))).toBe(false)
    expect(recap.highlights.some((h) => h.includes('merge'))).toBe(false)
    expect(recap.highlights.some((h) => h.includes('doc'))).toBe(false)
  })

  it('returns empty highlights array when no events', () => {
    const recap = buildRecap([], initialState())
    expect(recap.highlights).toEqual([])
  })

  it('all highlights in mixed array are non-empty strings', () => {
    const recap = buildRecap(EVENTS_MIXED, initialState())
    for (const h of recap.highlights) {
      expect(typeof h).toBe('string')
      expect(h.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// level / cards / completedSets from GameState
// ---------------------------------------------------------------------------

describe('buildRecap — state fields', () => {
  it('reflects the passed level', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 7, currency: 0 },
    }
    const recap = buildRecap([], state)
    expect(recap.level).toBe(7)
  })

  it('reflects the passed cards count', () => {
    const state: GameState = {
      ...initialState(),
      cards: [
        { id: 'c1', name: 'Card 1', rarity: 'common', set: 'set-a' },
        { id: 'c2', name: 'Card 2', rarity: 'rare', set: 'set-b' },
        { id: 'c3', name: 'Card 3', rarity: 'epic', set: 'set-c' },
      ],
    }
    const recap = buildRecap([], state)
    expect(recap.cards).toBe(3)
  })

  it('reflects the passed completedSets', () => {
    const state: GameState = {
      ...initialState(),
      completedSets: ['set-alpha', 'set-beta'],
    }
    const recap = buildRecap([], state)
    expect(recap.completedSets).toEqual(['set-alpha', 'set-beta'])
  })

  it('returns empty completedSets from initialState', () => {
    const recap = buildRecap([], initialState())
    expect(recap.completedSets).toEqual([])
  })

  it('state fields are independent of filtered events', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 42, currency: 0 },
      cards: [{ id: 'x', name: 'X', rarity: 'legendary', set: 'z' }],
      completedSets: ['z'],
    }
    // sinceTs excludes all events
    const recap = buildRecap(EVENTS_MIXED, state, { sinceTs: '2099-01-01T00:00:00Z' })
    // State fields come from the passed GameState, not from events
    expect(recap.level).toBe(42)
    expect(recap.cards).toBe(1)
    expect(recap.completedSets).toEqual(['z'])
    // But totals reflect the filtered (empty) window
    expect(recap.total).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { initialState } from './state'
import { mulberry32, hashStringToSeed, weightedPick } from './rng'
import { parseEvent } from './events'
import { EVENT_TYPES } from './events'
import { RARITIES, rarityRank } from './rewards'

describe('core/state', () => {
  it('starts a new player at level 1 with no loot', () => {
    const s = initialState()
    expect(s.player.level).toBe(1)
    expect(s.player.xp).toBe(0)
    expect(s.cards).toEqual([])
    expect(s.gear).toEqual([])
  })

  it('starts in Wellspring mode: energy known=false (unmetered → UI hides the bar)', () => {
    const s = initialState()
    expect(s.energy).toBeDefined()
    expect(s.energy.known).toBe(false)
    expect(s.energy.vigor).toBe(100)
    expect(s.energy.sap).toBe(100)
    // resets are unknown until a real frame arrives — never fabricated.
    expect(s.energy.vigorResetsAt).toBeUndefined()
    expect(s.energy.sapResetsAt).toBeUndefined()
  })
})

describe('core/events — quota_update vocabulary', () => {
  it('quota_update is a valid event type (ambient quota signal)', () => {
    expect((EVENT_TYPES as readonly string[]).includes('quota_update')).toBe(true)
  })

  it('parses a quota_update event carrying quota data in meta', () => {
    const e = parseEvent({
      source: 'claude-code',
      sessionId: 's1',
      type: 'quota_update',
      ts: '2026-05-30T00:00:00Z',
      meta: { present: true, fiveHourPct: 30, sevenDayPct: 10 },
    })
    expect(e.type).toBe('quota_update')
    expect(e.meta.present).toBe(true)
    expect(e.meta.fiveHourPct).toBe(30)
  })

  it('commons_contribution is a valid event type (ADR-0013 commons P0)', () => {
    expect((EVENT_TYPES as readonly string[]).includes('commons_contribution')).toBe(true)
  })

  it('parses a commons_contribution event (a merged commons PR outcome)', () => {
    const e = parseEvent({
      source: 'commons-merge-hook',
      sessionId: 's1',
      type: 'commons_contribution',
      ts: '2026-05-30T00:00:00Z',
    })
    expect(e.type).toBe('commons_contribution')
    expect(e.success).toBe(true)
  })
})

describe('core/rng', () => {
  it('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })

  it('mulberry32 differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('hashStringToSeed is stable and produces a uint32', () => {
    const h = hashStringToSeed('session-abc')
    expect(h).toBe(hashStringToSeed('session-abc'))
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
  })

  it('weightedPick never picks a zero-weight entry when others exist', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 50; i++) {
      const v = weightedPick(rng, [
        { value: 'a', weight: 1 },
        { value: 'z', weight: 0 },
      ])
      expect(v).toBe('a')
    }
  })
})

describe('core/events', () => {
  it('parses a valid event and applies defaults', () => {
    const e = parseEvent({
      source: 'git',
      sessionId: 's1',
      type: 'commit',
      ts: '2026-05-30T00:00:00Z',
    })
    expect(e.type).toBe('commit')
    expect(e.magnitude).toBe(1)
    expect(e.success).toBe(true)
    expect(e.meta).toEqual({})
  })

  it('rejects an unknown event type', () => {
    expect(() =>
      parseEvent({ source: 'git', sessionId: 's1', type: 'nope', ts: 't' }),
    ).toThrow()
  })
})

describe('core/rewards', () => {
  it('rarity ranks ascend from common to shiny', () => {
    expect(rarityRank('common')).toBe(0)
    expect(rarityRank('shiny')).toBe(RARITIES.length - 1)
    expect(rarityRank('legendary')).toBeGreaterThan(rarityRank('rare'))
  })
})

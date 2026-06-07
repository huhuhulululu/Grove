/**
 * status-json.test.ts — the PURE computed game-state snapshot (own-your-data).
 *
 * gameStateToJson(state) emits the DERIVED game-state (level/xp/seeds/shards,
 * prestige rank, per-rarity card breakdown, completed sets, non-prestige buffs,
 * pity counter) as a machine-readable, LOCALE-INDEPENDENT object — the numbers a
 * `sq status --json | jq` consumer wants, which live nowhere on disk (they are
 * reduce()-derived). Pure: no I/O, no clock, no state mutation; mirrors
 * formatStatus's data EXACTLY but never t()-renders (raw ids + numbers).
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { gameStateToJson } from './status-json'

function state(overrides: Partial<GameState> = {}): GameState {
  return { ...initialState(), ...overrides }
}

function card(id: string, rarity: GameState['cards'][number]['rarity']) {
  return { id, name: id, rarity, set: 'forest' } as GameState['cards'][number]
}

describe('gameStateToJson — pure computed-state snapshot', () => {
  it('emits the full shape for a known state', () => {
    const j = gameStateToJson(state({ player: { level: 3, xp: 120, currency: 50, shards: 7 } }))
    expect(j.player).toEqual({ level: 3, xp: 120, currency: 50, shards: 7 })
    expect(j.prestige).toBe(0)
    expect(j.cards).toEqual({ total: 0, byRarity: {} })
    expect(j.completedSets).toEqual([])
    expect(j.buffs).toEqual([])
    expect(j.pity).toEqual({ sinceLegendary: 0 })
  })

  it('aggregates cards by rarity, total === cards.length', () => {
    const j = gameStateToJson(state({ cards: [card('a', 'common'), card('b', 'common'), card('c', 'rare')] }))
    expect(j.cards.total).toBe(3)
    expect(j.cards.byRarity).toEqual({ common: 2, rare: 1 })
  })

  it('reads shards as 0 on a legacy state with no player.shards (never undefined/NaN)', () => {
    const j = gameStateToJson(state({ player: { level: 1, xp: 0, currency: 0 } }))
    expect(j.player.shards).toBe(0)
  })

  it('folds prestige into the rank field and EXCLUDES the prestige buff from buffs[]', () => {
    const j = gameStateToJson(state({
      buffs: [
        { id: 'prestige:mark', label: 'Prestige 1' },
        { id: 'refreshed', label: 'Refreshed' },
      ],
    }))
    expect(j.prestige).toBe(1)
    expect(j.buffs).toEqual([{ id: 'refreshed', label: 'Refreshed' }])
  })

  it('emits RAW buff id+label (locale-independent — never resolves msgKey via t())', () => {
    const j = gameStateToJson(state({
      buffs: [{ id: 'b1', label: 'Raw Label', msgKey: 'reward.buff.precast' }],
    }))
    expect(j.buffs).toEqual([{ id: 'b1', label: 'Raw Label' }])
  })

  it('round-trips through JSON with no undefined / NaN values', () => {
    const j = gameStateToJson(state({
      player: { level: 2, xp: 30, currency: 10, shards: 3 },
      cards: [card('a', 'epic')],
      completedSets: ['forest'],
    }))
    expect(JSON.parse(JSON.stringify(j))).toEqual(j)
    for (const n of [j.player.level, j.player.xp, j.player.currency, j.player.shards, j.prestige, j.cards.total, j.pity.sinceLegendary]) {
      expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('is PURE — twice is deep-equal and the input state is not mutated', () => {
    const s = state({ cards: [card('a', 'common')], completedSets: ['forest'] })
    const beforeSets = [...s.completedSets]
    const beforeCards = s.cards.length
    const a = gameStateToJson(s)
    const b = gameStateToJson(s)
    expect(a).toEqual(b)
    // the returned arrays are COPIES, and the input is untouched.
    expect(a.completedSets).not.toBe(s.completedSets)
    expect(s.completedSets).toEqual(beforeSets)
    expect(s.cards.length).toBe(beforeCards)
  })
})

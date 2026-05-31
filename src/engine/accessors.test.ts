/**
 * accessors.test.ts — R8 decision-point telemetry (economy A-blocker:
 * "surface pity/odds at the decision point").
 *
 * Small PURE exported accessors the render/TUI layer reads to show the player WHY a
 * pull/save decision matters: pity progress (sinceLegendary vs SOFT_PITY/HARD_PITY),
 * the cards they are still missing, and the published REALIZED legendary+shiny rate.
 * No I/O, no wall-clock, no rng — they only read state + published constants.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import {
  pityProgress,
  missingCardIdsForPlayer,
  realizedLegendaryShinyRate,
} from './reduce'
import { SOFT_PITY, HARD_PITY, REALIZED_LEGENDARY_SHINY_RATE } from './gacha'
import { unlockedSets } from '../core/cards'
import { missingCardIds } from './collection'

describe('pityProgress — sinceLegendary vs SOFT_PITY / HARD_PITY', () => {
  it('reports the raw counter and the published thresholds', () => {
    const s: GameState = { ...initialState(), pity: { sinceLegendary: 12 } }
    const p = pityProgress(s)
    expect(p.sinceLegendary).toBe(12)
    expect(p.softPity).toBe(SOFT_PITY)
    expect(p.hardPity).toBe(HARD_PITY)
  })

  it('flags softActive once at/above SOFT_PITY and hardNext on the pull that hits HARD_PITY', () => {
    const atSoft = pityProgress({ ...initialState(), pity: { sinceLegendary: SOFT_PITY } })
    expect(atSoft.softActive).toBe(true)
    expect(atSoft.hardNext).toBe(false)

    const beforeHard = pityProgress({
      ...initialState(),
      pity: { sinceLegendary: HARD_PITY - 1 },
    })
    // the NEXT pull (sinceLegendary + 1 === HARD_PITY) is the guaranteed one
    expect(beforeHard.hardNext).toBe(true)

    const fresh = pityProgress({ ...initialState(), pity: { sinceLegendary: 0 } })
    expect(fresh.softActive).toBe(false)
    expect(fresh.hardNext).toBe(false)
  })

  it('pullsToHard counts down to the hard guarantee and never goes negative', () => {
    expect(pityProgress({ ...initialState(), pity: { sinceLegendary: 0 } }).pullsToHard).toBe(HARD_PITY)
    expect(
      pityProgress({ ...initialState(), pity: { sinceLegendary: HARD_PITY } }).pullsToHard,
    ).toBe(0)
    expect(
      pityProgress({ ...initialState(), pity: { sinceLegendary: HARD_PITY + 5 } }).pullsToHard,
    ).toBe(0)
  })
})

describe('missingCardIdsForPlayer — the player\'s missing cards within unlocked sets', () => {
  it('a fresh player is missing every level-1 card', () => {
    expect(missingCardIdsForPlayer({ ...initialState() })).toEqual(missingCardIds([], unlockedSets(1)))
  })

  it('respects the player level (a higher level widens the unlocked scope)', () => {
    const lvl10 = missingCardIdsForPlayer({
      ...initialState(),
      player: { ...initialState().player, level: 10 },
    })
    const lvl1 = missingCardIdsForPlayer({ ...initialState() })
    expect(lvl10.length).toBeGreaterThan(lvl1.length)
  })
})

describe('realizedLegendaryShinyRate — the published honest long-run rate', () => {
  it('equals the published REALIZED_LEGENDARY_SHINY_RATE constant', () => {
    expect(realizedLegendaryShinyRate()).toBe(REALIZED_LEGENDARY_SHINY_RATE)
  })
})

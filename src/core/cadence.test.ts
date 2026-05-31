/**
 * cadence.test.ts — R6 UNLOCK CADENCE retune (game-design P1).
 *
 * The audit (re-score③) flagged a content dead zone: a beat landed at ~day-2.3
 * (syntax@L3) and then NOTHING until deploy@L6 (~day-17 at the modelled rate),
 * leaving the ~day-5..8 window empty. This pins down the RETUNED cadence so a
 * new-content beat lands in the day-5..8 window (deploy shifted L6→L4).
 *
 * The "day" model is the audit's own anchor: syntax@L3 (cumulative XP 191 to
 * reach L3) ≈ day-2.3 → ~83 XP/day. We assert the SHAPE of the cadence (a beat
 * in the day-5..8 cumXP band) rather than hard-coding fragile per-set levels, so
 * a future re-tune that keeps the property stays green.
 */

import { describe, it, expect } from 'vitest'
import { SET_UNLOCK_LEVEL, setIds } from './cards'
import { xpForLevel } from '../engine/xp'

/** Modelled daily XP rate, anchored to the audit's syntax@L3 ≈ day-2.3. */
const XP_PER_DAY = 83

/** Cumulative XP a fresh player must earn to first REACH `level`. */
function cumXpToReach(level: number): number {
  let c = 0
  for (let k = 1; k < level; k++) c += xpForLevel(k)
  return c
}

/** The modelled day a set's unlock level lands on. */
function dayForLevel(level: number): number {
  return cumXpToReach(level) / XP_PER_DAY
}

describe('unlock cadence — a content beat lands in the day-5..8 window (no dead zone)', () => {
  it('at least one set unlocks in the modelled day-5..8 window', () => {
    const days = setIds()
      .map((s) => dayForLevel(SET_UNLOCK_LEVEL[s] ?? 1))
      .filter((d) => d > 0) // ignore the level-1 starter sets
    const inWindow = days.some((d) => d >= 5 && d <= 8)
    expect(inWindow).toBe(true)
  })

  it('the early beat (syntax) is preserved around day-2.3', () => {
    const syntaxDay = dayForLevel(SET_UNLOCK_LEVEL['syntax'] ?? 1)
    expect(syntaxDay).toBeGreaterThan(1)
    expect(syntaxDay).toBeLessThan(4)
  })

  it('no gap larger than ~6 days between consecutive unlock beats below day-12', () => {
    // Sort the modelled days of every gated set, restricted to the early/mid game.
    const days = setIds()
      .map((s) => dayForLevel(SET_UNLOCK_LEVEL[s] ?? 1))
      .filter((d) => d > 0 && d <= 12)
      .sort((a, b) => a - b)
    // The first gated beat should arrive by ~day-3 and each next beat within ~6 days.
    let prev = 0
    for (const d of days) {
      expect(d - prev).toBeLessThanOrEqual(6)
      prev = d
    }
  })

  it('the late-game prize set still sits clearly beyond the mid game (a real horizon)', () => {
    // relics remains the deliberate late prize — far past the day-5..8 mid beat.
    const relicsDay = dayForLevel(SET_UNLOCK_LEVEL['relics'] ?? 1)
    expect(relicsDay).toBeGreaterThan(12)
  })

  it('cadence is monotonic: the three starter sets stay at level 1', () => {
    expect(SET_UNLOCK_LEVEL['forest']).toBe(1)
    expect(SET_UNLOCK_LEVEL['tools']).toBe(1)
    expect(SET_UNLOCK_LEVEL['creatures']).toBe(1)
  })
})

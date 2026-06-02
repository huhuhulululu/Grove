/**
 * mastery.ts — the calm "you've got the groove" ARRIVAL (ADR-0005 cosmetic-only).
 *
 * isMastered(state) is a PURE conjunction of four EXISTING cumulative-state
 * derivations — every set complete · level >= MASTERY_LEVEL · prestige rank >= 1 · a
 * fully-foiled set. It is a DERIVABLE OUTCOME (never activity / hours / time / streak).
 * The recognition that reads it (reduce.grantMastery) is one-shot + idempotent and is
 * an ARRIVAL that ends the treadmill, never a new carrot to chase (anti-burnout).
 */
import type { GameState } from './state'
import { ALL_SET_IDS, prestigeRankOf, hasFullyFoiledSet } from './achievements'

/** The level floor for mastery — where the last content set has unlocked. */
export const MASTERY_LEVEL = 10

export function isMastered(s: GameState): boolean {
  return (
    ALL_SET_IDS.every((set) => s.completedSets.includes(set)) &&
    s.player.level >= MASTERY_LEVEL &&
    prestigeRankOf(s) >= 1 &&
    hasFullyFoiledSet(s)
  )
}

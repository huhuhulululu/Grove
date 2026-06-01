/**
 * achievements.ts (engine) — PURE `checkAchievements` (ADR-0015 rev.2).
 *
 * Returns the ids of achievements whose `when` predicate is satisfied by `state`
 * AND that are NOT already in `state.achievements` (the idempotency gate). Order
 * follows the published table. PURE: no I/O, no wall-clock, no rng — it only reads
 * state + the published ACHIEVEMENTS table (purity.test).
 *
 * FIREWALL (ADR-0005): unlocking an achievement is COSMETIC — the wiring layer
 * appends the id to `state.achievements` and pushes a celebratory reward; nothing
 * here touches real artifacts. Achievements never expire / reset / revert.
 */

import type { GameState } from '../core/state'
import { ACHIEVEMENTS } from '../core/achievements'

/**
 * The ids of newly-satisfied achievements: each `when(state)` is true AND the id is
 * not already recorded in `state.achievements`. PURE & deterministic (table order).
 */
export function checkAchievements(state: GameState): string[] {
  const already = new Set(state.achievements ?? [])
  const out: string[] = []
  for (const def of ACHIEVEMENTS) {
    if (already.has(def.id)) continue
    if (def.when(state)) out.push(def.id)
  }
  return out
}

/**
 * loadout.ts — Track A (ADR-0014 rev.2), PURE.
 *
 * The player BUILDS a loadout from owned cards / gear / quest-buffs into limited
 * SLOTS; SYNERGIES between equipped members (the published src/core/synergies.ts
 * table) produce a COSMETIC `LoadoutEffect` of xp/seed/crit multipliers — giving
 * the collection a PURPOSE and real "构筑" decisions.
 *
 * FIREWALL (ADR-0005): every output here is COSMETIC. `computeLoadoutEffect` never
 * touches real artifacts; `equip`/`unequip` only edit the cosmetic loadout slots.
 * This module is PURE: no fs/process/network/wall-clock/Math.random (purity.test).
 *
 * NEUTRAL-EMPTY: an empty loadout (or one with no active synergy) returns the
 * identity effect {xpMult:1, seedMult:1, critBonus:0, activeSynergies:[]} — empty
 * is first-class and never penalized (ADR-0014 acceptance).
 *
 * BOUNDED: each multiplier field is clamped to a small cap so stacking synergies
 * can never make the cosmetic economy run away (mirrors the existing capped gear
 * economy). The wiring agent folds this into the SAME capped `scale` and must not
 * re-count a member gear's own activeGearBonus.
 */

import type { GameState } from '../core/state'
import type { EquippedRef, SynergyDef, SynergyRequire } from '../core/synergies'
import { SYNERGIES } from '../core/synergies'

/** The number of loadout slots. Equipping past this is refused (tradeoff). */
export const SLOT_CAP = 3

/**
 * Caps on the COMBINED synergy effect, so stacking can never trivialise the
 * cosmetic economy. Small + bounded, mirroring the gear-bonus caps in gear.ts.
 *  - xp/seed multipliers are clamped to at most +15% total.
 *  - crit bonus is clamped to at most +10 percentage-points total.
 */
export const MAX_XP_MULT = 1.15
export const MAX_SEED_MULT = 1.15
export const MAX_CRIT_BONUS = 0.1

/** The cosmetic effect a built loadout confers (neutral = {1,1,0,[]}). */
export interface LoadoutEffect {
  xpMult: number
  seedMult: number
  critBonus: number
  /** ids of the synergies currently active, in table order. */
  activeSynergies: string[]
}

/** The identity (neutral) effect — empty loadout / no active synergy. */
function neutralEffect(): LoadoutEffect {
  return { xpMult: 1, seedMult: 1, critBonus: 0, activeSynergies: [] }
}

/** Whether `ref` satisfies a single synergy requirement clause. */
function refMatches(ref: EquippedRef, req: SynergyRequire): boolean {
  if (ref.kind !== req.kind) return false
  if (req.tag !== undefined && ref.tag !== req.tag) return false
  if (req.id !== undefined && ref.id !== req.id) return false
  return true
}

/**
 * Whether every clause of `def` is satisfied by the equipped `slots`. A clause
 * needs at least `min` DISTINCT equipped members (counted by id) that match it.
 */
function synergyActive(def: SynergyDef, slots: EquippedRef[]): boolean {
  for (const req of def.requires) {
    const matchingIds = new Set<string>()
    for (const ref of slots) {
      if (refMatches(ref, req)) matchingIds.add(ref.id)
    }
    if (matchingIds.size < Math.max(1, req.min)) return false
  }
  return true
}

/**
 * Compute the cosmetic LoadoutEffect for the player's current loadout (PURE).
 *
 * Folds in EVERY active synergy: xp/seed multipliers multiply together; crit
 * bonuses add. The combined result is then clamped to the small caps above so it
 * can never run away. NEUTRAL when nothing is equipped or no synergy is active.
 */
export function computeLoadoutEffect(state: GameState): LoadoutEffect {
  const slots = state.loadout?.slots ?? []
  if (slots.length === 0) return neutralEffect()

  const effect = neutralEffect()
  for (const def of SYNERGIES) {
    if (!synergyActive(def, slots)) continue
    effect.activeSynergies.push(def.id)
    effect.xpMult *= def.effect.xpMult ?? 1
    effect.seedMult *= def.effect.seedMult ?? 1
    effect.critBonus += def.effect.critBonus ?? 0
  }

  // Bound the combined effect (no runaway).
  effect.xpMult = Math.min(MAX_XP_MULT, effect.xpMult)
  effect.seedMult = Math.min(MAX_SEED_MULT, effect.seedMult)
  effect.critBonus = Math.min(MAX_CRIT_BONUS, effect.critBonus)
  return effect
}

/**
 * Equip `ref` into a free slot (PURE reducer). Returns a NEW state.
 *
 * SLOT CAP (ADR-0014): a loadout holds at most SLOT_CAP members. Equipping past
 * the cap is REFUSED — the state is returned UNCHANGED (the player must unequip
 * first, so a full loadout is a real tradeoff). Re-equipping an already-equipped
 * id (same kind + id) is also a no-op (no duplicate slot). The input state is
 * never mutated.
 */
export function equip(state: GameState, ref: EquippedRef): GameState {
  const slots = state.loadout?.slots ?? []
  // Already equipped (same kind + id) → no-op.
  if (slots.some((s) => s.kind === ref.kind && s.id === ref.id)) return state
  // At capacity → refused, unchanged (tradeoff: unequip to make room).
  if (slots.length >= SLOT_CAP) return state
  return { ...state, loadout: { slots: [...slots, ref] } }
}

/**
 * Unequip the member at slot index `slot` (PURE reducer). Returns a NEW state.
 * An out-of-range index is a no-op (state returned unchanged). The input state is
 * never mutated.
 */
export function unequip(state: GameState, slot: number): GameState {
  const slots = state.loadout?.slots ?? []
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length) return state
  return { ...state, loadout: { slots: slots.filter((_, i) => i !== slot) } }
}

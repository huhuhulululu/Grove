/**
 * render/loadout.ts — PURE loadout panel renderer (ADR-0014 rev.2 Track A).
 *
 * Renders:
 *  - the 3 slots (filled or empty)
 *  - ACTIVE synergies with their effects
 *  - ONE-AWAY synergies (the chase) — synergies that need exactly 1 more member
 *
 * ZEN suppression: callers pass isZen; this module returns '' when zen is true
 * so the HUD never appears in calm mode (ADR-0014 acceptance + ADR-0005).
 *
 * NEUTRAL-EMPTY: an empty loadout is a first-class state — no "leaving value on
 * the table" prompting, just the three empty slots and that's it.
 *
 * PURE: no I/O, no wall-clock, no filesystem. Returns a string.
 */

import type { GameState } from '../core/state'
import type { SynergyDef, SynergyEffect } from '../core/synergies'
import { SYNERGIES } from '../core/synergies'
import { computeLoadoutEffect, SLOT_CAP } from '../engine/loadout'
import type { Locale } from '../i18n/types'
import { t } from '../i18n/t'

// ---------------------------------------------------------------------------
// One-away detection
// ---------------------------------------------------------------------------

/**
 * A synergy is ONE-AWAY when it has at least one unsatisfied clause, but
 * the total number of additional DISTINCT members needed across all unsatisfied
 * clauses is exactly 1. This is the "chase" the player can act on next slot.
 *
 * PURE: reads slots only.
 */
export function isOneAway(def: SynergyDef, slots: GameState['loadout']['slots']): boolean {
  let gap = 0
  for (const req of def.requires) {
    const matchingIds = new Set<string>()
    for (const ref of slots) {
      if (
        ref.kind === req.kind &&
        (req.tag === undefined || ref.tag === req.tag) &&
        (req.id === undefined || ref.id === req.id)
      ) {
        matchingIds.add(ref.id)
      }
    }
    const need = Math.max(1, req.min)
    const have = matchingIds.size
    if (have < need) gap += need - have
  }
  // Already active (gap === 0) is NOT one-away; gap === 1 is the chase.
  return gap === 1
}

// ---------------------------------------------------------------------------
// Effect summary line
// ---------------------------------------------------------------------------

/**
 * Terse one-line summary of a synergy's cosmetic effect, LOCALIZED:
 * "+5% XP", "+6% seeds", "+4pp crit", joined by ' · '. Shared by the dashboard,
 * the loadout panel, and the TUI so the unit copy (seeds/crit) localizes in ONE
 * place — XP stays literal in every locale. Pure (no I/O, no clock, no RNG).
 */
export function synergyEffectLine(effect: SynergyEffect, locale: Locale = 'en'): string {
  const parts: string[] = []
  const xp = effect.xpMult ?? 1
  const seed = effect.seedMult ?? 1
  const crit = effect.critBonus ?? 0
  if (xp !== 1) parts.push(t(locale, 'ui.synergy.effect.xp', { n: Math.round((xp - 1) * 100) }))
  if (seed !== 1) parts.push(t(locale, 'ui.synergy.effect.seeds', { n: Math.round((seed - 1) * 100) }))
  if (crit !== 0) parts.push(t(locale, 'ui.synergy.effect.crit', { n: Math.round(crit * 100) }))
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the loadout panel as a multi-line string.
 *
 * @param state  Current game state (read-only).
 * @param isZen  When true, returns '' — no loadout HUD in calm mode.
 * @param locale Translation locale (default 'en').
 * @returns      Multi-line string, or '' when zen.
 */
export function renderLoadoutPanel(
  state: GameState,
  isZen: boolean,
  locale: Locale = 'en',
): string {
  // ADR-0014: the loadout HUD is SUPPRESSED under --zen (calm mode, no synergy nag).
  if (isZen) return ''

  const slots = state.loadout?.slots ?? []
  const effect = computeLoadoutEffect(state)
  const lines: string[] = []

  lines.push(t(locale, 'ui.loadout.title'))

  // --- Slots -----------------------------------------------------------------
  for (let i = 0; i < SLOT_CAP; i++) {
    const ref = slots[i]
    if (ref === undefined) {
      lines.push(t(locale, 'ui.loadout.slot_empty', { n: i + 1 }))
    } else {
      const label = ref.tag ?? ref.id
      lines.push(t(locale, 'ui.loadout.slot_filled', { n: i + 1, label, kind: ref.kind }))
    }
  }

  // --- Active synergies -------------------------------------------------------
  // Each active row gets the ✦ sparkle prefix — a celebratory pop for a firing synergy.
  if (effect.activeSynergies.length > 0) {
    lines.push(t(locale, 'ui.loadout.active_header'))
    for (const id of effect.activeSynergies) {
      const def = SYNERGIES.find((s) => s.id === id)
      if (def === undefined) continue
      lines.push('✦ ' + t(locale, 'ui.loadout.active_row', { name: def.name, effect: synergyEffectLine(def.effect, locale) }))
    }
  }

  // --- One-away synergies (chase) --------------------------------------------
  // Only show when there is at least one free slot to fill.
  // Each chase row gets the ◇ marker — an open diamond signals "almost there",
  // inviting without nagging (the chase, not a scolding).
  const freeSlots = SLOT_CAP - slots.length
  if (freeSlots > 0) {
    const oneAway = SYNERGIES.filter(
      (def) =>
        !effect.activeSynergies.includes(def.id) && isOneAway(def, slots),
    )
    if (oneAway.length > 0) {
      lines.push(t(locale, 'ui.loadout.chase_header'))
      for (const def of oneAway) {
        lines.push(
          '◇ ' + t(locale, 'ui.loadout.chase_row', { name: def.name, effect: synergyEffectLine(def.effect, locale) }),
        )
      }
    }
  }

  return lines.join('\n')
}

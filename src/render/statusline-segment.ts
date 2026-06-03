/**
 * statusline-segment.ts — a calm, composable ONE-LINE Grove glance for a statusline.
 *
 * The user composes this into their OWN statusLine.command (e.g. `<their-cmd> ; sq
 * statusline-segment`). Grove never owns or rewrites their bar (ADR-0004) — the
 * segment sits where the user puts it and fuses by spatial adjacency.
 *
 * It shows ONLY game-state (level · xp-to-next · energy REMAINING). It does NOT
 * re-render model/branch/context (the user's own bar owns those; the Claude Code
 * statusline JSON carries no branch/context fields anyway — tool-agnostic, ADR-0001).
 *
 * Anti-burnout on the only always-visible surface (ADR-0005/0008):
 *  - energy is REMAINING (⚡ Vigor 5h · 🌿 Sap 7d), the exact inverse of a "% used"
 *    bar, so it never contradicts and never adds a second countdown clock;
 *  - Wellspring (energy.known === false) shows NO energy and invents NO scarcity;
 *  - a low present window adds at most one quiet 🌙 "good stopping point" glyph;
 *  - --zen collapses to the quietest mark: tree + level.
 *
 * PURE: a function of GameState only. No fs, no clock, no rng, no mutation.
 */

import type { GameState } from '../core/state'
import type { Locale } from '../i18n/types'
import { t } from '../i18n/t'
import { xpForLevel } from '../engine/xp'

/** xp-to-next mini bar — same ratio math + glyphs as the dashboard xpBar, length 5. */
const BAR_LEN = 5
/** A present energy window below this earns the calm rest cue (matches the dashboard). */
const LOW_ENERGY = 20

function miniBar(current: number, max: number): string {
  const ratio = max > 0 ? Math.min(1, current / max) : 0
  const filled = Math.round(ratio * BAR_LEN)
  return '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled)
}

export function renderStatuslineSegment(state: GameState, locale: Locale = 'en', zen = false): string {
  const levelTag = t(locale, 'ui.statusline.level', { level: state.player.level })

  // --zen: the quietest possible ambient mark (alive, growing) — nothing else.
  if (zen) return levelTag

  const bar = miniBar(state.player.xp, xpForLevel(state.player.level))
  const parts: string[] = [`${levelTag} ${bar}`]

  // Energy. Wellspring gate FIRST: an unmetered plan (known === false) shows no
  // energy and invents no scarcity (initialState defaults vigor/sap to 100 with
  // known:false, so gating on known — not on vigor !== undefined — is essential).
  const e = state.energy
  if (e.known) {
    const eparts: string[] = []
    if (e.vigor !== undefined) eparts.push(`⚡${Math.round(e.vigor)}`)
    if (e.sap !== undefined) eparts.push(`🌿${Math.round(e.sap)}`)
    if (eparts.length > 0) parts.push(eparts.join(' '))
    // One calm rest cue when a PRESENT window is low. Never red, never text-shaming.
    const low =
      (e.vigor !== undefined && e.vigor < LOW_ENERGY) ||
      (e.sap !== undefined && e.sap < LOW_ENERGY)
    if (low) parts.push('🌙')
  }

  return parts.join(' · ')
}

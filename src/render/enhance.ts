/**
 * enhance.ts — pure string renderers for the gear-enhancement surface.
 *
 * ADR-0005 FIREWALL: 'break' and 'downgrade' are COSMETIC-ONLY visual states.
 * They NEVER represent real loss of work, code, commits, or any external artefact.
 * This module is pure (no I/O, no filesystem access).
 *
 * ADR-0007: Juicy, interactive, never a scrolling text stream.
 */

import type { Gear } from '../core/rewards'
import type { EnhanceResult } from '../engine/gear'
import { enhanceTable } from '../engine/gear'

// ---------------------------------------------------------------------------
// renderEnhanceOdds
// ---------------------------------------------------------------------------

/**
 * Show the enhancement odds for a piece of gear.
 *
 * Format:
 *   <name> +<level> → +<level+1>
 *   success 70%  downgrade 25%  break 5%
 */
export function renderEnhanceOdds(gear: Gear): string {
  const table = enhanceTable(gear.level)

  const successPct  = Math.round(table.success   * 100)
  const downgradePct = Math.round(table.downgrade * 100)
  const breakPct    = Math.round(table.break      * 100)

  const transition = `${gear.name} +${gear.level} → +${gear.level + 1}`
  const odds = `success ${successPct}%  downgrade ${downgradePct}%  break ${breakPct}%`

  return `${transition}\n${odds}`
}

// ---------------------------------------------------------------------------
// renderEnhanceResult
// ---------------------------------------------------------------------------

/**
 * A juicy, celebratory-or-gentle one-to-few-line reveal per result.
 *
 * - success   → celebratory with ✦ and the level transition
 * - downgrade → gentle, encouraging, shows new (lower) level
 * - break     → dramatic but MUST reassure cosmetic-only (ADR-0005)
 * - stay      → calm note that nothing happened (already broken)
 */
export function renderEnhanceResult(before: Gear, after: Gear, result: EnhanceResult): string {
  switch (result) {
    case 'success':
      return `ENHANCE +${before.level}→+${after.level}\n✓ success`

    case 'downgrade':
      return `ENHANCE +${before.level}→+${after.level}\n↓ +${after.level}`

    case 'break':
      return `ENHANCE +${before.level}→+${after.level}\n✗ SHATTERED (code safe)`

    case 'stay':
      return `– broken`
  }
}

// ---------------------------------------------------------------------------
// renderEnhanceFrames
// ---------------------------------------------------------------------------

/**
 * A few short ASCII 'rolling' frames for a suspense animation.
 * Each frame is a standalone string; cycle through them at ~150ms each.
 */
export function renderEnhanceFrames(): string[] {
  return [
    '🎲 .',
    '🎲 ..',
    '🎲 ...',
    '⚡ ...',
    '⚡ ..',
    '⚡ .',
  ]
}

// ---------------------------------------------------------------------------
// renderPullFrames — pack-opening suspense for `sq pull`
// ---------------------------------------------------------------------------

/**
 * A few short pack-opening 'shuffle' frames for the `sq pull` reveal — mirrors
 * renderEnhanceFrames but with a card/pack (🃏) motif. Cycle at ~150ms each,
 * then print the drop. Pure: returns standalone strings, no I/O.
 */
export function renderPullFrames(): string[] {
  return [
    '🃏 .',
    '🃏 ..',
    '🃏 ...',
    '✨ ...',
    '✨ ..',
    '✨ .',
  ]
}

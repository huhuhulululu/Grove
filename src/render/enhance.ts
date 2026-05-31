/**
 * enhance.ts — pure string renderers for the gear-enhancement surface.
 *
 * ADR-0005 FIREWALL: 'break' and 'downgrade' are COSMETIC-ONLY visual states.
 * They NEVER represent real loss of work, code, commits, or any external artefact.
 * This module is pure (no I/O, no filesystem access).
 *
 * ADR-0007: Juicy, interactive, never a scrolling text stream.
 */

import type { Gear, Rarity } from '../core/rewards'
import { rarityRank } from '../core/rewards'
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
// RARITY-SCALED REVEAL FRAMES — escalating anticipation (R9, game-design)
// ---------------------------------------------------------------------------
//
// The suspense itself signals "something big": a rarer drop earns a LONGER,
// BRIGHTER, accelerating build with a held beat / near-miss tease before it
// settles; a common drop gets a short, snappy reveal. All pure strings, cycled
// by the existing 120ms stepper (the caller appends the actual drop flash).
//
// Build shape (per reveal):
//   1. shuffle  — the pack/anvil shuffles (the 🃏 / 🎲 motif).
//   2. sparkle widen — a sparkle field that WIDENS with the rarity (more ✨).
//   3. held beat — for rare+ drops, a near-miss tension hold repeated by tier.
// Length & sparkle width both climb with rarityRank so the player FEELS the tier
// before the name lands.

/**
 * How many sparkle-widen + held-beat frames a rarity earns, on top of the base
 * shuffle. rarityRank: common 0 … shiny 5. The build grows monotonically.
 */
function revealIntensity(rarity?: Rarity): number {
  // No rarity (legacy callers / unknown) → a modest default mid-build.
  if (rarity === undefined) return 2
  return rarityRank(rarity)
}

/**
 * Build the shared escalating frame sequence for a reveal, given a `lead` glyph
 * (the shuffle motif: 🃏 for a pull, 🎲 for an enhance) and the salient rarity.
 *
 * - common (rank 0): a short snappy shuffle + a single spark.
 * - rare+ : a widening ✨ field then a held "·•✦•·" near-miss beat, repeated more
 *   per tier, so a legendary|shiny lingers on the edge before it drops.
 *
 * Pure: returns standalone, non-empty, non-identical strings.
 */
function buildRevealFrames(lead: string, rarity?: Rarity): string[] {
  const rank = revealIntensity(rarity)
  const frames: string[] = []

  // 1. Shuffle — always at least two beats so it reads as motion, not a freeze.
  frames.push(`${lead} ·`)
  frames.push(`${lead} · ·`)

  // 2. Sparkle widen — the field grows one ✨ wider per rarity rank (so a rarer
  //    drop is visibly BRIGHTER). common adds one spark; shiny adds six.
  for (let w = 0; w <= rank; w++) {
    const sparkles = '✨'.repeat(w + 1)
    frames.push(`${sparkles} ${lead} ${sparkles}`)
  }

  // 3. Held beat / near-miss tease — only for rare+ (rank ≥ 2), and the hold
  //    LENGTHENS with the tier: the rarer the drop, the longer it teeters on the
  //    edge before the name lands. The "✦" pulse is the near-miss tell.
  const holdBeats = Math.max(0, rank - 1)
  for (let b = 0; b < holdBeats; b++) {
    // Alternate a dim and a bright hold so the beat visibly pulses.
    frames.push(b % 2 === 0 ? '·  ✦  ·' : ' ✦ ✨ ✦ ')
  }

  return frames
}

// ---------------------------------------------------------------------------
// renderEnhanceFrames
// ---------------------------------------------------------------------------

/**
 * Escalating dice/anvil suspense frames for an enhance reveal. Pass the salient
 * RARITY (the gear's rarity) so a rarer piece earns a longer, brighter build;
 * omit it for a neutral default. Cycle each frame on the 120ms stepper, then
 * print the result. Pure: standalone strings, no I/O.
 */
export function renderEnhanceFrames(rarity?: Rarity): string[] {
  return buildRevealFrames('🎲', rarity)
}

// ---------------------------------------------------------------------------
// renderPullFrames — pack-opening suspense for `sq pull`
// ---------------------------------------------------------------------------

/**
 * Escalating pack-opening suspense frames for a `sq pull` reveal (the 🃏 motif).
 * Pass the salient RARITY so a rarer pull builds longer/brighter with a held
 * near-miss beat before the card lands; omit it for a neutral default. Cycle on
 * the 120ms stepper, then print the drop. Pure: standalone strings, no I/O.
 */
export function renderPullFrames(rarity?: Rarity): string[] {
  return buildRevealFrames('🃏', rarity)
}

/**
 * share.ts — opt-in shareable card + README badge renderer (M6 social, ADR-0011).
 *
 * PURE: no I/O, no filesystem, no wall-clock. Returns plain strings.
 * Privacy-safe: never emits repo/cwd/cost — only cosmetic game stats.
 * Tone: terse, emoji OK, no deny-list phrases (ADR-0009 / docs/TONE.md).
 * Identity/achievement-driven, not competitive (ADR-0011 primary loop).
 */

import type { GameState } from '../core/state'
import type { Rarity } from '../core/rewards'
import { ALL_CARD_DEFS } from '../core/cards'
import { prestigeRank } from '../engine/reduce'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const TOTAL_CARDS = ALL_CARD_DEFS.length

/** Unique card ids owned (deduped — only distinct ids count for collection %). */
function uniqueOwnedCount(state: GameState): number {
  return new Set(state.cards.map((c) => c.id)).size
}

/** Collection % as an integer (0..100). */
function collectionPct(owned: number): number {
  return Math.round((owned / TOTAL_CARDS) * 100)
}

/** One-line flex copy that varies by context. Never includes em-dash or deny-list copy. */
function flexLine(state: GameState, recentRarity?: Rarity): string {
  if (recentRarity === 'shiny') return '✦ shiny drop'
  if (recentRarity === 'legendary') return '✦ legendary drop'
  if (recentRarity === 'epic') return '🃏 epic drop'

  const rank = prestigeRank(state)
  if (rank > 0) return `✦ Prestige ×${rank}`

  const pct = collectionPct(uniqueOwnedCount(state))
  if (pct === 100) return '🏆 collection complete'
  if (pct >= 75) return `📦 ${pct}% collected`

  const lvl = state.player.level
  if (lvl >= 10) return `⚡ Lv${lvl} grinder`
  return `🌿 Lv${lvl} in the groove`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ShareCardOptions {
  /** Most recently obtained card rarity, used to boost the flex line. */
  recentRarity?: Rarity
}

/**
 * Render a terse, copy-pasteable share card (ASCII/markdown) celebrating
 * a Grove milestone.
 *
 * Layout:
 *   Grove · Lv<N>
 *   📦 <owned>/<total> cards (<pct>%)
 *   [prestige line — if rank > 0]
 *   <flex line>
 *
 * Privacy-safe: contains ONLY cosmetic game stats (level, collection count,
 * prestige rank). Never emits repo path, cwd, token counts, or cost.
 *
 * @param state - Current game state (read-only).
 * @param opts  - Optional context (recentRarity boosts the flex line).
 */
export function renderShareCard(state: GameState, opts: ShareCardOptions = {}): string {
  const owned = uniqueOwnedCount(state)
  const pct = collectionPct(owned)
  const rank = prestigeRank(state)

  const lines: string[] = [
    `Grove · Lv${state.player.level}`,
    `📦 ${owned}/${TOTAL_CARDS} cards (${pct}%)`,
  ]

  if (rank > 0) {
    lines.push(`✦ Prestige ×${rank}`)
  }

  lines.push(flexLine(state, opts.recentRarity))

  return lines.join('\n')
}

/**
 * Render a markdown badge line the user can paste into a README as passive
 * opt-in advertising.
 *
 * Example output:
 *   ![Grove](https://img.shields.io/badge/grove-Lv5-green)
 *
 * Privacy-safe: badge encodes only the cosmetic level number.
 *
 * @param state - Current game state (read-only).
 */
export function renderReadmeBadge(state: GameState): string {
  const lvl = state.player.level
  return `![Grove](https://img.shields.io/badge/grove-Lv${lvl}-green)`
}

import type { PlayerState } from '../core/state'

/**
 * Per-level XP ceiling (P1 pacing knob). Published/inspectable (ADR-0002); a
 * cosmetic pacing constant only (ADR-0005) — read by NO crit/seed/scale selector,
 * only by xpForLevel(). Lowered 2000→1200 so reaching L20 is ≈ 210 modeled days
 * (a real but not punitive horizon) instead of ~300, leaving every sub-L9 beat
 * untouched (the cap only bites once raw 50*level^1.5 exceeds it, at L9+).
 * MIRROR: src/web/page.ts inlines this literal — keep them in lockstep.
 */
export const MAX_XP_PER_LEVEL = 1200

/**
 * Returns the XP required to advance FROM `level` TO `level + 1`.
 * Formula: min(MAX_XP_PER_LEVEL, round(50 * max(1, level)^1.5))
 */
export function xpForLevel(level: number): number {
  return Math.min(MAX_XP_PER_LEVEL, Math.round(50 * Math.pow(Math.max(1, level), 1.5)))
}

/**
 * Seeds granted per level-up. R5 leveling P1: a level-up now FEEDS the economy
 * (was display-only). Cosmetic currency only (ADR-0005); modest by design so
 * outcomes stay the dominant driver. Published / inspectable (ADR-0002).
 */
export const LEVELUP_SEED_BONUS = 15

/**
 * Total seed bonus for `levelUps` level-ups in a single grant. Linear and never
 * negative (a zero/negative count grants nothing). Pure.
 */
export function levelUpSeedBonus(levelUps: number): number {
  return Math.max(0, Math.floor(levelUps)) * LEVELUP_SEED_BONUS
}

/**
 * Applies `amount` XP to `player`, resolving any level-ups.
 * - amount <= 0: returns a clone of player with levelUps = 0 (never lose progress).
 * - Otherwise: adds amount to xp, then advances levels while xp >= xpForLevel(level).
 * Returns a NEW player object; never mutates the input.
 */
export function applyXp(
  player: PlayerState,
  amount: number,
): { player: PlayerState; levelUps: number } {
  if (amount <= 0) {
    return { player: { ...player }, levelUps: 0 }
  }

  let xp = player.xp + amount
  let level = player.level
  let levelUps = 0

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level)
    level++
    levelUps++
  }

  return {
    player: { ...player, xp, level },
    levelUps,
  }
}

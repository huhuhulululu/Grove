import type { PlayerState } from '../core/state'

/**
 * Returns the XP required to advance FROM `level` TO `level + 1`.
 * Formula: min(2000, round(50 * max(1, level)^1.5))
 */
export function xpForLevel(level: number): number {
  return Math.min(2000, Math.round(50 * Math.pow(Math.max(1, level), 1.5)))
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

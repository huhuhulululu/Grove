/**
 * commands/achievements.ts — `sq achievements` player-facing surface (ADR-0015 rev.2).
 *
 * DEFAULT: prints UNLOCKED achievements only (celebrate what you did).
 * --all:   also lists locked achievements (opt-in, never nagged).
 * --zen:   prints only a terse count (no list, no nag).
 *
 * STRUCTURAL anti-FOMO (ADR-0015):
 *  - No achievements line on the dashboard.
 *  - Locked list only under explicit --all.
 *  - --zen suppresses the list entirely.
 *  - No nagging, no "you could unlock X" prompts.
 *
 * Cosmetic only (ADR-0005). The engine's pure checkAchievements is the source
 * of truth; this handler is the IMPURE shell (I/O + state load).
 */

import { loadState } from '../../store/store'
import { renderAchievementsPanel } from '../../render/achievements'
import type { Locale } from '../../i18n/types'

/**
 * Handle `sq achievements [--all]`.
 *
 * @param flags   Parsed flag map from sq.ts.
 * @param dir     Grove state directory.
 * @param zen     --zen / GROVE_ZEN: suppresses the list to a terse count.
 * @param locale  Resolved locale.
 * @returns       Process exit code (0 = success).
 */
export function handleAchievements(
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
  locale: Locale = 'en',
): number {
  const showAll = flags['all'] === 'true'
  const state = loadState(dir)
  const output = renderAchievementsPanel(state, showAll, zen, locale)
  console.log(output)
  return 0
}

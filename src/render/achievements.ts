/**
 * render/achievements.ts — PURE achievements panel renderer (ADR-0015 rev.2).
 *
 * Renders the player's unlocked achievements, with an optional locked list
 * behind an explicit opt-in flag.
 *
 * ZEN suppression: callers pass isZen; this module returns a terse count string
 * under --zen, and the full list is suppressed (ADR-0015 structural anti-FOMO).
 *
 * DEFAULT surface: unlocked achievements only (celebrate what you did).
 * --all: also lists locked ones (opt-in, never nagged, never on the dashboard).
 *
 * PURE: no I/O, no wall-clock, no filesystem. Returns a string.
 */

import type { GameState } from '../core/state'
import { ACHIEVEMENTS } from '../core/achievements'
import type { Locale } from '../i18n/types'
import { t } from '../i18n/t'

/**
 * Render the achievements panel as a multi-line string.
 *
 * @param state    Current game state (read-only).
 * @param showAll  When true, also list locked achievements (opt-in).
 * @param isZen    When true, returns a terse count line only (calm mode).
 * @param locale   Translation locale (default 'en').
 * @returns        Multi-line string.
 */
export function renderAchievementsPanel(
  state: GameState,
  showAll: boolean,
  isZen: boolean,
  locale: Locale = 'en',
): string {
  const unlocked = new Set(state.achievements ?? [])
  const unlockedDefs = ACHIEVEMENTS.filter((a) => unlocked.has(a.id))
  const lockedDefs = ACHIEVEMENTS.filter((a) => !unlocked.has(a.id))

  // --zen: terse count only, no list, no nag (ADR-0015 structural anti-FOMO).
  if (isZen) {
    return t(locale, 'cli.achievements.zen_count', { n: unlockedDefs.length, total: ACHIEVEMENTS.length })
  }

  const lines: string[] = []
  lines.push(t(locale, 'ui.achievements.title'))

  if (unlockedDefs.length === 0) {
    lines.push(t(locale, 'ui.achievements.none'))
  } else {
    for (const a of unlockedDefs) {
      lines.push(t(locale, 'ui.achievements.unlocked_row', { name: a.name, desc: a.desc }))
    }
  }

  // Locked list is ONLY shown under --all (opt-in, never nagged by default).
  if (showAll && lockedDefs.length > 0) {
    lines.push(t(locale, 'ui.achievements.locked_header'))
    for (const a of lockedDefs) {
      lines.push(t(locale, 'ui.achievements.locked_row', { name: a.name, desc: a.desc }))
    }
  }

  return lines.join('\n')
}

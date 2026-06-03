/**
 * learn.ts — `sq learn [practice]` opt-in practice explainers (Pillar B education).
 *
 * Prints a terse one-line WHY a good engineering practice matters. Strictly opt-in:
 * it is NEVER auto-shown, NEVER nagged. A newcomer can pull the reasoning on demand;
 * a veteran simply never types it and loses nothing.
 *
 * PURE of clock/RNG/fs and of any state/ingest/reward path — it only reads the i18n
 * catalog and prints. Firewall-safe by construction (it rewards nothing).
 */

import type { Locale } from '../../i18n/types'
import { t } from '../../i18n/t'

/** The fixed catalog of recognized practices (also the print order). */
export const PRACTICES = [
  'conventional-commits',
  'test-first',
  'spec-first',
  'plan-first',
  'sync-docs',
  'keep-adrs',
  'small-changes',
  'write-grimoire',
] as const

/**
 * Handle `sq learn [practice]`.
 *  - no arg → a terse index (each practice + its one-line why).
 *  - known practice → just that practice's one-line why.
 *  - unknown → a terse stderr hint, exit 2.
 * `zen` is accepted for signature symmetry but does not branch output — this is
 * read-only info the user explicitly asked for (prints under --zen like `promise`).
 */
export function handleLearn(rest: string[], _zen: boolean, locale: Locale = 'en'): number {
  const which = rest[0]

  if (which === undefined) {
    console.log(t(locale, 'cli.learn.header'))
    for (const p of PRACTICES) {
      console.log(t(locale, 'cli.learn.row', { name: p, why: t(locale, `learn.${p}.why`) }))
    }
    return 0
  }

  if ((PRACTICES as readonly string[]).includes(which)) {
    console.log(t(locale, `learn.${which}.why`))
    return 0
  }

  console.error(t(locale, 'cli.learn.unknown', { practice: which }))
  return 2
}

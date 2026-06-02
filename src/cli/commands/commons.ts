/**
 * commons.ts — `sq commons` ATTENDED client (ADR-0013, read-only shell).
 *
 *   list        → list claimable commons issues (GET only).
 *   draft <N>   → print a read-only brief (the user's AI writes the patch).
 *   open  <N>   → print the exact fork + `gh pr create` the USER runs.
 *
 * Grove NEVER writes a patch, opens a PR, or runs contributor code. handleCommons
 * NEVER ingests an event — the merge reward flows ONLY through the normal
 * `sq event commons_contribution` / a chained commons merge-hook, on a real merge.
 */

import type { Locale } from '../../i18n/types'
import { t } from '../../i18n/t'
import { listCommonsIssues, commonsToken } from '../../adapters/commons-github'

/** Default commons task repo; override with --repo OWNER/REPO. */
const DEFAULT_REPO = 'grove-commons/tasks'

export async function handleCommons(
  rest: string[],
  flags: Record<string, string>,
  _dir: string,
  _zen: boolean,
  locale: Locale = 'en',
): Promise<number> {
  const action = rest[0]
  const repo = flags['repo'] ?? DEFAULT_REPO

  if (action === 'list') {
    const tasks = await listCommonsIssues(repo, commonsToken())
    if (tasks.length === 0) {
      console.log(t(locale, 'cli.commons.empty'))
      return 0
    }
    for (const task of tasks) {
      console.log(
        t(locale, 'cli.commons.row', {
          number: task.number,
          title: task.title,
          labels: task.labels.join(', '),
        }),
      )
    }
    return 0
  }

  if (action === 'draft' || action === 'open') {
    const n = Number(rest[1])
    if (!Number.isInteger(n) || n <= 0) {
      console.error(t(locale, 'cli.commons.usage'))
      return 2
    }
    // Read-only: a brief for the user's AI to fill in, then the exact command the
    // USER runs to open the PR under their own identity. Grove writes/opens nothing.
    console.log(t(locale, 'cli.commons.brief', { number: n, title: `commons task #${n}` }))
    console.log(t(locale, 'cli.commons.open_hint', { repo, number: n }))
    return 0
  }

  console.error(t(locale, 'cli.commons.usage'))
  return 2
}

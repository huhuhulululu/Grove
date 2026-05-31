/**
 * recap.ts — builds a RecapData snapshot from a list of events + GameState.
 *
 * Pure: no I/O, no filesystem access. Accepts arrays and state, returns a RecapData.
 */

import type { GroveEvent } from '../core/events'
import type { GameState } from '../core/state'
import type { RecapData } from '../render/format'

export interface RecapOpts {
  /** Include only events with ts >= sinceTs (ISO-8601 string compare). */
  sinceTs?: string
  /** Human-facing label for the time window. Defaults to 'session' when sinceTs
   *  is given, or 'all time' otherwise. */
  window?: string
}

/**
 * Build a RecapData view-model from a raw event list and current GameState.
 *
 * @param events   Full list of GroveEvents to consider.
 * @param state    The current GameState (level/cards/completedSets read from here).
 * @param opts     Optional filtering / labelling config.
 */
export function buildRecap(
  events: GroveEvent[],
  state: GameState,
  opts?: RecapOpts,
): RecapData {
  // ---- Filter ----------------------------------------------------------------
  const filtered =
    opts?.sinceTs !== undefined
      ? events.filter((e) => e.ts >= opts.sinceTs!)
      : events

  // ---- byType counts ---------------------------------------------------------
  const byType: Record<string, number> = {}
  for (const e of filtered) {
    byType[e.type] = (byType[e.type] ?? 0) + 1
  }

  // ---- Window label ----------------------------------------------------------
  const window =
    opts?.window !== undefined
      ? opts.window
      : opts?.sinceTs !== undefined
        ? 'session'
        : 'all time'

  // ---- Highlights ------------------------------------------------------------
  const highlights: string[] = []

  const testRuns = byType['test_result'] ?? 0
  if (testRuns > 0) {
    highlights.push(`${testRuns} tests green`)
  }

  const merges = byType['pr_merged'] ?? 0
  if (merges > 0) {
    highlights.push(`${merges} PR${merges === 1 ? '' : 's'} merged`)
  }

  const docs = byType['doc_updated'] ?? 0
  if (docs > 0) {
    highlights.push(`${docs} docs updated`)
  }

  const specs = byType['spec_written'] ?? 0
  if (specs > 0) {
    highlights.push(`${specs} spec${specs === 1 ? '' : 's'} written`)
  }

  const plans = byType['plan_written'] ?? 0
  if (plans > 0) {
    highlights.push(`${plans} plan${plans === 1 ? '' : 's'} set`)
  }

  // ---- Assemble --------------------------------------------------------------
  return {
    window,
    total: filtered.length,
    byType,
    level: state.player.level,
    cards: state.cards.length,
    completedSets: state.completedSets,
    highlights,
  }
}

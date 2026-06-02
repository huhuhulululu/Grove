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
  /** Injected wall-clock (ms) so recap stays PURE; when present, enables the
   *  read-only 7-day outcome sparkline (weekSparkValues). */
  nowEpoch?: number
}

/** Event types that are NOT outcomes — raw activity / lifecycle / ambient. Counting
 *  these would reward activity, which Grove never does (ADR: reward outcomes only). */
const NON_OUTCOME_TYPES = new Set<string>([
  'quota_update',
  'session_start',
  'session_end',
  'file_edit',
])

/**
 * Count successful OUTCOME events per UTC day over the last 7 days (index 0 = 6 days
 * ago … index 6 = today), derived purely from each event's ts and the injected
 * nowEpoch. Excludes success:false events (a failed test must not inflate the bar)
 * and non-outcome activity. Pure.
 */
function dailyOutcomeCounts(events: GroveEvent[], nowEpoch: number): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  const dayMs = 86_400_000
  const todayStart = Math.floor(nowEpoch / dayMs) * dayMs
  for (const e of events) {
    if (e.success === false) continue
    if (NON_OUTCOME_TYPES.has(e.type)) continue
    const t = Date.parse(e.ts)
    if (Number.isNaN(t)) continue
    const eventDayStart = Math.floor(t / dayMs) * dayMs
    const daysAgo = Math.round((todayStart - eventDayStart) / dayMs)
    if (daysAgo >= 0 && daysAgo <= 6) {
      const idx = 6 - daysAgo
      counts[idx] = (counts[idx] ?? 0) + 1
    }
  }
  return counts
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

  // ---- 7-day outcome sparkline (only when a clock is injected — keeps clock-free
  //      callers byte-identical). Derived from `filtered` so it respects --since. ---
  const weekSparkValues =
    opts?.nowEpoch !== undefined ? dailyOutcomeCounts(filtered, opts.nowEpoch) : undefined

  // ---- Assemble --------------------------------------------------------------
  return {
    window,
    total: filtered.length,
    byType,
    level: state.player.level,
    cards: state.cards.length,
    completedSets: state.completedSets,
    highlights,
    ...(weekSparkValues !== undefined ? { weekSparkValues } : {}),
  }
}

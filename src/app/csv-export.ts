/**
 * csv-export.ts — serialize the normalized event timeline to RFC-4180 CSV.
 *
 * PURE: takes a GroveEvent[] and returns a CSV string — no fs/process/clock/random,
 * no GameState, no reduce(). The columns are the EVENT-NATIVE persisted fields only
 * (ts/type/source/magnitude/success/sessionId/cwd/repo). Computed game numbers
 * (level/xp/seeds/rarity) are derived in reduce() and are NOT in the event log, so
 * they are intentionally absent — own-your-data export of OUTCOMES, never a new
 * activity metric (ADR-0005 firewall; ADR-0001 tool-agnostic normalized schema).
 *
 * The user owns the output: `sq recap --csv > timeline.csv` then open it anywhere.
 */

import type { GroveEvent } from '../core/events'

const HEADER = 'timestamp,event_type,source,magnitude,success,session_id,cwd,repo'

/** RFC-4180: quote a field iff it contains a comma, double-quote, CR, or LF; double any internal quote. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Serialize events to CSV (header + one row per event, in event-log order).
 * Caller does any time-window filtering BEFORE calling this (kept a pure serializer).
 */
export function eventsToCsv(events: GroveEvent[]): string {
  const rows = events.map((e) =>
    [
      e.ts,
      e.type,
      e.source,
      String(e.magnitude),
      String(e.success),
      e.sessionId,
      e.cwd ?? '',
      e.repo ?? '',
    ]
      .map(csvCell)
      .join(','),
  )
  return [HEADER, ...rows].join('\n')
}

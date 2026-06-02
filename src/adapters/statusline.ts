/**
 * statusline.ts — pure-ish adapter for Claude Code's statusline JSON payload.
 *
 * Parses the JSON object that Claude Code pipes via the statusline mechanism
 * (shape: { rate_limits?, cost?, model?, session_id? }) and emits exactly one
 * normalized `quota_update` GroveEvent carrying the anti-burnout energy data.
 *
 * PURITY CONTRACT (ADR-0005):
 *  - No filesystem access, no wall-clock calls (Date.now / new Date()).
 *  - May import node:* for types only.
 *  - All parsing decisions are pure functions of the input arguments.
 *
 * FRAMING (ADR-0008 / anti-text-fatigue):
 *  - Absent rate_limits  → meta.present:false (Wellspring; UI hides the bar).
 *  - Present rate_limits → meta.present:true  with REMAINING energy fields.
 *  - resets_at may arrive as Unix seconds (number) OR ISO-8601 (string);
 *    both are normalised to epoch MILLISECONDS (number).
 */

import type { GroveEvent } from '../core/events'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParseStatuslineResult {
  /** Always exactly one quota_update event. */
  events: GroveEvent[]
  /** Informational notes from parsing (e.g. warnings). May be empty. */
  notes: string[]
}

export interface ParseStatuslineOpts {
  /** Fallback sessionId when payload.session_id is absent. */
  sessionId?: string
}

// ---------------------------------------------------------------------------
// Internal helpers — pure
// ---------------------------------------------------------------------------

/**
 * Normalise a `resets_at` value to epoch MILLISECONDS (number).
 *
 *  - number  : Claude Code emits Unix seconds (~1.7e9). Multiply by 1000 to get ms.
 *              Values already > 1e12 are treated as ms and passed through unchanged.
 *  - string  : parse as ISO-8601 and return Date.parse() directly (already ms).
 *  - anything else → undefined.
 */
function normaliseResetsAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Guard: if already in ms range (> 1e12), pass through; otherwise scale seconds→ms.
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms)) {
      return ms
    }
  }
  return undefined
}

/** Safely coerce `used_percentage` to a FINITE number, else undefined (no fabrication). */
function extractPct(win: Record<string, unknown>): number | undefined {
  const v = win['used_percentage']
  // Mirror the isFinite guard of the two sibling extractors: a JSON-valid overflow
  // (1e400 -> Infinity) must not pass through and yield a silently-wrong 0%/100%.
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Read a finite number at `obj[key]`, else undefined (no fabrication). */
function extractNumber(obj: Record<string, unknown> | null, key: string): number | undefined {
  if (obj === null) return undefined
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// ---------------------------------------------------------------------------
// parseStatuslinePayload
// ---------------------------------------------------------------------------

/**
 * Parse a Claude Code statusline JSON payload and return a list of GroveEvents
 * plus informational notes.
 *
 * Always emits exactly ONE `quota_update` event. The event's `meta` carries:
 *
 *  - Wellspring (no / unmetered quota):
 *      `{ present: false }`
 *
 *  - Metered (rate_limits present with at least one window):
 *      `{ present: true, fiveHourPct?, fiveHourResetsAt?, sevenDayPct?, sevenDayResetsAt? }`
 *    Only fields that exist in the payload are set; absent windows → undefined.
 */
export function parseStatuslinePayload(
  payload: unknown,
  opts: ParseStatuslineOpts = {},
): ParseStatuslineResult {
  const notes: string[] = []

  // Resolve sessionId: payload.session_id > opts.sessionId > 'statusline'
  const sessionId: string =
    (isRecord(payload) && typeof payload['session_id'] === 'string' && payload['session_id'])
      ? (payload['session_id'] as string)
      : (opts.sessionId ?? 'statusline')

  // Stable placeholder timestamp (pure: no wall-clock).
  // The engine uses this only for ordering; renderers may substitute a real wall-
  // clock ts at the impure shell layer (src/cli / src/adapters that call this fn).
  const ts = 'statusline'

  // Detect rate_limits and extract windows.
  const rateLimits =
    isRecord(payload) && isRecord(payload['rate_limits'])
      ? (payload['rate_limits'] as Record<string, unknown>)
      : null

  const fiveHourRaw =
    rateLimits !== null && isRecord(rateLimits['five_hour'])
      ? (rateLimits['five_hour'] as Record<string, unknown>)
      : null

  const sevenDayRaw =
    rateLimits !== null && isRecord(rateLimits['seven_day'])
      ? (rateLimits['seven_day'] as Record<string, unknown>)
      : null

  // Token-milestone floor (ADR-0010): pull REAL cost/token consumption from the
  // payload. These are independent of rate_limits — present for API/Wellspring
  // users too — so the floor pays out for everyone.
  const costRaw =
    isRecord(payload) && isRecord(payload['cost'])
      ? (payload['cost'] as Record<string, unknown>)
      : null
  const ctxRaw =
    isRecord(payload) && isRecord(payload['context_window'])
      ? (payload['context_window'] as Record<string, unknown>)
      : null

  const costUsd = extractNumber(costRaw, 'total_cost_usd')
  const outputTokens = extractNumber(ctxRaw, 'output_tokens')

  // Wellspring: no rate_limits OR both windows missing.
  const present = fiveHourRaw !== null || sevenDayRaw !== null

  let meta: Record<string, unknown>

  if (!present) {
    meta = { present: false }
  } else {
    meta = { present: true }

    if (fiveHourRaw !== null) {
      const pct = extractPct(fiveHourRaw)
      if (pct !== undefined) {
        meta['fiveHourPct'] = pct
      }
      const resetsAt = normaliseResetsAt(fiveHourRaw['resets_at'])
      if (resetsAt !== undefined) {
        meta['fiveHourResetsAt'] = resetsAt
      }
    }

    if (sevenDayRaw !== null) {
      const pct = extractPct(sevenDayRaw)
      if (pct !== undefined) {
        meta['sevenDayPct'] = pct
      }
      const resetsAt = normaliseResetsAt(sevenDayRaw['resets_at'])
      if (resetsAt !== undefined) {
        meta['sevenDayResetsAt'] = resetsAt
      }
    }
  }

  // Carry cost/tokens regardless of present (the token floor uses them either way).
  if (costUsd !== undefined) {
    meta['costUsd'] = costUsd
  }
  if (outputTokens !== undefined) {
    meta['outputTokens'] = outputTokens
  }

  const event: GroveEvent = {
    source: 'statusline',
    sessionId,
    type: 'quota_update',
    magnitude: 1,
    success: true,
    ts,
    meta,
  }

  return { events: [event], notes }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

import { z } from 'zod'

// The closed event vocabulary. Adapters normalize every tool-specific signal into one of these.
// Pillar A (fatigue relief): session_*, commit, test_result, build_result, pr_merged, commons_contribution, lint_clean, checkpoint.
// Pillar B (good habits): doc_updated, spec_written, plan_written, file_presence, review_confirmed.
export const EVENT_TYPES = [
  'session_start',
  'session_end',
  'commit',
  'test_result',
  'test_added',
  'build_result',
  'pr_merged',
  // A merged commons PR (ADR-0013) — a publicly-verifiable merge OUTCOME, paid like
  // pr_merged. Emitted by a chained commons merge-hook / `sq event` only on merge.
  'commons_contribution',
  'lint_clean',
  'file_edit',
  'doc_updated',
  'spec_written',
  'plan_written',
  'checkpoint',
  'file_presence',
  'review_confirmed',
  // Ambient: Claude Code usage-quota signal (5h/7d rate limits). Carries quota
  // data in `meta`; drives the anti-burnout Vigor/Sap energy system. Never an
  // "outcome" — purely informational, so it grants no xp/cards (ADR-0005).
  'quota_update',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** The single normalized event the engine consumes. Tool-agnostic by construction (ADR-0001). */
export const GroveEvent = z.object({
  /** which adapter produced this: 'git' | 'sq-wrap' | 'claude-code' | 'codex' | ... */
  source: z.string().min(1),
  sessionId: z.string().min(1),
  cwd: z.string().optional(),
  repo: z.string().optional(),
  type: z.enum(EVENT_TYPES),
  /** 1-10 importance; drives XP/drop weighting without tool-specific logic */
  magnitude: z.number().int().min(1).max(10).default(1),
  success: z.boolean().default(true),
  /** ISO-8601 timestamp */
  ts: z.string().min(1),
  meta: z.record(z.unknown()).default({}),
})

export type GroveEvent = z.infer<typeof GroveEvent>

/** Parse + validate unknown input into a GroveEvent (throws on invalid). */
export function parseEvent(input: unknown): GroveEvent {
  return GroveEvent.parse(input)
}

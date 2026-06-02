/**
 * try.ts — `sq try` (alias `demo`): a zero-state taste of the loot loop.
 *
 * FIREWALL (ADR-0005): the demo runs a few canned OUTCOME events through the REAL
 * engine into a THROWAWAY scratch dir created under os.tmpdir(), which is deleted on
 * exit. The user's real Grove state and repo are NEVER touched — the scratch path is
 * passed straight to ingestEvent as the state dir; stateDir() / groveHome() are never
 * called here, so nothing under the real GROVE_HOME is read or written. Read-only w.r.t.
 * everything real; never auto-runs tests or git (ADR-0003).
 */
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { ingestEvent } from '../../app/ingest'
import { printRewards, calmConfirm } from './shared'
import { t } from '../../i18n/t'
import type { Locale } from '../../i18n/types'
import type { GroveEvent } from '../../core/events'
import type { Reward } from '../../core/rewards'

/** Canned outcome event types for the demo — a small, satisfying taste of the loop. */
const DEMO_EVENT_TYPES: GroveEvent['type'][] = ['commit', 'test_result', 'pr_merged']

export function handleTry(zen: boolean, locale: Locale = 'en'): number {
  // A throwaway home under the system temp dir — NOT the real GROVE_HOME. Both the
  // per-repo state and the account-global file (a sibling _global dir) land inside it.
  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-try-'))
  const dir = path.join(scratchHome, 'repo')
  try {
    fs.mkdirSync(dir, { recursive: true })

    const rewards: Reward[] = []
    DEMO_EVENT_TYPES.forEach((type, i) => {
      const event: GroveEvent = {
        source: 'sq-try',
        sessionId: 'demo',
        type,
        magnitude: 1,
        success: true,
        ts: new Date().toISOString(),
        meta: {},
      }
      try {
        // Fixed per-event seed → deterministic demo loot (independent of the clock).
        rewards.push(...ingestEvent(dir, event, 1000 + i).rewards)
      } catch {
        /* the demo is best-effort — a single event hiccup never aborts it */
      }
    })

    if (zen) {
      calmConfirm(t(locale, 'cli.try.zen_done'), locale)
      return 0
    }

    console.log(t(locale, 'cli.try.intro'))
    printRewards(rewards, locale)
    console.log(t(locale, 'cli.try.cta'))
    return 0
  } finally {
    // Always remove the scratch home — the demo leaves zero trace.
    fs.rmSync(scratchHome, { recursive: true, force: true })
  }
}

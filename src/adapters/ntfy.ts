/**
 * ntfy.ts — opt-in mobile push notifications via ntfy.sh (M5).
 *
 * Three exports:
 *  - pushWorthy(rewards)  PURE: decides if a reward batch is big enough to push
 *                         and builds a terse phone notification. Returns null for
 *                         routine batches (never spam).
 *  - ntfyTopic()          reads opt-in topic from GROVE_NTFY_TOPIC env var; null = disabled.
 *  - sendNtfy(topic, n)   fire-and-forget POST to https://ntfy.sh/<topic>. Never throws.
 *
 * ETHICS (ADR-0005 / ADR-0011):
 *  - Opt-in ONLY (GROVE_NTFY_TOPIC must be set).
 *  - Title/message carry only cosmetic game events — NEVER code, cwd, cost, or paths.
 *  - Celebratory, not competitive. No shame, no FOMO.
 */

import * as https from 'node:https'
import type { Reward } from '../core/rewards'
import { groveHome } from '../store/paths'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NtfyNotification {
  title: string
  message: string
  tags: string[]
}

// ---------------------------------------------------------------------------
// pushWorthy — PURE
// ---------------------------------------------------------------------------

/**
 * Decides if a reward batch is significant enough to send a phone notification.
 *
 * Big enough:
 *  - legendary or shiny card drop
 *  - level-up
 *  - milestone chest (currency reward whose message includes "chest" or "milestone")
 *  - quest complete (buff reward whose message includes "quest")
 *  - set complete (reward whose message includes "set complete")
 *
 * Returns null for routine batches (common/uncommon/rare cards, plain XP, etc.).
 * Never includes code, cwd, or cost data in title/message.
 */
export function pushWorthy(rewards: Reward[]): NtfyNotification | null {
  if (rewards.length === 0) return null

  for (const r of rewards) {
    // Legendary or shiny card
    if (r.kind === 'card' && (r.rarity === 'legendary' || r.rarity === 'shiny')) {
      const rarity = r.rarity === 'shiny' ? 'shiny ✨' : 'legendary'
      const name = r.card?.name ?? 'rare card'
      return {
        title: `Grove · ${rarity} drop`,
        message: `🃏 ${name} · ${r.rarity}`,
        tags: ['tada', 'sparkles'],
      }
    }

    // Level-up
    if (r.kind === 'levelup') {
      const lvl = r.amount ?? '?'
      return {
        title: `Grove · Level ${lvl} 🆙`,
        message: `Level ${lvl} reached`,
        tags: ['arrow_up', 'trophy'],
      }
    }

    // Milestone chest
    if (
      r.kind === 'currency' &&
      (r.message.toLowerCase().includes('chest') || r.message.toLowerCase().includes('milestone'))
    ) {
      return {
        title: 'Grove · milestone chest 📦',
        message: r.message,
        tags: ['package', 'tada'],
      }
    }

    // Quest complete
    if (r.kind === 'buff' && r.message.toLowerCase().includes('quest')) {
      return {
        title: 'Grove · quest complete ✅',
        message: r.message,
        tags: ['white_check_mark'],
      }
    }

    // Set complete
    if (r.message.toLowerCase().includes('set complete')) {
      return {
        title: 'Grove · set complete 🏆',
        message: r.message,
        tags: ['trophy', 'tada'],
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// ntfyTopic — reads opt-in topic (impure: reads env + maybe config file)
// ---------------------------------------------------------------------------

/**
 * Returns the ntfy.sh topic to push to, or null if opt-in is not configured.
 *
 * Resolution order:
 *  1. GROVE_NTFY_TOPIC env var (non-empty string → use it)
 *  2. <groveHome>/ntfy-topic file (first non-empty line)
 *  3. null (disabled by default)
 */
export function ntfyTopic(): string | null {
  const envVal = process.env['GROVE_NTFY_TOPIC']
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal
  }

  // Fallback: config file under groveHome
  try {
    const configPath = path.join(groveHome(), 'ntfy-topic')
    const raw = fs.readFileSync(configPath, 'utf8').trim()
    if (raw.length > 0) return raw
  } catch {
    // Not present — disabled
  }

  return null
}

// ---------------------------------------------------------------------------
// sendNtfy — fire-and-forget POST (impure; never throws, never blocks)
// ---------------------------------------------------------------------------

/**
 * POSTs a notification to https://ntfy.sh/<topic>.
 *
 * Fire-and-forget: errors are silently swallowed. The caller must NOT await
 * any result. Never throws — network failures, DNS errors, timeouts are all
 * ignored so the main coding workflow is never disrupted.
 *
 * Privacy (ADR-0011): only the cosmetic game event (title, message, tags) is
 * transmitted. Code, cwd, cost, and user identity are never included.
 */
export function sendNtfy(topic: string, n: NtfyNotification): void {
  const body = JSON.stringify({
    topic,
    title: n.title,
    message: n.message,
    tags: n.tags,
  })

  try {
    const req = https.request(
      `https://ntfy.sh/${encodeURIComponent(topic)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
    )

    req.on('error', () => {
      // Silently ignore — fire-and-forget, never disrupt the workflow
    })

    req.write(body)
    req.end()
  } catch {
    // Silently ignore any synchronous errors (e.g. invalid URL)
  }
}

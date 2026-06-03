/**
 * commands/view.ts · read/show + event-ingest handlers — event, status, recap,
 * scan, quests, dashboard, and the async tui / serve surfaces.
 *
 * Impure shell (ADR-0005): reads persisted state, ingests events via the pure
 * engine (app/ingest), and renders. No game logic re-implemented here.
 */

import { loadState, readEvents } from '../../store/store'
import { ingestEvent } from '../../app/ingest'
import { buildRecap } from '../../app/recap'
import { formatReward, formatStatus, formatRecap, formatQuests } from '../../render/format'
import { EVENT_TYPES } from '../../core/events'
import type { GroveEvent } from '../../core/events'
import { scanRepo } from '../../detect/pillarb'
import { QUESTS } from '../../core/quests'
// runTui and startWebServer are intentionally NOT statically imported.
// They pull in Ink/React and the web server stack, which are heavy. Since
// these are only needed for the `tui` and `serve` subcommands (never on the
// hot path), they are loaded lazily via dynamic import() inside each handler.
import { renderDashboard } from '../../render/dashboard'
import { stateDir } from '../../store/paths'
import type { Locale } from '../../i18n/types'
import { t } from '../../i18n/t'
import { resolveLocale } from '../../i18n/locale'
import {
  parsePositiveIntFlag,
  parseIntFlag,
  calmConfirm,
  printContextualOffers,
  maybePush,
  printRewards,
  isZen,
} from './shared'

export function handleEvent(
  positional: string[],
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
  locale: Locale = 'en',
): number {
  const type = positional[0]

  if (!type) {
    console.error('Error: event type is required. Run `sq help` for usage.')
    return 2
  }

  if (!(EVENT_TYPES as readonly string[]).includes(type)) {
    console.error(
      `Error: invalid event type "${type}". Valid types: ${EVENT_TYPES.join(', ')}`,
    )
    return 2
  }

  // Guard NaN: a non-numeric / empty --magnitude (e.g. `--magnitude abc`, `--magnitude=`)
  // would poison every downstream reward calc with NaN · default to 1 instead. Also
  // clamp the UPPER bound to the GroveEvent schema's max (10) — symmetric with the
  // silent default-to-1, so `--magnitude 999` no longer dumps a raw ZodError.
  const magnitude = Math.min(10, parsePositiveIntFlag(flags['magnitude'], 1))
  const successFlag = flags['success']
  const success = successFlag !== 'false'
  const source = flags['source'] ?? 'cli'
  const sessionId = flags['session'] ?? 'cli'
  const ts = new Date().toISOString()

  const raw: Omit<GroveEvent, 'meta'> & { meta: Record<string, unknown> } = {
    source,
    sessionId,
    type: type as GroveEvent['type'],
    magnitude,
    success,
    ts,
    meta: {},
  }

  const { rewards } = ingestEvent(dir, raw)

  // Push-on-big-moment (opt-in, default OFF, fire-and-forget). Runs regardless of
  // zen · it is the user's own chosen async channel, not terminal spectacle.
  maybePush(rewards)

  if (zen) {
    // Calm: engine ran & persisted; suppress all loot/crit/offers · one quiet line.
    calmConfirm(
      success
        ? t(locale, 'cli.confirm.event_recorded', { type })
        : t(locale, 'cli.confirm.event_recorded_noreward', { type }),
      locale,
    )
    return 0
  }

  if (rewards.length === 0) {
    console.log(t(locale, 'cli.ingest.no_drop'))
  } else {
    printRewards(rewards, locale)
  }

  // Contextual offers
  printContextualOffers(rewards, dir, locale)

  return 0
}

export function handleStatus(dir: string, zen: boolean, locale: Locale = 'en'): number {
  const state = loadState(dir)
  if (zen) {
    // Quiet status: a single terse line, no banner/box spectacle.
    const { player, cards } = state
    calmConfirm(
      t(locale, 'cli.confirm.status_zen', { level: player.level, seeds: player.currency, cards: cards.length }),
      locale,
    )
    return 0
  }
  console.log(formatStatus(state, locale))
  return 0
}

export function handleRecap(flags: Record<string, string>, dir: string, locale: Locale = 'en'): number {
  const events = readEvents(dir)
  const state = loadState(dir)

  const sinceMode = flags['since'] ?? 'session'

  let sinceTs: string | undefined
  let windowLabel: string | undefined

  // Capture the clock ONCE so the week-boundary math and the sparkline nowEpoch can
  // never disagree (this is the only impure-clock seam in the recap path — the CLI
  // layer, not the pure engine).
  const now = Date.now()

  if (sinceMode === 'session') {
    // Find the ts of the last session_start event
    const sessionStarts = events.filter((e) => e.type === 'session_start')
    const lastSessionStart = sessionStarts[sessionStarts.length - 1]
    if (lastSessionStart !== undefined) {
      sinceTs = lastSessionStart.ts
    }
    // If no session_start found, sinceTs remains undefined → all events
  } else if (sinceMode === 'week') {
    // Events since UTC-midnight of the most recent Sunday — fixed to UTC Sunday-start
    // to match the existing UTC-day sparkline buckets (no timezone/locale boundary).
    const dayMs = 86_400_000
    const dayStart = Math.floor(now / dayMs) * dayMs
    const weekStart = dayStart - new Date(dayStart).getUTCDay() * dayMs
    sinceTs = new Date(weekStart).toISOString()
    windowLabel = t(locale, 'ui.recap.window.week')
  }
  // 'all' → sinceTs stays undefined

  // Inject the clock (mirrors handleDashboard) so buildRecap stays pure yet can derive
  // the read-only 7-day outcome sparkline.
  const recap = buildRecap(events, state, {
    ...(sinceTs !== undefined ? { sinceTs } : {}),
    ...(windowLabel !== undefined ? { window: windowLabel } : {}),
    nowEpoch: now,
  })
  console.log(formatRecap(recap, locale))
  return 0
}

export function handleScan(positional: string[], dir: string, zen: boolean, locale: Locale = 'en'): number {
  const repoDir = positional[0] ?? process.cwd()

  const { events, notes } = scanRepo(repoDir)

  // Tally counts for the summary
  const counts: Record<string, number> = {}

  let totalRewards = 0

  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1
    const { rewards } = ingestEvent(dir, event)
    totalRewards += rewards.length
    if (zen) continue // engine ran & persisted; suppress per-reward loot lines.
    if (rewards.length === 0) {
      console.log(t(locale, 'cli.scan.nothing_new'))
    } else {
      printRewards(rewards, locale)
    }
  }

  // Print notes (e.g. git not available)
  for (const note of notes) {
    console.log(t(locale, 'cli.scan.note', { note }))
  }

  // Summary
  const typeList = Object.entries(counts)
    .map(([tp, n]) => `${tp}:${n}`)
    .join(', ')
  const eventCount = events.length
  const detail = typeList ? ` (${typeList})` : ''
  if (zen) {
    // Calm: a single terse confirmation, no per-reward loot, no "reward(s)" tally spectacle.
    calmConfirm(t(locale, 'cli.scan.zen_summary', { n: eventCount, detail }), locale)
    return 0
  }
  console.log(t(locale, 'cli.scan.summary', { n: eventCount, detail, rewards: totalRewards }))

  return 0
}

export function handleQuests(dir: string, locale: Locale = 'en'): number {
  const state = loadState(dir)
  console.log(formatQuests(QUESTS, state, locale))
  // One quiet, opt-in discovery line — points at `sq learn` for the WHY behind a
  // practice. Never per-quest, never a "you haven't…"; a veteran can ignore it.
  console.log(t(locale, 'cli.quests.learn_tip'))
  return 0
}

export function handleDashboard(flags: Record<string, string>, dir: string, locale: Locale = 'en'): number {
  const noClear = flags['no-clear'] === 'true'

  if (!noClear) {
    process.stdout.write('\x1b[2J\x1b[H')
  }

  const state = loadState(dir)
  // Inject wall-clock epoch so energy ETAs render correctly (pure renderer).
  console.log(renderDashboard(state, { nowEpoch: Date.now(), locale }))
  return 0
}

// ---------------------------------------------------------------------------
// tui / serve handlers (async · the M3 TUI + M5 web renderers)
// ---------------------------------------------------------------------------

/**
 * `sq tui [--once]` · launch the navigable live Ink dashboard over the engine.
 * Delegates to the existing `runTui` renderer (NO game logic here):
 *  - `--once` renders ONE static frame string (deterministic, headless/CI-safe ·
 *    never mounts Ink raw-mode) and logs it.
 *  - otherwise mounts the live interactive <App>; resolves on the user's q/Ctrl-C.
 * Returns 0 (a TUI session has no failure exit code).
 */
export async function handleTui(flags: Record<string, string>, dir: string): Promise<number> {
  const once = flags['once'] === 'true'
  const zen = isZen(flags) // calm mode suppresses the loadout/achievements panels (ADR-0005)
  // Lazy: Ink/React is heavy and only needed for the `tui` subcommand.
  const { runTui } = await import('../../tui/app')
  const frame = await runTui(dir, { ...(once ? { once: true } : {}), zen })
  // In --once mode log the frame so CI / pipes can assert on it. The live path
  // already rendered to the terminal via Ink; its returned frame is redundant
  // there, so only print on the once path.
  if (once) console.log(frame)
  return 0
}

/**
 * `sq serve [--port N] [--host H]` · start the local READ-ONLY web dashboard via
 * the existing `startWebServer` (NO game logic here), print its URL, and keep the
 * process alive until Ctrl-C (live-updating an open page as state changes).
 *
 * `--no-wait` is the TEST/CI seam: it starts the server, prints the URL, then
 * IMMEDIATELY closes the handle and returns · so a test never blocks on a signal.
 */
export async function handleServe(flags: Record<string, string>, dir: string): Promise<number> {
  const port = flags['port'] !== undefined ? parseIntFlag(flags['port'], 0) : 0
  const host = flags['host']
  const noWait = flags['no-wait'] === 'true'

  // Lazy: the web server stack is only needed for `serve`.
  const { startWebServer } = await import('../../web/server')
  const server = startWebServer({
    dir,
    port,
    ...(host !== undefined ? { host } : {}),
  })

  const serveLocale: Locale = resolveLocale()
  console.log(t(serveLocale, 'cli.serve.banner_url', { url: server.url }))
  console.log(t(serveLocale, 'cli.serve.banner_hint'))

  if (noWait) {
    // Test/CI seam: don't block on a signal · tear the server down and return.
    server.close()
    return 0
  }

  // Keep the process alive until SIGINT/SIGTERM, then close cleanly.
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      server.close()
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}

/** Resolve the grove state dir for an async subcommand from its --home flag. */
export function resolveDir(flags: Record<string, string>): string {
  const home = flags['home']
  return home ? stateDir(home) : stateDir()
}

/**
 * `sq promise` · print Grove's hard ethics guarantees (ADR-0005) as a terse,
 * read-only block — the firewall made a first-class, runnable feature. No flags,
 * no state, no I/O beyond stdout; prints even under --zen (the user asked for it).
 */
export function handlePromise(locale: Locale = 'en'): number {
  console.log(t(locale, 'cli.promise.title'))
  console.log(t(locale, 'cli.promise.no_modify'))
  console.log(t(locale, 'cli.promise.no_autorun'))
  console.log(t(locale, 'cli.promise.chain_safe'))
  console.log(t(locale, 'cli.promise.cosmetic'))
  console.log(t(locale, 'cli.promise.calm'))
  return 0
}

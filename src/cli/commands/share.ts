/**
 * commands/share.ts · the social/signal handlers — `sq wrap` (the REAL
 * test/build signal source, ADR-0003), `sq share` (opt-in copy-pasteable card /
 * README badge), and `sq ntfy` (opt-in mobile push topic config).
 *
 * Impure shell (ADR-0005): spawns the wrapped command, reads its exit code, and
 * ingests an outcome through the pure engine. Privacy-minimal (ADR-0011): share /
 * push emit only cosmetic stats · NEVER code, cwd, or cost.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { groveHome } from '../../store/paths'
import { loadState } from '../../store/store'
import { ingestEvent } from '../../app/ingest'
import { ntfyTopic } from '../../adapters/ntfy'
import { renderShareCard, renderReadmeBadge } from '../../render/share'
import { printContextualOffers, maybePush, printRewards } from './shared'

// ---------------------------------------------------------------------------
// wrap · the REAL test/build signal source (ADR-0003).
// ---------------------------------------------------------------------------

/** Event types `sq wrap` can emit (a closed subset of the outcome vocabulary). */
type WrapEventType = 'test_result' | 'build_result' | 'lint_clean'

/**
 * The bare PROGRAM name from a wrapped argv (basename of argv[0]) — never the
 * arguments. ISOLATION (R-safety): the event log records WHICH tool ran (e.g.
 * `pytest`), not the full command line, so test-filter patterns / feature names
 * / internal flags (work content) never get persisted into the grove store.
 */
export function programName(argv: string[]): string {
  const first = argv[0] ?? ''
  return first === '' ? '' : path.basename(first)
}

/**
 * Infer the GroveEvent type from the wrapped command's argv. Looks at the first
 * token (the program name) and any sub-token for a 'test' / 'build' / 'lint'
 * hint (so `npm test`, `npm run build`, `cargo build`, `eslint`/`lint` all map
 * sensibly). Defaults to test_result · the most common signal. PURE.
 */
function inferWrapType(argv: string[]): WrapEventType {
  const haystack = argv.join(' ').toLowerCase()
  // Order matters: build/lint are more specific than the test default.
  if (/\bbuild\b/.test(haystack)) return 'build_result'
  if (/\blint\b/.test(haystack)) return 'lint_clean'
  if (/\btest\b/.test(haystack)) return 'test_result'
  return 'test_result'
}

/**
 * `sq wrap [--as <type>] -- <cmd...>` · run a command the user runs ANYWAY,
 * stream its output transparently (inherited stdio), read its EXIT CODE, and
 * ingest an outcome event with success=(exitCode===0). A FAILING command emits
 * success:false → the firewall mints NO reward (ADR-0005). Finally EXIT WITH THE
 * WRAPPED COMMAND'S EXIT CODE so `sq wrap` is a transparent passthrough wrapper
 * (it can sit in front of any test/build/lint command in a script or CI).
 *
 * This is what makes "tests green" a REAL signal (ADR-0003): the reward is gated
 * on the command actually running green, not minted on faith.
 *
 * @param command  The wrapped argv (everything after `--`).
 * @param asType   Optional explicit event type (overrides argv inference).
 * @param dir      The grove state dir.
 * @returns        The wrapped command's exit code (for transparent passthrough).
 */
export function handleWrap(command: string[], asType: string | undefined, dir: string, zen: boolean): number {
  if (command.length === 0) {
    console.error('Error: no command to wrap. Usage: sq wrap [--as <type>] -- <cmd...>')
    return 2
  }

  const program = command[0] as string
  const args = command.slice(1)

  // Run the command with INHERITED stdio so its output streams transparently to
  // the user's terminal · Grove is invisible to the wrapped command's I/O.
  const res = spawnSync(program, args, { stdio: 'inherit' })

  // Resolve the exit code. A signal kill (res.signal) or spawn error (res.error,
  // e.g. ENOENT) is reported as a non-zero code so the passthrough stays honest
  // and the ingested event is success:false.
  let exitCode: number
  if (res.error !== undefined && res.error !== null) {
    exitCode = 127 // command-not-found-ish; non-zero → success:false
  } else if (typeof res.status === 'number') {
    exitCode = res.status
  } else {
    exitCode = 1 // killed by signal / unknown → treat as failure
  }

  const type: WrapEventType =
    asType === 'test_result' || asType === 'build_result' || asType === 'lint_clean'
      ? asType
      : inferWrapType(command)

  // Ingest the outcome. success is gated on the REAL exit code (the whole point).
  try {
    const { rewards } = ingestEvent(dir, {
      source: 'sq-wrap',
      sessionId: 'sq-wrap',
      type,
      magnitude: 1,
      success: exitCode === 0,
      ts: new Date().toISOString(),
      // Record the program name only, never the full args (ISOLATION · see programName).
      meta: { cmd: programName(command), exitCode },
    })

    // Push-on-big-moment (opt-in, default OFF, fire-and-forget) · independent of zen.
    maybePush(rewards)

    if (!zen) {
      printRewards(rewards)
      printContextualOffers(rewards, dir)
    }
    // Calm: the engine ran on the real exit code & persisted; no loot line. The
    // wrapped command's own output already streamed transparently · stay quiet.
  } catch {
    // Never let a Grove failure change the wrapped command's outcome.
  }

  // Transparent passthrough: exit with the wrapped command's exact code.
  return exitCode
}

// ---------------------------------------------------------------------------
// share handler (M6 social, opt-in, ADR-0011) · user-invoked, copy-pasteable
// ---------------------------------------------------------------------------

/**
 * `sq share [--badge]` · print an opt-in, copy-pasteable share artifact built
 * from the PURE share renderer (no game logic here):
 *  - default → renderShareCard (level + collection %, a terse flex line)
 *  - --badge → renderReadmeBadge (a markdown shields.io badge for a README)
 *
 * Privacy-minimal (ADR-0011): the renderer emits only cosmetic stats · never
 * code, cwd, token counts, or cost. User-invoked, so it STILL prints under
 * --zen (zen strips spectacle from automatic output; an explicit `share` is the
 * thing the user asked for, not spectacle).
 */
export function handleShare(flags: Record<string, string>, dir: string): number {
  const state = loadState(dir)
  const badge = flags['badge'] === 'true'
  console.log(badge ? renderReadmeBadge(state) : renderShareCard(state))
  return 0
}

// ---------------------------------------------------------------------------
// ntfy handler (M5 push, opt-in, ADR-0011) · set/clear the global topic config
// ---------------------------------------------------------------------------

/**
 * Path to the opt-in ntfy topic config file. It lives under groveHome() (the
 * account-wide root) · one topic per machine, not per repo · which is exactly
 * where the adapter's `ntfyTopic()` reads it back. Honors GROVE_HOME, so tests
 * point both writer and reader at one isolated tree.
 */
function ntfyConfigPath(): string {
  return path.join(groveHome(), 'ntfy-topic')
}

/**
 * `sq ntfy <topic> | off` · opt into (or disable) mobile push.
 *
 *  - `<topic>` → persist the topic to <groveHome>/ntfy-topic so push is enabled.
 *  - `off`     → delete the config so push is OFF (the default).
 *  - (no arg)  → print the current state without changing anything.
 *
 * DEFAULT OFF: nothing is sent until the user runs this with a topic (ADR-0011).
 * Cosmetic-only, privacy-minimal · the topic is the only thing stored.
 */
export function handleNtfy(positional: string[], _dir: string): number {
  const arg = positional[0]
  const configPath = ntfyConfigPath()

  if (arg === undefined) {
    // Status only · persist nothing.
    const current = ntfyTopic()
    if (current === null) {
      console.log('  🔕 ntfy push is OFF · run `sq ntfy <topic>` to opt in.')
    } else {
      console.log(`  🔔 ntfy push ON · topic: ${current}`)
      console.log('  Run `sq ntfy off` to disable.')
    }
    return 0
  }

  if (arg.toLowerCase() === 'off') {
    try {
      fs.rmSync(configPath, { force: true })
    } catch {
      // Non-fatal · worst case it was already gone.
    }
    console.log('  🔕 ntfy push disabled.')
    return 0
  }

  // Set the topic. The topic is user-chosen and acts as a shared secret · keep
  // it as a single literal line; no interpolation into any shell context.
  try {
    fs.mkdirSync(groveHome(), { recursive: true })
    fs.writeFileSync(configPath, arg + '\n', 'utf8')
  } catch {
    console.error('  could not save the ntfy topic · check your GROVE_HOME permissions.')
    return 1
  }
  console.log(`  🔔 ntfy push ON · topic: ${arg}`)
  console.log('  Install the ntfy app and subscribe to that topic to get big-moment alerts.')
  console.log('  Big moments only (level-ups, legendaries, chests). Run `sq ntfy off` anytime.')
  return 0
}

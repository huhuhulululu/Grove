/**
 * sq.ts · Grove CLI entry point.
 *
 * Impure shell: may use process / console / wall-clock time (ADR-0005 firewall).
 * The engine's pure GameState updates flow through the existing `reduce` via
 * `ingestEvent`; no game logic is re-implemented here.
 *
 * Usage:
 *   sq [--home <DIR>] [--zen] <subcommand> [flags]
 *
 * --zen (or env GROVE_ZEN=1) is the calm mode (ADR-0005): the engine STILL runs
 * and records state, but the RENDER strips all spectacle · no loot/crit/
 * serendipity/milestone lines, no contextual offers, no drop reveals. Commands
 * print a plain, terse confirmation instead.
 *
 * Subcommands:
 *   event <type> [--magnitude N] [--success true|false] [--source S] [--session ID]
 *   status
 *   recap [--since session|all]
 *   help
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { spawnSync } from 'node:child_process'
import { shQuote } from '../adapters/shquote'
import { stateDir, groveHome } from '../store/paths'
import { ingestEvent } from '../app/ingest'
import { loadState, saveState, readEvents, withStateLock, rotateBackups } from '../store/store'
import { buildRecap } from '../app/recap'
import { formatReward, formatStatus, formatRecap, formatQuests } from '../render/format'
import { EVENT_TYPES } from '../core/events'
import type { GroveEvent } from '../core/events'
import { scanRepo } from '../detect/pillarb'
import { QUESTS } from '../core/quests'
import { installPostCommit, uninstallPostCommit } from '../adapters/githook'
import {
  enhance,
  repairGear,
  enhanceCost,
  repairCost,
  ENHANCE_COST_BASE,
  ENHANCE_COST_PER_LEVEL,
  REPAIR_COST_BASE,
  REPAIR_COST_PER_LEVEL,
} from '../engine/gear'
import {
  pull as enginePull,
  pullPremium,
  craftCard,
  buyPrestige,
  foilCard,
  PULL_COST,
  PREMIUM_PULL_COST,
  PRESTIGE_COST,
  FOIL_COST,
} from '../engine/reduce'
import { convertShards, SHARDS_PER_CRAFT, SHARD_TO_SEED } from '../engine/collection'
import { runTui } from '../tui/app'
import { startWebServer } from '../web/server'
import { renderDashboard } from '../render/dashboard'
import { renderEnhanceOdds, renderEnhanceResult, renderEnhanceFrames, renderPullFrames } from '../render/enhance'
import { mulberry32, hashStringToSeed } from '../core/rng'
import { parseStatuslinePayload } from '../adapters/statusline'
import { installStatusline, uninstallStatusline } from '../adapters/statusline-install'
import { stagedDiffStat, createStashSnapshot, currentBranch } from '../adapters/git-utils'
import { pushWorthy, ntfyTopic, sendNtfy } from '../adapters/ntfy'
import type { NtfyNotification } from '../adapters/ntfy'
import { renderShareCard, renderReadmeBadge } from '../render/share'
import type { Reward } from '../core/rewards'
import type { GameState } from '../core/state'

// ---------------------------------------------------------------------------
// Minimal argv parser
// ---------------------------------------------------------------------------

interface ParsedArgs {
  /** Any positional arguments (everything that isn't a flag or its value) */
  positional: string[]
  /** Named flags as a string→string map */
  flags: Record<string, string>
}

/**
 * Parse a flat argv array into positional args and named flags.
 * Supports both `--flag value` and `--flag=value` forms.
 *
 * Boolean flags (never consume the next token as a value, even when that token
 * does not start with `--`). This prevents `sq --zen wrap -- cmd` from
 * treating `wrap` as the value of `--zen`.
 */
// Flags that carry NO value (boolean-only). A flag in this set is set to
// 'true' unconditionally, never consuming the following positional token.
const BOOL_FLAGS = new Set(['zen', 'no-clear', 'premium', 'once', 'no-wait', 'badge'])

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}

  let i = 0
  while (i < argv.length) {
    const arg = argv[i] as string
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx !== -1) {
        // --flag=value
        const key = arg.slice(2, eqIdx)
        const value = arg.slice(eqIdx + 1)
        flags[key] = value
        i++
      } else {
        // --flag value (next item) · UNLESS the flag is a known boolean flag,
        // in which case it never has a value: --zen wrap means zen=true + wrap
        // is the positional subcommand, not zen=wrap.
        const key = arg.slice(2)
        const next = argv[i + 1]
        if (!BOOL_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
          flags[key] = next
          i += 2
        } else {
          // boolean flag with no value
          flags[key] = 'true'
          i++
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Single-char flag: -m value (only with a following non-flag value)
      const key = arg.slice(1)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i += 2
      } else {
        flags[key] = 'true'
        i++
      }
    } else {
      positional.push(arg)
      i++
    }
  }

  return { positional, flags }
}

/**
 * Parse a flag value as an integer, falling back to `fallback` when it is
 * absent, empty, or non-numeric (NaN). Prevents a bad `--magnitude abc` /
 * `--seed xyz` from poisoning downstream arithmetic with NaN.
 */
function parseIntFlag(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? fallback : n
}

/** Like parseIntFlag but clamps to a minimum of 1 (for magnitudes / counts). */
function parsePositiveIntFlag(value: string | undefined, fallback: number): number {
  const n = parseIntFlag(value, fallback)
  return n < 1 ? fallback : n
}

// ---------------------------------------------------------------------------
// Subcommand registry + "did you mean?" suggestion
// ---------------------------------------------------------------------------

/** Every top-level subcommand sq accepts (drives did-you-mean suggestions). */
const SUBCOMMANDS = [
  'event', 'status', 'recap', 'scan', 'quests', 'pull', 'enhance', 'repair',
  'protect', 'craft', 'foil', 'convert', 'prestige', 'dashboard', 'tui', 'serve',
  'statusline-ingest', 'statusline', 'init', 'uninstall', 'commit-hook',
  'suggest-commit', 'checkpoint', 'wrap', 'share', 'ntfy', 'help',
] as const

/** Classic Levenshtein edit distance (pure). */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  // Single rolling row keeps it O(n) memory.
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (curr[j - 1] as number) + 1, // insertion
        (prev[j] as number) + 1, // deletion
        (prev[j - 1] as number) + cost, // substitution
      )
    }
    prev = curr
  }
  return prev[n] as number
}

/**
 * Suggest the closest known subcommand for a mistyped token, or null when
 * nothing is close enough. Threshold scales with the input length so short
 * tokens need a tight match and long ones tolerate a typo or two · keeping a
 * far-off string ("zzzzzzzzzz") from matching anything.
 */
export function suggestSubcommand(input: string): string | null {
  if (input === '') return null
  let best: string | null = null
  let bestDist = Infinity
  for (const cmd of SUBCOMMANDS) {
    const d = editDistance(input, cmd)
    if (d < bestDist) {
      bestDist = d
      best = cmd
    }
  }
  // Accept only a genuinely-close match: at most ~40% of the longer length.
  const limit = Math.max(2, Math.floor(Math.max(input.length, (best ?? '').length) * 0.4))
  return best !== null && bestDist <= limit ? best : null
}

// ---------------------------------------------------------------------------
// AI-CLI detection (onboarding) · PATH probe, injectable for tests
// ---------------------------------------------------------------------------

/** Known AI-coding CLIs Grove can ride alongside (ADR-0001, tool-agnostic). */
const KNOWN_AI_CLIS = ['claude', 'cursor', 'aider', 'codex', 'copilot', 'gemini'] as const

export interface DetectAiOpts {
  /** Probe whether `bin` resolves on PATH. Defaults to a real PATH scan. */
  onPath?: (bin: string) => boolean
}

/** Return the subset of KNOWN_AI_CLIS resolvable on PATH (pure given onPath). */
export function detectAiClis(opts: DetectAiOpts = {}): string[] {
  const probe = opts.onPath ?? binOnPath
  return KNOWN_AI_CLIS.filter((bin) => probe(bin))
}

/**
 * True if an executable named `bin` is resolvable on PATH. Portable (honors
 * PATHEXT on Windows), side-effect-light (no spawn) · mirrors defaultSqOnPath.
 */
function binOnPath(bin: string): boolean {
  const PATH = process.env['PATH'] ?? ''
  if (PATH === '') return false
  const exts =
    process.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : ['']
  for (const d of PATH.split(path.delimiter)) {
    if (d === '') continue
    for (const ext of exts) {
      try {
        if (fs.statSync(path.join(d, `${bin}${ext}`)).isFile()) return true
      } catch {
        // not here · keep scanning
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Usage block
// ---------------------------------------------------------------------------

/**
 * Seed price to arm a one-shot enhance protection. (Enhance & repair prices are
 * now LEVEL-SCALING · see the engine's enhanceCost(level) / repairCost(gear),
 * which R6 wired in place of the old flat ENHANCE_COST/REPAIR_COST constants.)
 * Declared here (above USAGE_TEXT) so the help body can interpolate it. Exported
 * so the help-text cost-drift guard can treat it as a backing constant too.
 */
export const PROTECT_COST = 40

/**
 * The help body. INTERPOLATES the live engine cost constants (P2 anti-drift):
 * every cost number below is `${CONSTANT}`, never a hardcoded literal, so a
 * balance change in the engine flows straight into the help text and the
 * integrate cost-drift guard can never go stale. Exported so a test can assert
 * directly against it without re-rendering.
 */
export const USAGE_TEXT = `
Usage: sq [--home <DIR>] [--zen] <subcommand> [flags]

Global flags:
  --zen   Calm mode (or env GROVE_ZEN=1). The engine still records state, but
          output is plain & terse · NO loot/crit/serendipity/milestone lines,
          no contextual offers, no drop reveals. Just a quiet confirmation.

Subcommands:
  event <type> [--magnitude N] [--success true|false] [--source S] [--session ID]
      Ingest a Grove event. <type> must be one of:
          ${(EVENT_TYPES as readonly string[]).join(', ')}

  wrap [--as <type>] [--home DIR] -- <cmd...>
      Run a command you run anyway (tests / build / lint), stream its output
      transparently, and ingest a REAL outcome from its EXIT CODE (ADR-0003):
      a green command grants the reward; a FAILING one grants NOTHING (firewall).
      sq exits with the wrapped command's exact exit code (transparent passthrough),
      so it drops in front of any command in a script or CI.
      --as  Force the event type (test_result | build_result | lint_clean).
            Otherwise inferred from the command (test/build/lint), default test_result.
      e.g.  sq wrap -- npm test      sq wrap --as build_result -- make

  status
      Show current Grove game state.

  recap [--since session|all]
      Show a recap of events and progress.
      --since session  (default) · events since the last session_start
      --since all      · all events

  scan [path] [--home DIR]
      Scan a repo directory for Pillar-B signals (grimoire, tests, docs, specs).
      Defaults to process.cwd() if no path given. Ingests detected events and
      prints rewards; prints a summary of what was detected.

  quests [--home DIR]
      Show the Pillar-B quest board with status glyphs and active buffs.
      ✓ done  ◆ active  · not yet started

  pull [--premium] [--spark <cardId>] [--seed N] [--home DIR]
      Spend ${PULL_COST} 🌰 seeds for one gacha pull (the core decision · you choose WHEN).
      --premium  Spend ${PREMIUM_PULL_COST} 🌰 for a PREMIUM pull (better odds; the escalating sink).
      --spark    (with --premium) Choose a missing card to build a GUARANTEE toward ·
                 after enough premium misses the next premium pull is guaranteed to be it.
      Earn seeds by shipping outcomes (commits, green tests, merges, docs).
      Refuses calmly when you can't afford it. Cosmetic only (ADR-0005).

  craft [cardId] [--home DIR]
      Spend ${SHARDS_PER_CRAFT} shards to craft ONE chosen missing card (the dup-tail SINK · every
      duplicate pull banks rarity-scaled shards). With no id, crafts the first
      missing card in your unlocked sets. Refuses calmly when short on shards or
      nothing is left to craft. Cosmetic only (ADR-0005).

  foil [cardId] [--home DIR]
      Spend ${FOIL_COST} shards to cosmetically FOIL an OWNED card (a renewable polish · a
      completed collection still has a target). With no id, foils the first
      not-yet-foiled owned card. Refuses calmly when short on shards or nothing
      is left to foil. Cosmetic only, confers ZERO power (ADR-0005).

  convert [n] [--home DIR]
      Trade banked shards back into 🌰 seeds at ${SHARD_TO_SEED} 🌰 per shard (the dead-shard
      relief valve: once your collection is craftable-complete, surplus shards
      still have a horizon). With no count, converts ALL banked shards; with [n],
      exactly min(n, banked). Refuses calmly at zero shards. Cosmetic only (ADR-0005).

  prestige [--home DIR]
      Spend ${PRESTIGE_COST} 🌰 seeds to buy the next ENDGAME prestige rank · a permanent
      cosmetic flair at an escalating, recurring cost (the late-game seed sink: a
      finished collection always has a target). Refuses calmly when broke.
      Cosmetic-only, confers ZERO power (ADR-0005).

  enhance <ref> [--seed N] [--home DIR]
      Spend seeds to attempt to enhance a piece of cosmetic gear (risk + reward).
      Cost SCALES with the gear's level (${ENHANCE_COST_BASE} at +0, +${ENHANCE_COST_PER_LEVEL} per level), so chasing a
      high +N is a deepening sink. <ref> can be a gear id, a 1-based index, or 'first'.
      If the gear is PROTECTED (sq protect), a would-be break softens to a downgrade.
      Refuses calmly when you can't afford it. Cosmetic only · real code is NEVER affected (ADR-0005).

  repair <ref> [--home DIR]
      Spend seeds to un-break a cosmetic gear (its level is preserved). Cost SCALES
      with the gear's level (${REPAIR_COST_BASE} at +0, +${REPAIR_COST_PER_LEVEL} per level) · a broken +12 costs far more
      than a +1. <ref> can be a gear id, a 1-based index, or 'first'.
      Refuses calmly when you can't afford it. Cosmetic only (ADR-0005).

  protect <ref> [--home DIR]
      Spend ${PROTECT_COST} 🌰 seeds to arm a ONE-SHOT protection: the next enhance turns a
      would-be break into a downgrade instead. <ref> = gear id, index, or 'first'.
      Refuses calmly when broke. Cosmetic risk-management only (ADR-0005).

  dashboard [--no-clear] [--home DIR]
      Display the full in-place Grove dashboard (levels, gear, collection, quests).
      --no-clear  Skip the terminal clear (useful for tests / piped output).

  tui [--once] [--home DIR]
      Launch the navigable, live-updating Grove dashboard (Ink TUI): arrow/tab to
      move focus, p pull · P premium · e enhance · c craft · b prestige · q quit.
      Every action runs the same engine and persists under the lock. Cosmetic only.
      --once  Render ONE static frame and exit (for tests / CI / piped output).

  serve [--port N] [--host H] [--home DIR]
      Start a local, READ-ONLY web dashboard over your Grove state and print its
      URL; runs until Ctrl-C, live-updating an open page as state changes. Binds
      to 127.0.0.1 by default; --host 0.0.0.0 exposes it on your LAN (opt-in, loud).
      --port  TCP port (default: an ephemeral free port).

  statusline-ingest [--home DIR]
      Read the Claude Code statusline JSON from STDIN, parse it, and ingest a
      quota_update event to keep the energy system current.
      Prints NOTHING to stdout (designed to run inside the statusline pipe).
      Always returns 0 · never disrupts the HUD.

  statusline install [--settings PATH]
      Install Grove's chain-safe statusline wrapper.
      Backs up the original statusLine.command and chains Grove onto it.
      The original statusline is ALWAYS preserved (never clobbered).
      --settings  Path to Claude Code's settings.json (default: ~/.claude/settings.json).

  statusline uninstall [--settings PATH]
      Remove Grove's statusline wrapper, restoring the original command.
      --settings  Path to Claude Code's settings.json (default: ~/.claude/settings.json).

  init [--repo DIR]
      Install Grove's post-commit git hook in a repo (chains; never clobbers).
      Defaults to process.cwd() if --repo is omitted.
      Grove failures NEVER block commits · the hook is fail-open by design.

  uninstall [--repo DIR]
      Remove Grove's contribution from the post-commit hook. Other hooks intact.
      Defaults to process.cwd() if --repo is omitted.

  commit-hook [--repo DIR] [--home DIR]
      Called automatically by the installed post-commit hook on every commit.
      Scans the repo for Pillar-B signals and ingests events.

  suggest-commit [--repo DIR]
      Read-only: print a suggested commit message from staged diff. No AI ·
      type inferred from file paths (test/docs/chore/feat). Copy the output.
      If nothing is staged, prints a hint to run git add first.

  checkpoint [-m MSG] [--repo DIR] [--home DIR]
      📍 Safety-net: snapshot working state via git stash create (read-only ·
      never modifies tree/index), record to grove state, ingest a checkpoint
      event for the rest-buff reward. Prints how to restore with git stash apply.

  share [--badge] [--home DIR]
      Print a terse, copy-pasteable share card (level + collection %). Opt-in &
      privacy-minimal · only cosmetic stats, NEVER code/cwd/cost (ADR-0011).
      --badge  Print a markdown shields.io badge for your README instead.

  ntfy <topic> | off [--home DIR]
      Opt-in mobile push (ntfy.sh). Default OFF · no push unless you set a topic.
      <topic>  Set the topic; install the ntfy.sh app and subscribe to it.
      off      Disable push. Big moments only (level-ups, legendaries, chests);
      the message carries cosmetic events only · NEVER code/cwd/cost (ADR-0011).

  help
      Show this help message.
`.trim()

// ---------------------------------------------------------------------------
// groveInvocation · compute the portable, injection-safe command to reinvoke sq
// ---------------------------------------------------------------------------

/** Options for groveInvocation · injectable seams keep it testable & pure-ish. */
export interface GroveInvocationOpts {
  /**
   * Detect a PATH-resolvable `sq` binary. Defaults to scanning `process.env.PATH`.
   * Injectable so tests can force either branch deterministically.
   */
  sqOnPath?: () => boolean
  /** Override the module URL used to locate the built bundle (tests only). */
  moduleUrl?: string
}

/**
 * Return true if an executable named `sq` is resolvable on PATH. Portable
 * (honors PATHEXT on Windows) and side-effect-light · no process spawn.
 */
function defaultSqOnPath(): boolean {
  const PATH = process.env['PATH'] ?? ''
  if (PATH === '') return false
  const exts =
    process.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : ['']
  for (const dir of PATH.split(path.delimiter)) {
    if (dir === '') continue
    for (const ext of exts) {
      const candidate = path.join(dir, `sq${ext}`)
      try {
        const st = fs.statSync(candidate)
        if (st.isFile()) return true
      } catch {
        // not here · keep scanning
      }
    }
  }
  return false
}

/**
 * Returns the shell command used to re-invoke THIS CLI from a generated script
 * (the post-commit hook block, the statusline wrapper).
 *
 * PORTABLE + INJECTION-SAFE (Security B→B+, ADR-0005 firewall stays intact):
 *  - When Grove is installed (a `sq` is on PATH) → returns bare `sq`. No path is
 *    interpolated, so there is no injection surface at all.
 *  - Otherwise → falls back to the BUILT bundle: `node <abs>/dist/cli/sq.js`.
 *    The absolute path is SINGLE-QUOTE / shQuote-escaped · never wrapped in raw
 *    double quotes · so an install path containing `"`, `$()`, or a backtick is
 *    a single literal argument and can never be executed.
 *
 * The built bundle lives at `<root>/dist/cli/sq.js`. Both the dev source
 * (`<root>/src/cli/sq.ts`) and the built output (`<root>/dist/cli/sq.js`) are two
 * levels below root, so `resolve(dirname(thisFile), '..', '..')` yields root in
 * either case.
 */
export function groveInvocation(opts: GroveInvocationOpts = {}): string {
  const sqOnPath = opts.sqOnPath ?? defaultSqOnPath
  if (sqOnPath()) return 'sq'

  const moduleUrl = opts.moduleUrl ?? import.meta.url
  const thisFile = url.fileURLToPath(moduleUrl)
  const root = path.resolve(path.dirname(thisFile), '..', '..')
  const built = path.join(root, 'dist', 'cli', 'sq.js')
  return `node ${shQuote(built)}`
}

// ---------------------------------------------------------------------------
// Calm mode (--zen / GROVE_ZEN) · see ADR-0005
// ---------------------------------------------------------------------------

/**
 * True when calm mode is on: the `--zen` flag OR a truthy `GROVE_ZEN` env var
 * (anything but unset / "" / "0" / "false"). Env support lets the git-hook /
 * statusline contexts (which don't pass flags) opt into calm globally.
 */
function isZen(flags: Record<string, string>): boolean {
  if (flags['zen'] === 'true') return true
  const env = process.env['GROVE_ZEN']
  return env !== undefined && env !== '' && env !== '0' && env.toLowerCase() !== 'false'
}

/**
 * Print a single plain, terse calm-mode confirmation line. Calm mode strips ALL
 * spectacle (loot/crit/serendipity/milestone/offers/reveals) · the engine still
 * ran and persisted state; this line is the only thing the user sees.
 */
function calmConfirm(message: string): void {
  console.log(`  ✓ ${message}`)
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleEvent(
  positional: string[],
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
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
  // would poison every downstream reward calc with NaN · default to 1 instead.
  const magnitude = parsePositiveIntFlag(flags['magnitude'], 1)
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
    calmConfirm(success ? `${type} recorded` : `${type} recorded (no reward)`)
    return 0
  }

  if (rewards.length === 0) {
    console.log('  (no drop)')
  } else {
    for (const reward of rewards) {
      console.log(formatReward(reward))
    }
  }

  // Contextual offers
  printContextualOffers(rewards, dir)

  return 0
}

function handleStatus(dir: string, zen: boolean): number {
  const state = loadState(dir)
  if (zen) {
    // Quiet status: a single terse line, no banner/box spectacle.
    const { player, cards } = state
    calmConfirm(`Level ${player.level} · ${player.currency} 🌰 · ${cards.length} cards`)
    return 0
  }
  console.log(formatStatus(state))
  return 0
}

function handleRecap(flags: Record<string, string>, dir: string): number {
  const events = readEvents(dir)
  const state = loadState(dir)

  const sinceMode = flags['since'] ?? 'session'

  let sinceTs: string | undefined

  if (sinceMode === 'session') {
    // Find the ts of the last session_start event
    const sessionStarts = events.filter((e) => e.type === 'session_start')
    const lastSessionStart = sessionStarts[sessionStarts.length - 1]
    if (lastSessionStart !== undefined) {
      sinceTs = lastSessionStart.ts
    }
    // If no session_start found, sinceTs remains undefined → all events
  }
  // 'all' → sinceTs stays undefined

  const recap = buildRecap(events, state, sinceTs !== undefined ? { sinceTs } : undefined)
  console.log(formatRecap(recap))
  return 0
}

function handleScan(positional: string[], dir: string, zen: boolean): number {
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
      console.log('  (nothing new)')
    } else {
      for (const reward of rewards) {
        console.log(formatReward(reward))
      }
    }
  }

  // Print notes (e.g. git not available)
  for (const note of notes) {
    console.log(`  note: ${note}`)
  }

  // Summary
  const typeList = Object.entries(counts)
    .map(([t, n]) => `${t}:${n}`)
    .join(', ')
  const eventCount = events.length
  if (zen) {
    // Calm: a single terse confirmation, no per-reward loot, no "reward(s)" tally spectacle.
    calmConfirm(`scan complete · ${eventCount} signal(s)${typeList ? ` (${typeList})` : ''}`)
    return 0
  }
  console.log(
    `  Scan complete · ${eventCount} signal(s) detected${typeList ? ` (${typeList})` : ''}, ${totalRewards} reward(s).`,
  )

  return 0
}

function handleQuests(dir: string): number {
  const state = loadState(dir)
  console.log(formatQuests(QUESTS, state))
  return 0
}

/** Starter seeds granted ONCE on first `sq init` so the dashboard isn't empty. */
const STARTER_SEEDS = 40

/**
 * Grant the first-run starter exactly once. Idempotency is tracked by an
 * `.onboarded` marker file in the grove state dir (the impure shell) · so a
 * second `init` never re-grants, and the engine state shape is untouched. The
 * grant is COSMETIC seeds only (ADR-0005). Returns true if it granted this call.
 */
function grantStarterOnce(dir: string): boolean {
  const marker = path.join(dir, '.onboarded')
  return withStateLock(dir, () => {
    if (fs.existsSync(marker)) return false
    const state = loadState(dir)
    saveState(dir, {
      ...state,
      player: { ...state.player, currency: state.player.currency + STARTER_SEEDS },
    })
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(marker, new Date().toISOString() + '\n', 'utf8')
    } catch {
      // Non-fatal: if the marker can't be written, worst case is a re-grant on
      // the next init · never a crash, never a blocked install.
    }
    return true
  })
}

function handleInit(flags: Record<string, string>, dir: string): number {
  const repo = flags['repo'] ?? process.cwd()
  const res = installPostCommit(repo, groveInvocation())

  let message: string
  if (res.action === 'created') {
    message = `Grove post-commit hook installed.`
  } else if (res.action === 'chained') {
    message = `Grove chained onto your existing hook · your existing hooks are preserved.`
  } else {
    message = `Grove hook already installed (no change).`
  }

  console.log(`  🌳 ${message}`)
  console.log(`  Hook path: ${res.hookPath}`)
  console.log(`  Grove failures never block commits · the hook is fail-open by design.`)

  // First-run starter: a brand-new player gets seeds so the dashboard has loot
  // to show before their first commit lands (avoids the empty-board first-aha).
  const granted = grantStarterOnce(dir)
  if (granted) {
    console.log(`  🪙 starter grant · +${STARTER_SEEDS} 🌰 seeds · your board isn't empty.`)
  }

  // Detect the AI CLIs the user already runs (tool-agnostic · ADR-0001).
  const clis = detectAiClis()
  if (clis.length > 0) {
    console.log(`  Detected: ${clis.join(', ')} · Grove rides alongside, doesn't replace.`)
  } else {
    console.log(`  Works with any AI-coding tool (Claude Code, Cursor, Aider, Codex…) · tool-agnostic.`)
  }

  // Clear next-step CTA (the first-aha): one concrete command to run next.
  console.log(`  Next: git commit like normal, then \`sq dashboard\` to see your loot.`)
  return 0
}

function handleUninstall(flags: Record<string, string>): number {
  const repo = flags['repo'] ?? process.cwd()
  const res = uninstallPostCommit(repo)

  let message: string
  if (res.action === 'removed') {
    message = `Grove hook removed.`
  } else if (res.action === 'unchained') {
    message = `Grove block removed · your other hooks remain intact.`
  } else {
    message = `Grove hook was not installed (nothing to remove).`
  }

  console.log(`  ${message}`)
  console.log(`  Hook path: ${res.hookPath}`)
  return 0
}

function handleEnhance(
  positional: string[],
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
): number {
  const ref = positional[0]

  if (!ref) {
    console.error('Error: gear ref is required. Use a gear id, 1-based index, or "first".')
    return 2
  }

  const state = loadState(dir)

  if (state.gear.length === 0) {
    console.log('(no gear yet · merge a PR to drop some: sq event pr_merged)')
    return 0
  }

  const gearIndex = resolveGearRef(state.gear, ref)

  if (gearIndex < 0 || gearIndex >= state.gear.length) {
    console.error(`Error: no gear at ref "${ref}". You have ${state.gear.length} piece(s).`)
    return 2
  }

  const before = state.gear[gearIndex]!

  // Run the (priced) attempt + persist atomically under the lock so the consumed
  // protection, the new gear level, and the seed debit can't be lost to a
  // concurrent writer. The seed COST is checked inside the lock against fresh
  // state so a calm refusal is consistent with the actual wallet.
  const outcome = withStateLock(dir, () => {
    const fresh = loadState(dir)
    const idx = resolveGearRef(fresh.gear, ref)

    // BOUNDS GUARD inside the lock: the pre-lock check ran against a possibly
    // stale snapshot; a concurrent writer may have removed/reordered gear so the
    // ref no longer resolves. Re-validate against fresh state before any debit.
    if (idx < 0 || idx >= fresh.gear.length || fresh.gear[idx] === undefined) {
      return { kind: 'badref' as const, count: fresh.gear.length }
    }
    const cur = fresh.gear[idx]!

    // R6 P0: price the attempt with the engine's LEVEL-SCALING enhanceCost (was a
    // flat 20 the CLI ignored · chasing a high +N must be a deepening sink).
    const cost = enhanceCost(cur.level)

    // CONSISTENCY (audit re-score①): enhance COSTS seeds, like repair/protect.
    // Refuse calmly when broke · no roll, no debit, no state change.
    if (fresh.player.currency < cost) {
      return { kind: 'broke' as const, have: fresh.player.currency, cost }
    }

    // One-shot protection: armed via `sq protect`. Consumed by THIS attempt
    // regardless of outcome (the pure engine softens a would-be break to a
    // downgrade when protect=true; ADR-0005 · cosmetic only).
    const isProtected = fresh.protectedGear.includes(cur.id)

    // RNG: time-seeded for variety, or a fixed --seed for tests (NaN-guarded).
    const seedFlag = flags['seed']
    const seed =
      seedFlag !== undefined
        ? parseIntFlag(seedFlag, 0)
        : hashStringToSeed(cur.id + ':' + String(cur.level) + ':' + String(Date.now()))
    const rng = mulberry32(seed)

    const { gear: enhanced, result: res } = enhance(cur, rng, isProtected)

    const newGear = fresh.gear.map((g, i) => (i === idx ? enhanced : g))
    const newProtected = isProtected
      ? fresh.protectedGear.filter((id) => id !== cur.id)
      : fresh.protectedGear
    saveState(dir, {
      ...fresh,
      gear: newGear,
      protectedGear: newProtected,
      player: { ...fresh.player, currency: fresh.player.currency - cost },
    })
    return { kind: 'enhanced' as const, after: enhanced, result: res }
  })

  if (outcome.kind === 'badref') {
    // Lost the race: the gear vanished between the pre-lock check and the lock.
    console.error(`Error: no gear at ref "${ref}". You have ${outcome.count} piece(s).`)
    return 2
  }

  if (outcome.kind === 'broke') {
    console.log(`  not enough 🌰 · enhance costs ${outcome.cost}, have ${outcome.have}.`)
    console.log('  earn more 🌰 by shipping · commits, green tests, merges, docs.')
    return 0
  }

  if (zen) {
    // Calm: the attempt ran & persisted; suppress the odds + juicy result reveal.
    calmConfirm(`enhance ${before.name} · attempt recorded`)
    return 0
  }

  // Print odds (the suspense), play the dice-roll reveal, then the result ·
  // only when an attempt happened. Mirrors the pull reveal (playReveal is
  // TTY-only and skipped in pipes/tests, so output stays deterministic).
  console.log(renderEnhanceOdds(before))
  playReveal(renderEnhanceFrames())
  console.log(renderEnhanceResult(before, outcome.after, outcome.result))

  return 0
}

/**
 * Sleep `ms` milliseconds WITHOUT a CPU-burning busy-loop, in a synchronous
 * context. `Atomics.wait` parks the thread on a private SharedArrayBuffer that
 * is never signalled, so it blocks for the timeout without spinning a core
 * (unlike `while (Date.now() < until) {}`). Used only for the TTY reveal cadence.
 */
function sleepSync(ms: number): void {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Play a short in-place pack-opening suspense animation, THEN clear the line.
 * TTY-only: in pipes / tests (non-TTY) it is SKIPPED ENTIRELY so output stays
 * clean and deterministic AND there is no delay at all. The per-frame pause uses
 * a non-blocking `sleepSync` (parks the thread, never busy-spins the CPU).
 * Writes to process.stdout directly (never console.log) so the frames don't
 * pollute scriptable reward lines.
 */
function playReveal(frames: string[]): void {
  if (!process.stdout.isTTY) return
  for (const frame of frames) {
    process.stdout.write(`\r  ${frame}   `)
    sleepSync(120) // ~120ms per frame, non-busy
  }
  process.stdout.write('\r\x1b[K') // carriage-return + clear-to-EOL
}

/**
 * `sq pull [--premium]` · spend seeds for one gacha pull (the core R3 decision).
 *
 * Loads state under the cross-process lock, runs the PURE engine `pull` (or
 * `pullPremium` with `--premium` · the escalating seed SINK at PREMIUM_PULL_COST,
 * better odds), persists, and prints the rewards behind a pack-opening reveal.
 * Time-seeded for variety, or a fixed --seed for tests. When broke, prints a
 * friendly earn-more-by-shipping hint.
 */
function handlePull(flags: Record<string, string>, dir: string, zen: boolean): number {
  const premium = flags['premium'] === 'true'
  const cost = premium ? PREMIUM_PULL_COST : PULL_COST
  // --spark <id>: the missing card a PREMIUM banner builds its guarantee toward
  // (the engine reads state.sparkTarget). Choosing a target = the save-vs-spend
  // reason the targeted premium gives (SPARK_THRESHOLD misses → guaranteed).
  const sparkTarget = premium ? flags['spark'] : undefined

  const result = withStateLock(dir, () => {
    const loaded = loadState(dir)
    // Set/refresh the spark target up front (impure shell, immutable update) so the
    // premium roll below sees it; a no-op when the player passed no --spark.
    const state: GameState =
      sparkTarget !== undefined && sparkTarget !== ''
        ? { ...loaded, sparkTarget }
        : loaded
    const affordable = state.player.currency >= cost
    const seedFlag = flags['seed']
    const seed =
      seedFlag !== undefined
        ? parseIntFlag(seedFlag, 0)
        : hashStringToSeed(`pull:${premium ? 'p:' : ''}${state.eventCount}:${String(Date.now())}`)
    const rng = mulberry32(seed)

    const { state: next, rewards } = premium ? pullPremium(state, rng) : enginePull(state, rng)
    // ROBUSTNESS (R8 code-review): when the player is broke the engine returns the
    // state UNCHANGED (no draw, no debit) — persisting it is a pure no-op write
    // (touches the file mtime + re-acquires the global lock for nothing). Skip the
    // save UNLESS the player actually chose a (new) spark target, which IS a real
    // state change worth persisting even on a refused pull.
    const targetChanged = state.sparkTarget !== loaded.sparkTarget
    if (affordable || targetChanged) {
      saveState(dir, next)
    }
    return { rewards, affordable }
  })

  if (!result.affordable) {
    if (zen) {
      // Calm refusal · no spectacle, no earn-more nudge.
      calmConfirm(`pull skipped · not enough 🌰 (need ${cost})`)
      return 0
    }
    // The engine already pushed the calm 'not enough' reward; surface it + a hint.
    for (const reward of result.rewards) {
      console.log(formatReward(reward))
    }
    console.log('  earn more 🌰 by shipping · commits, green tests, merges, docs.')
    return 0
  }

  if (zen) {
    // Calm: the pull happened & persisted; suppress the reveal + loot line.
    calmConfirm(premium ? 'premium pull done' : 'pull done')
    return 0
  }

  // Affordable: play the pack-opening suspense, then reveal the drop.
  playReveal(renderPullFrames())
  for (const reward of result.rewards) {
    console.log(formatReward(reward))
  }
  return 0
}

/**
 * `sq craft [cardId]` · spend shards to craft one chosen missing card (the SPEND
 * side of the dup tail; shards were write-only before R6). Loads state under the
 * lock, runs the PURE engine `craftCard` (debits SHARDS_PER_CRAFT, or refuses when
 * short / nothing left), persists, and renders the rewards. Respects --zen.
 */
function handleCraft(positional: string[], flags: Record<string, string>, dir: string, zen: boolean): number {
  const cardId = positional[0]
  const seedFlag = flags['seed']

  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const before = state.cards.length
    // rng only feeds a possible set-completion bonus legendary; time-seeded for
    // variety, fixed --seed for tests.
    const seed =
      seedFlag !== undefined
        ? parseIntFlag(seedFlag, 0)
        : hashStringToSeed(`craft:${state.eventCount}:${String(Date.now())}`)
    const rng = mulberry32(seed)

    const { state: next, rewards } = craftCard(state, cardId, rng)
    const crafted = next.cards.length > before
    // ROBUSTNESS (R8): a refused craft (short on shards / nothing left / locked id)
    // returns state UNCHANGED — skip the no-op write. A successful craft debits
    // shards + appends a card, so persist that.
    if (crafted) {
      saveState(dir, next)
    }
    return { rewards, crafted }
  })

  if (zen) {
    // Calm: the engine ran & persisted; one quiet line either way.
    calmConfirm(result.crafted ? 'crafted' : 'craft skipped')
    return 0
  }

  for (const reward of result.rewards) {
    console.log(formatReward(reward))
  }
  return 0
}

/**
 * `sq foil [cardId]` · spend FOIL_COST shards to cosmetically FOIL an OWNED card
 * (R8 renewable content axis — a completed collection still has a runway). Loads
 * state under the lock, runs the PURE engine `foilCard` (debits shards, or refuses
 * calmly when short / unowned / already foiled / nothing left), persists ONLY when
 * the foil actually applied (no no-op write), and renders the reward. Respects --zen.
 */
function handleFoil(positional: string[], dir: string, zen: boolean): number {
  const cardId = positional[0]

  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const beforeFoiled = (state.foiled ?? []).length
    const { state: next, rewards } = foilCard(state, cardId)
    const foiled = (next.foiled ?? []).length > beforeFoiled
    // ROBUSTNESS (R8): a refused foil returns state UNCHANGED — skip the no-op
    // write. A successful foil debits shards + appends to foiled[], so persist it.
    if (foiled) {
      saveState(dir, next)
    }
    return { rewards, foiled }
  })

  if (zen) {
    calmConfirm(result.foiled ? 'foiled' : 'foil skipped')
    return 0
  }

  for (const reward of result.rewards) {
    console.log(formatReward(reward))
  }
  return 0
}

/**
 * `sq prestige` · spend seeds to buy the next ENDGAME prestige rank (the
 * escalating, recurring late-game sink). Loads state under the lock, runs the
 * PURE engine `buyPrestige` (debits prestigeCost(rank), or refuses when broke),
 * persists, and renders the rewards. Cosmetic-only (ADR-0005). Respects --zen.
 */
function handlePrestige(flags: Record<string, string>, dir: string, zen: boolean): number {
  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const before = state.buffs.length
    const { state: next, rewards } = buyPrestige(state)
    const bought = next.buffs.length > before
    // ROBUSTNESS (R8): a refused prestige (broke) returns state UNCHANGED — skip
    // the no-op write. A purchase debits seeds + adds a rank buff, so persist it.
    if (bought) {
      saveState(dir, next)
    }
    return { rewards, bought }
  })

  if (zen) {
    // Calm: the engine ran & persisted; one quiet line either way.
    calmConfirm(result.bought ? 'prestige earned' : 'prestige skipped')
    return 0
  }

  for (const reward of result.rewards) {
    console.log(formatReward(reward))
  }
  return 0
}

/**
 * `sq convert [n]` · trade banked shards back into seeds at SHARD_TO_SEED (the
 * dead-shard-tail relief valve). Loads state under the lock, runs the PURE engine
 * `convertShards` (debits shards, credits seeds; refuses calmly at zero), persists,
 * and renders the reward. With no count, converts ALL banked shards; with `n`,
 * exactly min(n, banked). Cosmetic-only (ADR-0005). Respects --zen.
 */
function handleConvert(positional: string[], dir: string, zen: boolean): number {
  // Optional positive count; absent → convert all (undefined). A non-numeric /
  // zero token is NaN-guarded by parsePositiveIntFlag → 0 → engine refuses calmly.
  const countToken = positional[0]
  const n = countToken === undefined ? undefined : parsePositiveIntFlag(countToken, 0)

  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const before = state.player.shards ?? 0
    const { state: next, rewards } = convertShards(state, n)
    const converted = before - (next.player.shards ?? 0)
    // ROBUSTNESS (R8): a refused convert (no shards / nothing to convert) returns
    // state UNCHANGED — skip the no-op write. A real convert moves shards→seeds.
    if (converted > 0) {
      saveState(dir, next)
    }
    return { rewards, converted }
  })

  if (zen) {
    // Calm: the engine ran & persisted; one quiet line either way.
    calmConfirm(
      result.converted > 0
        ? `${result.converted} shards → ${result.converted * SHARD_TO_SEED} 🌰`
        : 'convert skipped · no shards',
    )
    return 0
  }

  for (const reward of result.rewards) {
    console.log(formatReward(reward))
  }
  return 0
}

/**
 * Resolve a gear ref (gear id, 1-based index, or 'first') to an index into
 * `gear`. Returns -1 when the ref is unresolvable. Pure helper.
 */
function resolveGearRef(gear: { id: string }[], ref: string): number {
  const normalized = ref.toLowerCase()
  if (normalized === 'first') return gear.length > 0 ? 0 : -1
  const asInt = parseInt(ref, 10)
  if (!isNaN(asInt) && String(asInt) === ref) return asInt - 1 // 1-based
  return gear.findIndex((g) => g.id === ref)
}

/**
 * `sq repair <ref>` · spend repairCost(gear) seeds to un-break a cosmetic gear
 * (level preserved). R6 P0: the price now SCALES with the gear's level (engine
 * repairCost) · a broken +12 costs far more than a +1, instead of the old flat
 * 50. Refuses calmly when broke. Cosmetic only (ADR-0005).
 */
function handleRepair(positional: string[], flags: Record<string, string>, dir: string, zen: boolean): number {
  const ref = positional[0]
  if (!ref) {
    console.error('Error: gear ref is required. Use a gear id, 1-based index, or "first".')
    return 2
  }

  const outcome = withStateLock(dir, () => {
    const state = loadState(dir)
    if (state.gear.length === 0) return { kind: 'nogear' as const }

    const idx = resolveGearRef(state.gear, ref)
    if (idx < 0 || idx >= state.gear.length) return { kind: 'badref' as const, count: state.gear.length }

    const gear = state.gear[idx]!
    if (!gear.broken) return { kind: 'notbroken' as const, gear }
    // R6 P0: level-scaling repair price (was a flat 50 the CLI ignored).
    const cost = repairCost(gear)
    if (state.player.currency < cost) {
      return { kind: 'broke' as const, have: state.player.currency, cost }
    }

    const { gear: repairedGear } = repairGear(state, gear.id)
    saveState(dir, {
      ...state,
      gear: repairedGear,
      player: { ...state.player, currency: state.player.currency - cost },
    })
    return { kind: 'repaired' as const, gear, cost }
  })

  switch (outcome.kind) {
    case 'nogear':
      console.log('(no gear yet · nothing to repair)')
      return 0
    case 'badref':
      console.error(`Error: no gear at ref "${ref}". You have ${outcome.count} piece(s).`)
      return 2
    case 'notbroken':
      console.log(`  ${outcome.gear.name} +${outcome.gear.level} isn't broken · nothing to repair.`)
      return 0
    case 'broke':
      console.log(`  not enough 🌰 · repair costs ${outcome.cost}, have ${outcome.have}.`)
      console.log('  earn more 🌰 by shipping · commits, green tests, merges, docs.')
      return 0
    case 'repaired':
      if (zen) {
        calmConfirm(`repaired ${outcome.gear.name} +${outcome.gear.level}`)
      } else {
        console.log(`  🔧 REPAIRED · ${outcome.gear.name} +${outcome.gear.level} · -${outcome.cost} 🌰`)
      }
      return 0
  }
}

/**
 * `sq protect <ref>` · spend PROTECT_COST seeds to arm a ONE-SHOT protection on
 * a gear: the next enhance turns a would-be cosmetic break into a downgrade.
 * Refuses calmly when broke. Cosmetic risk-management only (ADR-0005).
 */
function handleProtect(positional: string[], flags: Record<string, string>, dir: string, zen: boolean): number {
  const ref = positional[0]
  if (!ref) {
    console.error('Error: gear ref is required. Use a gear id, 1-based index, or "first".')
    return 2
  }

  const outcome = withStateLock(dir, () => {
    const state = loadState(dir)
    if (state.gear.length === 0) return { kind: 'nogear' as const }

    const idx = resolveGearRef(state.gear, ref)
    if (idx < 0 || idx >= state.gear.length) return { kind: 'badref' as const, count: state.gear.length }

    const gear = state.gear[idx]!
    if (state.protectedGear.includes(gear.id)) return { kind: 'already' as const, gear }
    if (state.player.currency < PROTECT_COST) {
      return { kind: 'broke' as const, have: state.player.currency }
    }

    saveState(dir, {
      ...state,
      protectedGear: [...state.protectedGear, gear.id],
      player: { ...state.player, currency: state.player.currency - PROTECT_COST },
    })
    return { kind: 'armed' as const, gear }
  })

  switch (outcome.kind) {
    case 'nogear':
      console.log('(no gear yet · nothing to protect)')
      return 0
    case 'badref':
      console.error(`Error: no gear at ref "${ref}". You have ${outcome.count} piece(s).`)
      return 2
    case 'already':
      console.log(`  ${outcome.gear.name} +${outcome.gear.level} is already protected.`)
      return 0
    case 'broke':
      console.log(`  not enough 🌰 · protect costs ${PROTECT_COST}, have ${outcome.have}.`)
      console.log('  earn more 🌰 by shipping · commits, green tests, merges, docs.')
      return 0
    case 'armed':
      if (zen) {
        calmConfirm(`protected ${outcome.gear.name} +${outcome.gear.level} (one enhance)`)
      } else {
        console.log(`  🛡 PROTECTED · ${outcome.gear.name} +${outcome.gear.level} · -${PROTECT_COST} 🌰 (one enhance)`)
      }
      return 0
  }
}

function handleDashboard(flags: Record<string, string>, dir: string): number {
  const noClear = flags['no-clear'] === 'true'

  if (!noClear) {
    process.stdout.write('\x1b[2J\x1b[H')
  }

  const state = loadState(dir)
  // Inject wall-clock epoch so energy ETAs render correctly (pure renderer).
  console.log(renderDashboard(state, { nowEpoch: Date.now() }))
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
async function handleTui(flags: Record<string, string>, dir: string): Promise<number> {
  const once = flags['once'] === 'true'
  const frame = await runTui(dir, once ? { once: true } : {})
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
async function handleServe(flags: Record<string, string>, dir: string): Promise<number> {
  const port = flags['port'] !== undefined ? parseIntFlag(flags['port'], 0) : 0
  const host = flags['host']
  const noWait = flags['no-wait'] === 'true'

  const server = startWebServer({
    dir,
    port,
    ...(host !== undefined ? { host } : {}),
  })

  console.log(`  🌳 Grove web dashboard · ${server.url}`)
  console.log(`  Read-only view of your state · live-updates as you ship · Ctrl-C to stop.`)

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

// ---------------------------------------------------------------------------
// statusline-ingest handler
// ---------------------------------------------------------------------------

/**
 * Read the Claude Code statusline JSON from STDIN (or --test-stdin for tests),
 * parse it via parseStatuslinePayload, and ingest the resulting quota_update
 * event. Prints NOTHING to stdout. Always returns 0 (never disrupts the HUD).
 */
function handleStatuslineIngest(flags: Record<string, string>, dir: string): number {
  try {
    // --test-stdin allows tests to inject JSON without real stdin plumbing.
    const raw = flags['test-stdin'] !== undefined
      ? flags['test-stdin']
      : readStdinSync()

    const payload: unknown = JSON.parse(raw)
    const { events } = parseStatuslinePayload(payload, {
      sessionId: 'statusline',
    })

    for (const event of events) {
      // Add a real timestamp at the impure shell layer.
      const eventWithTs = { ...event, ts: new Date().toISOString() }
      ingestEvent(dir, eventWithTs)
    }
  } catch {
    // Never disrupt the HUD · swallow all errors silently.
  }

  return 0
}

// ---------------------------------------------------------------------------
// statusline install/uninstall handlers
// ---------------------------------------------------------------------------

function defaultSettingsPath(): string {
  return path.join(process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root', '.claude', 'settings.json')
}

function handleStatuslineInstall(flags: Record<string, string>, dir: string): number {
  const settingsPath = flags['settings'] ?? defaultSettingsPath()
  const wrapperPath = path.join(path.dirname(settingsPath), 'grove-statusline-wrapper.sh')

  // Use the portable, injection-safe invocation the git-hook adapter uses:
  // a bare `sq` when installed, else `node '<abs>/dist/cli/sq.js'` (shQuote'd).
  const ingestCmd = `${groveInvocation()} statusline-ingest`
  const result = installStatusline(settingsPath, wrapperPath, ingestCmd)

  // R8 hygiene: the installer writes a timestamped settings.json.bak.<ts> each
  // install; rotate so only the newest few survive (never an unbounded pile).
  rotateBackups(path.dirname(settingsPath), 'settings.json.bak.')

  if (result.action === 'already-installed') {
    console.log('  Grove statusline wrapper is already installed (no change).')
  } else {
    console.log(`  Grove statusline wrapper installed.`)
    console.log(`  Original command preserved: ${result.original || '(none)'}`)
    console.log(`  Wrapper: ${wrapperPath}`)
    // Point to backup
    const backupFiles = fs.readdirSync(path.dirname(settingsPath))
      .filter((f: string) => f.startsWith('settings.json.bak'))
      .sort()
      .reverse()
    const latestBackup = backupFiles[0]
    if (latestBackup !== undefined) {
      console.log(`  Backup: ${path.join(path.dirname(settingsPath), latestBackup)}`)
    }
  }

  console.log(`  Your original statusline is fully preserved and chained · it still runs.`)
  return 0
}

function handleStatuslineUninstall(flags: Record<string, string>): number {
  const settingsPath = flags['settings'] ?? defaultSettingsPath()
  const result = uninstallStatusline(settingsPath)

  // R8 hygiene: cap the timestamped settings backups here too (keep newest few).
  rotateBackups(path.dirname(settingsPath), 'settings.json.bak.')

  if (result.action === 'not-installed') {
    console.log('  Grove statusline wrapper was not installed (nothing to remove).')
  } else {
    console.log('  Grove statusline wrapper removed.')
    console.log('  Your original statusline command has been restored.')
  }

  return 0
}

// ---------------------------------------------------------------------------
// Minimal synchronous stdin reader
// ---------------------------------------------------------------------------

/**
 * Read all of stdin synchronously (blocking). Used by statusline-ingest which
 * is invoked from a shell pipe · it's fine to block here.
 */
function readStdinSync(): string {
  const BUFSIZE = 65536
  let data = ''
  let bytesRead: number
  const buf = Buffer.alloc(BUFSIZE)

  // Use fs.readSync on fd 0 (stdin)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      bytesRead = fs.readSync(0, buf, 0, BUFSIZE, null)
      if (bytesRead === 0) break
      data += buf.subarray(0, bytesRead).toString('utf-8')
    } catch {
      break
    }
  }
  return data
}

// ---------------------------------------------------------------------------
// Commit type inference (pure helper for suggest-commit)
// ---------------------------------------------------------------------------

/**
 * Infer a conventional-commit type from staged file paths.
 * Priority order: test > docs > chore > feat/fix heuristic.
 */
function inferCommitType(files: string[]): string {
  const hasTest = files.some((f) =>
    /\.test\.[tj]sx?$|\.spec\.[tj]sx?$|__tests__/.test(f),
  )
  if (hasTest) return 'test'

  const hasDocs = files.some((f) =>
    /\.md$|^docs\/|CHANGELOG|ARCHITECTURE|DECISIONS/i.test(f),
  )
  if (hasDocs) return 'docs'

  const hasChore = files.some((f) =>
    /package\.json$|package-lock\.json$|tsconfig|\.eslintrc|\.prettierrc|vitest\.config|vite\.config/.test(f),
  )
  if (hasChore) return 'chore'

  return 'feat'
}

// ---------------------------------------------------------------------------
// suggest-commit handler
// ---------------------------------------------------------------------------

function handleSuggestCommit(flags: Record<string, string>): number {
  const repo = flags['repo'] ?? process.cwd()

  const diff = stagedDiffStat(repo)

  if (diff === null || diff.files.length === 0) {
    console.log('  nothing staged · `git add` first, then `sq suggest-commit`.')
    return 0
  }

  const type = inferCommitType(diff.files)
  const topFile = diff.files[0] ?? ''
  // Build a concise subject from the top changed path
  const subject = path.basename(topFile, path.extname(topFile))

  const fileList = diff.files.join(', ')
  const statsLine = `+${diff.insertions}/-${diff.deletions}`

  // Suggested message (two-line conventional-commit style)
  const suggested = [
    `${type}: ${subject}`,
    ``,
    `Changed: ${fileList} (${statsLine})`,
  ].join('\n')

  console.log('  📋 Suggested commit (copy it):')
  console.log('  ─'.repeat(26))
  console.log(suggested.split('\n').map((l) => `  ${l}`).join('\n'))
  console.log('  ─'.repeat(26))

  return 0
}

// ---------------------------------------------------------------------------
// checkpoint handler
// ---------------------------------------------------------------------------

function handleCheckpoint(flags: Record<string, string>, dir: string, zen: boolean): number {
  const repo = flags['repo'] ?? process.cwd()
  const message = flags['m'] ?? 'checkpoint'

  // 1. Non-destructive snapshot via git stash create
  const snapshot = createStashSnapshot(repo)
  const ref = snapshot?.ref ?? ''
  const branch = currentBranch(repo) ?? 'unknown'

  // 2. Collect diffStat for the record (may be null on clean repo · that's fine)
  const diffStat = stagedDiffStat(repo)

  // 3. Record to checkpoints.jsonl in the grove state dir
  const entry = {
    ts: new Date().toISOString(),
    ref,
    branch,
    message,
    diffStat,
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    const checkpointsFile = path.join(dir, 'checkpoints.jsonl')
    fs.appendFileSync(checkpointsFile, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    // Non-fatal · continue even if write fails
  }

  // 4. Ingest a 'checkpoint' GroveEvent (fires rest-buff + gift pull)
  const rewards = (() => {
    try {
      const result = ingestEvent(dir, {
        source: 'sq-checkpoint',
        sessionId: 'checkpoint',
        type: 'checkpoint',
        magnitude: 1,
        success: true,
        ts: new Date().toISOString(),
        meta: { ref, branch },
      })
      return result.rewards
    } catch {
      return []
    }
  })()

  // 5. Print checkpoint confirmation (the safety-net purpose · kept even in calm
  //    mode; it is the command's reason for existing, not loot spectacle).
  if (ref !== '') {
    console.log(`  📍 Checkpoint saved · ${branch}`)
    console.log(`  Restore: git stash apply ${ref}`)
  } else {
    console.log(`  📍 Checkpoint · nothing to snapshot · ${branch}`)
  }

  // Push-on-big-moment (opt-in, default OFF, fire-and-forget) · independent of zen.
  maybePush(rewards)

  if (zen) {
    // Calm: engine ran & persisted the rest-buff; suppress loot + offers.
    return 0
  }

  // Print rewards
  for (const reward of rewards) {
    console.log(formatReward(reward))
  }

  // 6. Contextual offers
  printContextualOffers(rewards, dir)

  return 0
}

// ---------------------------------------------------------------------------
// Contextual offers (ADR-0008): printed suggestions, never auto-executed
// ---------------------------------------------------------------------------

/**
 * After an event produces rewards, check for contextual offer conditions and
 * print terse offer lines. OFFER only · never auto-execute.
 *
 *  - Any reward with crit:true → draft commit offer
 *  - energy.known && vigor < 20 → checkpoint offer
 */
function printContextualOffers(rewards: ReturnType<typeof ingestEvent>['rewards'], dir: string): void {
  const hasCrit = rewards.some((r) => r.crit === true)
  if (hasCrit) {
    console.log('  💥 CRIT · free draft: sq suggest-commit')
  }

  try {
    const state = loadState(dir)
    if (state.energy.known && typeof state.energy.vigor === 'number' && state.energy.vigor < 20) {
      console.log(`  ⚡ low · good stopping point: sq checkpoint`)
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Push-on-big-moment wiring (M5, opt-in, ADR-0011) · fire-and-forget
// ---------------------------------------------------------------------------

/** Injectable seams for maybePush · tests pass mocks; prod uses the real adapter. */
export interface PushDeps {
  /** Resolve the opt-in topic (null = disabled). Defaults to the real ntfyTopic. */
  topicFn?: () => string | null
  /** Fire-and-forget sender. Defaults to the real sendNtfy. */
  send?: (topic: string, n: NtfyNotification) => void
}

/**
 * Push a phone notification ONLY when BOTH hold:
 *   1. the user has opted in (a topic is configured), AND
 *   2. the reward batch is significant (pushWorthy returns a notification).
 *
 * Default OFF: with no topic set, this is a silent no-op · no network is touched.
 * Fire-and-forget by construction: it never throws, never blocks, and never
 * affects the command's outcome (a failing send is swallowed). Privacy-minimal ·
 * only the cosmetic NtfyNotification is sent, never code/cwd/cost (ADR-0011).
 */
export function maybePush(rewards: Reward[], deps: PushDeps = {}): void {
  const topicFn = deps.topicFn ?? ntfyTopic
  const send = deps.send ?? sendNtfy
  try {
    const topic = topicFn()
    if (topic === null || topic === '') return // opt-in OFF → never push
    const note = pushWorthy(rewards)
    if (note === null) return // routine batch → never spam
    send(topic, note)
  } catch {
    // Fire-and-forget: a push must NEVER disrupt the coding workflow.
  }
}

// ---------------------------------------------------------------------------
// wrap · the REAL test/build signal source (ADR-0003).
// ---------------------------------------------------------------------------

/** Event types `sq wrap` can emit (a closed subset of the outcome vocabulary). */
type WrapEventType = 'test_result' | 'build_result' | 'lint_clean'

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
function handleWrap(command: string[], asType: string | undefined, dir: string, zen: boolean): number {
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
      meta: { cmd: command.join(' '), exitCode },
    })

    // Push-on-big-moment (opt-in, default OFF, fire-and-forget) · independent of zen.
    maybePush(rewards)

    if (!zen) {
      for (const reward of rewards) {
        console.log(formatReward(reward))
      }
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

function handleCommitHook(flags: Record<string, string>, dir: string, zen: boolean): number {
  // Banner first in normal mode (kept for the loot reveal). Calm mode stays quiet
  // until the single confirmation below · no banner, no loot, no offers.
  if (!zen) console.log('  🌳 grove')

  try {
    const repo = flags['repo'] ?? process.cwd()
    const { events } = scanRepo(repo)

    const allRewards: ReturnType<typeof ingestEvent>['rewards'] = []

    for (const event of events) {
      const { rewards } = ingestEvent(dir, event)
      allRewards.push(...rewards)
      if (zen) continue
      for (const reward of rewards) {
        console.log(formatReward(reward))
      }
    }

    // Push-on-big-moment for the whole commit's reward batch (opt-in, default
    // OFF, fire-and-forget). Done before the zen early-return so a calm user who
    // opted into push still gets their phone alert.
    maybePush(allRewards)

    if (zen) {
      // Calm: engine ran & persisted; one quiet line, no banner/loot/offers.
      calmConfirm(`commit recorded · ${events.length} signal(s)`)
      return 0
    }

    // Contextual offers after all events are processed
    printContextualOffers(allRewards, dir)
  } catch {
    // Never fail a commit · swallow all errors silently
  }

  return 0
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
function handleShare(flags: Record<string, string>, dir: string): number {
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
function handleNtfy(positional: string[], _dir: string): number {
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

// ---------------------------------------------------------------------------
// run · exported entry point
// ---------------------------------------------------------------------------

/**
 * Subcommands whose handler is ASYNC (the Ink TUI session and the long-running
 * web server). They are dispatched by `runAsync`; the synchronous `run` returns
 * a directive to use `runAsync` if one is reached there directly (it never is in
 * the normal entry path · the script guard calls `runAsync`).
 */
const ASYNC_SUBCOMMANDS = new Set(['tui', 'serve'])

/**
 * Async entry point. Handles the two async subcommands (`tui`, `serve`) and
 * delegates EVERYTHING ELSE to the synchronous `run` · so the whole existing
 * sync surface is untouched. The script guard awaits this.
 *
 * @param argv  Arguments AFTER the script name (i.e. process.argv.slice(2)).
 * @returns     Process exit code (0 = success, 2 = usage error).
 */
export async function runAsync(argv: string[]): Promise<number> {
  const sepIdx = argv.indexOf('--')
  const sqSide = sepIdx === -1 ? argv : argv.slice(0, sepIdx)
  const { positional, flags } = parseArgs(sqSide)

  const subcommand = positional[0]
  if (subcommand !== undefined && ASYNC_SUBCOMMANDS.has(subcommand)) {
    const home = flags['home']
    const dir = home ? stateDir(home) : stateDir()
    if (subcommand === 'tui') return handleTui(flags, dir)
    if (subcommand === 'serve') return handleServe(flags, dir)
  }

  // Every other subcommand is synchronous.
  return run(argv)
}

/**
 * Execute the sq CLI (synchronous subcommands).
 *
 * @param argv  Arguments AFTER the script name (i.e. process.argv.slice(2)).
 * @returns     Process exit code (0 = success, 2 = usage error).
 */
export function run(argv: string[]): number {
  // The `--` separator marks a verbatim inner command (used by `wrap`): EVERYTHING
  // after the FIRST `--` is the wrapped command and MUST NOT be touched by sq's
  // flag parser (a wrapped `--magnitude`, `-c`, `--zen` belongs to the inner
  // command). Split the raw argv at `--` first, then parse ONLY the sq-side
  // tokens before it. Parsing the sq-side generically (not gating on argv[0])
  // lets GLOBAL FLAGS (--zen / --home) compose with `wrap` in ANY position:
  // `sq --zen wrap -- cmd`, `sq wrap --home X -- cmd`, etc. all work.
  const sepIdx = argv.indexOf('--')
  const sqSide = sepIdx === -1 ? argv : argv.slice(0, sepIdx)
  const command = sepIdx === -1 ? [] : argv.slice(sepIdx + 1)

  const { positional, flags } = parseArgs(sqSide)

  // Resolve the grove home directory
  const home = flags['home']
  const dir = home ? stateDir(home) : stateDir()

  // Calm mode (ADR-0005): --zen flag OR env GROVE_ZEN truthy. Parsed from the
  // sq-side, so it applies whether placed before or after the subcommand.
  const zen = isZen(flags)

  const subcommand = positional[0]
  const rest = positional.slice(1)

  // `wrap` consumes the verbatim command after `--`; global flags already parsed.
  if (subcommand === 'wrap') {
    return handleWrap(command, flags['as'], dir, zen)
  }

  switch (subcommand) {
    case 'event':
      return handleEvent(rest, flags, dir, zen)

    case 'status':
      return handleStatus(dir, zen)

    case 'recap':
      return handleRecap(flags, dir)

    case 'scan':
      return handleScan(rest, dir, zen)

    case 'quests':
      return handleQuests(dir)

    case 'pull':
      return handlePull(flags, dir, zen)

    case 'enhance':
      return handleEnhance(rest, flags, dir, zen)

    case 'repair':
      return handleRepair(rest, flags, dir, zen)

    case 'protect':
      return handleProtect(rest, flags, dir, zen)

    case 'craft':
      return handleCraft(rest, flags, dir, zen)

    case 'foil':
      return handleFoil(rest, dir, zen)

    case 'prestige':
      return handlePrestige(flags, dir, zen)

    case 'convert':
      return handleConvert(rest, dir, zen)

    case 'dashboard':
      return handleDashboard(flags, dir)

    case 'statusline-ingest':
      return handleStatuslineIngest(flags, dir)

    case 'statusline': {
      const statuslineCmd = rest[0]
      if (statuslineCmd === 'install') {
        return handleStatuslineInstall(flags, dir)
      } else if (statuslineCmd === 'uninstall') {
        return handleStatuslineUninstall(flags)
      } else {
        console.error(
          `Error: unknown statusline subcommand "${statuslineCmd ?? '(none)'}". Use: sq statusline install | uninstall`,
        )
        return 2
      }
    }

    case 'init':
      return handleInit(flags, dir)

    case 'uninstall':
      return handleUninstall(flags)

    case 'commit-hook':
      return handleCommitHook(flags, dir, zen)

    case 'suggest-commit':
      return handleSuggestCommit(flags)

    case 'checkpoint':
      return handleCheckpoint(flags, dir, zen)

    case 'share':
      return handleShare(flags, dir)

    case 'ntfy':
      return handleNtfy(rest, dir)

    case 'help':
    case undefined:
      console.log(USAGE_TEXT)
      return 0

    default: {
      // Terse correction over the full USAGE wall: offer the closest match if
      // there is one, else point at `sq help` · don't dump every subcommand.
      const guess = suggestSubcommand(subcommand ?? '')
      if (guess !== null) {
        console.error(`Unknown subcommand "${subcommand}". Did you mean \`sq ${guess}\`?`)
      } else {
        console.error(`Unknown subcommand "${subcommand}". Run \`sq help\` for the full list.`)
      }
      return 2
    }
  }
}

// ---------------------------------------------------------------------------
// Run-as-script guard · allows `sq …`, `node dist/cli/sq.js …`, and
// `tsx src/cli/sq.ts …` to execute directly while staying inert on import.
// ---------------------------------------------------------------------------

/**
 * True when this module is the program's entry point. Matches on the BASENAME
 * of argv[1] (`sq`, `sq.js`, `sq.ts`) rather than a fragile substring of the
 * whole path · so a repo path that merely *contains* "sq" (e.g.
 * /home/user/sqlbox/other.js) no longer falsely trips the guard.
 */
export function isRunAsScript(argv1: string | undefined): boolean {
  if (argv1 === undefined || argv1 === '') return false
  const base = path.basename(argv1)
  return base === 'sq' || base === 'sq.js' || base === 'sq.ts'
}

if (isRunAsScript(process.argv[1])) {
  // runAsync covers the async subcommands (tui/serve) and delegates the rest to
  // the synchronous run. A live `serve` keeps the process alive on its own; the
  // promise resolves with the exit code when the command finishes.
  runAsync(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}

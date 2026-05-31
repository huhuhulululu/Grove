/**
 * sq.ts · Grove CLI entry point (the THIN dispatch shell).
 *
 * Impure shell: may use process / console / wall-clock time (ADR-0005 firewall).
 * The engine's pure GameState updates flow through the existing `reduce` via
 * `ingestEvent`; no game logic is re-implemented here.
 *
 * This file is intentionally lean: argv parse + USAGE + the dispatch switch. Every
 * subcommand HANDLER lives in a cohesive per-group module under commands/ (the
 * architecture-A split of the former 2101-line God-file):
 *   - commands/economy.ts  · pull, premium, enhance, repair, protect, craft, foil, convert, prestige
 *   - commands/view.ts     · event, status, recap, scan, quests, dashboard, tui, serve
 *   - commands/hooks.ts     · init, uninstall, commit-hook, statusline-ingest/install/uninstall, suggest-commit, checkpoint
 *   - commands/share.ts     · wrap, share, ntfy
 *   - commands/shared.ts    · cross-cutting helpers (zen, reveal, offers, push, gear-ref, groveInvocation, detectAiClis)
 *
 * Usage:
 *   sq [--home <DIR>] [--zen] <subcommand> [flags]
 *
 * --zen (or env GROVE_ZEN=1) is the calm mode (ADR-0005): the engine STILL runs
 * and records state, but the RENDER strips all spectacle · no loot/crit/
 * serendipity/milestone lines, no contextual offers, no drop reveals. Commands
 * print a plain, terse confirmation instead.
 */

import * as path from 'node:path'
import { stateDir } from '../store/paths'
import { EVENT_TYPES } from '../core/events'
import {
  ENHANCE_COST_BASE,
  ENHANCE_COST_PER_LEVEL,
  REPAIR_COST_BASE,
  REPAIR_COST_PER_LEVEL,
} from '../engine/gear'
import {
  PULL_COST,
  PREMIUM_PULL_COST,
  PRESTIGE_COST,
  FOIL_COST,
} from '../engine/reduce'
import { SHARDS_PER_CRAFT, SHARD_TO_SEED } from '../engine/collection'

import { isZen, groveInvocation, detectAiClis, maybePush } from './commands/shared'
import {
  handlePull,
  handleEnhance,
  handleRepair,
  handleProtect,
  handleCraft,
  handleFoil,
  handleConvert,
  handlePrestige,
  PROTECT_COST,
} from './commands/economy'
import {
  handleEvent,
  handleStatus,
  handleRecap,
  handleScan,
  handleQuests,
  handleDashboard,
  handleTui,
  handleServe,
  resolveDir,
} from './commands/view'
import {
  handleInit,
  handleUninstall,
  handleCommitHook,
  handleStatuslineIngest,
  handleStatuslineInstall,
  handleStatuslineUninstall,
  handleSuggestCommit,
  handleCheckpoint,
} from './commands/hooks'
import { handleWrap, handleShare, handleNtfy } from './commands/share'

// Re-export the public surface the tests / other layers import from './sq', so
// the God-file split is transparent to every existing import site.
export { groveInvocation, detectAiClis, maybePush, PROTECT_COST }
export type { GroveInvocationOpts, DetectAiOpts, PushDeps } from './commands/shared'

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
// Usage block
// ---------------------------------------------------------------------------

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
    const dir = resolveDir(flags)
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

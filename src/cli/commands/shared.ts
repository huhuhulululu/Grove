/**
 * commands/shared.ts · cross-cutting helpers used by more than one sq command
 * group (the thin entry sq.ts and the per-group command modules import from here).
 *
 * Impure shell (ADR-0005): may touch process / console / wall-clock. No game
 * logic lives here · all GameState updates flow through the pure engine via the
 * handlers that call these.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { shQuote } from '../../adapters/shquote'
import { loadState, saveState, withStateLock } from '../../store/store'
import { ingestEvent } from '../../app/ingest'
import { formatReward } from '../../render/format'
import { ntfyTopic, sendNtfy } from '../../adapters/ntfy'
import type { NtfyNotification } from '../../adapters/ntfy'
import { pushWorthy } from '../../adapters/ntfy'
import type { Reward } from '../../core/rewards'
import { t } from '../../i18n/t'
import type { Locale } from '../../i18n/types'

// ---------------------------------------------------------------------------
// Numeric flag parsing
// ---------------------------------------------------------------------------

/**
 * Parse a flag value as an integer, falling back to `fallback` when it is
 * absent, empty, or non-numeric (NaN). Prevents a bad `--magnitude abc` /
 * `--seed xyz` from poisoning downstream arithmetic with NaN.
 */
export function parseIntFlag(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? fallback : n
}

/** Like parseIntFlag but clamps to a minimum of 1 (for magnitudes / counts). */
export function parsePositiveIntFlag(value: string | undefined, fallback: number): number {
  const n = parseIntFlag(value, fallback)
  return n < 1 ? fallback : n
}

// ---------------------------------------------------------------------------
// Calm mode (--zen / GROVE_ZEN) · see ADR-0005
// ---------------------------------------------------------------------------

/**
 * True when calm mode is on: the `--zen` flag OR a truthy `GROVE_ZEN` env var
 * (anything but unset / "" / "0" / "false"). Env support lets the git-hook /
 * statusline contexts (which don't pass flags) opt into calm globally.
 */
export function isZen(flags: Record<string, string>): boolean {
  if (flags['zen'] === 'true') return true
  const env = process.env['GROVE_ZEN']
  return env !== undefined && env !== '' && env !== '0' && env.toLowerCase() !== 'false'
}

/**
 * Print a single plain, terse calm-mode confirmation line. Calm mode strips ALL
 * spectacle (loot/crit/serendipity/milestone/offers/reveals) · the engine still
 * ran and persisted state; this line is the only thing the user sees.
 */
export function calmConfirm(message: string, locale: Locale = 'en'): void {
  console.log(t(locale, 'cli.confirm', { message }))
}

// ---------------------------------------------------------------------------
// TTY reveal animation
// ---------------------------------------------------------------------------

/**
 * Sleep `ms` milliseconds WITHOUT a CPU-burning busy-loop, in a synchronous
 * context. `Atomics.wait` parks the thread on a private SharedArrayBuffer that
 * is never signalled, so it blocks for the timeout without spinning a core
 * (unlike `while (Date.now() < until) {}`). Used only for the TTY reveal cadence.
 */
export function sleepSync(ms: number): void {
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
export function playReveal(frames: string[]): void {
  if (!process.stdout.isTTY) return
  for (const frame of frames) {
    process.stdout.write(`\r  ${frame}   `)
    sleepSync(120) // ~120ms per frame, non-busy
  }
  process.stdout.write('\r\x1b[K') // carriage-return + clear-to-EOL
}

// ---------------------------------------------------------------------------
// Gear ref resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a gear ref (gear id, 1-based index, or 'first') to an index into
 * `gear`. Returns -1 when the ref is unresolvable. Pure helper.
 */
export function resolveGearRef(gear: { id: string }[], ref: string): number {
  const normalized = ref.toLowerCase()
  if (normalized === 'first') return gear.length > 0 ? 0 : -1
  const asInt = parseInt(ref, 10)
  if (!isNaN(asInt) && String(asInt) === ref) return asInt - 1 // 1-based
  return gear.findIndex((g) => g.id === ref)
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
export function printContextualOffers(
  rewards: ReturnType<typeof ingestEvent>['rewards'],
  dir: string,
  locale: Locale = 'en',
): void {
  const hasCrit = rewards.some((r) => r.crit === true)
  if (hasCrit) {
    console.log(t(locale, 'cli.offer.crit'))
  }

  try {
    const state = loadState(dir)
    if (state.energy.known && typeof state.energy.vigor === 'number' && state.energy.vigor < 20) {
      console.log(t(locale, 'cli.offer.low_energy'))
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Reward printing (shared by every loot-bearing handler)
// ---------------------------------------------------------------------------

/** Print each reward's formatted line (the scriptable loot output). */
export function printRewards(rewards: Reward[], locale: Locale = 'en'): void {
  for (const reward of rewards) {
    const line = reward.msgKey
      ? t(locale, reward.msgKey, reward.msgArgs)
      : formatReward(reward)
    console.log(line)
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
 * either case. This file lives in src/cli/commands/, three levels below root, so
 * we resolve via the BUILT bundle path explicitly (`../..`/'dist'/...) keyed off
 * the package root, which both the source and bundled layouts share.
 */
export function groveInvocation(opts: GroveInvocationOpts = {}): string {
  const sqOnPath = opts.sqOnPath ?? defaultSqOnPath
  if (sqOnPath()) return 'sq'

  const moduleUrl = opts.moduleUrl ?? import.meta.url
  const thisFile = url.fileURLToPath(moduleUrl)
  // This module is bundled INTO dist/cli/sq.js (tsup single-entry bundle), so at
  // runtime import.meta.url points at dist/cli/sq.js · two levels below root.
  // In dev (tsx) it is src/cli/commands/shared.ts · three levels below root. Walk
  // up until we find a dir that contains dist/cli/sq.js, falling back to the
  // two-levels-up root (the bundled case) so the built artifact resolves cleanly.
  const root = resolvePackageRoot(thisFile)
  const built = path.join(root, 'dist', 'cli', 'sq.js')
  return `node ${shQuote(built)}`
}

/**
 * Resolve the package root from this module's file path. In the BUILT bundle the
 * module is dist/cli/sq.js (root = ../..); in dev source it is
 * src/cli/commands/shared.ts (root = ../../..). Walk up to the first ancestor
 * that actually contains dist/cli/sq.js; fall back to two-levels-up (the bundled
 * layout) so a built artifact always resolves even before it exists.
 */
function resolvePackageRoot(thisFile: string): string {
  let dir = path.dirname(thisFile)
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'dist', 'cli', 'sq.js'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: the bundled layout (dist/cli/sq.js) is two levels below root.
  return path.resolve(path.dirname(thisFile), '..', '..')
}

// ---------------------------------------------------------------------------
// AI-CLI detection (onboarding) · PATH probe, injectable for tests
// ---------------------------------------------------------------------------

/** Known AI-coding CLIs Grove can ride alongside (ADR-0001, tool-agnostic). */
export const KNOWN_AI_CLIS = ['claude', 'cursor', 'aider', 'codex', 'copilot', 'gemini'] as const

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

// Re-export the imports that handler modules also need, so each group module
// imports state plumbing from one place where convenient. (loadState etc. are
// also imported directly by handlers; this keeps shared the single seam.)
export { loadState, saveState, withStateLock, ingestEvent, formatReward }

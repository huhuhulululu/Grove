import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { parseEvent } from '../core/events'
import type { GroveEvent } from '../core/events'

// ---------------------------------------------------------------------------
// Cross-process exclusive lock
// ---------------------------------------------------------------------------

/** Max time to wait acquiring the lock before stealing/giving up (ms). */
const LOCK_TIMEOUT_MS = 3000
/** A lock whose file is older than this is considered abandoned and stolen (ms). */
const LOCK_STALE_MS = 10_000
/** Pause between acquisition attempts (ms). */
const LOCK_RETRY_MS = 25

/** Block the current thread for `ms` milliseconds (sync — runs inside a CLI process). */
function sleepSync(ms: number): void {
  // Atomics.wait on a throwaway buffer is the simplest portable sync sleep.
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}

/**
 * Run `fn` while holding an exclusive cross-process lock for `dir`.
 *
 * The lock is a `${dir}/.lock` file created atomically with `wx` (exclusive
 * create — fails if it already exists). On contention we retry with a small
 * backoff for up to ~LOCK_TIMEOUT_MS. A lock whose file mtime is older than
 * ~LOCK_STALE_MS is assumed abandoned (a process that crashed before releasing)
 * and is stolen. The lock is always released (close + unlink) in a `finally`,
 * even if `fn` throws.
 *
 * This serializes the load→reduce→save→appendEvent read-modify-write so two
 * concurrent ingests (e.g. the post-commit hook + the statusline pipe) cannot
 * lose each other's updates.
 */
export function withStateLock<T>(dir: string, fn: () => T): T {
  fs.mkdirSync(dir, { recursive: true })
  const lockPath = path.join(dir, '.lock')

  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let fd: number | undefined

  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx')
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err

      // Lock is held by someone else. If it looks abandoned (stale mtime), steal it.
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs
        if (age > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath)
          continue
        }
      } catch {
        // The holder released between EEXIST and stat — just retry immediately.
        continue
      }

      if (Date.now() >= deadline) {
        // Last resort after waiting the full timeout: treat as stale and steal,
        // rather than failing the (fail-open) ingest path.
        try {
          fs.unlinkSync(lockPath)
        } catch {
          /* someone else won the race — loop will retry */
        }
        continue
      }
      sleepSync(LOCK_RETRY_MS)
    }
  }

  try {
    return fn()
  } finally {
    try {
      fs.closeSync(fd)
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(lockPath)
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// GameState schema + versioned migration
// ---------------------------------------------------------------------------

/** Zod schema for the persisted GameState. Mirrors core/state.ts. */
const GameStateSchema = z.object({
  version: z.number(),
  player: z.object({
    xp: z.number(),
    level: z.number(),
    currency: z.number(),
  }),
  cards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      rarity: z.string(),
      set: z.string(),
    }),
  ),
  gear: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      level: z.number(),
      rarity: z.string(),
      broken: z.boolean(),
    }),
  ),
  pity: z.object({ sinceLegendary: z.number() }),
  completedSets: z.array(z.string()),
  buffs: z.array(z.record(z.unknown())),
  eventCount: z.number(),
  quests: z.array(z.record(z.unknown())),
  energy: z.object({ known: z.boolean() }).passthrough(),
  work: z.object({
    workMeter: z.number(),
    lastCostUsd: z.number(),
    windowKey: z.number(),
    milestonesInWindow: z.number(),
  }),
  protectedGear: z.array(z.string()),
})

/**
 * The migratable core of a GameState — only the fields the engine actually
 * relies on must be PRESENT and well-typed for a state to be recoverable.
 * Newer/optional fields are filled from initialState() defaults below.
 */
const MigratableSchema = z.object({
  player: z.object({
    xp: z.number(),
    level: z.number(),
    currency: z.number().optional(),
  }),
  cards: z.array(z.unknown()).optional(),
  gear: z.array(z.unknown()).optional(),
  pity: z.object({ sinceLegendary: z.number() }).optional(),
})

/**
 * Bring a loosely-shaped parsed object up to the current GameState by filling
 * any missing fields with initialState() defaults. Keyed off `version` so future
 * versioned migrations can branch here. Defensive against partially-written or
 * legacy states (pre-energy/quests/eventCount).
 */
function migrate(raw: Record<string, unknown>): GameState {
  const defaults = initialState()
  const player = (raw['player'] ?? {}) as Record<string, unknown>

  return {
    version: typeof raw['version'] === 'number' ? (raw['version'] as number) : defaults.version,
    player: {
      xp: typeof player['xp'] === 'number' ? (player['xp'] as number) : defaults.player.xp,
      level: typeof player['level'] === 'number' ? (player['level'] as number) : defaults.player.level,
      currency:
        typeof player['currency'] === 'number'
          ? (player['currency'] as number)
          : defaults.player.currency,
    },
    cards: Array.isArray(raw['cards']) ? (raw['cards'] as GameState['cards']) : defaults.cards,
    gear: Array.isArray(raw['gear']) ? (raw['gear'] as GameState['gear']) : defaults.gear,
    pity:
      raw['pity'] && typeof (raw['pity'] as Record<string, unknown>)['sinceLegendary'] === 'number'
        ? (raw['pity'] as GameState['pity'])
        : defaults.pity,
    completedSets: Array.isArray(raw['completedSets'])
      ? (raw['completedSets'] as string[])
      : defaults.completedSets,
    buffs: Array.isArray(raw['buffs']) ? (raw['buffs'] as GameState['buffs']) : defaults.buffs,
    eventCount:
      typeof raw['eventCount'] === 'number' ? (raw['eventCount'] as number) : defaults.eventCount,
    quests: Array.isArray(raw['quests']) ? (raw['quests'] as GameState['quests']) : defaults.quests,
    energy:
      raw['energy'] && typeof (raw['energy'] as Record<string, unknown>)['known'] === 'boolean'
        ? (raw['energy'] as GameState['energy'])
        : defaults.energy,
    work: migrateWork(raw['work'], defaults.work),
    // Additive R3 field — legacy states predating gear-protect get a fresh default.
    protectedGear: Array.isArray(raw['protectedGear'])
      ? (raw['protectedGear'] as string[]).filter((x): x is string => typeof x === 'string')
      : defaults.protectedGear,
  }
}

/**
 * Fill a (possibly absent/partial) `work` accumulator with defaults. Additive R3
 * field — legacy states predating the token-milestone floor get a fresh default.
 */
function migrateWork(
  raw: unknown,
  defaults: GameState['work'],
): GameState['work'] {
  const w = (raw ?? {}) as Record<string, unknown>
  return {
    workMeter: typeof w['workMeter'] === 'number' ? (w['workMeter'] as number) : defaults.workMeter,
    lastCostUsd:
      typeof w['lastCostUsd'] === 'number' ? (w['lastCostUsd'] as number) : defaults.lastCostUsd,
    windowKey: typeof w['windowKey'] === 'number' ? (w['windowKey'] as number) : defaults.windowKey,
    milestonesInWindow:
      typeof w['milestonesInWindow'] === 'number'
        ? (w['milestonesInWindow'] as number)
        : defaults.milestonesInWindow,
  }
}

/**
 * Back up a corrupt state file alongside it as `state.json.corrupt.<ts>` so the
 * bad data is never silently discarded. Best-effort: a failure to back up must
 * never prevent recovery.
 */
function backupCorrupt(file: string, raw: string): void {
  try {
    const backup = `${file}.corrupt.${Date.now()}`
    fs.writeFileSync(backup, raw, 'utf8')
  } catch {
    // Best-effort only.
  }
}

/**
 * Read `${dir}/state.json` and return a valid, current-shape GameState.
 *  - Absent file → initialState().
 *  - Valid current state → returned as-is.
 *  - Legacy/partial state (missing energy/quests/eventCount/buffs/…) → migrated
 *    with defaults filled (no throw).
 *  - Unrecoverable corruption (unparseable JSON, or missing/ill-typed core
 *    fields like player.xp) → back up the bad file as state.json.corrupt.<ts>
 *    and return initialState() rather than throwing.
 */
export function loadState(dir: string): GameState {
  const file = path.join(dir, 'state.json')
  if (!fs.existsSync(file)) {
    return initialState()
  }

  const raw = fs.readFileSync(file, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Unparseable → unrecoverable.
    backupCorrupt(file, raw)
    return initialState()
  }

  // Already a full, current-shape state → fast path, no migration needed.
  if (GameStateSchema.safeParse(parsed).success) {
    return parsed as GameState
  }

  // Recoverable iff the engine-critical core is present and well-typed.
  if (MigratableSchema.safeParse(parsed).success) {
    return migrate(parsed as Record<string, unknown>)
  }

  // Structurally invalid beyond migration → back up + reset.
  backupCorrupt(file, raw)
  return initialState()
}

/** Atomically write state to `${dir}/state.json` (tmp-then-rename). */
export function saveState(dir: string, state: GameState): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'state.json')
  const tmp = path.join(dir, 'state.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
  fs.renameSync(tmp, file)
}

/** Append a single event as a JSON line to `${dir}/events.jsonl`. */
export function appendEvent(dir: string, event: GroveEvent): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'events.jsonl')
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8')
}

/**
 * Read all events from `${dir}/events.jsonl`.
 * Returns [] if the file is absent.
 * Lines that fail to parse (or fail GroveEvent validation) are silently skipped.
 */
export function readEvents(dir: string): GroveEvent[] {
  const file = path.join(dir, 'events.jsonl')
  if (!fs.existsSync(file)) {
    return []
  }
  const raw = fs.readFileSync(file, 'utf8')
  const results: GroveEvent[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      results.push(parseEvent(parsed))
    } catch {
      // skip malformed lines
    }
  }
  return results
}

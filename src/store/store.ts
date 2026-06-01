import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { initialState } from '../core/state'
import type { GameState, EnergyState, WorkMeterState } from '../core/state'
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
 * Run `fn` while holding an exclusive cross-process lock at `${lockDir}/.lock`.
 *
 * The lock is a `${lockDir}/.lock` file created atomically with `wx` (exclusive
 * create — fails if it already exists). On contention we retry with a small
 * backoff for up to ~LOCK_TIMEOUT_MS. A lock whose file mtime is older than
 * ~LOCK_STALE_MS is assumed abandoned (a process that crashed before releasing)
 * and is stolen. The lock is always released (close + unlink) in a `finally`,
 * even if `fn` throws. Shared by both the per-repo and the account-global locks.
 */
function withLockDir<T>(lockDir: string, fn: () => T): T {
  fs.mkdirSync(lockDir, { recursive: true })
  const lockPath = path.join(lockDir, '.lock')

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

/**
 * Run `fn` while holding the per-repo exclusive lock (`${dir}/.lock`).
 *
 * This serializes the load→reduce→save→appendEvent read-modify-write so two
 * concurrent ingests (e.g. the post-commit hook + the statusline pipe) cannot
 * lose each other's updates.
 */
export function withStateLock<T>(dir: string, fn: () => T): T {
  return withLockDir(dir, fn)
}

/**
 * Run `fn` while holding the ACCOUNT-GLOBAL exclusive lock (`<home>/_global/.lock`).
 *
 * R6 P1: the account-wide energy/work file (`<home>/_global/global.json`) is
 * shared across every repo and process, yet `writeGlobal` ran only under the
 * PER-REPO lock — two different repos hold DIFFERENT per-repo locks, so their
 * concurrent global read-modify-writes could clobber each other (the R2
 * lost-update guarantee regressed for the shared file). This gives the global
 * file its OWN cross-process lock, keyed off `<home>/_global` so EVERY repo under
 * the same home contends on the SAME lock. Same atomic-create + backoff +
 * stale-steal semantics as withStateLock.
 *
 * `dir` is any per-repo state dir; the global lock dir is its sibling `_global`.
 */
export function withGlobalLock<T>(dir: string, fn: () => T): T {
  return withLockDir(globalLockDir(dir), fn)
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
    // R6 schema P0: the R5 dup-tail shards must PERSIST and VALIDATE (was absent,
    // so a saved state with shards round-tripped only by accident). Optional so
    // legacy states (pre-shards) still validate; migrate() fills a default 0.
    shards: z.number().optional(),
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
  // Track A loadout (ADR-0014 rev.2). Optional so legacy states (pre-loadout) still
  // validate against the FAST path; migrate() fills the default {slots:[]}. Slot
  // refs are loosely shaped here (engine owns the EquippedRef contract).
  loadout: z
    .object({
      slots: z.array(
        z.object({
          kind: z.string(),
          id: z.string(),
          tag: z.string().optional(),
        }),
      ),
    })
    .optional(),
  // Achievements (ADR-0015 rev.2). Optional so legacy states (pre-achievements)
  // still validate against the FAST path; migrate() fills the default [].
  achievements: z.array(z.string()).optional(),
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
    shards: z.number().optional(),
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
      // R6 schema P0: legacy states predating the dup tail get a fresh shards 0.
      shards:
        typeof player['shards'] === 'number'
          ? (player['shards'] as number)
          : (defaults.player.shards ?? 0),
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
    // Track A loadout (ADR-0014) — legacy states predating it get a fresh {slots:[]}.
    loadout: migrateLoadout(raw['loadout'], defaults.loadout),
    // Achievements (ADR-0015) — legacy states predating it get a fresh []. Keep only
    // string ids (a malformed entry is dropped, never throws).
    achievements: Array.isArray(raw['achievements'])
      ? (raw['achievements'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : defaults.achievements,
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
 * Fill a (possibly absent/partial) `loadout` with defaults (ADR-0014). Additive —
 * legacy states predating the loadout get a fresh `{slots:[]}`. Each slot is kept
 * only if it has a string `kind` + `id` (a malformed slot is dropped, never throws);
 * the optional `tag` is preserved when it is a string.
 */
function migrateLoadout(
  raw: unknown,
  defaults: GameState['loadout'],
): GameState['loadout'] {
  const l = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(l['slots'])) return defaults
  const slots = (l['slots'] as unknown[])
    .filter(
      (s): s is Record<string, unknown> =>
        typeof s === 'object' && s !== null,
    )
    .filter((s) => typeof s['kind'] === 'string' && typeof s['id'] === 'string')
    .map((s) => {
      const ref: GameState['loadout']['slots'][number] = {
        kind: s['kind'] as GameState['loadout']['slots'][number]['kind'],
        id: s['id'] as string,
      }
      if (typeof s['tag'] === 'string') ref.tag = s['tag']
      return ref
    })
  return { slots }
}

// ---------------------------------------------------------------------------
// File-rotation / hygiene (R8) — timestamped sidecar files (settings backups,
// corrupt-state backups) and the append-only event log are capped so they never
// grow without bound (a disk-hygiene + minor info-exposure concern). Keep the
// NEWEST few; drop the rest. Best-effort: a rotation failure never breaks I/O.
// ---------------------------------------------------------------------------

/** How many newest timestamped backups to keep (settings + corrupt-state). */
export const BACKUP_KEEP = 3

/** Soft cap on events.jsonl line count — trimmed to the newest this many. */
export const EVENTS_MAX_LINES = 5000

/**
 * Keep only the newest `keep` files in `dir` whose name starts with `prefix`;
 * delete the older ones. Ordering is by mtime (newest first), tie-broken by name
 * (the timestamp suffix sorts lexicographically too). Best-effort & total: a stat
 * or unlink failure is swallowed so a backup-rotation hiccup never breaks a write.
 * PURE-of-throw — exported so the CLI can rotate after a statusline install/uninstall.
 */
export function rotateBackups(dir: string, prefix: string, keep: number = BACKUP_KEEP): void {
  try {
    const matches = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .map((name) => {
        let mtimeMs = 0
        try {
          mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs
        } catch {
          /* gone between readdir and stat — treat as oldest */
        }
        return { name, mtimeMs }
      })
      // Newest first (mtime desc, then name desc so the ts-suffix breaks ties).
      .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1))

    for (const { name } of matches.slice(Math.max(0, keep))) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch {
        /* already gone — fine */
      }
    }
  } catch {
    // dir unreadable → nothing to rotate.
  }
}

/**
 * Back up a corrupt state file alongside it as `state.json.corrupt.<ts>` so the
 * bad data is never silently discarded, then prune old corrupt backups so they
 * can't accumulate forever. Best-effort: a failure to back up must never prevent
 * recovery.
 */
function backupCorrupt(file: string, raw: string): void {
  try {
    const backup = `${file}.corrupt.${Date.now()}`
    fs.writeFileSync(backup, raw, 'utf8')
    // Keep only the newest BACKUP_KEEP corrupt backups (disk hygiene).
    rotateBackups(path.dirname(file), `${path.basename(file)}.corrupt.`)
  } catch {
    // Best-effort only.
  }
}

// ---------------------------------------------------------------------------
// ACCOUNT-GLOBAL energy/work store (AI-eng P1) — quota/energy is account-WIDE,
// not per-repo: the 5h/7d usage windows are shared by every repo you work in. So
// energy + the token-milestone work meter live in ONE shared file next to all
// the per-repo state dirs (`<home>/_global/global.json`, where <home> is the dir
// containing every `<home>/<repoKey>`), while each repo's state.json keeps its
// own COSMETIC progress (cards/gear/xp/level/currency/pity/quests/buffs).
//
// loadState transparently MERGES the global energy/work over the per-repo state;
// saveState SPLITS energy/work back out to the global file. reduce/cli stay
// unchanged — they keep reading/writing state.energy / state.work as before.
// ---------------------------------------------------------------------------

/** Schema for the shared global energy/work file. */
const GlobalSchema = z.object({
  energy: z.object({ known: z.boolean() }).passthrough(),
  work: z.object({
    workMeter: z.number(),
    lastCostUsd: z.number(),
    windowKey: z.number(),
    milestonesInWindow: z.number(),
  }),
})

/** The shared-global directory for a per-repo state `dir` (sibling `_global`). */
function globalLockDir(dir: string): string {
  return path.join(path.dirname(dir), '_global')
}

/** The shared-global file path for a per-repo state `dir` (sibling `_global` dir). */
function globalFile(dir: string): string {
  return path.join(globalLockDir(dir), 'global.json')
}

/**
 * Read the shared global energy/work, or null when absent/unreadable. A missing
 * or corrupt global file is non-fatal: the per-repo state's own energy/work (or
 * the initialState default) is used instead.
 */
function readGlobal(dir: string): { energy: EnergyState; work: WorkMeterState } | null {
  const file = globalFile(dir)
  if (!fs.existsSync(file)) return null
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!GlobalSchema.safeParse(parsed).success) return null
    const g = parsed as { energy: EnergyState; work: WorkMeterState }
    return { energy: g.energy, work: g.work }
  } catch {
    return null
  }
}

/** Atomically write the shared global energy/work (tmp-then-rename). */
function writeGlobal(dir: string, state: GameState): void {
  const file = globalFile(dir)
  const gdir = path.dirname(file)
  fs.mkdirSync(gdir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ energy: state.energy, work: state.work }), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * Read `${dir}/state.json` and return a valid, current-shape GameState, with the
 * shared account-global energy/work MERGED in (when a global file exists).
 *  - Absent file → initialState() (still merged with any global energy/work).
 *  - Valid current state → returned as-is.
 *  - Legacy/partial state (missing energy/quests/eventCount/buffs/…) → migrated
 *    with defaults filled (no throw).
 *  - Unrecoverable corruption (unparseable JSON, or missing/ill-typed core
 *    fields like player.xp) → back up the bad file as state.json.corrupt.<ts>
 *    and return initialState() rather than throwing.
 *
 * The global merge is transparent: reduce/cli still read `state.energy` /
 * `state.work` exactly as before — they just now reflect the account-wide value.
 */
export function loadState(dir: string): GameState {
  const base = loadStateLocal(dir)
  const global = readGlobal(dir)
  // Global energy/work OVERRIDE the per-repo copy (account-wide is the truth).
  // When no global file exists yet, the per-repo / default values stand.
  if (global === null) return base
  return { ...base, energy: global.energy, work: global.work }
}

/** The per-repo state read, WITHOUT the global merge (the legacy behavior). */
function loadStateLocal(dir: string): GameState {
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

/**
 * Atomically write state to `${dir}/state.json` (tmp-then-rename), and SPLIT the
 * account-global energy/work out to the shared `<home>/_global/global.json`.
 *
 * The per-repo file still carries its own energy/work copy (so a per-repo read
 * with no global file present round-trips correctly); the shared global file is
 * the authoritative account-wide source that loadState merges back in.
 */
export function saveState(dir: string, state: GameState): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'state.json')
  const tmp = path.join(dir, 'state.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
  fs.renameSync(tmp, file)

  // Split energy/work out to the shared global store (account-wide). Guarded by
  // the GLOBAL lock (R6 P1): the global file is shared across repos/processes, so
  // its write must serialize on its OWN lock, not the per-repo lock (which differs
  // per repo and so couldn't protect the shared file from cross-repo clobber).
  withGlobalLock(dir, () => writeGlobal(dir, state))
}

/** Append a single event as a JSON line to `${dir}/events.jsonl`, capping growth. */
export function appendEvent(dir: string, event: GroveEvent): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'events.jsonl')
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8')
  capEventLog(file)
}

/**
 * Cap `events.jsonl` growth (R8 hygiene): if the log exceeds EVENTS_MAX_LINES,
 * rewrite it keeping only the NEWEST EVENTS_MAX_LINES lines (the oldest are
 * dropped — recap/seed-derivation only need recent history, and the cosmetic
 * state.json is the durable record). Best-effort & atomic (tmp-then-rename) so a
 * crash mid-trim never leaves a torn log. A failure is swallowed — the append
 * already succeeded, so a trim hiccup must never break the ingest path.
 */
function capEventLog(file: string): void {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const lines = raw.split('\n')
    // Trailing '' from the final newline is not a real line.
    const realCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    // Trim only once we're a MARGIN over the cap, then back down to the cap. This
    // amortizes the rewrite over MARGIN appends (O(1) avg) instead of rewriting the
    // whole file on every append once at the limit.
    if (realCount <= EVENTS_MAX_LINES + EVENTS_TRIM_MARGIN) return

    const kept = lines
      .filter((l) => l.trim() !== '')
      .slice(-EVENTS_MAX_LINES)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, kept.join('\n') + '\n', 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    // Best-effort: the append already landed; a trim failure is non-fatal.
  }
}

/** Slack above EVENTS_MAX_LINES before a trim fires (amortizes the rewrite). */
export const EVENTS_TRIM_MARGIN = 1000

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

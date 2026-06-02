import { parseEvent } from '../core/events'
import type { GroveEvent } from '../core/events'
import { mulberry32, hashStringToSeed } from '../core/rng'
import type { GameState } from '../core/state'
import type { Reward } from '../core/rewards'
import { reduce } from '../engine/reduce'
import { loadState, saveState, appendEvent, withStateLock, withGlobalLock } from '../store/store'

/**
 * Ingest a raw event into the Grove store for the given directory.
 *
 * Steps:
 *  1. Parse and validate `raw` into a GroveEvent (throws on invalid input).
 *  2. Load the current GameState from `dir` (or initialState if absent).
 *  3. Derive a deterministic RNG seed from the event's identity fields
 *     (or use the caller-supplied `rngSeed`).
 *  4. Run the pure `reduce` engine to get the next state and rewards.
 *  5. Persist the new state and append the event.
 *  6. Return `{ state, rewards }`.
 *
 * The entire load→reduce→save→append read-modify-write runs inside the per-repo
 * lock (`withStateLock`) so same-repo ingests can't lose each other's updates, AND
 * inside the account-global lock (`withGlobalLock`) so the shared energy/work file's
 * read (loadState→readGlobal) and write (saveState→writeGlobal) are ONE atomic RMW —
 * two DIFFERENT repos (distinct per-repo locks) accruing the work-meter concurrently
 * can no longer clobber each other (concurrency: the R6 P1 cross-repo lost-update).
 * Ordering is per-repo OUTER, global INNER everywhere (saveState also takes the
 * global lock inner — reentrant here), so there is no lock-ordering deadlock.
 *
 * This is the single seam that all adapters (git, sq-wrap, claude-code, …) call.
 */
export function ingestEvent(
  dir: string,
  raw: unknown,
  rngSeed?: number,
): { state: GameState; rewards: Reward[] } {
  const event: GroveEvent = parseEvent(raw)

  return withStateLock(dir, () => withGlobalLock(dir, () => {
    const state: GameState = loadState(dir)

    // Seed from the already-loaded state.eventCount instead of re-reading and
    // counting the whole events.jsonl (an O(n) reparse on every event). The
    // count still uniquely distinguishes successive events from one identity.
    const seed =
      rngSeed ??
      hashStringToSeed(
        `${event.sessionId}:${event.ts}:${event.type}:${state.eventCount}`,
      )
    const rng = mulberry32(seed)

    const { state: next, rewards } = reduce(state, event, rng)

    saveState(dir, next)
    appendEvent(dir, event)

    return { state: next, rewards }
  }))
}

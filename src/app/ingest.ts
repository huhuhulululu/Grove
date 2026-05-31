import { parseEvent } from '../core/events'
import type { GroveEvent } from '../core/events'
import { mulberry32, hashStringToSeed } from '../core/rng'
import type { GameState } from '../core/state'
import type { Reward } from '../core/rewards'
import { reduce } from '../engine/reduce'
import { loadState, saveState, appendEvent, withStateLock } from '../store/store'

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
 * The entire load→reduce→save→append read-modify-write runs inside an exclusive
 * cross-process lock (`withStateLock`) so concurrent ingests — e.g. a post-commit
 * hook firing while the high-frequency statusline pipe ingests a quota_update —
 * cannot lose each other's updates.
 *
 * This is the single seam that all adapters (git, sq-wrap, claude-code, …) call.
 */
export function ingestEvent(
  dir: string,
  raw: unknown,
  rngSeed?: number,
): { state: GameState; rewards: Reward[] } {
  const event: GroveEvent = parseEvent(raw)

  return withStateLock(dir, () => {
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
  })
}

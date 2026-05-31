# Grove — Architecture (technical source of truth)

> When this doc disagrees with the code, the code wins — then update this doc.

## Data flow

```
ADAPTERS (tool-specific, thin)        →  NORMALIZED EVENT  →  ENGINE (pure)        →  RENDERERS
 git hooks (chained) / sq wrap /          GroveEvent           reduce(state,event,    statusline HUD
 claude-code hooks / codex hooks /        (closed vocab)       rng) → {state,         `sq recap`
 file presence+diff scan                                       rewards[]}            web SSE / push
```

The **only** tool-specific code lives in adapters; they translate raw signals into a `GroveEvent`.
The engine never knows which tool produced an event. Renderers read game-state read-only.

## Core layer (`src/core/`) — LOCKED interfaces

Parallel work must conform to these signatures.

- `events.ts` — `GroveEvent` (zod). Closed `EVENT_TYPES` vocabulary. Fields:
  `{ source, sessionId, cwd?, repo?, type, magnitude(1-10), success, ts(ISO), meta }`.
- `state.ts` — `GameState { version, player{xp,level,currency}, cards[], gear[], pity{sinceLegendary},
  completedSets[], buffs[] }`; `initialState()`. **Immutable updates only** (return new objects).
- `rng.ts` — `mulberry32(seed)`, `hashStringToSeed(s)`, `weightedPick(rng, entries)`. Deterministic & seedable (ADR-0002).
- `rewards.ts` — `RARITIES`, `Rarity`, `Card`, `Gear`, `Reward`. All rewards are **cosmetic**.

## Engine layer (`src/engine/`) — pure functions, no I/O, immutable

| Module | Exported signature (target) | Notes |
|---|---|---|
| `xp.ts` | `xpForLevel(level): number`; `applyXp(player, amount): {player, levelUps}` | capped quadratic curve; first level ~3 actions; per-level cost clamped |
| `gacha.ts` | `RARITY_ODDS`; `pull(pity, rng): {rarity, pity}`; `makeCard(rarity, rng): Card` | soft pity ~8, hard pity ~14 → guaranteed legendary; published odds |
| `gear.ts` | `enhanceTable(level)`; `enhance(gear, rng): {gear, result}` | result ∈ success/downgrade/break/stay; **cosmetic gear only** (firewall) |
| `collection.ts` | `addCard(cards, completedSets, card): {cards, completedSets, newlyCompleted}` | set-completion detection + bonus |
| `reduce.ts` | `reduce(state, event, rng): {state, rewards: Reward[]}` | maps event.type → engine calls; Pillar-B events weighted higher |

### `reduce` event → reward mapping (target)
- `commit` (success) → small XP (+ currency).
- `test_result` (success) → XP + **gacha pull** → card via collection.
- `build_result`/`lint_clean` (success) → XP + chance of pull.
- `pr_merged` → larger XP + guaranteed pull.
- `doc_updated`/`spec_written`/`plan_written` → **large XP (Pillar B weighted)** + buff.
- `checkpoint` → "refreshed" buff + guaranteed small drop (rest, not chore).
- `review_confirmed` → XP + rarity boost.
- failing/`success:false` events → no reward (never punish; just no drop).

## Firewall (ADR-0005)
The engine's only inputs are `(GameState, GroveEvent, Rng)` and its only output is `(GameState, Reward[])`.
It has **no filesystem, git, or process access**. Therefore no game outcome can touch real work —
this is enforced by construction, not policy.

## Later phases (not built yet)
State persistence (SQLite WAL single-writer daemon / append-only log), adapters (git/sq-wrap/claude/codex),
renderers (statusline/recap/web SSE/ntfy push). See docs/PROJECT-CONTEXT.md for build order.

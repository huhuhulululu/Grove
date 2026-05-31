# Grove — Architecture (technical source of truth)

> When this doc disagrees with the code, the code wins — then update this doc.
> Last updated: 2026-05-31 (R6, after engine-depth + cli/ux round).

## Data flow

```
ADAPTERS (impure, tool-specific)     →  NORMALIZED EVENT  →  ENGINE (pure)        →  RENDERERS / CLI
 adapters/githook.ts (post-commit)       GroveEvent            reduce(state,event,    render/dashboard.ts
 adapters/statusline.ts (quota)          (closed vocab)        rng) → {state,         render/format.ts
 adapters/statusline-install.ts                                rewards[]}             render/enhance.ts
 adapters/git-utils.ts (diff/stash)                                                   render/width.ts
 adapters/shquote.ts (injection-safe)
 detect/pillarb.ts (Pillar-B signals)
 sq wrap -- <cmd>  (real exit code)
```

The **only** tool-specific code lives in adapters. They translate raw signals into a `GroveEvent`. The engine never knows which tool produced an event. Renderers read game-state read-only.

## Core layer (`src/core/`) — LOCKED interfaces

Parallel work must conform to these signatures.

- `events.ts` — `GroveEvent` (zod). Closed `EVENT_TYPES` vocabulary. Fields:
  `{ source, sessionId, cwd?, repo?, type, magnitude(1-10), success, ts(ISO), meta }`.
- `state.ts` — `GameState { version, player{xp,level,currency,shards?}, cards[], gear[],
  pity{sinceLegendary}, completedSets[], buffs[], eventCount, quests[], energy{EnergyState},
  work{WorkMeterState}, protectedGear[] }`. `initialState()`. **Immutable updates only.**
- `rng.ts` — `mulberry32(seed)`, `hashStringToSeed(s)`, `weightedPick(rng, entries)`. Deterministic & seedable (ADR-0002).
- `rewards.ts` — `RARITIES`, `Rarity`, `Card`, `Gear`, `Reward`. All rewards are **cosmetic**.
- `cards.ts` — `CARD_SETS`, `cardDefsByRarity`, `cardIdsInSet`, `cardFromDef`. Card content catalogue.
- `quests.ts` — `QUESTS` (the 4 Pillar-B quest definitions).

## Engine layer (`src/engine/`) — pure functions, no I/O, immutable

| Module | Key exports | Notes |
|---|---|---|
| `xp.ts` | `xpForLevel(level)`, `applyXp(player,amount)`, `levelUpSeedBonus(n)` | Capped quadratic curve; level-ups now grant seeds (R5). |
| `gacha.ts` | `RARITY_ODDS`, `PREMIUM_RARITY_ODDS`, `REALIZED_LEGENDARY_SHINY_RATE`, `pull(pity,rng,odds?)`, `makeCard(rarity,rng,level?)` | Soft pity (~40), hard pity (~60). Premium banner = 5× cost, better odds. Realized rate published. |
| `gear.ts` | `makeGear(rng)`, `enhance(gear,rng,protect?)`, `enhanceTable(level)`, `activeGearBonus(state)`, `gearEffectText(gear)`, `enhanceCost(level)`, `repairCost(gear)`, `repairGear(state,id)` | Gear level MATTERS: Commit Hammer +seeds%, Type Saber +crit%, Build/Refactor Blade +XP%. Costs escalate with level. |
| `collection.ts` | `addCard(cards,completedSets,card)`, `shardsForDuplicate(rarity)` | Set-completion detection + bonus. Dup → cosmetic shards. |
| `quests.ts` | `applyQuests(state,event,rng,rewards)`, `activeMultiplier`, `activeFreshnessBonus`, `activeSeedBonus`, `activeStreakMultiplier`, `SET_BONUS_SEED`, `DUP_COMP_SEEDS` | Pillar-B aura/multiplier/freshness/streak buffs; first-time-only achievements (anti-overjustification). |
| `reduce.ts` | `reduce(state,event,rng)`, `pull(state,rng)`, `pullPremium(state,rng)`, `buyPrestige(state)`, `PULL_COST`, `PREMIUM_PULL_COST`, `PRESTIGE_COST`, `CRIT_CHANCE`, `SERENDIPITY_CHANCE`, `WORK_MILESTONE` | Composition layer: maps event type → XP+seeds+gacha+gear+quest+energy. Three progression layers (outcomes + token-milestone floor + serendipity). Agency-bearing player actions: `pull`, `pullPremium`, `buyPrestige`. |

### `reduce` — event → reward mapping (shipped)

| Event type | Grants |
|---|---|
| `commit` | XP + seeds + serendipity chance |
| `test_result`, `build_result`, `lint_clean` | XP + seeds + serendipity chance |
| `pr_merged` | XP + seeds + guaranteed pull + gear drop + serendipity chance |
| `doc_updated`, `spec_written`, `plan_written` | Large XP (Pillar B weighted) + seeds + serendipity chance |
| `review_confirmed` | XP + seeds + serendipity chance |
| `checkpoint` | 'Refreshed' rest buff + guaranteed gift pull (rest, not chore) |
| `quota_update` | Energy state update + token-milestone chest (cosmetic) + Second Wind rest buff on reset |
| Everything else (`session_start`, `file_edit`, `test_added`, `file_presence`, …) | Quest effects only (no base reward) |

Failing events (`success:false`): eventCount advances + buffs expire silently; **no reward, no draw** (firewall).

### Three progression layers (R3/R5)

1. **Outcomes (primary):** green tests / merges / specs / docs → main XP + seeds. Dominant driver.
2. **Token-milestone floor (保底, ADR-0010):** cumulative cost fills a work meter; crossing `WORK_MILESTONE` grants a cosmetic chest. Capped 2×/5h window. Never XP/power.
3. **Serendipity (奇遇):** `SERENDIPITY_CHANCE` (5%) stochastic surprise on successful outcomes — lucky free pull or seed windfall. Variable-ratio dopamine.

### Economy (seeds, R3/R5)

- **Faucet:** outcome grants + level-up seeds + serendipity windfalls + milestone chests.
- **Sinks:** `sq pull` (30 🌰), `sq pull --premium` (150 🌰), `sq enhance` (20+ escalating), `sq repair` (50+ escalating), `sq protect` (40 🌰), `sq prestige` (500 🌰).
- Escalating enhance/repair costs (level × multiplier) mean late-game gear is a deepening seed sink — preserving save-vs-spend decisions at every stage.

## Store layer (`src/store/`)

- `paths.ts` — `stateDir(home?)`: resolves grove home directory (`~/.grove` by default).
- `store.ts` — `loadState(dir)`, `saveState(dir,state)`, `readEvents(dir)`, `withStateLock(dir,fn)`: atomic JSON state + JSONL event log. Cross-process lockfile guards the read-modify-write cycle (R2 trust fix).

## App layer (`src/app/`)

- `ingest.ts` — `ingestEvent(dir, rawEvent)`: the adapter→engine seam. Loads state under lock, runs `reduce`, saves state, returns rewards.
- `recap.ts` — `buildRecap(events, state, opts?)`: derives a session or all-time recap from the JSONL event log.

## Adapters (`src/adapters/`)

| File | Purpose |
|---|---|
| `githook.ts` | Chain-safe `installPostCommit` / `uninstallPostCommit` (honors `core.hooksPath` / husky / lefthook; sentinel block; never clobbers). |
| `statusline.ts` | Parse Claude Code statusline JSON → `quota_update` GroveEvent. Handles `rate_limits` epoch/ISO, Wellspring mode. |
| `statusline-install.ts` | Surgical jq-based statusline wrapper install/uninstall (backs up original; chain-safe). |
| `git-utils.ts` | `execFileSync`-based git helpers: `stagedDiffStat`, `createStashSnapshot`, `currentBranch`. No shell injection. |
| `shquote.ts` | POSIX single-quote escape (`shQuote`) for safe path interpolation in generated scripts. |

## Detect (`src/detect/`)

- `pillarb.ts` — `scanRepo(repoDir)`: tool-agnostic Pillar-B signal detector. Reads file presence + last-commit diff via `git diff-tree --root HEAD` to emit `test_added` / `doc_updated` / `spec_written` / `file_presence`. Anti-overjustification: a signal only fires once per detection key.

## Render (`src/render/`)

| File | Purpose |
|---|---|
| `dashboard.ts` | Full-screen, in-place dashboard (pure). Sections: ENERGY · WORK · COLLECTION · GEAR · QUESTS · BUFFS. Wide-emoji cell-accurate layout via `width.ts`. |
| `format.ts` | `formatReward`, `formatStatus`, `formatRecap`, `formatQuests` — terse Diablo loot-grammar lines (ADR-0009). |
| `enhance.ts` | `renderEnhanceOdds`, `renderEnhanceResult`, `renderPullFrames` — the gear risk reveal + pack-opening animation frames. |
| `width.ts` | `displayWidth`, `padToWidth`, `truncateToWidth` — terminal-cell-accurate string layout for wide emoji / CJK. |

## CLI (`src/cli/`)

- `sq.ts` — entry point + all subcommand handlers. Impure shell: may use process / console / wall-clock / filesystem. Pure engine logic flows through `ingestEvent` and `reduce` — no re-implementation in the CLI.
  - Global flags: `--zen` (calm mode, ADR-0005) · `--home DIR` (override grove state dir).
  - Subcommands: `event` · `wrap` · `status` · `recap` · `scan` · `quests` · `pull` · `enhance` · `repair` · `protect` · `dashboard` · `statusline-ingest` · `statusline install/uninstall` · `init` · `uninstall` · `commit-hook` · `suggest-commit` · `checkpoint` · `help`.
  - `groveInvocation()`: portable injection-safe CLI re-invocation (bare `sq` when on PATH, else `node '<shQuote(abs-path)>'`).
  - `suggestSubcommand(input)`: Levenshtein "did you mean?" for unknown subcommands.

## Firewall (ADR-0005)

The engine's only inputs are `(GameState, GroveEvent, Rng)` and its only outputs are `(GameState, Reward[])`.
It has **no filesystem, git, or process access**. No game outcome can touch real work — structural guarantee, not policy.

The impure shell (`store/`, `app/`, `adapters/`, `cli/`, `render/`) is the only place I/O may live.

## Purity enforcement (CI/test)

A test verifies that `src/engine/` and `src/core/` have zero imports of `node:fs`, `node:path`, `node:child_process`, `process`, `Date.now`, or `Math.random`. The firewall is checked by construction on every test run.

## Later phases (ROADMAP, not built)

- **Account-global energy store:** quota is account-wide; the current energy state is per-repo (known limit). A global `~/.grove/global-state.json` with its own lockfile is needed.
- **Navigable Ink TUI:** the dashboard today is a string render, redrawn on demand. A live-updating, keyboard-navigable TUI is M3 roadmap.
- **Web SSE dashboard + mobile push (M5):** SSE server + ntfy push for live session display on phone/web.
- **Social + leaderboard (M6, ADR-0011):** opt-in, league-based, server-verified outcomes only.

# Grove

A local-first, tool-agnostic **game layer for AI-assisted coding**. Two pillars:
- **Relieve fatigue** — turn invisible wins (green tests, merges, builds) into loot/XP/collection.
- **Drive good habits** — turn skipped chores (write CLAUDE.md, specs, keep docs synced) into quests/buffs.

## Hard constraints (see docs/decisions.md)
- **Ethics firewall**: the engine is pure (events → cosmetic game-state). Real code/commits/docs/git
  history can NEVER be modified, lost, or penalized by any game outcome. Rewards are cosmetic only.
- **Tool-agnostic**: capture events via adapters → one normalized event schema. Never couple to one tool.
- **Never auto-run tests**; ingest signals via `sq wrap <cmd>`, chained git hooks, file presence/diff.
- **Never clobber** existing git hooks (husky/lefthook/core.hooksPath) — chain.
- **Reward outcomes, never raw activity** (no LOC/commit-count/hours). Forgiving, no shame, calm mode.

## Commands
- `npm test` — run vitest (TDD: write test RED → impl GREEN). Coverage target 80%+.
- `npm run typecheck` — tsc --noEmit.
- `sq --zen <cmd>` (or env `GROVE_ZEN=1`) — calm mode: the engine still records
  state, but output is plain & terse (no loot/crit/serendipity/milestone lines,
  no contextual offers, no drop reveals — just a quiet `✓` confirmation).

## Layout
- `src/core/` — locked shared interfaces (events, state, rng, rewards). Change with care.
- `src/engine/` — pure game logic (xp, gacha, gear, collection, reduce). No I/O.
- adapters / renderers / daemon — later phases (see docs/PROJECT-CONTEXT.md).

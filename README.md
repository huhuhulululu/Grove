# 🌳 Grove

A local-first, tool-agnostic **game layer for AI-assisted coding**. Grove turns the invisible wins
of a coding session — green tests, merged PRs, clean builds, a written `CLAUDE.md` — into loot, XP, gear,
and a collection, and nudges good engineering habits as quests. It's a fun skin over a real productivity
toolkit: every reward maps to a safe, opt-in workflow power-up (a drafted commit message, a non-destructive
checkpoint, a refreshed code map). Your code, commits, docs, and git history can **never** be modified or
penalized by any game outcome — the engine is a pure function and rewards are cosmetic by construction
(see [`docs/decisions.md`](docs/decisions.md), ADR-0005).

## 60-second quickstart

```sh
# 1. Install (global bin: `sq`)
npm i -g grove          # or run ad-hoc: npx grove <cmd>  ·  alias: npx -p grove sq <cmd>

# 2. Wire Grove into a repo you already work in (chains your existing hooks — never clobbers)
cd my-project
sq init                 # installs a fail-open post-commit hook; Grove never blocks a commit

# 3. Commit like normal — Grove scores it automatically
git commit -m "feat: thing"
#   🌳 grove
#   ✨ +10 XP · commit (10)
#   🪙 +5 🌰 seeds · commit

# 4. See it all in one place (in-place panel, not a scrolling log)
sq dashboard            # XP bar · seeds · gear · quests · buffs · energy

# 5. The earn → choose → pull loop
#    Shipping outcomes earns 🌰 seeds. You decide WHEN to spend them.
sq pull                 # spend 30 🌰 for one gacha pull (refuses calmly when you're broke)
sq enhance first        # risk/reward: upgrade a piece of gear (cosmetic — code is never touched)

# 6. Optional: feed Grove your Claude Code energy meter (chains your statusline — never clobbers)
sq statusline install
```

Prefer not to install globally? Every command works through `npx`:

```sh
npx -p grove sq dashboard
```

## What it is

Two pillars, one normalized event stream:

- **Relieve fatigue** — invisible wins (green tests, merges, builds) become loot / XP / a collection.
- **Drive good habits** — skipped chores (write `CLAUDE.md`, specs, keep docs synced) become quests / buffs.

Signals are captured by thin per-tool adapters and reduced by a **pure** engine, so Grove works for any
AI-coding workflow (Claude Code, Cursor, Aider, Codex/Copilot/Gemini CLI, or plain terminal + git) — one
adapter per tool, no coupling.

## Commands (run `sq help` for the full list)

| Command | What it does |
|---|---|
| `sq init` / `sq uninstall` | Install / remove the chain-safe post-commit hook |
| `sq wrap -- <cmd>` | Run a command you'd run anyway; Grove reads its exit code — green grants reward, red grants nothing (ADR-0003) |
| `sq scan [path]` | Scan a repo for habit signals (grimoire / tests / docs / specs) and reward them |
| `sq dashboard` | Full in-place board: XP, seeds, gear, quests, buffs, energy |
| `sq quests` | The habit quest board |
| `sq pull` | Spend 30 🌰 seeds for one gacha pull — you choose when |
| `sq enhance <ref>` · `sq repair <ref>` · `sq protect <ref>` | The gear risk/reward loop (cosmetic only) |
| `sq suggest-commit` | Read-only: draft a commit message from your staged diff (never commits) |
| `sq checkpoint` | Non-destructive `git stash create` snapshot + a rest buff |
| `sq statusline install` / `uninstall` | Chain Grove onto your Claude Code statusline (energy meter) |
| `sq status` / `sq recap` | Plain-text state / session recap |

## Shipped vs. roadmap (honest scope)

**Shipped today:** the pure game engine (XP, gacha, gear, collection, quests, energy, crit), persistence,
the auto-capture git hook, `sq scan`, `sq wrap -- <cmd>` (real exit-code-driven signals — ADR-0003), the
seeds economy + `sq pull` / `enhance` / `repair` / `protect`, the `sq dashboard`, `suggest-commit`,
`checkpoint`, the chain-safe statusline integration, and `--zen` calm mode.

**Roadmap (not yet built):** account-global energy (quota is account-wide; energy is currently stored
per-repo); a navigable live-updating Ink TUI (the dashboard is a string render today, redrawn on demand
but not keyboard-navigable); and the opt-in, league-based leaderboard (ADR-0011). Multi-platform
mobile/web sync is a later phase.

## Build from source

```sh
npm install
npm run build           # bundles src/cli/sq.ts → dist/cli/sq.js (ESM, executable bin)
node dist/cli/sq.js help
npm test                # vitest (TDD; coverage target 80%+)
npm run typecheck       # tsc --noEmit
```

## Safety & ethics

- **Ethics firewall** — the engine is pure (`events → cosmetic game-state`); real work is structurally
  untouchable (ADR-0005).
- **Never auto-runs your tests** — signals come from things you already do (ADR-0003).
- **Never clobbers existing git hooks or your statusline** — Grove chains, it doesn't overwrite (ADR-0004).
- **Rewards outcomes, never raw activity** — no LOC/commit-count/hours grind. Forgiving, no shame, calm mode.

## Docs

- [`CLAUDE.md`](CLAUDE.md) — constraints + layout index
- [`docs/decisions.md`](docs/decisions.md) — Architecture Decision Records (the firewall, tool-agnostic adapters, hook chaining…)
- [`docs/GOALS.md`](docs/GOALS.md) — goals & non-goals
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — modules, the pure/impure seam, event schema
- [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) — current status & milestones

## License

MIT.

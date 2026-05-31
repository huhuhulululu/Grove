# 🌳 Grove

A local-first, tool-agnostic **game layer for AI-assisted coding**. Grove turns the invisible wins
of a coding session — green tests, merged PRs, clean builds, a written `CLAUDE.md` — into loot, XP, gear,
and a collection, and nudges good engineering habits as quests. It's a fun skin over a real productivity
toolkit: every reward maps to a safe, opt-in workflow power-up (a drafted commit message, a non-destructive
checkpoint, a refreshed code map). Your code, commits, docs, and git history can **never** be modified or
penalized by any game outcome — the engine is a pure function and rewards are cosmetic by construction
(see [`docs/decisions.md`](https://github.com/grovekit/grove/blob/main/docs/decisions.md), ADR-0005).

## 60-second quickstart

```sh
# 1. Install (package: grovekit · global bin: `sq`)
npm i -g grovekit       # or run ad-hoc without installing: npx -p grovekit sq <cmd>

# 2. Wire Grove into a repo you already work in (chains your existing hooks — never clobbers)
cd my-project
sq init                 # installs a fail-open post-commit hook + grants a starter; never blocks a commit
#   🌳 Grove post-commit hook installed.
#   🪙 starter grant · +40 🌰 seeds — your board isn't empty.
#   Next: git commit like normal, then `sq dashboard` to see your loot.

# 3. Commit like normal — Grove scores good-practice signals in the commit (ADR-0003)
git commit -m "docs: write CLAUDE.md"
#   🌳 grove
#   🌿 CLAUDE.md written · permanent aura
#   🃏 Compiler · uncommon          ← a card drops the first time a habit signal lands

# 4. See it all in one place (in-place panel, not a scrolling log)
sq dashboard            # XP bar · seeds · gear · quests · buffs · energy

# 5. The earn → choose → pull loop
#    Shipping outcomes earns 🌰 seeds. You decide WHEN to spend them.
sq pull                 # spend 45 🌰 for one gacha pull (refuses calmly when you're broke)
sq enhance first        # risk/reward: upgrade a piece of gear (cosmetic — code is never touched)

# 6. Optional: feed Grove your Claude Code energy meter (chains your statusline — never clobbers)
sq statusline install
```

Prefer not to install globally? Every command works through `npx`:

```sh
npx -p grovekit sq dashboard
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
| `sq pull` | Spend 45 🌰 seeds for one gacha pull · you choose when |
| `sq enhance <ref>` · `sq repair <ref>` · `sq protect <ref>` | The gear risk/reward loop (cosmetic only) |
| `sq suggest-commit` | Read-only: draft a commit message from your staged diff (never commits) |
| `sq checkpoint` | Non-destructive `git stash create` snapshot + a rest buff |
| `sq statusline install` / `uninstall` | Chain Grove onto your Claude Code statusline (energy meter) |
| `sq share [--badge]` | Print a copy-pasteable share card (or a README badge) — opt-in, cosmetic stats only (ADR-0011) |
| `sq ntfy <topic>` / `sq ntfy off` | Opt into (or disable) mobile push for big moments via ntfy.sh — **default OFF** |
| `sq status` / `sq recap` | Plain-text state / session recap |

### Opt-in sharing & mobile push (privacy-minimal, ADR-0011)

Both are **off by default** and transmit only cosmetic game stats — never code, cwd, or cost.

```sh
sq share                # prints a terse, copy-pasteable card (level + collection %)
sq share --badge        # prints a markdown shields.io badge for your README
sq ntfy my-grove-alerts # opt in: subscribe to that topic in the ntfy.sh app to get phone alerts
sq ntfy off             # disable push again
```

Push fires only on a **big moment** (level-up, legendary/shiny drop, milestone chest, quest/set complete) —
never routine commits, never a stream. A **global, ranked leaderboard is roadmap, not shipped**: a credible
one needs a server-verified outcomes backend (local state is trivially forgeable), so until that exists any
"leaderboard" stays friends-only / cosmetic (ADR-0011).

## Positioning: Grove vs. nearest rivals

Grove is the first to **fuse** verified-outcome gamification with AI-assisted coding, AI-quota energy, loot/gear/gacha, local-first privacy, and an ethics firewall — in one tool-agnostic CLI.

| | Grove | claude-quest | claude-code-tamagotchi | Habitica | Gamekins |
|---|---|---|---|---|---|
| Outcome-gated rewards (verified) | ✅ exit-code + git diff | Partial | ❌ activity | Manual | ✅ CI-only |
| Loot / gear / gacha | ✅ | ❌ | ❌ | ✅ generic | ❌ |
| AI-tool agnostic | ✅ all tools | ❌ CC only | ❌ CC only | ✅ generic | ❌ JVM |
| AI-quota → game energy | ✅ Vigor/Weekly | ❌ | ❌ | ❌ | ❌ |
| Ethics firewall (pure engine) | ✅ structural | Unclear | ❌ punishes | ✅ cosmetic | Partial |
| Local-first, no server | ✅ | ❌ cloud | Partial | ❌ | ❌ |
| Safe workflow power-ups | ✅ suggest-commit, checkpoint | ❌ | ❌ | ❌ | ❌ |
| Calm / zen mode | ✅ | ❌ | ❌ | ❌ | ❌ |

Each factor exists *somewhere*; the **product exists nowhere but Grove.** The main structural risk is Anthropic's own `/buddy` — the moat there is tool-agnostic outcome-gating that a Claude-only identity-deterministic companion cannot match. Full competitive analysis: [`docs/PRIOR-ART.md`](https://github.com/grovekit/grove/blob/main/docs/PRIOR-ART.md).

## Shipped vs. roadmap (honest scope)

**Shipped today:** the pure game engine (XP, gacha, gear, collection, quests, energy, crit), persistence,
the auto-capture git hook, `sq scan`, `sq wrap -- <cmd>` (real exit-code-driven signals — ADR-0003), the
seeds economy + `sq pull` / `enhance` / `repair` / `protect`, the `sq dashboard`, the navigable Ink TUI
(`sq tui`), the read-only web/SSE dashboard (`sq serve`), `suggest-commit`, `checkpoint`, the chain-safe
statusline integration, `--zen` calm mode, the opt-in `sq share` card/badge, and opt-in `sq ntfy` mobile
push on big moments.

**Roadmap (not yet built):** account-global energy (quota is account-wide; energy is currently stored
per-repo); friend streaks / co-op; and the opt-in, league-based **global leaderboard** — which needs a
**server-verified outcomes backend** (local state is forgeable) before it can ship without becoming a
dark pattern, so it stays deferred (ADR-0011).

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
- [`docs/decisions.md`](https://github.com/grovekit/grove/blob/main/docs/decisions.md) — Architecture Decision Records (the firewall, tool-agnostic adapters, hook chaining…)
- [`docs/GOALS.md`](https://github.com/grovekit/grove/blob/main/docs/GOALS.md) — goals & non-goals
- [`docs/ARCHITECTURE.md`](https://github.com/grovekit/grove/blob/main/docs/ARCHITECTURE.md) — modules, the pure/impure seam, event schema
- [`docs/PROJECT-CONTEXT.md`](https://github.com/grovekit/grove/blob/main/docs/PROJECT-CONTEXT.md) — current status & milestones

## License

MIT.

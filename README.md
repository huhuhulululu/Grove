<div align="center">

# 🌳 Grove

**A local-first, tool-agnostic game layer for AI-assisted coding.**

Turn the invisible wins of a coding session (green tests, merged PRs, clean builds, a written `CLAUDE.md`)
into loot, XP, and a collection. Turn the chores you skip into quests. All cosmetic, all calm, all yours.

[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![i18n](https://img.shields.io/badge/i18n-en·zh--CN·ja·ko-blue.svg)
![engine: pure](https://img.shields.io/badge/engine-pure%20(ethics%20firewall)-8a2be2.svg)
![rewards: cosmetic-only](https://img.shields.io/badge/rewards-cosmetic--only-brightgreen.svg)
![local-first](https://img.shields.io/badge/local--first-no%20server-success.svg)

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

</div>

---

Grove is a fun skin over a real productivity toolkit. Every reward maps to a safe, opt-in workflow power-up
(a drafted commit message, a non-destructive checkpoint, a refreshed code map). Your code, commits, docs, and
git history can **never** be modified, lost, or penalized by any game outcome · the engine is a pure function
and rewards are cosmetic *by construction* (see [`docs/decisions.md`](docs/decisions.md), ADR-0005).

```text
$ git commit -m "docs: write CLAUDE.md"
  🌳 grove
  🌿 CLAUDE.md written · permanent aura
  🃏 Compiler · uncommon            ← a card drops the first time a habit signal lands
  🌅 first light · build green for the first time
```

You did the work anyway. Grove just notices.

## Why

Two pillars, one normalized event stream:

- 🍃 **Relieve fatigue** · invisible wins (green tests, merges, builds) become loot / XP / a collection.
- 🛠️ **Drive good habits** · skipped chores (write `CLAUDE.md`, specs, keep docs synced) become quests / buffs.

Signals are captured by thin per-tool adapters and reduced by a **pure** engine, so Grove works for *any*
AI-coding workflow · Claude Code, Cursor, Aider, Codex / Copilot / Gemini CLI, or plain terminal + git.
One adapter per tool, zero coupling.

## 60-second quickstart

```sh
# 1. Install (package: grovekit · global bin: sq)
npm i -g grovekit            # or ad-hoc, no install: npx -p grovekit sq <cmd>

# 2. Wire Grove into a repo you already work in (chains your existing hooks · never clobbers)
cd my-project
sq init                      # fail-open post-commit hook + a starter grant; never blocks a commit

# 3. Commit like normal · Grove scores good-practice signals in the commit (it never runs your tests)
git commit -m "docs: write CLAUDE.md"

# 4. See it all in one in-place panel (not a scrolling log)
sq dashboard                 # XP · seeds · gear · quests · buffs · energy

# 5. The loop: shipping outcomes earns 🌰 seeds; you decide WHEN to spend them
sq pull                      # spend 45 🌰 for one gacha pull (refuses calmly when you're broke)

# 6. Curious why a habit matters? Ask · opt-in, never nagged
sq learn test-first          # one plain line: why a failing test first pins the intended behavior
```

> Prefer not to install globally? Every command works through `npx -p grovekit sq <cmd>`.

## The core loop

```text
   ship a real outcome            you choose when to spend         a calm arrival
  ────────────────────  ──▶  ──────────────────────────  ──▶  ────────────────────
   green test · merge          sq pull / craft / foil          🌳 you've got the
   clean build · a spec        enhance · repair · protect         groove (mastery)
        │  earns 🌰 seeds            │  cosmetic upgrades              one warm line,
        ▼                           ▼  (code never touched)           never a treadmill
```

Grove **rewards outcomes, never raw activity** · no LOC, commit-count, or hours grind. A red test costs you
nothing; a comeback (red → green again) earns one warm line. Skipping a quest is always fine: a quiet glyph,
never a "you haven't…".

## Highlights

| | |
|---|---|
| 🎴 **Collection** | 7 card sets · 39 cards · gacha pulls with pity + a targeted `--spark` guarantee; craft missing cards and cosmetically **foil** owned ones (a renewable shard sink, diminishing past a full craft's worth). |
| ⚔️ **Gear & loadout** | A risk/reward `enhance` / `repair` / `protect` loop, a 3-slot loadout, and 8 cosmetic synergies between equipped cards/gear/buffs (ADR-0014). |
| 🏆 **Recognition** | 13 derivable **achievements** (retroactive, no FOMO), a one-shot **mastery** arrival that ends the endgame treadmill, **comeback** (a stuck suite finally green), and **first light** (your first green build). |
| 📜 **Good habits** | A habit-quest board (write a `CLAUDE.md`, a spec, a plan, keep docs synced, **record decisions** in `docs/decisions.md`) and `sq learn` · opt-in one-line *why*s for both newcomers and veterans. |
| 🔋 **Anti-burnout energy** | Your Claude Code 5h/7d quota becomes **Vigor / Weekly** energy, framed as *remaining* (never "burned"); unmetered plans show a calm "Wellspring", never invented scarcity. Account-global across all your repos. |
| 🖥️ **Surfaces** | An in-place `sq dashboard`, a navigable Ink **TUI** (`sq tui`), a read-only web/SSE dashboard (`sq serve`), and a recap (`sq recap --since week`). |
| 🌍 **Calm & global** | A `--zen` mode that strips all spectacle to a quiet ✓, and full **i18n** in en / zh-CN / ja / ko. |
| 🤝 **Commons** | `sq commons` (opt-in): claim a labelled community task, your AI drafts the patch *you* review, then *you* open the PR · a merged PR is a real outcome. Grove never writes or runs contributor code (ADR-0013). |

## Commands (run `sq help` for the full list)

| Command | What it does |
|---|---|
| `sq init` / `sq uninstall` | Install / remove the chain-safe post-commit hook |
| `sq wrap -- <cmd>` | Run a command you'd run anyway; green grants reward, red grants nothing (ADR-0003) |
| `sq scan [path]` | Scan a repo for habit signals (grimoire / tests / docs / specs / decisions) and reward them |
| `sq dashboard` · `sq tui` · `sq serve` | The board: in-place panel · navigable TUI · read-only web/SSE |
| `sq quests` · `sq achievements [--all]` | The habit board · retroactive recognitions |
| `sq learn [practice]` | Opt-in one-line *why* for a good practice (never auto-shown) |
| `sq pull [--premium] [--spark <id>]` | Spend 🌰 seeds for a gacha pull · you choose when |
| `sq craft <id>` · `sq foil [id]` · `sq convert [n]` | Shard sinks: craft a missing card, foil an owned one, or convert surplus shards back to seeds |
| `sq enhance <ref>` · `sq repair <ref>` · `sq protect <ref>` | The gear risk/reward loop (cosmetic only) |
| `sq suggest-commit` | Read-only: draft a commit message from your staged diff (never commits) |
| `sq checkpoint` | Non-destructive `git stash create` snapshot + a rest buff |
| `sq statusline install` / `uninstall` | Chain Grove onto your Claude Code statusline (energy meter) |
| `sq statusline-segment` | A calm, composable one-line glance (level · xp · energy) you chain into your own bar |
| `sq export [file]` · `sq import <file>` | Own your data: portable, versioned state (import backs up first, refuses a bad file) |
| `sq share [--badge]` · `sq ntfy <topic>` | Opt-in, privacy-minimal: a share card / README badge · mobile push on big moments (default **off**) |
| `sq status` · `sq recap [--since session\|week\|all]` | Plain-text state · a calm look-back |

## The ethics firewall

This is the load-bearing promise, enforced structurally · not by good intentions:

> The engine is a **pure function**: `events → cosmetic game-state`. It has no filesystem, no clock, no
> network, and no randomness except an injected seed. It is therefore *incapable* of touching your real work.

- **Rewards are cosmetic, never power** · no game outcome grants real capability; a card is a card.
- **Never auto-runs your tests** · signals come from things you already do (ADR-0003).
- **Never clobbers** your git hooks or statusline · Grove chains and is fully restorable (ADR-0004).
- **Outcomes, never activity** · no LOC / commit-count / hours / streaks-to-lose. Forgiving, no shame, calm mode.
- **Local-first & private** · state lives on your disk; `share` / `ntfy` are off by default and transmit only
  cosmetic stats, never code, cwd, or cost (ADR-0011).

## Positioning

Grove is the first to **fuse** verified-outcome gamification with AI-assisted coding, AI-quota energy,
loot/gear/gacha, local-first privacy, and an ethics firewall · in one tool-agnostic CLI.

| | Grove | claude-quest | code-tamagotchi | Habitica | Gamekins |
|---|---|---|---|---|---|
| Outcome-gated rewards (verified) | ✅ exit-code + git diff | partial | ❌ activity | manual | ✅ CI-only |
| Loot / gear / gacha | ✅ | ❌ | ❌ | generic | ❌ |
| AI-tool agnostic | ✅ all tools | ❌ CC only | ❌ CC only | generic | ❌ JVM |
| AI-quota → game energy | ✅ Vigor/Weekly | ❌ | ❌ | ❌ | ❌ |
| Ethics firewall (pure engine) | ✅ structural | unclear | ❌ punishes | cosmetic | partial |
| Local-first, no server | ✅ | ❌ cloud | partial | ❌ | ❌ |
| Calm / zen mode | ✅ | ❌ | ❌ | ❌ | ❌ |

Each factor exists *somewhere*; the product exists nowhere but Grove. Full analysis:
[`docs/PRIOR-ART.md`](docs/PRIOR-ART.md).

## Shipped vs. roadmap (honest scope)

**Shipped:** the pure engine (XP, gacha, gear, collection, quests, energy, crit, synergies), persistence with
forward-compatible migration, the chain-safe git hook, `sq scan` / `sq wrap`, the seeds economy and every sink
(`pull` / `craft` / `foil` / `convert` / `enhance` / `repair` / `protect`), the dashboard / TUI / web-SSE
surfaces, achievements / mastery / comeback / first-light, the habit-quest board + `sq learn`, account-global
energy, `--zen`, opt-in `share` / `ntfy`, `export` / `import`, the `commons` P0 client, and i18n in en/zh-CN/ja/ko.

**Roadmap (not yet built):** friend streaks / co-op, and an opt-in, league-based **global leaderboard** · which
needs a **server-verified outcomes backend** (local state is forgeable) before it can ship without becoming a
dark pattern, so it stays deferred (ADR-0011).

## Build from source

```sh
npm install
npm run build            # bundles src/cli/sq.ts → dist/cli/sq.js (ESM, executable bin)
node dist/cli/sq.js help
npm test                 # vitest (TDD; coverage target 80%+)
npm run typecheck        # tsc --noEmit
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) · constraints + layout index
- [`docs/decisions.md`](docs/decisions.md) · Architecture Decision Records (the firewall, tool-agnostic adapters, hook chaining…)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · modules, the pure/impure seam, event schema
- [`docs/GOALS.md`](docs/GOALS.md) · goals & non-goals
- [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) · current status & milestones

## License

[MIT](LICENSE).

# Grove — Goals

## North star
Make AI-assisted coding **fun, low-pressure, and habit-forming** for any developer, on any tool,
without ever risking real work. (Multi-platform — phone / web — is a ROADMAP goal, not yet shipped;
today Grove is a terminal-only CLI. See Milestones / Status.)

Grove is **productivity-first**: it exists to reinforce the workflow and make the user faster/better —
every mechanic ties to a real work action. It aims to be **high game-feel, high operability (you DO things),
high interactivity**, and to **reduce CLI text-stream fatigue**. (See ADR-0007.)

**Shipped today (terminal CLI):** the pure engine, persistence, a chained git-hook + `sq wrap` signal
ingestion, `sq enhance`/`pull`/`protect`/`repair` (the risk/economy loop), a full-screen in-place
`sq dashboard` (string render, redrawn on demand), a navigable Ink TUI (`sq tui`), Pillar-B quests,
energy/statusline, `suggest-commit`/`checkpoint` utilities, and `--zen` calm mode.

**Shipped since (M3/M5/M6 partial):** the navigable, live-updating Ink TUI (`sq tui`), the read-only
web SSE dashboard (`sq serve`), opt-in ntfy mobile push on big moments (`sq ntfy`), and the opt-in
shareable card / README badge (`sq share`).

**Roadmap (NOT yet built):** friend streaks / co-op; and the opt-in, league-based **global leaderboard**
(M6, ADR-0011) — which needs a server-verified outcomes backend before it can ship.

## Milestones
- **M0 — Engine spine (current):** locked event schema + pure game engine (XP/leveling, gacha+pity,
  risk gear-enhancement, collection) with TDD ≥80% coverage. *Acceptance: deterministic engine turns a
  stream of events into loot/XP/gear/collection; no I/O; full suite green.*
- **M1 — Persistence + recap:** append-only event store + `sq recap` ("what you shipped" + loot summary).
- **M2 — Adapters:** universal chained git-hook adapter + `sq wrap` signal ingestion + Claude Code adapter.
- **M3 — Interactive surface (front-loaded per ADR-0007):** SHIPPED — interactive gear enhancement
  (`sq enhance`: the risk/tension loop), pack-opening (`sq pull`), and a full-screen in-place
  `sq dashboard` (level/collection/quests/gear/energy panels, redrawn on demand), and a navigable
  live-updating Ink TUI (`sq tui`). *SHIPPED.*
- **M4 — Pillar B breadth:** SHIPPED — 8 quests shipped (CLAUDE.md / spec / doc-sync / tests + 4 more R5 quests);
  renewable variants are ROADMAP.
- **M5 — Multi-platform:** PARTIAL — the read-only web SSE dashboard (`sq serve`) and opt-in ntfy
  mobile push on big moments (`sq ntfy`, default OFF) are SHIPPED; account-global energy sync is ROADMAP.
- **M6 — Social + launch:** PARTIAL — the opt-in shareable card + README badge (`sq share`) is SHIPPED;
  friend streaks, co-op repo raids, and the league-based **global leaderboard** are ROADMAP (ADR-0011).
  The global leaderboard specifically needs a server-verified outcomes backend (local state is forgeable)
  before it can ship without becoming the dark pattern Grove exists to fight — deferred until that exists.

## Non-goals
- No surveillance/productivity-scoreboard for managers.
- No real-money gacha, no pay-to-restore, no FOMO timers.
- No mechanic that can modify, lock, or lose real code/docs/history.

# Grove — Project Context

## Status
- **2026-05-30** — Project kickoff. Research + adversarial design review complete (see below).
  Direction chosen: **full-vision product, built incrementally**, name **Grove**.
- **2026-05-30 — M0 (Engine spine) DONE & verified.** Pure engine built via TDD:
  `xp / gacha / gear / collection / reduce` + `core/*`. Evidence: `tsc --noEmit` clean,
  **93/93 tests pass**, engine coverage ~98% (overall ≥80% with demo excluded), firewall
  confirmed pure (no fs/process/wall-clock/Math.random in src/engine — only injected Rng),
  `npx tsx src/demo.ts` prints a full deterministic play-by-play. → Next: **M1 (persistence + recap)**.
- **2026-05-30 — M1 (persistence + CLI) DONE & verified.** Impure shell around the engine:
  `store/paths`, `store/store` (atomic JSON state + JSONL event log), `render/format`,
  `app/ingest` (adapter→engine seam), `app/recap`, `cli/sq` (`event` / `status` / `recap`).
  Evidence (re-run by hand): `tsc` clean, **204/204 tests pass** across 12 files, live `sq` CLI
  ingests events → loot/level-ups and **state persists across separate process invocations**
  (proven: level 1→3, cards 0→2 over 3 runs). `npm run sq` script wired. → Next: **M2 (adapters)** or per user priority.
- **2026-05-30 — M4 (Pillar-B quests) DONE & verified.** (Pulled ahead of M2/M3 by user choice.)
  Engine: `engine/quests.ts` (pure: aura/multiplier/freshness/streak, first-time-only achievements,
  silent buff expiry) integrated into `reduce` (eventCount clock, XP scaled by active buffs).
  Detector: `detect/pillarb.ts` (tool-agnostic — grimoire file presence + last-commit diff →
  test_added / doc_updated synced|drift / spec_written). CLI: `sq scan` (auto-detect+reward),
  `sq quests` (quest board). 4 flagship quests: Forge the Grimoire, Pre-cast the Spell, Tend the
  Living Map, Test Warden. Evidence (re-run by hand): **276/276 tests**, tsc clean, live `sq scan`
  on a fixture repo grants grimoire+test-warden+living-map, anti-overjustification guardrail holds
  (2nd scan → 0 rewards). **Bug found & fixed in verify-fix loop:** detector used `git diff-tree HEAD`
  without `--root`, so a repo's INITIAL (parentless) commit reported no files → first `sq scan` missed
  test/doc signals. Added `--root` + a regression test. → Next: M2 (auto-capture hooks) / M3 / M5 per user.
- **2026-05-30 — M2 (auto-capture git hook) DONE & verified.** (User-chosen next.) Chain-safe adapter
  `adapters/githook.ts` (resolveHooksDir honors core.hooksPath; installPostCommit chains via sentinel block,
  never clobbers; `|| true` fail-open) + CLI `sq init` / `sq uninstall` / `sq commit-hook` + `groveInvocation()`.
  **#1 landmine (ADR-0004) defused & proven by a REAL git commit:** a pre-existing custom post-commit hook
  AND Grove rewards both fire on one commit; uninstall leaves the other hook byte-intact. Evidence (re-run by
  hand): **313/313 tests**, tsc clean, `git commit` auto-prints Grove loot. (Dev note: groveInvocation embeds an
  absolute tsx+sq.ts path — fine for dev; a packaged build will use the installed `sq`.)
- **2026-05-30 — User steer → ADR-0007** (productivity-first; high operability/interactivity; reduce CLI
  text-stream fatigue → in-place visual TUI over scrolling logs). → Now building **M3 interactive surface**:
  gear acquisition + interactive `sq enhance` (risk loop) + full-screen `sq dashboard` (in-place, paneled).
- **2026-05-30 — M3 (interactive surface) DONE & verified.** Gear now drops on `pr_merged` (engine
  `makeGear`/`grantGear`); `sq enhance <ref>` shows odds → rolls → juicy result (success/downgrade/break/stay;
  break reassures code is safe); `sq dashboard [--no-clear]` renders a full-screen paneled board (XP bar,
  collection N/5, gear, quests, buffs) — the in-place visual surface replacing scrolling logs (ADR-0007).
  Evidence (re-run by hand): **390/390 tests**, tsc clean, engine+render pure (firewall grep clean), live
  enhance + dashboard confirmed. Fixed a cosmetic double-emoji in the gear-drop message.
- **2026-05-30 — Quota/energy research DONE** → design + adversarial critique caught 4 ethics must-fixes
  (Second Wind not gated on low energy; window-reset = buff-only no pull; frame-freshness no fabrication;
  kind:'rest'). All folded into M-energy.
- **2026-05-30 — M-energy (quota→energy) DONE & verified.** `quota_update` event + `EnergyState`
  (Vigor 5h / Sap 7d, REMAINING-framed, `known:false`=Wellspring hides bar for API/Free) + `applyQuota`
  in reduce (reset→rest-buff-only, 4 fixes proven) + `adapters/statusline.ts` parser (epoch/ISO) +
  dashboard ENERGY panel + chain-safe `adapters/statusline-install.ts` (`sq statusline install/uninstall`,
  surgical jq on .statusLine.command only, timestamped backup, wrapper backgrounds ingest + calls original).
  Evidence: **498/498 tests**, tsc clean, 4 fixes source+test proven, energy/Wellspring/chain-safety re-run by hand.
- **2026-05-30 — User steer → ADR-0009 + docs/TONE.md** (de-中二; Diablo loot-grammar, keep light/emoji).
  → **tone pass** rewriting all flavor copy + quest names + energy copy to TONE.md, copy-lint enforced.
- **2026-05-30 — Tone pass DONE & verified.** All cloying forest copy → terse Diablo loot-grammar (kept emoji);
  quest renames (Write the CLAUDE.md / Spec First / Sync the Docs / Add Tests); 'Sap'→'Weekly'; copy-lint test
  (deny-list) added. **507 tests**, tsc clean, live output de-中二.
- **2026-05-30 — Statusline wiring PROVEN-READY but NOT enabled (user chose "keep building").** Fixed the
  wrapper to use a resolvable tsx invocation (was bare `grove`). Backed up the user's statusline.sh + settings.json.
  Proved the wrapper is transparent (clean HUD passthrough + Grove captures energy) WITHOUT touching settings.json.
  FYI found: the user's statusline.sh has a pre-existing Linux `md5` bug (stderr noise only, HUD fine). Enable later via `sq statusline install`.
- **2026-05-30 — M-useful (crit + real utility) DONE & verified.** Crit (暴击) in engine (8% chance, ×2-3 XP,
  `crit` flag, pure); `sq suggest-commit` (read-only diff→message, never commits); `sq checkpoint`
  (`git stash create` snapshot — NON-DESTRUCTIVE, working tree byte-identical proven — + rest buff + restore ref);
  contextual offers (crit→suggest-commit, low-energy→checkpoint; printed only, never auto). ADR-0008 realized.
  Evidence (re-run by hand): **552 tests**, tsc clean, checkpoint working-tree byte-identical, suggest-commit read-only.
- **In flight:** prior-art research (public repos similar to Grove → comparison + differentiation gap).
- **Known refinements (deferred):** energy is stored per-repo but quota is account-global (make it a global store);
  format.ts appends slightly-redundant `[name]`/`(rarity)` extras (minor terse-polish).
- **2026-05-30 — 10-lens audit (docs/AUDIT.md), overall C+.** Then an autonomous improve-loop until every lens ≥ B+:
  - **R1** (in-audit): fixed epoch-ETA / partial-vigor-fabrication / test-deletion-reward / git-utils injection. (565 tests)
  - **R2 (trust):** cross-process state lock (20-parallel no-lost-update) + Zod schema/migration + full shell-injection
    kill (execFileSync + shQuote'd generated scripts). Verified. (594 tests)
  - **R3 (real game):** seeds economy (outcomes grant; `sq pull` costs 30; no auto-pull-per-test), token-milestone
    floor (ADR-0010, capped/window), serendipity (奇遇), gear levels with REAL effects + repair/protect, aura/streak
    real, dup-comp, set-completion bonus, gacha pity re-tune (SOFT 40/HARD 60). Verified — earn→choose→spend loop +
    3 progression layers live. (710 tests, tsc clean)
  - **R4 (front door + honesty) — IN PROGRESS.** Honesty pass DONE & verified: the `--zen` calm mode (claimed in
    CLAUDE.md / ADR-0005 but never built) is now REAL — a global `--zen` flag / `GROVE_ZEN=1` env threads a `zen`
    boolean through the spectacle handlers (event/scan/pull/wrap/commit-hook/checkpoint/status); the engine still
    records state, only the RENDER is calm (no loot/crit/serendipity/milestone/offer lines, no drop reveals — a
    single terse `✓` confirmation). Docs trimmed to shipped scope: GOALS.md marks phone/web/multi-platform +
    navigable-Ink-TUI as ROADMAP (not shipped), ADR-0008 scopes "genuine workflow utility" to the shipped surface
    (suggest-commit, checkpoint, gear effects, energy nudges; codemap-inject / spec-stubs / templates = roadmap),
    CLAUDE.md documents `--zen`. Evidence: **746 tests** (14 new zen tests), tsc clean, copy-lint pass, live
    `sq event --zen` shows a calm `✓` line while normal mode still shows full loot. Remaining R4: bin/README/build
    install path, account-global energy store.
  - **Loop plan:** R3 → re-score① → R4 (front door: bin/README/build/portable invocation, `sq wrap`, account-global
    energy, honesty doc trim) → re-score② → R5 (close remaining < B+) → … until all 10 lenses ≥ B+. (ADR-0011 = global
    leaderboard, opt-in/league/server-verified, deferred until after the loop.)

## Origin / research
A 10-agent research workflow produced: pain-point map (fatigue + competency pains), prior-art review,
game-mechanics taxonomy, psychology/ethics guardrails, tool-agnostic adapter design, multi-platform
architecture, and product positioning — then an adversarial critic surfaced 4 ground-truthed landmines.
Those landmines are now defused in ADR-0002..0005. (Full dossier preserved in the workflow output transcript.)

## Build order (why this sequence)
Pure engine (M0) → persistence + recap (M1) → adapters (M2) → Pillar A depth (M3) →
Pillar B breadth (M4) → multi-platform (M5) → social + launch (M6).
Rationale: prove the *fun* with zero infrastructure first; lock the engine seam; defer the hard infra
(daemon, mobile sync, hooks-collision handling) until the core is validated. See ADR-0006.

## Key constraints (carry forward)
- Ethics firewall (ADR-0005): engine is pure; rewards cosmetic-only; real work untouchable.
- Tool-agnostic (ADR-0001); never auto-run tests (ADR-0003); chain git hooks (ADR-0004).
- Reward outcomes not activity; forgiving; `--zen` calm mode.

## Open questions / de-risk spikes (before later phases)
- Daemon lifecycle (restart-on-boot, orphans, socket collisions, clean uninstall).
- Mobile delivery tier (ntfy push default vs. LAN PWA vs. hosted relay).
- Monetization that survives the ethics firewall (no standard gamification revenue levers allowed).
- Pillar-B detection quality (heuristics are gameable/noisy — nudge, don't claim to verify).

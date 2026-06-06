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
  - **R5 cluster B (CLI/UX/docs/naming) DONE & verified.** Strategy **P0 name fix:** `grove` is taken on npm →
    renamed package to **`grovekit`** (ADR-0012); `package.json` name + README install (`npm i -g grovekit`,
    `npx -p grovekit sq`) + `bin: sq` made consistent, guarded by `cli/packaging.test.ts`. **wrap composes with
    global flags:** `run()` no longer short-circuits on `argv[0]==='wrap'` — it splits at the first `--`, parses the
    sq-side generically, so `--zen`/`--home` work BEFORE or AFTER `wrap` (and every subcommand). **Code-review nits:**
    enhance has a bounds-guard re-validated INSIDE the lock; enhance/repair/protect honor `--zen` (calm `✓` line);
    `--magnitude`/`--seed` NaN-guarded (default, never NaN); run-as-script guard is a basename match (`sq`/`sq.js`/
    `sq.ts`), not a fragile substring; `playReveal` uses non-blocking `Atomics.wait` (no CPU busy-spin) and is skipped
    entirely in non-TTY/tests. **First-aha UX:** README first-run promise corrected to REAL commit-hook output
    (Pillar-B signal rewards, not a fabricated `+10 XP · commit`); `sq init` is real onboarding — chains the hook,
    grants a one-time +40 🌰 starter (idempotent via an `.onboarded` marker), detects installed AI CLIs, prints a
    clear next-step CTA; an unknown subcommand prints a Levenshtein "did you mean …?" instead of the full USAGE wall.
    **Dashboard alignment:** new pure `render/width.ts` (displayWidth/padToWidth/truncateToWidth) pads box rows by
    terminal CELLS not `.length`, fixing wide-emoji/CJK border drift (asserted in `dashboard.test.ts`). Evidence:
    cluster-B test files green (`cli/{sq,zen,wrap-flags,nits,run-guard,onboarding,packaging}.test.ts`,
    `render/{dashboard,format,enhance,copy-lint,width}.test.ts`), copy-lint pass.

- **2026-05-31 — Social/push integrate wave (M5 partial / M6 partial) DONE & verified.** Wired the new
  opt-in modules into the CLI: `sq share [--badge]` prints the pure `renderShareCard` / `renderReadmeBadge`
  (cosmetic stats only — level + collection %, NEVER code/cwd/cost; still prints under `--zen` since it's
  user-invoked); `sq ntfy <topic>` persists an opt-in push topic to `<groveHome>/ntfy-topic` (where the
  adapter's `ntfyTopic()` reads it) and `sq ntfy off` clears it; a fire-and-forget `maybePush(rewards)` hook
  (injectable `topicFn`/`send` seams) is called in every reward path (`event` / `commit-hook` / `wrap` /
  `checkpoint`) and sends ONLY when a topic is set AND `pushWorthy(rewards)` is non-null — **default OFF, no
  push without opt-in**, never blocks/affects the command. USAGE + README + GOALS updated; a decisions note
  records that the *global* leaderboard still needs a server-verified outcomes backend (ADR-0011, deferred).
  Evidence (re-run by hand): **whole suite 1152/1152 pass** (15 new in `cli/ntfy-share.test.ts`), `tsc
  --noEmit` clean, `npm run build` success, copy-lint pass.

- **2026-06-01 — ADR-0014/0015 (loadout/synergies/achievements) SHIPPED & verified.** Loadout system:
  3-slot equip, `computeLoadoutEffect(state)` pure function, 8 published cosmetic synergies
  (`src/core/synergies.ts`, `src/engine/loadout.ts`), `sq loadout [equip <ref> | unequip <N>]` CLI,
  `render/loadout.ts`. Achievements: retroactive cumulative milestones (`src/core/achievements.ts`,
  `src/engine/achievements.ts`), `sq achievements [--all]` CLI, `render/achievements.ts`.
  Firewall: both systems are pure — no I/O, all bonuses cosmetic. ADR-0014/ADR-0015 captured.
- **2026-06-01 — i18n (en/zh-CN/ja/ko) SHIPPED.** `src/i18n/` catalogue with contract CI gate
  (`i18n/contract.test.ts`) enforcing parity across all 4 locales. Web dashboard respects
  `Accept-Language`; live at **game.aanao.cc**.
- **2026-06-01 — Content expansion DONE.** Card catalogue: **7 sets / 39 cards** (forest · tools ·
  creatures · syntax · deploy · circuits · relics). Three sets level-gated to prevent content cliff (R5).
- **2026-06-01 — Test suite: 1667 tests passing** (tsc clean). Up from 1152 at the M5-partial milestone.
- **2026-06-01 — PUBLIC on GitHub + commons + CI.** Source pushed to **https://github.com/huhuhulululu/Grove**
  (public, default branch `main`). `.github/workflows/ci.yml` (typecheck+test+build on push/PR, node 20 & 22 —
  GREEN) is the verified-outcome gate. `CONTRIBUTING.md` + a `commons` issue label + a first task backlog
  establish the community-build "commons" (ADR-0013 rev.2: GitHub-native, human-in-the-loop PRs; firewall code
  maintainer-gated). `docs/COMMONS-TOS.md` records per-tool AI ToS findings.
- **2026-06-01 — Web dashboard LIVE & persistent: https://game.aanao.cc** (alias b.aanao.cc). systemd
  `grove-web` (`sq serve` @ 127.0.0.1:8722, auto-restart + boot-enabled) behind the host's shared nginx
  (chain-safe vhost) behind Cloudflare. Auto-detects visitor locale (`Accept-Language`, `?lang=` override),
  an on-page EN·中·日·한 language switcher, and a collapsible "How to play" tutorial — all 4 locales.
  `webSafeState` strips cost from the wire. Ops: `/home/ubuntu/grove-deploy/README.md`.
- **2026-06-01 — Flake ROOT-CAUSED + fixed.** The rare full-suite-only flake was 2 `sq.test.ts` pull tests that
  earned seeds via un-seeded `sq event` (5% serendipity → random card → the deterministic `--seed` pull
  occasionally hit a DUPLICATE → broke strict cards/currency asserts). Fixed by seeding state directly + empty
  collection (deterministic). Verified 25×pull + 6×full = 0 fails.
- **2026-06-01 — Deep-optimize pass DONE & verified.** (1) TUI deepening: the Ink TUI now surfaces LOADOUT +
  ACHIEVEMENTS panels (6 panels, zen-suppressed, i18n×4) — the primary interactive surface (ADR-0007) now shows
  the new mechanics. (2) **Perf ~6×**: the CLI hot path (commit-hook/event/status/dashboard) no longer eagerly
  imports Ink/React — `handleTui`/`handleServe` use dynamic `import()`, tsup `splitting:true`; cold-start
  490ms→~70ms, main bundle 378KB→100KB (Ink loads only for `sq tui`). (3) Dead-code cleanup (6 files). **1682
  tests, tsc clean, build OK, firewall intact.**
- **2026-06-06 — Incursion depth, gate-then-build.** A fresh 37-agent design→adversarial-review workflow
  vetted 6 Incursion fast-follows; the gate REJECTED two with code-grounded blockers (typed-floors: its
  "bit-identical buildPower" premise is false and it would punish the very gear investment the module
  rewards; seed-wager: a no-lose dominant-strategy non-decision) and shipped the top pick. **The Incursion
  now has a consumable: a single-use SHIELD** (`sq incursion start --kit shield`, 30 🌰) that soaks ONE
  failed dive at the moment of your choosing. The per-item cap (`SHIELD_CAP=1`) is load-bearing balance,
  not tidiness — a Monte-Carlo pin proves 1 shield keeps banking-before-the-last-floor optimal (tension
  alive) while 2 would flip the run to always-dive. Engine stays PURE (no new GameState field — the kit
  lives in the ephemeral run.json); the seed debit is crash-safe (run written before the currency is
  spent, shield stripped if unaffordable) and the start-without-funds path TEACHES instead of erroring.
  **1879 tests, tsc clean, build OK, firewall intact.** (Shipped on PR atop the #7 firewall hardening.)
- **2026-06-06 — Incursion floor archetypes (ELITE).** The next vetted-READY item from the same
  37-agent workflow, scope-cut to combat+ELITE for a clean first commit (REST/TREASURE deferred). A
  non-final floor now rolls ELITE (~24% of floors, ~75% of runs) on a fresh `kind:i` rng stream: a
  **harder gamble (×1.15 difficulty) that guards fatter loot (×2 seeds)** — the mid-run greed fork. The
  load-bearing tuning is FREQUENCY, not the mult: `ELITE_DIFF_MULT=1.15` is deliberately smaller than a
  depth step, so difficulty stays strictly rising (proven across seeds) and the boss floor — NEVER elite —
  stays the depth-bias + gear climax. Balance re-pinned: bare greedy full-clear 0.203→**0.171** (a tighter
  gamble), strong (2.1) 0.800, the gap preserved. Engine stays PURE; back-compat (`floor.kind ?? 'combat'`
  at every read site) means a legacy kit-less run.json resolves byte-identically; help untouched (archetypes
  are a map-roll detail). **1889 tests, tsc clean, build OK, firewall intact.** (Stacked PR atop the shield.)
- **2026-06-06 — Incursion run history (war stories).** Third vetted-READY item from the workflow:
  `sq incursion history` shows a calm, cosmetic log of past runs in a SIBLING ephemeral file
  (`incursion-history.json`, capped at 20, best-effort — NEVER GameState). The gate caught a real latent
  bug: floors-cleared must come from `bag.cards.length` (a clear always banks one card), NOT `run.current`
  (which advances on a fail/shield too) — so "cleared N/5" can't lie. A pure `runOutcomeRecord(run, outcome)`
  derives it; a DEATH banks `null` (the forfeit bag never reached real state — no firewall leak) and the line
  is purely factual ("Fell on floor N", no "you died"/death-count/"try again" nag). The record is appended
  ONCE in the dive dead-branch (never via the tombstone-cleanup path) and skips instant empty escapes.
  `history` added to USAGE + cli.help ×4 locales. **1898 tests, tsc clean, build OK, firewall intact.**
- **2026-06-06 — Incursion TREASURE floors (the safe-jackpot fork).** A third archetype completing the
  combat/elite/treasure set: a non-final floor rolls TREASURE — FATTER loot (×2.5 seeds) at its NORMAL
  depth difficulty (a real dive, not free money). It pairs with ELITE (risky-richer): treasure is
  safe-richer. The key safety property, verified: TREASURE is carved from the COMBAT window AFTER elite is
  rolled (elite's window is fixed first), and it leaves difficulty untouched — so the elite set and the
  bare greedy full-clear rate are provably UNCHANGED (still exactly 0.171; the existing balance band holds
  with NO re-tune). Pure engine (rollMap-only, no resolveFloor change), back-compat (`kind ?? 'combat'`),
  scout/cleared lines tag `💎 TREASURE`, help untouched (a map-roll detail). **1903 tests, tsc clean, build
  OK, firewall intact.** (Stacked PR atop run history. A REST archetype remains the one deferred follow-up.)
- **2026-06-06 — Incursion BOSS climax (a fresh 37-agent design→review round).** With the prior vetted queue
  nearly dry, a new design→adversarial-review workflow vetted 6 next-gen decision-deepeners and REJECTED two
  with reproduced engine math (run-modifiers: glass+shield is a strict free-upside dominant config; depth-push:
  a failed push at HP=2 forfeits nothing — a free lottery). Top pick SHIPPED: the final floor is now a TWO-PHASE
  BOSS — clearing it means winning clearChance² in one dive, so the climax is a real escape-vs-dive crux again
  (it had decayed to a near-automatic single gear roll). A pure `floorClearChance(power, floor)` is the single
  odds source (CLI never hand-squares); `boss?:boolean` on the ephemeral RunFloor (no GameState field, no
  i18n/USAGE churn); the boss guards the fattest seeds (×1.5) + gear; a boss fail-survive is rendered honestly
  ("the boss still stands — no boss loot", not a false trophy). Balance RE-PINNED in the same commit: the boss
  pulled bare greedy full-clear 0.171→**0.110** (a fatal phase-fail at 1 HP is likelier); the existing 0.12..0.22
  bands moved to 0.07..0.15, and a TENSION pin proves escape-before-the-boss is EV-optimal up to ~power 2.0 (the
  flip to DIVE lands above). **1918 tests, tsc clean, build OK, firewall intact.** (Stacked PR atop treasure.)

## Current snapshot (2026-06-01)

**What Grove is now:** a local-first, tool-agnostic, multilingual GAME layer over AI-assisted coding, with a real
productivity toolkit underneath. Pure engine (xp · gacha+pity · risk-gear · collection · quests · crit · energy ·
prestige · **synergy/loadout** · **achievements**) + seeds/shards economy + 3-layer progression (outcomes +
token-milestone floor + serendipity). Surfaces: CLI, navigable Ink **TUI**, read-only **web** dashboard. Content:
8 synergies, 7 card sets / 39 cards, 12 achievements. i18n en/zh-CN/ja/ko everywhere. Two pillars: relieve
fatigue (invisible wins → loot) + drive good habits (chores → quests). Ethics firewall by construction (ADR-0005).

**Metrics:** 1682 tests · tsc clean · purity firewall green · main bundle 100KB · CLI cold-start ~70ms · 31 commits.
**Live:** https://game.aanao.cc · **Repo:** https://github.com/huhuhulululu/Grove (CI green).
**ADRs:** 0001–0015 (decisions.md). 10-lens audit reached straight-A (docs/AUDIT.md).

## Open decisions & next steps (awaiting user)

**Balance recommendations (from the deep-optimize audit — SUBJECTIVE, user calibrates; NOT yet applied):**
- **P1 (pacing wall):** XP curve caps at 2000/level from L12; the L20 achievement ≈ a year of grind with no
  content beats after L10 (last set unlocks L10). → lower the L20 threshold OR extend the curve.
- **P2 (collection grind):** `cards-25` / all-sets achievements sit near full completion (39 dup-heavy cards). →
  `cards-25`→`cards-20` OR add cards.
- **P3 (objective, low-risk):** enhance L0–3 are 100% success (a no-decision tax); enhancing past a gear's effect
  CAP is pure break-risk for zero benefit (dead). → surface the effect cap; compress the free band.
- **P4 (objective, low-risk):** 3-member synergies (naturalist/deployer) consume all 3 slots → can never combo. →
  drop to 2 members OR raise SLOT_CAP to 4.
- **P5 (objective, safety):** XP `scale` is an uncapped product of 5 multipliers. → cap the total.
  *(Recommendation: P3+P4+P5 are objective/low-risk and ready to apply; P1/P2 are experience-curve calls for the user.)*

**Deferred / roadmap:**
- Commons P1: the `sq commons` client (claim a labelled task → AI-draft → user opens PR). ADR-0013 rev.2.
- Global leaderboard: needs a server-verified-outcomes backend (ADR-0011) — still deferred.
- "Real value / tokens": resolved to Track-B (ungated helper utility for everyone) + cosmetic game depth;
  a redeemable-value/crypto model was rejected (gambling/Ponzi/ToS + anti-burnout). Commons = a code-contribution
  commons, not a fund.
- i18n: USAGE help + a few `Error:` diagnostics intentionally English.
- Latent: a `sq tui --zen` CLI-wiring gap was closed in the deep-optimize pass (panels now suppress under zen).

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

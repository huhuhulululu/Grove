# Architecture Decision Records (append-only)

Each ADR captures a decision and its rationale. Several directly defuse landmines found in the
adversarial design review (2026-05-30).

---

## ADR-0001 — Tool-agnostic adapter layer + one normalized event schema
**Status:** accepted · 2026-05-30
**Decision:** Capture coding signals through thin per-tool *adapters* that translate into a single
closed-vocabulary `GroveEvent`. The engine consumes only `GroveEvent` and never knows the source tool.
**Why:** Grove must work for any AI-coding workflow (Claude Code, Cursor, Aider, Codex/Copilot/Gemini CLI,
plain terminal+git). Coupling to one tool's hooks would forfeit universality. New tool = one adapter file.

## ADR-0002 — Embrace RNG transparency; deterministic seedable PRNG
**Status:** accepted · 2026-05-30
**Decision:** Use `mulberry32` (seedable, deterministic). Publish drop odds and pity thresholds. Do NOT
build competitive leaderboards on raw RNG outcomes.
**Why:** Review ground-truth: CLI power users reverse-engineer local PRNGs (the installed `buddy-hunter`
plugin brute-forces Claude Code's `/buddy` seed). For a solo, local, **cosmetic-only** game, "farming" your
own cosmetics is harmless, and determinism makes the engine testable. We resolve the "transparency paradox"
by making fairness inspectable and never staking anything real or competitive on the RNG.

## ADR-0003 — Never auto-run the user's tests; ingest signals the user already produces
**Status:** accepted · 2026-05-30
**Decision:** Grove will NOT invoke a project's test suite. Test/build results enter via `sq wrap <cmd>`
(reads exit code of a command the user runs anyway), chained git hooks, CI status, and file presence/diff.
**Why:** Auto-running tests in post-commit is slow, has side effects (DBs, emails, containers), is not
zero-config (needs the test command), and double-runs work — the opposite of fatigue relief.

## ADR-0004 — Chain git hooks; never clobber existing hook frameworks
**Status:** accepted · 2026-05-30
**Decision:** The git adapter must detect existing `core.hooksPath` / husky / lefthook / pre-commit and
**chain** (call through) rather than overwrite. Installs as a plugin where a framework is present.
"Installs without disabling existing git hooks" is an acceptance criterion.
**Why:** `core.hooksPath` is a single value; overwriting silently disables a mature dev's real hooks — a
data-loss-adjacent footgun and a dark pattern. The Pillar-B target audience is exactly who runs husky.

## ADR-0005 — Ethics firewall by construction
**Status:** accepted · 2026-05-30
**Decision:** The engine is a pure function `(GameState, GroveEvent, Rng) → (GameState, Reward[])` with no
I/O. All rewards are cosmetic. Gear-enhancement / gacha / loss mechanics gamble only earned in-game currency
and cosmetics — never code, commits, docs, files, or git history. Reward **outcomes** (verifiable artifacts),
never raw activity (LOC/commit-count/hours). Forgiving by default: no shame, free streak grace, `--zen` calm
mode that strips randomness/risk. Front-load rewards for first-time good practices, then fade (anti-overjustification).
**Why:** The product exists to REDUCE pressure. Purity makes "real work can never be harmed" a structural
guarantee, not a promise. Outcome-gating defeats Goodhart/streak distortion.

## ADR-0006 — TypeScript + vitest, pure-engine-first build order
**Status:** accepted · 2026-05-30
**Decision:** Node + TypeScript single language; vitest for TDD (80%+ coverage). Build the pure engine
(deterministic, fully testable, no infra) BEFORE persistence/daemon/adapters/renderers, so the "fun" core is
proven and the architectural seam is locked before the hard infra (daemon, mobile sync) is committed.
**Why:** The engine is the crown jewel and the lowest-risk highest-value first slice; locking its interfaces
lets later phases (and parallel work) proceed without churning the core.

## ADR-0007 — Productivity-first; interactive/operable over scrolling text
**Status:** accepted · 2026-05-30 (user direction)
**Decision:** Grove exists ENTIRELY to reinforce the dev workflow and boost productivity — every mechanic
must map to a real work action that makes the user faster/better; nothing is "fun for fun's sake." The
experience must be high game-feel, high **operability** (the player DOES things — enhance gear, open packs,
navigate, choose), and high interactivity. Crucially, the default reward surface must NOT be a scrolling
**text stream** (append-only log lines cause their own CLI fatigue — the very thing we fight). Favor an
in-place, navigable, visual interface: a rich TUI (panels/HUD that update in place, with juice on drops/
enhances) in the terminal, and a live web/mobile dashboard — over `console.log` spam.
**Implications:**
- Build a rich interactive TUI (e.g. Ink) as a first-class renderer; keep terse text output only as a
  scriptable/non-interactive fallback (e.g. for hook output) — never the primary experience.
- Add interactive, agency-bearing commands: gear enhancement (`sq enhance`, the risk/tension loop the user
  asked for), pack-opening, collection browsing, quest-board navigation.
- Measure every feature against: "does this make the actual coding workflow faster, clearer, or less tiring?"
**Why:** User's explicit steer (2026-05-30): "完全用来强化工作流和提效；游戏性强、操作性强、交互性强；减少 CLI
文字流疲劳感." This also resolves the design review's "no moment-to-moment agency / dead-time is mere
spectation / text fades fast" critique.

## ADR-0008 — Rewards are real, safe workflow power-ups (not just cosmetics)
**Status:** accepted · 2026-05-30 (user direction)
**Decision:** Beyond cosmetic dopamine, Grove's mechanics must confer GENUINE workflow utility. Crits, buffs,
multipliers, levels, gear, and collection each map to a REAL, helpful workflow effect tied to the habit/action
that earned it. The reward for playing well IS a more capable, better-paced workflow.
**Boundary (extends ADR-0005, respects ADR-0003):** real effects are ONLY safe, non-destructive, and
opt-in/offered — read-only helpers, better AI context, generated suggestions/artifacts the user accepts, or
pacing nudges. NEVER silent destructive mutations; NEVER auto-run side-effectful commands (e.g. the test
suite); NEVER intrusive nagging (that would re-add the fatigue Grove fights). The game OFFERS help; the user disposes.
**Examples (mix of SHIPPED + roadmap — see scope note):** crit on commit → offer a drafted commit summary /
a rollback checkpoint; 'Fresh Architecture' buff → inject/refresh the codemap given to the AI; 'Pre-cast x2'
→ turn the spec into a live acceptance checklist + test stubs; 'Refreshed' / low-energy → suggest
checkpoint+compact (fights context rot & burnout); gear/levels → unlock real workflow templates/configs.
**Why:** User steer — "除了游戏性，也希望它真的有用；暴击/加成在工作流里如何应用？" This is Grove's core
thesis: a fun skin over a real productivity toolkit. Open risk to vet: keeping real effects from becoming
intrusive (the design workflow + critic guard this).
**Scope — SHIPPED today (honesty pass, R4):** the genuine-utility surface that actually exists is:
`sq suggest-commit` (crit → read-only drafted commit message, never commits), `sq checkpoint` (low-energy →
non-destructive `git stash create` safety-net + rest buff), contextual OFFERS (crit→suggest-commit,
low-vigor→checkpoint; printed only, never auto), gear-level workflow effects (`gearEffectText` → xp/seed/crit
nudges), and the energy "good stopping point" nudge. The codemap-injection, spec→checklist/test-stub
generation, and template/config unlocks in the example list above are ROADMAP — NOT yet built. The decision &
boundary stand; this note keeps the docs honest about what ships vs. what is planned.

## ADR-0009 — Tone: de-中二, Diablo loot-grammar, keep light personality
**Status:** accepted · 2026-05-30 (user direction)
**Decision:** Drop the cloying forest-whimsy copy. Adopt Diablo's terse, rarity-forward LOOT GRAMMAR
(`🃏 Name · rarity`, `ENHANCE +7→+8 ✓ success`, numbers carry the feeling) while KEEPING a light,
approachable personality and emoji — not grimdark, not cutesy. User picked "keep a bit of fun, trim the
most cloying" (over both full-Diablo-grit and current whimsy). Full style guide + deny-list in **docs/TONE.md**;
a copy-lint test enforces the deny-list. Mechanics unchanged; this is a copy/rarity-presentation/panel pass.
**Why:** User: "也不要搞得太中二了啊，参考一下暗黑破坏神." The whimsical voice clashed with a hardcore
productivity tool's credibility.

## ADR-0010 — Three-layer progression: outcomes (primary) + token-milestone floor + serendipity
**Status:** accepted · 2026-05-30 (user direction) · realized in R3
**Decision:** Progression has THREE layers, with token consumption as one factor — never the only one:
1. **Outcomes (primary):** green tests / merges / specs / docs → the main XP + seeds. Outcome-gated,
   anti-Goodhart — unchanged, stays dominant.
2. **Token-milestone floor (保底):** cumulative real token/cost consumption (from the statusline payload's
   `cost.total_cost_usd` / `output_tokens` — works even for Wellspring/API users who have no rate_limits)
   fills a "work meter"; crossing a threshold grants a GUARANTEED loot chest. A fair floor so heavy work
   always pays out.
3. **Serendipity (奇遇):** stochastic surprise events (rare lucky drops / mini-encounters) layered on
   outcomes for the variable-ratio dopamine the game-design audit said was missing.
**Ethics guardrails (token = ACTIVITY not outcome — handle per ADR-0005/0008):** the token-milestone grants
COSMETIC loot / modest seeds ONLY — NEVER power/XP that would reward burning tokens; it is CAPPED & diminishing
per 5h window (grinding tokens past a point yields nothing); framed neutrally ("work tracked", never "burn
more"); outcomes stay the dominant driver; it composes with the energy system's "rest when low" so it never
pressures overuse. This keeps "token as an important factor, not the only one" (user's words) without
re-introducing the activity-Goodhart trap or a burnout incentive.
**Why:** User steer — "把 token 的消耗量也作为一个重要的参考因素，但不要作为唯一因素 … token 作为一个
milestone / 保底，然而也会有很多奇遇、很多随机性."

## ADR-0011 — Global leaderboard: opt-in, league-based, ranks HEALTHY outcomes, server-verified, sequenced LATE
**Status:** accepted (design) · 2026-05-30 (user direction) · build deferred until after R3 + adoption + a sync backend
**Decision:** A global leaderboard is desirable but is the mechanic MOST in tension with Grove's
anti-burnout / anti-shame / local-first ethos, so it ships ONLY under strict guardrails and LATE:
- **Opt-in, off by default;** zen/calm users never see it; rank is always hideable. (Honors the GOALS
  "no surveillance / productivity-scoreboard" non-goal.)
- **Rank on HEALTHY, hard-to-game metrics** — Pillar-B good-practice scores / consistency / collection —
  NEVER raw token consumption, hours, LOC, or commit-count (those reward overwork/grinding = the anti-goal;
  ranking on tokens would weaponize ADR-0010's token factor — explicitly forbidden).
- **League/cohort structure** (Duolingo-style brackets of similar peers; the middle 80% never "lose"),
  plus opt-in friend groups. No public "#9000 of millions" shaming.
- **Cheat-resistance:** local scores are trivially forgeable (edit state.json / script fake events — the
  buddy-hunter lesson), so a credible global board needs SERVER-SIDE verification of outcomes (e.g. via
  GitHub/CI signals the server can independently check). Until that exists, "leaderboard" = friends-only / cosmetic.
- **Privacy:** transmit only opt-in, minimal, aggregated data (a handle + a derived score) — NEVER raw
  repo/code/cwd/cost.
- **Architecture/sequencing:** needs the sync backend + identity that is currently unbuilt. Per the audit,
  do NOT build heavy server/social infra before the core game loop (R3) and the install path. Order:
  R3 → adoption → opt-in friend-streaks + share-card → (only then) leagues / global with server-verified outcomes.
**Why:** User — "进而我们也可以有全球的排行榜." Captured with the guardrails that keep it from becoming the
dark pattern Grove exists to fight.

## ADR-0012 — Publishable npm name `grovekit` (bin stays `sq`)
**Status:** accepted · 2026-05-31 (audit R5, strategy P0)
**Decision:** The npm package name is **`grovekit`** (not `grove`). The global binary is unchanged: **`sq`**.
`package.json` `name`, the README install command (`npm i -g grovekit` / `npx -p grovekit sq <cmd>`), and the
declared `bin` (`sq`) are all kept consistent, enforced by `src/cli/packaging.test.ts`.
**Why:** `grove` is ALREADY TAKEN on npm (a published `grove@0.4.0` by a third party), so the README's
`npm i -g grove` would have installed a stranger's package — a strategy-P0 install-path mismatch found in the
re-score② audit. `grove-cli` is also taken (a prototype). `grovekit` is unclaimed, keeps the brand, and is
unscoped (no scope-ownership / membership prerequisite to publish). The product/brand stays "Grove"; only the
distribution identifier disambiguates. The binary `sq` is short and memorable and the whole README/UX drives it.

## ADR-0011 note — share + ntfy shipped; GLOBAL leaderboard still needs a server backend
**Status:** note · 2026-05-31 (integrate wave)
**What shipped (within ADR-0011's guardrails):** the opt-in, privacy-minimal social layer's FIRST slice —
`sq share [--badge]` (a copy-pasteable card / README badge; cosmetic stats only) and `sq ntfy <topic> | off`
(opt-in mobile push on big moments via ntfy.sh, **default OFF**). Both transmit ONLY cosmetic game events —
never code, cwd, or cost (the ADR-0011 privacy rule). Push fires only when a topic is set AND the batch is
`pushWorthy` (level-up / legendary / chest / quest or set complete), fire-and-forget so it never blocks or
alters a command. **Still deferred:** the *global, ranked* leaderboard. As ADR-0011 requires, a credible one
needs **server-side verification of outcomes** (local `state.json` is trivially forgeable — the buddy-hunter
lesson); until that backend + identity exist, any "leaderboard" stays friends-only / cosmetic. No heavy
server/social infra is built ahead of adoption.

## ADR-0013 — Grove Commons: GitHub-native idle-AI collective build (earn, never gamble)
**Status:** proposed (rev.2, after critic REJECT of rev.1) · 2026-05-31 (user: "用闲置的 AI 一起共建一个有意义的东西")
**Decision:** Add an OPT-IN "Commons" mode where the community turns idle AI time into HUMAN-REVIEWED, GitHub-PR
contributions to a shared, meaningful codebase — the FIRST target being **Grove itself** (dogfood). The verified
outcome is a **MERGED GitHub PR**; the reward is cosmetic loot + (deferred) reputation. The real value is the
COMMONS ARTIFACT itself (a better shared codebase everyone uses) — NEVER redeemable money.

**The bright line (non-negotiable; extends ADR-0005 firewall + ADR-0002 transparency):**
- Randomness/gacha NEVER yields redeemable real value — cosmetic by construction.
- Real value (the merged code; later, reputation) is earned DETERMINISTICALLY for a **publicly-verifiable merged
  PR** — "earn for verified work", not "gamble". NOT a 资金盘/Ponzi (no money flows between participants; each
  uses their OWN quota; the only "payout" is shared code) and NOT gambling (no random-for-money).

**Architecture — GitHub IS the verified-outcome backend (the rev.1 "reuse the ADR-0011 server" was vapor; the
critic was right — building a bespoke multi-tenant server + identity + CI-sandbox + merge-bot is the largest,
riskiest piece in the project and is NOT free reuse). Instead lean on existing OSS infra:**
- Contributions are **real GitHub PRs**: fork → the user's AI drafts a patch for a claimed task → the **user
  reviews and opens the PR under their OWN GitHub identity** → **GitHub Actions** runs build+test in GitHub's
  sandbox → a **maintainer reviews + merges**. A merged PR (read via the public GitHub API) is the outcome.
  **Grove's own infra NEVER executes contributor code** → the rev.1 server-side-CI RCE/supply-chain surface is
  eliminated (critic finding #2).
- `sq commons` client (opt-in, OFF by default, **attended** — not an unattended background daemon): lists curated
  claimable tasks (Grove issues labelled `commons`/good-first), helps the user's AI draft a patch for a claimed
  task, and the **user** opens the PR. Fire-and-forget; **no obligation, no streak, no v1 leaderboard** (protects
  the North-star — critic #5).
- Engine PURE: a `commons_contribution` event (a verified merge) → cosmetic reward via reduce(). Networked logic
  lives in a thin client adapter + GitHub, never the engine. (Purity is necessary-NOT-sufficient — purity.test.ts
  is a token-grep, so it cannot prove the feature safe; real safety is the GitHub-runs-the-code design.)
- **Firewall governance (critic #5):** commons tasks are scoped to SAFE, additive areas (i18n locales, card
  packs, tool adapters, docs, tests). Changes to the ethics-firewall code (src/engine, src/core purity; ADR-0005)
  are **maintainer-gated and OUT OF SCOPE for the commons flow** — no reputation-holder can land firewall changes.
  Pooled contributions are covered by a CLA + the repo's MIT license.

**Phased rollout (sequenced LATE, after adoption — same discipline as ADR-0011):**
- **P0 (honestly sized, buildable on existing infra):** the GitHub-native loop — a `commons` issue-label scheme +
  CONTRIBUTING.md/CLA + the `commons_contribution` engine event (with a test asserting it grants its reward) +
  the `sq commons` client that drafts-a-patch and opens-a-PR for a claimed task. NO bespoke server.
- **P1:** reputation derived from **publicly-merged PRs** (read-only GitHub API) → cosmetic rewards. Still no
  competitive leaderboard.
- **P2 (deferred = ADR-0011 territory):** an OPTIONAL aggregation service + contributor leaderboard, ONLY once
  adoption is proven AND with ADR-0011's server-verified guardrails. Any bespoke backend lives HERE, explicitly
  deferred and honestly sized as net-new infra — never smuggled into P0.
- **P3:** open a SECOND commons target (a public OSS lib / knowledge base) once the loop is proven loved.

**Acceptance criteria (runtime-observable):**
- Commons mode opt-in, OFF by default; no patch drafted without explicit per-task user action, and the USER (not
  Grove) opens every PR.
- Grove infra NEVER executes contributor code (CI runs on GitHub Actions, asserted by design + the absence of any
  server-side exec path).
- A `commons_contribution` reward is granted ONLY for a PR the GitHub API reports as MERGED; a closed/un-merged PR
  grants nothing (testable against GitHub merge state).
- Commons task scope EXCLUDES firewall paths (src/engine, src/core); a guard test asserts the scope.
- An engine test asserts a `commons_contribution` event actually grants its cosmetic reward (guards the closed
  `EVENT_TYPES` enum + `reduce()` `default: break` silent-no-op trap — critic #4).
- No money flows between participants; each uses their own quota (not a 资金盘).

**Blocking pre-P0 gates (were "open questions"; the critic correctly flagged they are prerequisites, not footnotes):**
- **Per-tool AI ToS** for AI-assisted, user-attended OSS contribution (likely fine — it is normal "use your AI to
  help on an OSS PR you open yourself" — but MUST be confirmed per supported tool with citations; the rev.1
  "human-review-makes-it-ToS-clean" hand-wave is rejected — critic #3).
- Commons repo home + maintainer/merge ownership + reviewer capacity at scale (who merges the human-approved-but-
  still-AI PRs).
- Task source: auto-derive from labelled GitHub issues vs a curated backlog.
- CLA mechanism + license confirmation for pooled contributions.

**Why:** User — "大家用闲置的 AI 一起共建一个有意义的东西…分成就是游戏里的奖励." Reframed from a 资金盘/挖矿币 idea
(Ponzi/gambling + ToS landmine; would kill "everyone loves it / reduces stress") into a GitHub-native distributed-AI
COMMONS. rev.2 incorporates the critic's REJECT: GitHub (not a bespoke server) is the verified-outcome backend, so
P0 is buildable and Grove never runs stranger code; ToS is a blocking investigation not a hand-wave; the firewall
is governance-protected; the loop stays fire-and-forget with no v1 leaderboard; acceptance criteria are observable.

## ADR-0014 — Synergy / Loadout (rev.2): build-a-kit game depth + ungated helper utility for everyone
**Status:** proposed (rev.2, after critic REJECT of rev.1) · 2026-06-01 (user: focus on THE GAME; "采纳" the reframe)
**Decision:** Add a **Loadout** the player BUILDS from owned cards / gear / buffs into a few limited SLOTS;
**synergies** between equipped members (a published table) produce a PURE `LoadoutEffect` of **cosmetic
multipliers** (XP / seeds / crit) — giving the collection a PURPOSE and real "构筑" decisions. This is **Track A**.
SEPARATELY, **Track B** delivers ADR-0008 "real workflow power-ups" by making the safe helpers genuinely better
**FOR EVERYONE (UNGATED)** — never locked behind game grind.

**Why rev.1 was rejected (critic, code-verified) → the reframe:**
- rev.1 tied REAL utility to synergy "helperFlags". The critic showed this is mostly unbuildable/cosmetic-cosplay:
  `suggest-commit` has no extra signal to be "richer" by a flag; a "coverage hint" would require RUNNING tests
  (**ADR-0003 violation**); `suggest-commit` doesn't even take `dir`/state. Deeper: **gating real tool utility
  behind game-grind is backwards for a productivity tool** — the tool must help everyone. So we SPLIT the goal:
  Track A = game depth (cosmetic mults, honest); Track B = real utility, ungated, for all users.

**Track A — Loadout/synergy (PURE, extends the existing active-bonus pattern):**
- `src/core/state.ts` — add `loadout: { slots: EquippedRef[] }`; **MUST** be added to `GameStateSchema` +
  `migrate()` (legacy default `{slots:[]}`) + `cloneState()` or it is silently dropped on load (critic finding #3).
- `src/core/synergies.ts` — published SYNERGY TABLE (pure data; ADR-0002).
- `src/engine/loadout.ts` — `computeLoadoutEffect(state): { xpMult, seedMult, critBonus, activeSynergies }` (PURE,
  no helperFlags). `equip`/`unequip` pure reducers; slots LIMITED (start = 3).
- reduce(): fold the loadout mults into the SAME capped `scale` as the existing bonuses — a synergy adds a DISTINCT
  small bonus for the COMBINATION; it must NOT re-count a member gear's own `activeGearBonus`, and the TOTAL stays
  capped (no runaway). i18n via the existing catalog; surface in dashboard + TUI, **suppressed under `--zen`**.

**Track B — real, UNGATED helper utility (ADR-0008), available to all users:**
- First concrete win: `suggest-commit` infers a **conventional-commit type + scope + body** from the staged file
  list it ALREADY reads (`stagedDiffStat.files`): tests → `test:`, docs → `docs:`, a scope from the top dir, a body
  listing changed files. Stays a READ-ONLY draft (never commits). This is genuine added value from available data,
  for everyone, not gated. (Future Track-B wins: a richer `recap`, etc. — each ungated, safe, read-only.)

**Acceptance criteria (testable; addresses every critic finding):**
- `equip`/`unequip` pure reducers; slots limited (equip past cap requires unequip → tradeoff); empty loadout =
  neutral (1.0 mults), first-class, NEVER penalized, NO "leaving value on the table" prompting.
- `computeLoadoutEffect` pure (purity.test.ts); a synergy's `xpMult` actually multiplies an XP grant (engine test).
- **NO double-count**: a test asserts a synergy member's gear `activeGearBonus` is not folded twice; total `scale`
  stays within the existing cap.
- **Migration round-trip**: a saved `loadout` survives save→load (schema), `cloneState` (reduce), and `migrate`
  (legacy default `{slots:[]}`) — explicit tests (critic #3).
- **No dominant synergy**: the table yields ≥2 viable builds (asserted), so "构筑" is a real choice.
- **`--zen` suppression**: the loadout / one-away-synergy HUD does NOT appear in calm mode (test).
- **Track B**: `suggest-commit` emits a correct conventional-commit type/scope from staged files, FOR EVERYONE
  (no loadout/synergy gate), and remains a read-only draft that never commits (test). No ADR-0003 test-running.
- Synergy table published/inspectable (ADR-0002).

**Open questions (calibrate while building):** slot count (start 3); the initial synergy set (3-5, themed to
existing card sets + gear + quest buffs); the conventional-commit inference rules for Track B.

**Why:** User refocused on THE GAME and adopted the reframe. Track A gives the requested synergy/build DEPTH and
finally makes collection purposeful, honestly (cosmetic mults = the existing capped economy). Track B honors
ADR-0008's "REAL power-ups" the RIGHT way — by making the safe helpers better for ALL users, not by crippling the
tool until you grind. Firewall (ADR-0005) intact: the engine stays pure; Track B helpers stay read-only drafts.

## ADR-0015 — Achievements (rev.2): retroactive recognition, derivable-only, no completionist FOMO
**Status:** proposed (rev.2, after critic REJECT of rev.1) · 2026-06-01 (user "全都要" — the engagement pillar)
**Decision:** Add **Achievements** — one-time, never-expiring recognitions of cumulative thresholds the player
has ALREADY crossed, derived PURELY from existing state. Engagement = recognition of what you DID, never pressure
to do more. rev.2 incorporates the critic's REJECT of rev.1.

**Distinction from existing systems (critic #5):** an *achievement* RETROACTIVELY recognizes a cumulative
threshold already crossed (a pure read-derivation over GameState); a *quest* (Pillar-B) rewards an ACTION you
take; the *foiled-set capstone* is per-set foil flair. v1 achievements MUST NOT duplicate a quest-completion or a
capstone (asserted — disjoint reward set).

**v1 set is 100% DERIVABLE from existing cumulative state (critic #2):** ONLY from
`{ player.level, completedSets, cards, gear, foiled, prestigeRank(state), quests[].completions }`. e.g.
first-set-complete, all-sets-complete, reach L5/L10, first prestige / prestige x3, own N cards, first foil,
a fully-foiled set, all-gear-owned. **DEFERRED** (need a NEW lifetime counter that v1 does NOT add):
"N commits scored" (`eventCount` is all-types, no per-type counter) and "N synergies discovered"
(`activeSynergies` is recomputed per-call, not persisted). v1 adds ZERO new counters — no "minimal" hand-wave.

**Anti-FOMO is STRUCTURAL, not vocabulary (critic #1):**
- No achievement predicate may read a time/elapsed/inactivity quantity (purity bans the clock; a guard test
  asserts no predicate references an elapsed/inactivity concept). Absence is NEVER punished.
- DEFAULT surface shows UNLOCKED achievements only; the full locked list is behind an EXPLICIT opt-in
  (`sq achievements --all`), NEVER on the dashboard by default, NEVER nagged — mirroring ADR-0014's "NO 'leaving
  value on the table' prompting". `--zen` suppresses the achievements surface entirely.

**Architecture (pure, mirrors computeLoadoutEffect):**
- `src/core/achievements.ts` — published ACHIEVEMENTS table (pure data): `{ id, name, desc, when: (s)=>boolean }`,
  each `when` pure over the derivable fields above. Published/inspectable (ADR-0002).
- `src/engine/achievements.ts` — PURE `checkAchievements(state): string[]` returns ids satisfied-now AND NOT in
  `state.achievements` (the idempotency gate, critic #4). reduce() appends those + pushes a COSMETIC unlock reward;
  never reverts.
- state round-trip = ALL FOUR sites (critic #3, the loadout/foiled precedent): `achievements: string[]` on the
  GameState interface + initialState `[]`; `GameStateSchema` as `.optional()`; `migrate()` default `[]`;
  `cloneState` spread `[...]` (hand-written clone — omitting it silently drops achievements every reduce).
- render/TUI: a calm achievements surface (`sq achievements`), unlocked-only by default, `--all` opt-in; i18n ×4.

**Acceptance criteria (testable):**
- `checkAchievements` PURE (purity.test); every `when` derives ONLY from the listed existing fields (no new counter).
- **Idempotent**: reducing the SAME state twice yields ZERO new unlocks / ZERO new rewards on the 2nd pass (test).
- **No FOMO path**: a guard test asserts no predicate references an elapsed/inactivity/time quantity; default
  surface unlocked-only; locked list only under explicit `--all`; `--zen` suppresses entirely.
- **No duplication**: no achievement fires the same recognition as an existing quest-completion or foiled capstone (test).
- **Round-trips** through interface + schema(optional) + migrate(`[]`) + cloneState(`[...]`) — explicit tests.
- Cosmetic only (ADR-0005); never expires/reset/reverts; published (ADR-0002).

**Open questions:** the exact ~10-15 derivable achievements + thresholds; subcommand vs an opt-in panel.

**Why:** the return/engagement pillar, in the ONLY form consistent with Grove's soul — recognition, not coercion.
rev.2 fixes the critic's findings: derivable-only (no hidden counter/contradiction), structural anti-FOMO (no
locked-completionist nag), all four round-trip sites, an explicit idempotency gate, and a crisp
not-a-second-quest-system distinction.

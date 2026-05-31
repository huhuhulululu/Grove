# Grove — Multi-Angle Audit (rolling)

10-lens expert audit, 2026-05-30 (workflow `wrk2o29du`, 16 agents). Mandate: "不成功不停止 / 多角度" —
review→improve in rounds until every lens grades high.

## Round 1 — Scorecard (overall **C+**)
| Lens | Grade |  | Lens | Grade |
|---|---|---|---|---|
| Game design | C | | Security | C |
| Game economy | C | | Product/UX | C |
| AI-coding eng | C | | Ethics/anti-burnout | B |
| Architecture | B- | | QA/testing | B- |
| Code review | B- | | Product strategy | B |

**Standout asset:** the pure-engine ethics firewall (verified holds). **Verdict:** great foundation,
"not yet a game, not yet shippable."

### Round 1 fixes (DONE, verified — 565 tests green)
- Epoch-units mismatch (reset ETA always "soon") · partial-frame vigor fabrication · test-file **deletion**
  rewarded as test_added · git-utils shell injection → execFileSync.

## Backlog (29 items) → multi-round plan
**Round 2 — Trust tier (correctness/security P0, self-contained):**
- P0 Persistence concurrency: unlocked read-modify-write loses updates (20 commits → eventCount 17); add a
  lockfile around load→reduce→save; + loadState zod-validate/migration; + stop O(n) log reparse for the rng seed.
- P0 Shell injection: remaining execSync template-literals (githook, pillarb, statusline-install) + the two
  GENERATED scripts (hook block, statusline wrapper) interpolate unescaped repoDir/original → execFileSync + safe escaping.

**Round 3 — Make it a game (the C→B+ lever for game-design/economy):**
- P1 No economy: currency frozen at 0 → grant on outcomes, pulls/enhance-protect COST it, player CHOOSES to pull.
- P1 Gear level / sets / dead buff-kinds confer nothing → give gear level a safe ADR-0008 effect, real set bonus,
  make aura/streak real (or stop showing them).
- P1 Gacha inflation (realized legend+shiny ~8.8% vs published 1.7%) → raise pity thresholds + demote build/lint
  to chance-of-pull; dup-compensation; variable-ratio schedule; more content; leveling unlocks.

**Round 4 — Front door + honesty:**
- P0 No install path: package.json bin + README + build + portable groveInvocation (no baked dev tsx path).
- P1 `sq wrap -- <cmd>` (the real test/build signal source per ADR-0003; today test_result is minted on faith).
- P1 account-global energy store (quota is account-wide, currently per-repo).
- P3 honesty: trim doc over-claims (--zen, multi-platform) to shipped scope or build them.

**Later polish (P2/P3):** anti-farm recurring Pillar-B XP · remaining 4 quests + renewable variants · multiplier
provenance in reward line · dashboard wide-emoji width · interactive enhance TUI · onboarding/typo UX ·
backup rotation · stdin bounds · dev-dep audit (vitest GHSA) · e2e tests that execute the generated wrapper/hook.

> Re-baseline the scorecard after each round; target every lens ≥ B+, game-design/fun ≥ A-.

## Re-score ① (after R1/R2/R3) — recovered from transcripts (synthesis tool-glitched; grades intact)
| Lens | R1 | now | | Lens | R1 | now |
|---|---|---|---|---|---|---|
| Architecture | B- | **B+** ✅ | | Strategy | B | B |
| Ethics/anti-burnout | B | **B+** ✅ | | Economy | C | C+ |
| Security | C | B | | AI-coding eng | C | C+ |
| Game design | C | B | | Product/UX | C | C+ |
| Code review | B- | B | | QA | B- | B |

**2/10 at B+.** Two clusters still below:
- **Front-door cluster** (blocks UX/AI-eng/strategy/QA/security): no `bin`/README/install path; no `sq wrap`
  real signal; energy stored per-repo not account-global; `groveInvocation` double-quotes paths (residual
  injection surface); generated hook/wrapper never executed in a real-git e2e. → **R4 target.**
- **Game-depth cluster** (blocks economy C+/game-design B): content cliff (only 15 cards); leveling unlocks
  nothing; realized rarity still ~3x off published; near-free-pull inflation; thin endgame gear depth;
  + code-review nits (dedup grantPull/dupComp/setBonus; serendipity overwrites real pity; `sq enhance` free
  while repair costs seeds). → **R5 target.**

## Re-score ② (after R4) — 4/10 at B+
| Lens | R1 | ① | ② | | Lens | R1 | ① | ② |
|---|---|---|---|---|---|---|---|---|
| Architecture | B- | B+ | **A-** ✅ | | AI-coding eng | C | C+ | B |
| Ethics | B | B+ | **A-** ✅ | | Product/UX | C | C+ | B |
| Security | C | B | **B+** ✅ | | Code review | B- | B | B |
| QA | B- | B | **B+** ✅ | | Game design | C | B | B |
| Strategy | B | B | B | | Game economy | C | C+ | **C+** (laggard) |

**R5 targets — two file-disjoint clusters (run in parallel):**
- **ENGINE/ECONOMY DEPTH** (engine+core+store): leveling must DO something (gate/scale/unlock; level is dead);
  content depth (15→more cards/sets + remaining 4 quests + dup-conversion/prestige tail = kill the cliff);
  faucet≫sink rebalance (restore save-vs-spend); honest odds (realized 3.14% vs published 1.7% → reconcile);
  endgame seed sink; account-global energy store (AI-eng P1). → game-design/economy/AI-eng.
- **CLI/UX/DOCS/NAMING** (cli+render+docs+package): strategy **P0** package name vs README install mismatch;
  wrap can't combine with --zen/--home; first-aha onboarding (`sq init`) + "did you mean?" typo help; dashboard
  wide-emoji alignment; code-review nits (enhance bounds-guard, enhance/repair/protect honor zen, magnitude NaN
  guard, sturdier run-as-script guard, playReveal non-busy-loop). → UX/strategy/code-review.

## Re-score ③ (after R5) — 5/10 at B+; 3 lenses regressed on ONE root cause
| Lens | ① | ② | ③ | | Lens | ① | ② | ③ |
|---|---|---|---|---|---|---|---|---|
| AI-coding eng | C+ | B | **A-** ✅ | | Game economy | C+ | C+ | B- |
| Architecture | B+ | A- | **B+** ✅ | | Game design | B | B | B |
| Security | B | B+ | **B+** ✅ | | Code review | B | B | B- ⬇ |
| Ethics | B+ | A- | **A-** ✅ | | Product/UX | C+ | B | B- ⬇ |
| QA | B | B+ | **B+** ✅ | | Strategy | B | B | B |

**Root cause of the regressions (lesson: the R5 engine‖cli PARALLEL split disconnected them):** R5 built the
endgame in the ENGINE but left it DEAD at the player surface. R6 must WIRE it, with engine→cli SEQUENTIAL.
**R6 targets:**
- P0 wire `sq craft` (+ a `craftCard` engine fn to SPEND shards) / `sq prestige` / `sq pull --premium`;
  CLI must use level-scaling `enhanceCost(level)`/`repairCost(gear)` not flat constants; add `shards` to GameStateSchema.
- P1 global-store needs its OWN lock (R2 guarantee regressed for the account-wide file); surface shards /
  next-unlock horizon / locked-set labels / set-unlock reward line in the dashboard; README into package `files`.
- P1/P2 game-design: unlock-cadence day-5..8 beat; tiered/renewable prestige; grantDupComp dedup; card-name double-print.

## Re-score ④ (after R6) — 7/10 at B+
| Lens | ② | ③ | ④ | | Lens | ② | ③ | ④ |
|---|---|---|---|---|---|---|---|---|
| Game design | B | B | **B+** ✅ | | AI-coding eng | B | A- | **A-** ✅ |
| Architecture | A- | B+ | **A-** ✅ | | Security | B+ | B+ | **B+** ✅ |
| Ethics | A- | A- | **A-** ✅ | | QA | B+ | B+ | **A-** ✅ |
| Strategy | B | B | **B+** ✅ | | Game economy | C+ | B- | B |
| Code review | B | B- | B | | Product/UX | B | B- | B |

**R7 targets — last 3 lenses, two file-disjoint clusters (parallel; engine APIs already exist so no R5-style disconnect):**
- **ENGINE/ECONOMY tune** (engine+core): faucet≫sink (raise PULL_COST / lower grants / per-DAY milestone cap so
  affordable pulls/active-day ≤ ~10); craft horizon (tune SHARDS_PER_CRAFT/SHARDS_BY_RARITY); code nits —
  grantSetBonus must recurse `newlyCompleted`, prestigeRank exact-match (not startsWith), grantBuff dedup rest-kind.
- **CLI/RENDER surface** (cli+render): prestige rank + next cost on the dashboard + a single `✦ Prestige ×N` rollup
  (not N buff rows); affordable-action CTA line; `sq status` shows Shards (+ prestige) for dashboard/status parity;
  craft target shows card NAME not raw id.

## Re-score ⑤ (after R7) — ✅ ALL 10 LENSES ≥ B+ — LOOP COMPLETE
| Lens | now | | Lens | now |
|---|---|---|---|---|
| AI-coding eng | **A-** | | Product/UX | **A-** |
| Architecture | **A-** | | Ethics | **A-** |
| QA | **A-** | | Strategy | **A-** |
| Game design | **B+** | | Game economy | **B+** |
| Code review | **B+** | | Security | **B+** |

Overall **A-/B+**. Trajectory: C+ → (R1-R7) → all-B+ over 5 re-score gates (① 2/10 → ② 4/10 → ③ 5/10 →
④ 7/10 → ⑤ 10/10). Evidence: **1030 tests pass**, tsc clean, `npm run build` + `node dist/cli/sq.js` run,
full play session verified (scan→earn→pull→enhance→craft→dashboard). The "不成功不停止 / every lens ≥ B+"
mandate is MET.

### Remaining (non-blocking) polish — future, not loop targets
- P2 `sq help` USAGE text quotes pre-R7 costs (30/150/40) — runtime/dashboard use live constants; static help drifted.
- P3 dead shard-tail (shards accrue unbounded once craftable-complete → add shard→seed conversion).
- P3 game-FEEL ceiling: dashboard is a string redraw, not a navigable Ink TUI (GOALS M3 roadmap) — caps feel, not soundness.
- Roadmap (GOALS M5/M6): web/mobile, opt-in leaderboard (ADR-0011).

## Re-score ⑥ (after BC + polish) — ALL 10 ≥ A- (9×A-, 1×A: strategy). New target: straight A.
R8 push targets the concrete A-blockers (mostly FEEL/surfacing/docs, NOT soundness):
- **TUI feel** (game-design/product/qa): wire the reveal animation into the Ink TUI (frames exist, only the
  React loop is missing); flash the HIGHEST-salience reward (level-up/set-complete/prestige/windfall, not just
  card/gear); rarity-as-COLOR in TUI; feedback on unaffordable/blocked actions; try/catch around withStateLock.
- **Economy depth** (economy): a renewable content axis (cosmetic foil-upgrade shard sink and/or rotating set)
  + a targeted/"spark" premium banner; surface pity/odds at the decision point.
- **Docs/arch** (ai-eng/architecture): README account-global-energy is BUILT (drift — fix); ARCHITECTURE claims
  an engine-purity test that doesn't exist (add it); note the 1738-line sq.ts God-file.
- **Robustness/sec** (code/security): handlePull skip-save when broke; web security headers + granular SSE
  update (not full reload); rotate settings backups + cap jsonl logs.
> Honest caveat: some A-→A items are subjective FEEL; the loop may converge to "mostly A, a couple A-".

## Re-score ⑦ (after R8) — 5/10 straight A (security, product, ethics, qa, strategy); 5 at A-
R9 targets the (now mostly concrete) remaining A-blockers:
- **ai-eng → A**: GOALS.md M5 still calls account-global energy ROADMAP (drift — it's shipped). Doc fix.
- **architecture → A**: split the 2101-line `sq.ts` God-file into per-command modules (keep run()/dispatch + exports).
- **code-review → A**: complete the juice refusal regex (drops 2 refusal messages); implement granular SSE update (no full reload).
- **economy → A** (all low): rarity-scale FOIL_COST + a "fully-foiled" capstone; sharpen spark vs craft (lower threshold or foil-finish guarantee).
- **game-design → A** (the craft item): rarity-SCALED reveal frames (escalating anticipation for rarer drops, not identical dots) + better pack-open frames; light TUI panel motion (XP-bar fill / row pulse) — the last bit is subjective and may not fully converge.

## Re-score ⑧ (after R9) — 5/10 straight A (ai-eng, security, ethics, qa, strategy); 5 at A-
R9 landed (rarity-scaled reveal craft + escalating frames, TUI XP-bar/row motion, FOIL curve + foiled-set
capstone + spark→foil-finish, sq.ts 2101→585-line split, GOALS fix, granular SSE). ⑧ found the 5 remaining
A- lenses share ONE root cause — the recurring engine‖cli/doc DISCONNECT: R9 changed engine semantics
(rarity-scaled foil cost, rarity-scaled reveal) but the SURFACES didn't all follow. R10 closes it (all low/medium):
- **game-design (FEEL) → A**: the escalating reveal was wired in the Ink TUI only; `sq pull`/`sq enhance`
  (the PRIMARY documented CLI) still played the flat default build (a common looked identical to a shiny).
  R10: `revealRarityFor(rewards)` feeds the salient drop's tier to renderPullFrames/renderEnhanceFrames at
  both CLI call sites (+ surface guard economy.reveal.test.ts).
- **economy → A**: reduce.ts foil-curve comment made two FALSE claims about its own constants (said ≈1.5×,
  actually 3.0×; said "never as dear as a craft", but shiny=72 > craft=60). R10: comment corrected to the
  real curve + the shiny-tier exception named (published-cost contract, ADR-0002).
- **code-review + product/UX → A**: `sq help` / dashboard / web all advertised the flat 3-shard floor for a
  now-rarity-scaled (3→72) cost. R10: all three surface the CURVE ("3 to 72 shards by rarity"); cost-drift
  guard's liveCosts extended with the foil curve.
- **architecture → A**: ARCHITECTURE.md still described sq.ts as a "~2k-line God-file / deferred refactor".
  R10: rewritten to the shipped layout (585-line thin dispatch + commands/* groups); date bumped to R9.
Evidence: **1357 tests pass** (65 files, +economy.reveal), tsc clean, build 178.83KB, bin help/dashboard
show the curve. → 打分⑨ to confirm all 10 reach straight A.

## Re-score ⑨ (after R10) — 9/10 straight A; only product/UX A- (NEW R10 regression)
R10's surface-convergence fixes verified in code by every lens: FEEL→A (revealRarityFor wires the escalating
reveal onto the CLI; legendary pull plays strictly more frames than common), economy→A (foil-curve comment now
honest: ≈3×, shiny=72 named exception), ai-eng/architecture/code-review→A (curve surfaced live everywhere; sq.ts
split doc accurate; CLI→tui-helper coupling judged acceptable — type-only app import, no Ink in bundle), security/
ethics/qa/strategy→A. The lone A-: R10 itself widened the dashboard foil line to ~59 cells, overflowing the box
inner budget (width-4=56) so boxRow() truncated the "(sq foil)" CTA.

## Re-score ⑩ (after R10.1) — 10/10 STRAIGHT A ✅
R10.1 shortened the foil line to "✨ foil owned card · 3-72 shards by rarity (sq foil)" (52 cells, fits 56 with
margin; keeps owned-semantics + curve + CTA) + a regression test locking the CTA at default width. ⑩ confirmed
product/UX→A (runtime-verified: CTA intact + border-aligned at widths 56/60/70/80) and a dedicated regression-
safety sweep→A (width fits at every reachable width; the guard test would fail on the pre-fix string; the
pre-existing foil test still passes; "3-72" uses ASCII hyphen, no copy-lint issue).

**FINAL: all 10 lenses STRAIGHT A.** Trajectory: C+ → all-B+ (gates ①②④⑤) → all-A- (⑥) → 5/10 A (⑦) →
5/10 A (⑧) → 9/10 A (⑨) → **10/10 A (⑩)**. Evidence: **1358 tests pass** (65 files), tsc --noEmit clean,
`npm run build` 178.83KB ESM + `node dist/cli/sq.js` runs. The "再打分冲 A · 不到 A 不停" mandate is MET.
Recurring lesson (re-confirmed this round): semantic changes in the engine must be chased onto EVERY player
surface in the SAME pass (the engine‖cli/doc disconnect) — and widening a display string can overflow a
fixed-width box, so re-measure box rows after copy edits.

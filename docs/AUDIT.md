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

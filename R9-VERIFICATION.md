---
phase: R9-straight-A
verified: 2026-05-31T15:02:30Z
status: passed
score: 5/5 must-haves verified
gaps: []
---

# Grove R9 Verification Report

**Phase Goal:** Straight-A push — all 5 A-blocker areas addressed (FEEL, ECONOMY, STRUCTURE + tsc clean + full suite green).
**Verified:** 2026-05-31T15:02:30Z
**Status:** passed (after minimal fix to 2 test assertions)

## Fix Applied

`src/cli/r8.test.ts` tests 1 and 5 used `forest.oak` (rarity `uncommon` in `ALL_CARD_DEFS`, foil cost 6) but expected common-cost behavior (FOIL_COST = 3). R9 made foilCard use the real rarity from ALL_CARD_DEFS (rarity-scaled curve). Fixed by replacing the card fixture with `forest.sapling` (truly common in ALL_CARD_DEFS, cost 3) in those two tests.

## Test Results

- Full suite: 1353/1353 passed, 64/64 test files — all green.
- `npx tsc --noEmit` — clean (no output).
- `npm run build` — success: `dist/cli/sq.js` 178.49 KB.

## Smoke Tests

- `node dist/cli/sq.js help` — outputs usage, mentions foil + spark.
- `sq dashboard --no-clear` — renders dashboard panels.
- `sq foil` — "nothing to foil — no cards owned yet" (correct behavior).
- `sq tui --once` — renders TUI with collection rows.
- `sq pull` — "not enough seeds" (correct).

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Reveal frames escalate by rarity (legendary longer/brighter than common) | VERIFIED | `buildRevealFrames` in enhance.ts: common=3 frames, legendary=10 frames; tests pass |
| 2 | TUI XP-bar and row motion helpers exist | VERIFIED | `xpBarSteps` in juice.ts wired to app.tsx; 69 juice tests pass |
| 3 | Juice refusal regex matches foil/premium refusals | VERIFIED | REFUSAL_RE covers `not enough`, `can't foil`, `already foiled`, `premium needs` |
| 4 | FOIL_COST scales by rarity + fully-foiled-set capstone | VERIFIED | `FOIL_COST_BY_RARITY` table + `grantFoiledSetCapstone`; foil-curve.test.ts 15/15 pass |
| 5 | sq.ts thin entry with handlers extracted to commands/* | VERIFIED | sq.ts = 585 lines (was 2101); 5 command modules in src/cli/commands/ |
| 6 | GOALS.md no longer lists account-global energy as roadmap | VERIFIED | Listed as SHIPPED in M5; cross-device sync is roadmap, not account-global energy |
| 7 | Web page updates via SSE WITHOUT full reload | VERIFIED | page.ts uses EventSource + granular DOM patch via data-bind; comment: "NOT a full location.reload" |
| 8 | Spark has distinct niche vs craft | VERIFIED | Spark = premium pull guarantee toward missing card; craft = direct shard spend |

## Key Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/render/enhance.ts` | VERIFIED | buildRevealFrames escalates by rarityRank (0-5) |
| `src/tui/juice.ts` | VERIFIED | xpBarSteps pure helper + REFUSAL_RE with foil/premium coverage |
| `src/engine/reduce.ts` | VERIFIED | FOIL_COST_BY_RARITY curve + grantFoiledSetCapstone + SPARK_THRESHOLD |
| `src/cli/sq.ts` | VERIFIED | 585 lines, thin dispatch shell |
| `src/cli/commands/` | VERIFIED | economy.ts, view.ts, hooks.ts, share.ts, shared.ts |
| `src/web/page.ts` + `server.ts` | VERIFIED | SSE EventSource granular DOM patch |
| `docs/GOALS.md` | VERIFIED | Account-global energy = SHIPPED; cross-device = ROADMAP |

## Regressions

None found. All 1353 previously-passing tests still pass after the 2-line fixture fix.

---

_Verified: 2026-05-31T15:02:30Z_
_Verifier: Claude (Sonnet 4.6)_

# Grove — Prior Art & Competitive Landscape

Research date: 2026-05-30 (5-way public-repo scout + adversarial novelty check). Full transcript:
workflow `w7m80xo3e`. **Verdict: build from scratch; treat everything below as REFERENCE/BORROW, not a base.**
No public project is a superset of Grove — each owns ~one slice and breaks on at least one Grove hard constraint.

## The landscape splits into 5 clusters (none fuse Grove's thesis)
1. **Git/terminal XP wrappers** — reward raw activity, not verified outcomes; no loot/energy.
2. **CC pets/companions** — own the collectible/companion surface; identity/usage-driven, not outcome-driven.
3. **CC usage/statusline tools** — already parse the exact 5h/7d `rate_limits` JSON Grove uses; pure gauges, no game.
4. **Habit/quest/loot RPGs** — own outcome→loot/quest model + anti-pay-to-win; generic life/time, not coding-aware.
5. **Gacha/pity engines** — reusable drop/pity backends.

## Notable projects (URL · overlap · what to borrow)
| Project | Overlap | Borrow |
|---|---|---|
| **claude-quest** (SeanZoR) | THESIS twin (~30%): markets as "gamification layer for Claude Code" (XP/achievements/quests) | But rewards CC-*setup* actions, cloud-KV (not local-first), no loot/energy → differentiate against, not base |
| **claude-code-tamagotchi** (Ido-Levi, ~424★) | closest PLUMBING (PreToolUse hook→SQLite→statusline) | inverted philosophy (punishes violations); Grove rewards outcomes. Reference the pipeline only |
| **claude-pace** (Astro-Han, ~199★, MIT) | CRITICAL: reads `rate_limits` from statusline stdin = Grove's energy source, CONFIRMED | the whole stdin parse recipe + version gate (CC≥2.1.80) + "pace=sustainable burn rate" framing |
| **Claude-Code-Usage-Monitor** | burn-rate + P90 limit auto-detect + depletion forecast | port the forecasting into Grove's Vigor/Sap regen ("when does it refill") |
| **buddy-evolution** (MIT, TS, 104 tests) | token-usage→XP→5-tier evolution for CC /buddy | XP formula, diminishing returns, session-end processing, tier thresholds |
| **Habitica** (HabitRPG) | RPG MODEL north star: outcome→loot/XP/quests/collection + canonical pay-to-win doc | the "Play to Win, Not Pay to Win" rule verbatim; design only (copyleft, wrong domain) |
| **termonaut** (MIT, Go) | terminal gamification + TUI + badges | adaptive TUI density (Smart/Compact/Full); multiplier/streak XP taxonomy |
| **ccstatusline** (MIT, TS) | statusline JSONL parsing | the JSONL DEDUP logic (over-count gotcha we'll hit) |
| **codachi** (MIT, TS) | CC pet + a /compact nudge | "suggest once per trigger, above threshold, never nag" — exact ADR-0008 pattern |
| **gachapy / Pandora** (MIT) | gacha rarity / soft+hard pity + dup-compensation | validate our shipped gacha/pity; optionally make odds config-tunable |
| **rpg-cli** (MIT, Rust) | loot/chest/permadeath RISK feel | reference for the `sq enhance` risk/tension loop |
| **Code::Stats** (codestats.net) | verified XP curve `level=floor(0.025*sqrt(XP))` | the curve formula (AGPL — formula not code) for recap/levels |
| **Official /buddy** (Anthropic, closed) | companion/rarity/stats-from-identity; feature reqs #41684/#41895/#41908 = a community wishlist | design only: deterministic-from-identity starter, 5-stat model; **read /buddy state to coexist, not collide** |
| **Gamekins** (Jenkins/IntelliJ plugin, ICSE 2022) | **closest OUTCOME-GATING precedent** — gamifies VERIFIED coverage/mutation/build challenges | cite as prior art; it's CI/JVM, not CLI/AI/loot — different platform |

## Grove's gap (what nobody fuses — the differentiation)
Grove = **(outcome-gated loot/gear/quests) × (Claude-Code quota→energy) × (safe useful effects) × (local-first
tool-agnostic) × (pure-engine ethics firewall).** Each factor exists *somewhere*; the **product exists nowhere but
Grove.** Specifically unoccupied by everyone: (a) rewarding verified coding OUTCOMES *and* spec/doc/CLAUDE.md
authorship as first-class; (b) mapping live 5h/7d `rate_limits` into a *game energy* metaphor (the usage cluster
shows it as a plain gauge; the game cluster is blind to quota); (c) safe "useful" effects (suggest-commit,
checkpoint) as rewards under an ethics firewall; (d) terminal+phone+web for *live* sessions; (e) "real work can
never be harmed" by construction.

## Positioning (corrected after the Gamekins finding)
> "**First to FUSE verified-outcome gamification with AI-assisted coding + quota-energy + loot, local-first &
> tool-agnostic.**" — NOT "first to reward verified outcomes" (Gamekins did that for CI coverage since ICSE 2022).
De-emphasize the companion/collection pillar as the headline (Anthropic's own /buddy could commoditize it);
**lead with the fusion + tool-agnostic outcome-gating that a Claude-only, identity-deterministic /buddy structurally cannot match.**

## Risks (from the adversarial pass)
- **Anthropic /buddy + #41684** ("RPG evolution from usage") is the only well-resourced competitor → moat is the
  tool-agnostic fusion, not the companion.
- **Quota-parsing is a commodity + moving target** (undocumented oauth/usage endpoint; field shapes shift across CC
  versions, e.g. #41788) → our statusline parser is a maintenance liability, not a moat; **consider depending on/tracking
  ccusage** rather than owning the parse.
- **Pillar-B detection is novel-but-fragile** (heuristics gameable) → keep the "nudge, don't claim to verify" framing.

## Two narrow real-dependency candidates (everything else = reference only)
- **ccusage** — optional cost/token data source.
- **Claude-Code-Usage-Monitor's burn-rate/P90 forecasting** — port into the energy layer vs. bespoke prediction math.

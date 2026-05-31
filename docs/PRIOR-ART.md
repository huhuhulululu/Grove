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

## Head-to-head: Grove vs. nearest rivals

| | **Grove (grovekit)** | **claude-quest** | **claude-code-tamagotchi** | **Habitica** | **Gamekins** |
|---|---|---|---|---|---|
| **What it gamifies** | Verified coding outcomes + good-habit signals (spec, CLAUDE.md, docs) | Claude Code setup actions | Claude Code tool invocations | Generic life habits / to-dos | CI coverage & mutation scores |
| **Loot / gear / gacha** | ✅ Full: pull, enhance, prestige, shards, sets | ❌ No | ❌ No | ✅ RPG gear (generic) | ❌ No |
| **Outcome-gated rewards** | ✅ Exit-code verified (`sq wrap`), git-diff scanned | Partial (CC-setup) | ❌ Activity, not outcomes | Partial (manual check-off) | ✅ CI-verified |
| **AI-tool agnostic** | ✅ Claude / Cursor / Aider / Codex / Copilot / Gemini | ❌ Claude Code only | ❌ Claude Code only | ✅ (generic) | ❌ JVM / Jenkins only |
| **Energy from AI quota** | ✅ 5h/7d Vigor/Weekly → rest-beats, safe pacing | ❌ | ❌ | ❌ | ❌ |
| **Ethics firewall** | ✅ Pure engine, never touches real code/commits | Unclear | ❌ Punishes violations | ✅ Cosmetic only | Partial |
| **Local-first, no server** | ✅ | ❌ Cloud KV | Partial | ❌ Server required | ❌ Server required |
| **Safe workflow power-ups** | ✅ suggest-commit (crit), checkpoint (low-energy) | ❌ | ❌ | ❌ | ❌ |
| **`--zen` calm mode** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Never auto-runs tests** | ✅ (ADR-0003) | N/A | N/A | N/A | ❌ Runs CI |
| **Active community / stars** | 0 (pre-launch) | Small | ~424★ | Large | Academic |

### What each rival owns (and where Grove doesn't compete)

- **claude-quest** — closest thesis (~30%): XP/achievements for Claude Code setup. But cloud-only, no loot/energy, CC-specific. Grove competes on the fusion, not the setup-reward angle.
- **claude-code-tamagotchi** — best plumbing (PreToolUse → SQLite → statusline), but **inverted philosophy**: it *punishes* violations; Grove *rewards outcomes*. The pipeline is reference; the philosophy is the moat.
- **Habitica** — the canonical outcome→loot/XP north star for *generic habits*. No coding awareness, no AI-quota energy, no ethics firewall, server-required. Grove borrows the "play to win, not pay to win" rule; it does not compete on the habit-tracking surface.
- **Gamekins** — the closest *outcome-gating* precedent (CI coverage/mutation challenges, ICSE 2022). CI/JVM, not CLI/AI/loot. Proves the thesis is academically sound; different platform and audience.

### The fusion moat (what no single rival does)

Grove = **(outcome-gated loot/gear/gacha)** × **(Claude-Code quota → game energy)** × **(safe useful effects under an ethics firewall)** × **(local-first tool-agnostic)**.

Each factor exists *somewhere*. **The product exists nowhere but Grove.** Specifically unoccupied by all rivals simultaneously:

1. Rewarding *verified* coding outcomes *and* spec/doc/CLAUDE.md authorship as first-class — not just activity counts.
2. Mapping the live 5h/7d `rate_limits` into a *game energy* metaphor (the usage cluster shows it as a plain gauge; the game cluster is blind to quota).
3. Safe "useful" effects (`suggest-commit`, `checkpoint`) as rewards under a pure-function ethics firewall — real help, structurally harmless.
4. A `--zen` calm mode that strips spectacle while the engine still records state — so heavy workloads can opt out of stimulation without losing progress.

### Risk: Anthropic /buddy commoditizing the companion surface

The official `/buddy` feature (#41684) is the only well-resourced competitor. Its structural constraint: identity-deterministic, Claude-Code-only. Grove's moat is the *tool-agnostic fusion* + outcome-gating that a Claude-only, identity-deterministic companion structurally cannot match. Lead with the fusion in all positioning; de-emphasize pure collection/companion angles.

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

# Grove — Tone & Loot Aesthetic

Direction (user steer, 2026-05-30): **de-中二.** Borrow Diablo's LOOT GRAMMAR — terse, rarity-forward,
let numbers carry the feeling — but **keep a light, approachable personality and emoji.** Not grimdark,
not cutesy fantasy prose. (User picked "keep a bit of fun, just trim the most cloying.")

## Voice
- **Terse & clean.** One short clause, not a sentence of fantasy narration. Rarity + numbers do the work.
- **Light personality + emoji OK** (🃏 ⚔️ ✨ 🆙 ⚡). No edgelord grit, no whimsy overload.
- **Dev-grounded over fantasy:** "tests green", "PR merged", "+8" — not "the canopy shimmers".
- **Still never shaming** (ADR-0005) — but say it plainly, not sweetly.

## Loot grammar (Diablo-ish)
- Drop: `🃏 <Name> · <rarity>`  (rarity-forward, terse — no "a sprout appears" prose).
- Enhance: `ENHANCE +7→+8`  then  `✓ success` / `↓ +6` / `✗ SHATTERED (code safe)` / `– broken`.
- Level: `Level 2`.   XP: `+30 XP · tests green`.   Buff: `🌿 <Name>` (no "Carry it lightly").
- Rarity names UNCHANGED: common / uncommon / rare / epic / legendary / shiny (shiny = the playful top tier, kept).

## Deny-list — rewrite these OUT (a copy-lint test enforces this)
"the grove cheers", "canopy shimmers", "holds its breath", "Carry it lightly", "future-you sends thanks",
"a little seedling joins your collection", "an uncommon sprout appears", "a rare bloom unfurls",
"Light pours through the leaves", "sturdy roots", "tidy branches", "a clear path through the woods",
"the trail is mapped", "a whole new bough unfurls", "forged stronger", "a natural breath point",
"code freely", "Onward!", and any fairytale narration.

## Quest names — crisp, not spellbook cosplay
- "Forge the Grimoire" → e.g. **"Write the CLAUDE.md"** (or a light tag, but not 中二).
- "Pre-cast the Spell" → **"Spec First"**.   "Tend the Living Map" → **"Sync the Docs"**.   "Test Warden" → OK / **"Add Tests"**.

## Energy copy (M-energy)
Keep **Vigor** (5h). "Sap" reads forest-y → prefer **"Reserve"** or **"Weekly"** for the 7d.
Low energy: `⚡ Vigor 14% · good stopping point` (calm, terse) — never an alarm, never sweet.

## Keep
emoji · brevity · all mechanics · the anti-shame rule · approachable, competent dev voice.

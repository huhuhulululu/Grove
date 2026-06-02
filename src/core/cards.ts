import type { Card, Rarity } from './rewards'

// The built-in cosmetic card pool. Both gacha (makeCard) and collection (set-completion)
// depend on this single source so the two engine modules stay consistent.
//
// R5 content depth (audit ENGINE cluster): expanded 15→36 cards across 6 sets
// (was 3) to kill the content cliff. Three sets are GATED behind level thresholds
// (see SET_UNLOCK_LEVEL / unlockedSets) so leveling finally MATTERS — a higher
// level unlocks richer pulls. The three original sets stay unlocked at level 1 and
// together cover EVERY rarity, so a level-1 gacha pull can never starve.
//
// Cosmetic-firewall-safe (ADR-0005): a card is pure flavour; unlocking a set only
// widens the cosmetic pool, never touches real artifacts. Names stay dev-grounded
// and terse (ADR-0009 / docs/TONE.md) — no fairytale narration.

export interface CardDef {
  id: string
  name: string
  rarity: Rarity
  set: string
}

export const CARD_SETS: Record<string, CardDef[]> = {
  // -- Level 1 (unlocked from the start) — cover every rarity between them ----
  forest: [
    { id: 'forest.sapling', name: 'Sapling', rarity: 'common', set: 'forest' },
    { id: 'forest.fern', name: 'Fern', rarity: 'common', set: 'forest' },
    { id: 'forest.oak', name: 'Oak', rarity: 'uncommon', set: 'forest' },
    { id: 'forest.willow', name: 'Willow', rarity: 'rare', set: 'forest' },
    { id: 'forest.elder', name: 'Elder Tree', rarity: 'epic', set: 'forest' },
  ],
  tools: [
    { id: 'tools.hammer', name: 'Hammer', rarity: 'common', set: 'tools' },
    { id: 'tools.wrench', name: 'Wrench', rarity: 'common', set: 'tools' },
    { id: 'tools.compiler', name: 'Compiler', rarity: 'uncommon', set: 'tools' },
    { id: 'tools.debugger', name: 'Debugger', rarity: 'rare', set: 'tools' },
    { id: 'tools.refactor-blade', name: 'Refactor Blade', rarity: 'legendary', set: 'tools' },
  ],
  creatures: [
    { id: 'creatures.bug', name: 'Bug', rarity: 'common', set: 'creatures' },
    { id: 'creatures.duck', name: 'Rubber Duck', rarity: 'uncommon', set: 'creatures' },
    { id: 'creatures.daemon', name: 'Daemon', rarity: 'rare', set: 'creatures' },
    { id: 'creatures.panic', name: 'Kernel Panic', rarity: 'epic', set: 'creatures' },
    { id: 'creatures.phoenix', name: 'Shiny Phoenix', rarity: 'shiny', set: 'creatures' },
  ],

  // -- Level 3 — "Syntax" (AI-coding flavour) ---------------------------------
  syntax: [
    { id: 'syntax.semicolon', name: 'Semicolon', rarity: 'common', set: 'syntax' },
    { id: 'syntax.brace', name: 'Curly Brace', rarity: 'common', set: 'syntax' },
    { id: 'syntax.regex', name: 'Regex', rarity: 'uncommon', set: 'syntax' },
    { id: 'syntax.closure', name: 'Closure', rarity: 'rare', set: 'syntax' },
    { id: 'syntax.monad', name: 'Monad', rarity: 'epic', set: 'syntax' },
    { id: 'syntax.quine', name: 'Quine', rarity: 'legendary', set: 'syntax' },
  ],

  // -- Level 4 — "Deploy" (infra / shipping flavour; R6 mid-game beat) --------
  deploy: [
    { id: 'deploy.commit', name: 'Green Commit', rarity: 'common', set: 'deploy' },
    { id: 'deploy.pipeline', name: 'Pipeline', rarity: 'common', set: 'deploy' },
    { id: 'deploy.container', name: 'Container', rarity: 'uncommon', set: 'deploy' },
    { id: 'deploy.rollback', name: 'Rollback', rarity: 'rare', set: 'deploy' },
    { id: 'deploy.bluegreen', name: 'Blue-Green', rarity: 'epic', set: 'deploy' },
    { id: 'deploy.zero-downtime', name: 'Zero Downtime', rarity: 'legendary', set: 'deploy' },
  ],

  // -- Level 7 — "Circuits" (hardware / low-level flavour, bridges deploy→relics) -
  circuits: [
    { id: 'circuits.transistor', name: 'Transistor', rarity: 'common', set: 'circuits' },
    { id: 'circuits.resistor', name: 'Resistor', rarity: 'common', set: 'circuits' },
    { id: 'circuits.capacitor', name: 'Capacitor', rarity: 'uncommon', set: 'circuits' },
    { id: 'circuits.gate', name: 'Logic Gate', rarity: 'rare', set: 'circuits' },
    { id: 'circuits.cpu', name: 'CPU Die', rarity: 'epic', set: 'circuits' },
    { id: 'circuits.void-pointer', name: 'Void Pointer', rarity: 'legendary', set: 'circuits' },
  ],

  // -- Level 10 — "Relics" (legacy-code flavour, the late-game prize set) -----
  relics: [
    { id: 'relics.tabs', name: 'Tabs vs Spaces', rarity: 'common', set: 'relics' },
    { id: 'relics.goto', name: 'GOTO', rarity: 'uncommon', set: 'relics' },
    { id: 'relics.cobol', name: 'COBOL Scroll', rarity: 'rare', set: 'relics' },
    { id: 'relics.mainframe', name: 'Mainframe', rarity: 'epic', set: 'relics' },
    { id: 'relics.y2k', name: 'Y2K Survivor', rarity: 'legendary', set: 'relics' },
    { id: 'relics.golden-master', name: 'Golden Master', rarity: 'shiny', set: 'relics' },
  ],
}

// ---------------------------------------------------------------------------
// Level gating — leveling MUST matter (audit game-design P1: level was display-
// only). Each set unlocks at a level threshold; higher level → richer pulls.
// The three level-1 sets together cover every rarity (no starvation at level 1).
// Published / inspectable (ADR-0002); purely cosmetic widening (ADR-0005).
// ---------------------------------------------------------------------------

export const SET_UNLOCK_LEVEL: Record<string, number> = {
  forest: 1,
  tools: 1,
  creatures: 1,
  syntax: 3,
  // R6 cadence retune (game-design P1): deploy shifted 6→4 so a new-content beat
  // lands in the ~day-5..8 window (L4 ≈ day-5.4 at the audit's ~83 XP/day model),
  // filling the old day-2.3→day-9 dead zone. relics stays the L10 late-game prize.
  deploy: 4,
  // circuits bridges the deploy→relics dead zone (day-8..12 window at ~83 XP/day).
  circuits: 7,
  relics: 10,
}

export const ALL_CARD_DEFS: CardDef[] = Object.values(CARD_SETS).flat()

/** The level at which `set` unlocks. An unknown set defaults to 1 (always pullable). */
export function setUnlockLevel(set: string): number {
  return SET_UNLOCK_LEVEL[set] ?? 1
}

/**
 * The set ids a player of the given `level` can pull from. Monotonic in level
 * (a higher level never removes a set). A level < 1 is treated as level 1, so the
 * pool is never empty. Drives gacha so level genuinely gates the pull pool.
 */
export function unlockedSets(level: number): string[] {
  const lvl = Math.max(1, level)
  return setIds().filter((s) => setUnlockLevel(s) <= lvl)
}

/**
 * The soonest set gated ABOVE `level` (the player's next unlock "horizon"), or
 * null once everything is unlocked. Lets the UI surface a forward goal.
 */
export function nextSetUnlock(level: number): { set: string; level: number } | null {
  const lvl = Math.max(1, level)
  const upcoming = setIds()
    .map((s) => ({ set: s, level: setUnlockLevel(s) }))
    .filter((e) => e.level > lvl)
    .sort((a, b) => a.level - b.level)
  return upcoming[0] ?? null
}

/**
 * All card defs of a given rarity. With `level` provided, the result is scoped to
 * sets unlocked at that level (gacha respects unlocked sets — richer pulls at
 * higher level). With no level, returns every def of that rarity (back-compat).
 * Every rarity has at least one card in the level-1 pool.
 */
export function cardDefsByRarity(rarity: Rarity, level?: number): CardDef[] {
  let inScope = ALL_CARD_DEFS
  if (level !== undefined) {
    // Hoist the level-invariant set lookup out of the per-card predicate and use a
    // Set for O(1) membership (was: unlockedSets(level) recomputed for every card).
    const sets = new Set(unlockedSets(level))
    inScope = ALL_CARD_DEFS.filter((c) => sets.has(c.set))
  }
  return inScope.filter((c) => c.rarity === rarity)
}

/** The set ids that exist. */
export function setIds(): string[] {
  return Object.keys(CARD_SETS)
}

/** The full list of card ids that compose a set (for completion checks). */
export function cardIdsInSet(set: string): string[] {
  return (CARD_SETS[set] ?? []).map((c) => c.id)
}

/** Convert a card def into an owned Card instance (identity = def id, so dupes are detectable). */
export function cardFromDef(def: CardDef): Card {
  return { id: def.id, name: def.name, rarity: def.rarity, set: def.set }
}

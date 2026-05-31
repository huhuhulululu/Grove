import type { Card, Rarity } from './rewards'

// The built-in cosmetic card pool. Both gacha (makeCard) and collection (set-completion)
// depend on this single source so the two engine modules stay consistent.

export interface CardDef {
  id: string
  name: string
  rarity: Rarity
  set: string
}

export const CARD_SETS: Record<string, CardDef[]> = {
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
}

export const ALL_CARD_DEFS: CardDef[] = Object.values(CARD_SETS).flat()

/** All card defs of a given rarity (every rarity has at least one). */
export function cardDefsByRarity(rarity: Rarity): CardDef[] {
  return ALL_CARD_DEFS.filter((c) => c.rarity === rarity)
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

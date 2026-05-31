/**
 * model.ts — the PURE view-model for the navigable Ink TUI.
 *
 * `tuiModel(state)` derives a flat, render-ready snapshot of the game from a
 * GameState by RE-USING the existing engine selectors (xpForLevel, prestigeRank /
 * prestigeCost, activeGearBonus / gearEffectText, craftableCardId, the cards
 * catalogue, the quest catalogue, PULL_COST / PREMIUM_PULL_COST). It NEVER
 * re-implements game logic — it only reshapes engine truth for the renderer.
 *
 * PURE: no I/O, no wall-clock, no Math.random; immutable input. Same as the
 * string dashboard renderer (render/dashboard.ts), this is firewall-safe — it
 * reads cosmetic state read-only (ADR-0005).
 */

import type { GameState } from '../core/state'
import {
  CARD_SETS,
  cardIdsInSet,
  setUnlockLevel,
  unlockedSets,
} from '../core/cards'
import { QUESTS } from '../core/quests'
import { xpForLevel } from '../engine/xp'
import { gearEffectText } from '../engine/gear'
import {
  PULL_COST,
  PREMIUM_PULL_COST,
  prestigeRank,
  prestigeCost,
} from '../engine/reduce'
import { craftableCardId, SHARDS_PER_CRAFT } from '../engine/collection'

/**
 * The keyboard-navigable panels, in focus-cycle order. Tab / arrows move focus
 * between these; the action keys act on the focused panel. Stable ordering so
 * the renderer and the key router agree on the cycle.
 */
export const PANELS = ['Collection', 'Gear', 'Quests', 'Economy'] as const
export type Panel = (typeof PANELS)[number]

/** Header view-model: the at-a-glance progression + economy line. */
export interface HeaderVM {
  level: number
  xp: number
  /** XP needed to advance FROM this level (xpForLevel(level)). */
  xpForLevel: number
  /** xp / xpForLevel, clamped to [0,1] — the progress-bar fill fraction. */
  xpFraction: number
  /** cosmetic seed balance (the currency a pull spends). */
  seeds: number
  /** cosmetic dup-tail shards (craft fuel). */
  shards: number
  /** current prestige rank (count of prestige flair buffs). */
  prestigeRank: number
  /** seed cost of the NEXT prestige rank (escalating). */
  nextPrestigeCost: number
}

/** One collection-set row. */
export interface CollectionVM {
  set: string
  owned: number
  total: number
  complete: boolean
  /** true when the set is gated above the player's level (can't be filled yet). */
  locked: boolean
  unlockLevel: number
}

/** One gear row with its active-effect label (ADR-0008). */
export interface GearVM {
  id: string
  name: string
  level: number
  broken: boolean
  /** one-shot enhance-protection armed via `sq protect`. */
  protectedNow: boolean
  /** terse per-gear effect text, or null when broken / no mapped effect. */
  effect: string | null
}

/** One quest-board row. */
export interface QuestVM {
  id: string
  title: string
  status: 'todo' | 'active' | 'done'
}

/** Economy view-model — what THIS balance affords (the core decision surface). */
export interface EconomyVM {
  seeds: number
  shards: number
  pullCost: number
  premiumCost: number
  canPull: boolean
  canPremium: boolean
  canCraft: boolean
  /** the card id a craft would produce, or null when none / too few shards. */
  craftTarget: string | null
  /** seed cost of the next prestige rank. */
  prestigeCost: number
  canPrestige: boolean
}

/** The complete render-ready snapshot. */
export interface TuiModel {
  header: HeaderVM
  collection: CollectionVM[]
  gear: GearVM[]
  quests: QuestVM[]
  economy: EconomyVM
}

/** Derive the view-model from game state. PURE: read-only, deterministic. */
export function tuiModel(state: GameState): TuiModel {
  const level = state.player.level
  const seeds = state.player.currency
  const shards = state.player.shards ?? 0

  const needed = xpForLevel(level)
  const xp = state.player.xp
  const xpFraction = needed > 0 ? Math.min(1, Math.max(0, xp / needed)) : 0

  const rank = prestigeRank(state)
  const sets = unlockedSets(level)

  const header: HeaderVM = {
    level,
    xp,
    xpForLevel: needed,
    xpFraction,
    seeds,
    shards,
    prestigeRank: rank,
    nextPrestigeCost: prestigeCost(rank),
  }

  const collection = buildCollection(state)
  const gear = buildGear(state)
  const quests = buildQuests(state)

  const craftTarget = craftableCardId(state.cards, sets, shards)
  const economy: EconomyVM = {
    seeds,
    shards,
    pullCost: PULL_COST,
    premiumCost: PREMIUM_PULL_COST,
    canPull: seeds >= PULL_COST,
    canPremium: seeds >= PREMIUM_PULL_COST,
    canCraft: shards >= SHARDS_PER_CRAFT && craftTarget !== null,
    craftTarget,
    prestigeCost: prestigeCost(rank),
    canPrestige: seeds >= prestigeCost(rank),
  }

  return { header, collection, gear, quests, economy }
}

/** One row per card set: owned/total, completion, and lock state by level. */
function buildCollection(state: GameState): CollectionVM[] {
  const ownedIds = new Set(state.cards.map((c) => c.id))
  const level = Math.max(1, state.player.level)

  return Object.keys(CARD_SETS).map((set) => {
    const unlockLevel = setUnlockLevel(set)
    const allIds = cardIdsInSet(set)
    const total = allIds.length
    const owned = allIds.filter((id) => ownedIds.has(id)).length
    const locked = unlockLevel > level
    const complete = !locked && total > 0 && owned === total
    return { set, owned, total, complete, locked, unlockLevel }
  })
}

/** One row per owned gear, with its active-effect label + flags. */
function buildGear(state: GameState): GearVM[] {
  const protectedSet = new Set(state.protectedGear)
  return state.gear.map((g) => ({
    id: g.id,
    name: g.name,
    level: g.level,
    broken: g.broken,
    protectedNow: protectedSet.has(g.id),
    effect: gearEffectText(g),
  }))
}

/** One row per quest in the catalogue, with its progress status. */
function buildQuests(state: GameState): QuestVM[] {
  return QUESTS.map((def) => {
    const progress = state.quests.find((q) => q.id === def.id)
    const status: QuestVM['status'] =
      progress?.status === 'done' ? 'done' : progress?.status === 'active' ? 'active' : 'todo'
    return { id: def.id, title: def.title, status }
  })
}

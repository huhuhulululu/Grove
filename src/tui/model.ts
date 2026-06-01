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
import type { Rarity } from '../core/rewards'
import { rarityRank, RARITIES } from '../core/rewards'
import {
  CARD_SETS,
  cardIdsInSet,
  setUnlockLevel,
  unlockedSets,
} from '../core/cards'
import { QUESTS } from '../core/quests'
import { ACHIEVEMENTS } from '../core/achievements'
import { xpForLevel } from '../engine/xp'
import { gearEffectText } from '../engine/gear'
import {
  PULL_COST,
  PREMIUM_PULL_COST,
  prestigeRank,
  prestigeCost,
} from '../engine/reduce'
import { craftableCardId, SHARDS_PER_CRAFT } from '../engine/collection'
import { computeLoadoutEffect, SLOT_CAP } from '../engine/loadout'
import { SYNERGIES } from '../core/synergies'

/**
 * The keyboard-navigable panels, in focus-cycle order. Tab / arrows move focus
 * between these; the action keys act on the focused panel. Stable ordering so
 * the renderer and the key router agree on the cycle.
 */
export const PANELS = ['Collection', 'Gear', 'Quests', 'Economy', 'Loadout', 'Achievements'] as const
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
  /**
   * representative rarity for the row's colour tint — the HIGHEST rarity of any
   * card OWNED in the set (so the row brightens as you collect its top cards).
   * `common` when nothing is owned yet (a neutral tint).
   */
  rarity: Rarity
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
  /** the gear's rarity — drives its rarity-as-colour row tint. */
  rarity: Rarity
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

/** One filled or empty loadout slot row. */
export interface LoadoutSlotVM {
  n: number
  filled: boolean
  /** The label for a filled slot (tag ?? id). */
  label: string
  /** kind: 'card' | 'gear' | 'quest' */
  kind: string
}

/** Active synergy row (fires now). */
export interface LoadoutSynergyVM {
  id: string
  name: string
  /** Terse effect text: "+5% XP", "+6% seeds", etc. */
  effect: string
}

/** One-away synergy row (the chase: needs one more member). */
export interface LoadoutChaseVM {
  id: string
  name: string
  effect: string
}

/** Loadout view-model: slots N/3 + active synergies + one-away chase. */
export interface LoadoutVM {
  /** The 3 slot rows (each either filled or empty). */
  slots: LoadoutSlotVM[]
  /** Synergies currently active. */
  active: LoadoutSynergyVM[]
  /** Synergies needing exactly 1 more member (show only when a free slot exists). */
  chase: LoadoutChaseVM[]
}

/** A single unlocked achievement row. */
export interface AchievementVM {
  id: string
  name: string
  desc: string
}

/** Achievements view-model: count summary + recent unlocks. */
export interface AchievementsVM {
  /** Number of achievements the player has unlocked. */
  unlockedCount: number
  /** Total achievements in the catalogue. */
  total: number
  /** Unlocked achievement entries (in catalogue order). */
  unlocked: AchievementVM[]
}

/** The complete render-ready snapshot. */
export interface TuiModel {
  header: HeaderVM
  collection: CollectionVM[]
  gear: GearVM[]
  quests: QuestVM[]
  economy: EconomyVM
  loadout: LoadoutVM
  achievements: AchievementsVM
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

  const loadout = buildLoadout(state)
  const achievements = buildAchievements(state)

  return { header, collection, gear, quests, economy, loadout, achievements }
}

/** One row per card set: owned/total, completion, lock state, and a colour rarity. */
function buildCollection(state: GameState): CollectionVM[] {
  const ownedById = new Map(state.cards.map((c) => [c.id, c]))
  const level = Math.max(1, state.player.level)

  return Object.keys(CARD_SETS).map((set) => {
    const unlockLevel = setUnlockLevel(set)
    const allIds = cardIdsInSet(set)
    const total = allIds.length
    const ownedCards = allIds.map((id) => ownedById.get(id)).filter((c) => c !== undefined)
    const owned = ownedCards.length
    const locked = unlockLevel > level
    const complete = !locked && total > 0 && owned === total
    const rarity = topRarity(ownedCards.map((c) => c.rarity))
    return { set, owned, total, complete, locked, unlockLevel, rarity }
  })
}

/** The highest rarity among `rarities`, or `common` when the list is empty. */
function topRarity(rarities: Rarity[]): Rarity {
  let best: Rarity = RARITIES[0] // common
  for (const r of rarities) {
    if (rarityRank(r) > rarityRank(best)) best = r
  }
  return best
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
    rarity: g.rarity,
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

/** Terse one-line summary of a synergy's effect: "+5% XP", "+6% seeds", "+4pp crit". */
function synergyEffectLine(def: { effect: { xpMult?: number; seedMult?: number; critBonus?: number } }): string {
  const parts: string[] = []
  const xp = def.effect.xpMult ?? 1
  const seed = def.effect.seedMult ?? 1
  const crit = def.effect.critBonus ?? 0
  if (xp !== 1) parts.push(`+${Math.round((xp - 1) * 100)}% XP`)
  if (seed !== 1) parts.push(`+${Math.round((seed - 1) * 100)}% seeds`)
  if (crit !== 0) parts.push(`+${Math.round(crit * 100)}pp crit`)
  return parts.join(' · ')
}

/** Whether a synergy needs exactly 1 more distinct member to activate. */
function isOneAway(
  def: { requires: Array<{ kind: string; tag?: string; id?: string; min: number }> },
  slots: GameState['loadout']['slots'],
): boolean {
  let gap = 0
  for (const req of def.requires) {
    const matchingIds = new Set<string>()
    for (const ref of slots) {
      if (
        ref.kind === req.kind &&
        (req.tag === undefined || ref.tag === req.tag) &&
        (req.id === undefined || ref.id === req.id)
      ) {
        matchingIds.add(ref.id)
      }
    }
    const need = Math.max(1, req.min)
    const have = matchingIds.size
    if (have < need) gap += need - have
  }
  return gap === 1
}

/** Build the loadout view-model: slots + active synergies + one-away chase. */
function buildLoadout(state: GameState): LoadoutVM {
  const slots = state.loadout?.slots ?? []
  const effect = computeLoadoutEffect(state)

  const slotRows: LoadoutSlotVM[] = []
  for (let i = 0; i < SLOT_CAP; i++) {
    const ref = slots[i]
    if (ref === undefined) {
      slotRows.push({ n: i + 1, filled: false, label: '', kind: '' })
    } else {
      slotRows.push({ n: i + 1, filled: true, label: ref.tag ?? ref.id, kind: ref.kind })
    }
  }

  const active: LoadoutSynergyVM[] = effect.activeSynergies.map((id) => {
    const def = SYNERGIES.find((s) => s.id === id)
    return def
      ? { id, name: def.name, effect: synergyEffectLine(def) }
      : { id, name: id, effect: '' }
  })

  const freeSlots = SLOT_CAP - slots.length
  const chase: LoadoutChaseVM[] = freeSlots > 0
    ? SYNERGIES
        .filter((def) => !effect.activeSynergies.includes(def.id) && isOneAway(def, slots))
        .map((def) => ({ id: def.id, name: def.name, effect: synergyEffectLine(def) }))
    : []

  return { slots: slotRows, active, chase }
}

/** Build the achievements view-model: count + unlocked list. */
function buildAchievements(state: GameState): AchievementsVM {
  const unlockedSet = new Set(state.achievements ?? [])
  const unlocked = ACHIEVEMENTS
    .filter((a) => unlockedSet.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, desc: a.desc }))
  return {
    unlockedCount: unlocked.length,
    total: ACHIEVEMENTS.length,
    unlocked,
  }
}

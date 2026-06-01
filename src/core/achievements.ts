/**
 * achievements.ts — the published ACHIEVEMENTS table (ADR-0015 rev.2). PURE DATA.
 *
 * An achievement RETROACTIVELY recognizes a cumulative threshold the player has
 * ALREADY crossed — a one-time, never-expiring recognition of what you DID, never
 * pressure to do more. Each `when` is a PURE predicate over EXISTING cumulative
 * GameState, deriving ONLY from:
 *   { player.level, completedSets, cards, gear, foiled, prestige rank, quests[].completions }
 *
 * HARD RULES (ADR-0015 rev.2):
 *  - NO new lifetime counter is read — every field above already exists.
 *  - NO predicate reads a time / elapsed / inactivity quantity (structural anti-FOMO;
 *    the purity test bans the clock, and a guard test asserts no elapsed concept).
 *  - DISJOINT from the existing recognitions: no achievement duplicates a quest id
 *    or the foiled-set capstone — an achievement recognizes a CUMULATIVE threshold,
 *    a quest rewards an ACTION, the capstone is per-set foil flair.
 *
 * This module lives in the PURE layer (src/core) — no fs/process/network/wall-clock/
 * Math.random (purity.test). Published / inspectable (ADR-0002).
 */

import type { GameState } from './state'

/** A published, retroactive recognition. `when` is a pure read over GameState. */
export interface AchievementDef {
  id: string
  name: string
  desc: string
  /** PURE predicate: true once the player has crossed this cumulative threshold. */
  when: (s: GameState) => boolean
}

// ---------------------------------------------------------------------------
// Small pure derivations over EXISTING state (no new counters).
// ---------------------------------------------------------------------------

/**
 * The player's prestige rank = count of prestige rank buffs owned. Replicated here
 * (the reduce.ts `prestigeRank` lives in the engine layer; importing it into core
 * would invert the dependency) using the SAME exact-id shape: rank 1 is the legacy
 * `prestige:mark`, rank ≥2 is `prestige:mark:<N>`. PURE.
 */
const PRESTIGE_RANK_RE = /^prestige:mark(:\d+)?$/

function prestigeRankOf(s: GameState): number {
  return s.buffs.filter((b) => PRESTIGE_RANK_RE.test(b.id)).length
}

/** Whether at least one fully-foiled set exists (every owned card of a set is foiled). */
function hasFullyFoiledSet(s: GameState): boolean {
  const foiled = new Set(s.foiled ?? [])
  if (foiled.size === 0) return false
  // Group owned distinct card ids by set; a set is fully foiled when it has >=1 card
  // and every distinct owned card of it is foiled.
  const ownedBySet = new Map<string, Set<string>>()
  for (const c of s.cards) {
    let bag = ownedBySet.get(c.set)
    if (bag === undefined) {
      bag = new Set<string>()
      ownedBySet.set(c.set, bag)
    }
    bag.add(c.id)
  }
  for (const [, ids] of ownedBySet) {
    if (ids.size === 0) continue
    let all = true
    for (const id of ids) {
      if (!foiled.has(id)) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

/** Count of distinct card ids owned (a dup counts once). */
function distinctCardCount(s: GameState): number {
  const ids = new Set<string>()
  for (const c of s.cards) ids.add(c.id)
  return ids.size
}

// ---------------------------------------------------------------------------
// The published table (~12 entries). Each `when` derives ONLY from the allowed
// existing fields. Ordered by the cumulative beat they recognize.
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // -- Level milestones ------------------------------------------------------
  {
    id: 'ach:level-5',
    name: 'Finding Footing',
    desc: 'Reach level 5.',
    when: (s) => s.player.level >= 5,
  },
  {
    id: 'ach:level-10',
    name: 'Hitting Stride',
    desc: 'Reach level 10.',
    when: (s) => s.player.level >= 10,
  },
  {
    id: 'ach:level-20',
    name: 'Old Growth',
    desc: 'Reach level 20.',
    when: (s) => s.player.level >= 20,
  },

  // -- Collection: sets ------------------------------------------------------
  {
    id: 'ach:first-set',
    name: 'First Set',
    desc: 'Complete your first card set.',
    when: (s) => s.completedSets.length >= 1,
  },
  {
    id: 'ach:all-sets',
    name: 'Completionist',
    desc: 'Complete every card set.',
    // Derivable: every existing set id is in completedSets. We read only the
    // distinct set ids the player has actually completed against the set ids that
    // exist on owned cards plus the completed list — to avoid importing the engine
    // catalog into core, we require all SEVEN built-in sets to be complete.
    when: (s) => ALL_SET_IDS.every((set) => s.completedSets.includes(set)),
  },

  // -- Collection: cards owned (distinct) ------------------------------------
  {
    id: 'ach:cards-10',
    name: 'Budding Collection',
    desc: 'Own 10 distinct cards.',
    when: (s) => distinctCardCount(s) >= 10,
  },
  {
    id: 'ach:cards-25',
    name: 'Deep Shelf',
    desc: 'Own 25 distinct cards.',
    when: (s) => distinctCardCount(s) >= 25,
  },

  // -- Gear ------------------------------------------------------------------
  {
    id: 'ach:gear-5',
    name: 'Tooled Up',
    desc: 'Own 5 pieces of gear.',
    when: (s) => s.gear.length >= 5,
  },

  // -- Foiling (renewable axis) ---------------------------------------------
  {
    id: 'ach:first-foil',
    name: 'First Shimmer',
    desc: 'Foil your first card.',
    when: (s) => (s.foiled ?? []).length >= 1,
  },
  {
    id: 'ach:foiled-set',
    name: 'Set Aglow',
    desc: 'Fully foil any one card set.',
    // Recognizes the cumulative state (a fully-foiled set EXISTS), distinct from the
    // per-set capstone buff a single foil ACTION grants — disjoint recognition.
    when: (s) => hasFullyFoiledSet(s),
  },

  // -- Prestige (endgame) ----------------------------------------------------
  {
    id: 'ach:prestige-1',
    name: 'Prestige',
    desc: 'Reach your first prestige rank.',
    when: (s) => prestigeRankOf(s) >= 1,
  },
  {
    id: 'ach:prestige-3',
    name: 'Triple Prestige',
    desc: 'Reach prestige rank 3.',
    when: (s) => prestigeRankOf(s) >= 3,
  },
]

/**
 * The seven built-in set ids the "all sets complete" achievement recognizes. Kept
 * as a local literal (not imported from the engine cards catalog) so this pure-data
 * core module has no engine dependency. If the catalog grows, this list is the one
 * place to extend the completionist recognition.
 */
const ALL_SET_IDS: readonly string[] = [
  'forest',
  'tools',
  'creatures',
  'syntax',
  'deploy',
  'circuits',
  'relics',
]

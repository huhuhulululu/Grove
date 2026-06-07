/**
 * status-json.ts — serialize the COMPUTED game-state to a machine-readable snapshot.
 *
 * PURE: takes a GameState and returns a plain object — no fs/process/clock/random,
 * no mutation. It mirrors the data formatStatus shows, but emits LOCALE-INDEPENDENT
 * values (raw numbers + raw ids/labels, never t()-rendered text), so a script can
 * `sq status --json | jq .` it. Unlike the event log (already JSONL on disk), these
 * are reduce()-DERIVED facts — level/xp/seeds/shards, prestige rank, the per-rarity
 * card breakdown, completed sets, pity — that exist nowhere else (own-your-data).
 *
 * Firewall (ADR-0005): cosmetic/read-only outcomes; prestigeRank is a read-only
 * engine import (not a re-implementation); src/engine + src/core stay untouched.
 */

import type { GameState } from '../core/state'
import { prestigeRank, PRESTIGE_BUFF_ID } from '../engine/reduce'

export interface StatusJson {
  player: { level: number; xp: number; currency: number; shards: number }
  /** prestige rank (count of prestige flair buffs) — folded out of `buffs`. */
  prestige: number
  cards: { total: number; byRarity: Record<string, number> }
  completedSets: string[]
  /** non-prestige buffs as raw id+label (locale-independent). */
  buffs: { id: string; label: string }[]
  pity: { sinceLegendary: number }
}

/** Derive the machine-readable snapshot. PURE: read-only, deterministic, immutable input. */
export function gameStateToJson(state: GameState): StatusJson {
  const { player, cards, completedSets, buffs, pity } = state

  const byRarity = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.rarity] = (acc[c.rarity] ?? 0) + 1
    return acc
  }, {})

  // Mirror formatStatus: collapse the per-rank prestige flair into the `prestige`
  // count, and never duplicate it into the buff list.
  const otherBuffs = buffs.filter((b) => !b.id.startsWith(PRESTIGE_BUFF_ID))

  return {
    player: {
      level: player.level,
      xp: player.xp,
      currency: player.currency,
      shards: player.shards ?? 0,
    },
    prestige: prestigeRank(state),
    cards: { total: cards.length, byRarity },
    completedSets: [...completedSets],
    buffs: otherBuffs.map((b) => ({ id: b.id, label: b.label })),
    pity: { sinceLegendary: pity.sinceLegendary },
  }
}

// All rewards in Grove are COSMETIC (see ADR-0005). Nothing here can represent or affect
// a real file, commit, or capability.

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'shiny'] as const
export type Rarity = (typeof RARITIES)[number]

/** Ordinal rank of a rarity (common = 0 … shiny = 5). Useful for comparisons. */
export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r)
}

/** A cosmetic collectible card. */
export interface Card {
  id: string
  name: string
  rarity: Rarity
  /** the set this card belongs to (for set-completion bonuses) */
  set: string
}

/** Cosmetic gear that can be enhanced with risk. NEVER a real artifact. */
export interface Gear {
  id: string
  name: string
  /** enhancement level (e.g. +0 .. +15) */
  level: number
  rarity: Rarity
  /** a "boom" can break gear cosmetically; it is never real loss */
  broken: boolean
}

export type RewardKind = 'xp' | 'card' | 'gear' | 'currency' | 'buff' | 'levelup'

/** A single thing that happened as a result of an event — what renderers display. */
export interface Reward {
  kind: RewardKind
  amount?: number
  card?: Card
  gear?: Gear
  rarity?: Rarity
  buff?: string
  /** set on a critting XP reward (暴击): the amount was multiplied by a crit roll */
  crit?: boolean
  /** human-facing, celebratory (never shaming) one-liner */
  message: string
  /**
   * OPTIONAL i18n key for `message` (additive — never breaks an unkeyed Reward).
   * When set, a locale-aware renderer can re-translate the line via `t(locale,
   * msgKey, msgArgs)`; `message` itself stays the byte-identical English fallback
   * (so existing tests + copy-lint + any locale-unaware caller keep working). The
   * engine populates this via the pure `msg()` helper (src/i18n/t.ts) — see ADR-0005.
   */
  msgKey?: string
  /** OPTIONAL interpolation args for `msgKey` (numbers stringified at render). */
  msgArgs?: import('../i18n/types').MsgArgs
}

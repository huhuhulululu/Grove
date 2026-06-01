import type { Card, Gear } from './rewards'
import type { EquippedRef } from './synergies'

export interface PlayerState {
  xp: number
  level: number
  /** in-game cosmetic currency ("seeds") — the ONLY thing risk mechanics may gamble */
  currency: number
  /**
   * Dup-conversion sink (R5 dup tail). A duplicate pull accrues cosmetic
   * "shards" scaled by rarity; SHARDS_PER_CRAFT shards craft a chosen missing
   * card, so a completed collection still has a horizon. Optional/defaulted so
   * legacy states and existing PlayerState literals stay valid; read as `?? 0`.
   * Cosmetic-only (ADR-0005) — never code/commits/docs.
   */
  shards?: number
}

export interface PityState {
  /** pulls since the last legendary-or-better (drives soft/hard pity) */
  sinceLegendary: number
}

export type BuffKind = 'aura' | 'freshness' | 'multiplier' | 'rest' | 'streak'

export interface Buff {
  id: string
  label: string
  /** what flavour of buff — drives how the engine applies it */
  kind?: BuffKind
  /**
   * Effect strength: for `multiplier` it multiplies XP (e.g. 2 = 2x); for
   * `freshness` it adds a fraction to XP (e.g. 0.15 = +15%). Cosmetic-adjacent;
   * never affects real work.
   */
  factor?: number
  /** optional expiry expressed as an event-count milestone (kept simple; no wall-clock) */
  expiresAtCount?: number
}

/**
 * Anti-burnout "energy" derived from Claude Code's usage quota (ADR-0005,
 * anti-text-fatigue). Framing is INVERTED: these are amounts REMAINING, never
 * "burned". Both default high; `known:false` means the quota is unmetered
 * (API/Free → no rate_limits) and the UI hides the bar entirely ("Wellspring"
 * mode) rather than inventing scarcity.
 *
 *  - `vigor` — the fast 5h window's energy remaining (0..100), regenerates often.
 *  - `sap`   — the slow 7d window's energy remaining (0..100), the "season".
 *
 * The engine NEVER fabricates these from a clock — they are set only from an
 * actual fresh quota frame's data.
 */
export interface EnergyState {
  /** false = unmetered/Wellspring → UI hides the bar; true = a real frame seen. */
  known: boolean
  /**
   * 5h energy remaining, 0..100 (100 = none used).
   * `undefined` when the 5h window was absent from the quota frame — the engine
   * NEVER fabricates this from an absent or partial frame.
   */
  vigor?: number
  /** epoch milliseconds at which the 5h window resets, if known. */
  vigorResetsAt?: number
  /**
   * 7d energy remaining, 0..100 (100 = none used).
   * `undefined` when the 7d window was absent from the quota frame.
   */
  sap?: number
  /** epoch milliseconds at which the 7d window resets, if known. */
  sapResetsAt?: number
}

/**
 * Progress on a Pillar-B good-practice quest. `completions` lets first-time-only
 * achievements fire exactly once (anti-overjustification: heavy reward the FIRST
 * time, then fade to informational).
 */
export interface QuestProgress {
  id: string
  status: 'active' | 'done'
  completions: number
}

/** The entire persisted player profile. Updated immutably (return new objects). */
export interface GameState {
  version: number
  player: PlayerState
  /** the card collection */
  cards: Card[]
  gear: Gear[]
  pity: PityState
  /** ids of fully-completed card sets (bonus already granted) */
  completedSets: string[]
  buffs: Buff[]
  /** total events processed — drives buff expiry without wall-clock */
  eventCount: number
  /** Pillar-B quest progress */
  quests: QuestProgress[]
  /** anti-burnout energy derived from Claude Code's usage quota */
  energy: EnergyState
  /**
   * R8 RENEWABLE CONTENT AXIS (economy A-blocker). Card ids the player has spent
   * shards to cosmetically FOIL-upgrade (`foilCard`). Every owned card is a further
   * shard sink target, so a completed collection is never "done". Cosmetic-only
   * (ADR-0005) — a foiled card confers ZERO power, it is pure flair. Optional/
   * defaulted so legacy states and existing GameState literals stay valid; read as
   * `?? []`.
   */
  foiled?: string[]
  /**
   * R8 TARGETED 'SPARK' PREMIUM (economy A-blocker). A counter that ticks up on each
   * premium pull that does NOT land the chosen `sparkTarget`; once it reaches
   * SPARK_THRESHOLD the next premium pull GUARANTEES the target (then resets to 0).
   * So saving for premium is choosing a TARGET, not just better EV. Cosmetic-only
   * (ADR-0005); threshold published (ADR-0002). Optional/defaulted; read as `?? 0`.
   */
  spark?: number
  /**
   * The card id the spark counter is building toward (the chosen GUARANTEE target).
   * Set by the player/surface when they pick a premium target; the guarantee fires
   * only if this is still a missing card. Optional; read as `?? undefined`.
   */
  sparkTarget?: string
  /**
   * Gear ids armed with a one-shot "protect" (R3). The NEXT enhance on a protected
   * gear turns a would-be COSMETIC break into a downgrade instead; the id is then
   * consumed. Purely cosmetic risk-management — never touches real artifacts (ADR-0005).
   */
  protectedGear: string[]
  /**
   * Track A LOADOUT (ADR-0014 rev.2). The few EquippedRef the player has built
   * into limited SLOTS; synergies between members produce a PURE, COSMETIC
   * `LoadoutEffect` (xp/seed/crit mults) via src/engine/loadout.ts. An empty
   * loadout is first-class and NEUTRAL (no effect, never penalized). Cosmetic-only
   * (ADR-0005) — confers NO real-world power. MUST be in GameStateSchema + migrate()
   * + cloneState() or it is silently dropped on load.
   */
  loadout: LoadoutState
  /**
   * Token-milestone floor (保底, ADR-0010). A "work meter" that accrues from REAL
   * cumulative cost (cost.total_cost_usd) so heavy work always pays out a fair,
   * COSMETIC-only chest — never xp/power (that would reward burning tokens). It
   * is CAPPED & diminishing per 5h window so it can NOT be farmed. token = ACTIVITY,
   * not an outcome: handled per ADR-0005/0008.
   *
   *  - `workMeter`      — accumulated work units; crossing WORK_MILESTONE fires a chest.
   *  - `lastCostUsd`    — last seen cost.total_cost_usd, to compute the delta. A drop
   *                       (cost < lastCostUsd) means a NEW session → re-baseline from 0.
   *  - `windowKey`      — identifies the current 5h window (the vigorResetsAt epoch, or
   *                       a session-baseline sentinel) so the per-window cap can reset.
   *  - `milestonesInWindow` — chests already granted in the current window (cap-limited).
   */
  work: WorkMeterState
}

/**
 * Token-milestone floor accumulator (ADR-0010). Additive R3 field. Cosmetic-only
 * loot; capped per 5h window so burning tokens past the cap yields NOTHING.
 */
export interface WorkMeterState {
  /** accumulated work units (drained by WORK_MILESTONE on each crossing) */
  workMeter: number
  /** last observed cumulative cost (USD); a drop signals a new session */
  lastCostUsd: number
  /** the 5h window the milestone cap is counted against (vigorResetsAt epoch, or 0) */
  windowKey: number
  /** milestone chests already granted in the current window (cap-limited) */
  milestonesInWindow: number
}

/**
 * Track A loadout (ADR-0014 rev.2). A handful of equipped members in limited
 * slots. Empty by default; cosmetic-only.
 */
export interface LoadoutState {
  slots: EquippedRef[]
}

export function initialState(): GameState {
  return {
    version: 1,
    player: { xp: 0, level: 1, currency: 0, shards: 0 },
    cards: [],
    gear: [],
    pity: { sinceLegendary: 0 },
    completedSets: [],
    buffs: [],
    eventCount: 0,
    quests: [],
    // Wellspring by default: unmetered until a real quota frame proves otherwise.
    energy: { known: false, vigor: 100, sap: 100 },
    work: { workMeter: 0, lastCostUsd: 0, windowKey: 0, milestonesInWindow: 0 },
    loadout: { slots: [] },
    protectedGear: [],
    foiled: [],
    spark: 0,
  }
}

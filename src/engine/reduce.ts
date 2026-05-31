/**
 * reduce — the composition layer of the Grove engine.
 *
 * Maps a normalized GroveEvent onto the four engine modules (xp, gacha, gear,
 * collection) and returns a NEW GameState plus the list of cosmetic Rewards to
 * celebrate. PURE & IMMUTABLE: no I/O, no wall-clock, no Math.random — every
 * chance is threaded through the injected `rng`.
 *
 * ADR-0005 FIREWALL: a failing event NEVER reduces real progress. Failures are
 * a no-op (a clone of state, empty rewards). Rewards are cosmetic only and every
 * message is celebratory, never shaming.
 */

import type { GameState, Buff, BuffKind, EnergyState } from '../core/state'
import type { GroveEvent } from '../core/events'
import type { Reward } from '../core/rewards'
import { rarityRank } from '../core/rewards'
import type { Rng } from '../core/rng'

import { applyXp } from './xp'
import { pull as pull_, makeCard, SOFT_PITY } from './gacha'
import { addCard } from './collection'
import { makeGear, activeGearBonus } from './gear'
import {
  applyQuests,
  activeMultiplier,
  activeFreshnessBonus,
  activeSeedBonus,
  activeStreakMultiplier,
  SET_BONUS_SEED,
  DUP_COMP_SEEDS,
} from './quests'

// ---------------------------------------------------------------------------
// Base XP per event type (before magnitude scaling).
// Pillar-B (good-habit) events are weighted higher than raw code events.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CRIT (暴击) — a positive-XP event can crit, multiplying the awarded XP. This
// is a REAL workflow power-up surface (ADR-0008): downstream the crit flag lets
// the shell OFFER safe, opt-in help (e.g. a drafted commit summary). The roll
// uses the injected rng so the engine stays pure & deterministic (ADR-0005).
// ---------------------------------------------------------------------------

/** Probability that a positive-XP event crits. Published / inspectable (ADR-0002). */
export const CRIT_CHANCE = 0.08

// ---------------------------------------------------------------------------
// CURRENCY (seeds) — the R3 economy. Outcomes GRANT seeds; a pull SPENDS them.
// This is what turns Grove from a reward-fountain into a game of DECISIONS:
// the player chooses WHEN to spend the seeds their work earned. Seeds are the
// ONLY thing risk mechanics may gamble (ADR-0005); never code/commits/docs.
// ---------------------------------------------------------------------------

/** Seeds granted per outcome (before magnitude scaling). Modest by design. */
const CURRENCY_GRANT: Partial<Record<GroveEvent['type'], number>> = {
  commit: 5,
  test_result: 8,
  build_result: 5,
  lint_clean: 5,
  review_confirmed: 6,
  pr_merged: 20,
  doc_updated: 15,
  spec_written: 15,
  plan_written: 15,
}

/** Seeds one chosen gacha pull costs. Published / inspectable (ADR-0002). */
export const PULL_COST = 30

// ---------------------------------------------------------------------------
// SERENDIPITY (奇遇) — variable-ratio surprise layered on SUCCESSFUL outcomes.
// A small chance, on top of the deterministic seed grant, of a rare-boosted
// free pull or a seed windfall. This is the dopamine the game-design audit said
// was missing — pure stochastic delight threaded through the injected rng.
// ---------------------------------------------------------------------------

/** Chance a successful outcome triggers a serendipity event. Published (ADR-0002). */
export const SERENDIPITY_CHANCE = 0.05

/** A serendipity seed windfall (extra seeds, no pull). */
const SERENDIPITY_SEED_WINDFALL = 25

// ---------------------------------------------------------------------------
// TOKEN-MILESTONE FLOOR (保底, ADR-0010) — a fair payout for heavy real work.
// Cumulative cost (cost.total_cost_usd) fills a work meter; each crossing grants
// ONE guaranteed COSMETIC chest. CAPPED & diminishing per 5h window so it can
// NOT be farmed by burning tokens — token is ACTIVITY, never an outcome, so the
// chest is cosmetic-only (a pull + bonus seeds), NEVER xp/power.
// ---------------------------------------------------------------------------

/**
 * Work units per milestone chest. Cost is in USD; we scale by COST_TO_WORK so a
 * milestone fires roughly a few times per heavy day rather than per dollar.
 * Tuned: a heavy day might be a few dollars of cost → with COST_TO_WORK=1 and
 * WORK_MILESTONE=1, ~3 chests/day before the cap bites. Both exported so the
 * cap math is inspectable.
 */
export const WORK_MILESTONE = 1

/** Cost-USD → work-unit conversion (1 USD = 1 work unit). */
export const COST_TO_WORK = 1

/** Max milestone chests per 5h window (diminishing → can't be farmed). */
export const MILESTONE_CAP_PER_WINDOW = 3

/** Bonus seeds bundled with a milestone chest (cosmetic-adjacent, modest). */
const MILESTONE_BONUS_SEEDS = 15

const BASE_XP: Partial<Record<GroveEvent['type'], number>> = {
  commit: 10,
  test_result: 15,
  build_result: 15,
  lint_clean: 15,
  review_confirmed: 20,
  pr_merged: 30,
  // Pillar B — weighted higher than code:
  doc_updated: 40,
  spec_written: 40,
  plan_written: 40,
}

// ---------------------------------------------------------------------------
// Celebratory flavour copy (never shaming).
// ---------------------------------------------------------------------------

const XP_FLAVOUR: Partial<Record<GroveEvent['type'], string>> = {
  commit: 'commit',
  test_result: 'tests green',
  build_result: 'build green',
  lint_clean: 'lint clean',
  review_confirmed: 'review done',
  pr_merged: 'PR merged',
  doc_updated: 'docs updated',
  spec_written: 'spec written',
  plan_written: 'plan set',
}

/** A leading ✦ marks the top tiers (legendary / shiny). Otherwise terse. */
function rarityMark(rarity: string): string {
  return rarity === 'legendary' || rarity === 'shiny' ? '✦ ' : ''
}

// ---------------------------------------------------------------------------
// Small helpers (pure)
// ---------------------------------------------------------------------------

/** A shallow-but-fresh clone of state — never shares mutable references. */
function cloneState(state: GameState): GameState {
  return {
    version: state.version,
    player: { ...state.player },
    cards: [...state.cards],
    gear: [...state.gear],
    pity: { ...state.pity },
    completedSets: [...state.completedSets],
    buffs: state.buffs.map((b) => ({ ...b })),
    eventCount: state.eventCount,
    quests: state.quests.map((q) => ({ ...q })),
    energy: { ...state.energy },
    work: { ...state.work },
    protectedGear: [...state.protectedGear],
  }
}

/** Clamp a number into [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function xpAmount(type: GroveEvent['type'], magnitude: number): number {
  const base = BASE_XP[type] ?? 0
  if (base === 0) return 0
  return base * Math.max(1, magnitude)
}

/**
 * Award XP onto a working state, pushing an 'xp' reward and any 'levelup'
 * rewards. Returns a NEW state (the input working state is not mutated).
 *
 * `scale` is the combined active-buff factor (multiplier × (1 + freshness))
 * computed on the WORKING state BEFORE this event's quest additions — so a
 * multiplier armed by a PRIOR spec_written boosts THIS event's XP, but a
 * spec_written does not boost its own XP.
 */
function grantXp(
  state: GameState,
  type: GroveEvent['type'],
  magnitude: number,
  rewards: Reward[],
  scale: number,
  critChance: number,
  rng: Rng,
): GameState {
  const base = xpAmount(type, magnitude)
  if (base <= 0) return state

  // Crit roll — ONE draw per positive-XP grant, taken BEFORE any pull so the
  // rng stream stays predictable. On crit: critMult = 2 or 3, applied to the
  // already buff-scaled amount. `critChance` already folds in any Type Saber
  // gear bonus (ADR-0008 — gear level finally MATTERS).
  const crit = rng() < critChance
  const critMult = crit ? 2 + Math.floor(rng() * 2) : 1

  const flavour = XP_FLAVOUR[type] ?? 'xp'
  const amount = Math.round(base * scale) * critMult

  const { player, levelUps } = applyXp(state.player, amount)

  const xpReward: Reward = crit
    ? {
        kind: 'xp',
        amount,
        crit: true,
        message: `+${amount} XP · ${flavour} 💥 CRIT ×${critMult}`,
      }
    : {
        kind: 'xp',
        amount,
        message: `+${amount} XP · ${flavour}`,
      }
  rewards.push(xpReward)

  for (let i = 0; i < levelUps; i++) {
    rewards.push({
      kind: 'levelup',
      amount: player.level - levelUps + i + 1,
      message: `Level ${player.level - levelUps + i + 1}`,
    })
  }

  return { ...state, player }
}

/**
 * Grant dup-compensation seeds (a duplicate pull never feels worthless; audit P1).
 * Returns a NEW state and pushes a terse, non-shaming 'currency' reward.
 */
function grantDupComp(state: GameState, rewards: Reward[]): GameState {
  rewards.push({
    kind: 'currency',
    amount: DUP_COMP_SEEDS,
    message: `+${DUP_COMP_SEEDS} 🌰 dupe`,
  })
  return { ...state, player: { ...state.player, currency: state.player.currency + DUP_COMP_SEEDS } }
}

/**
 * Add an already-rolled card to the collection, push its 'card' reward, and apply
 * the shared follow-on effects — dup-compensation and (if a set just completed)
 * the set bonus. The SINGLE source of truth for "a card landed" so grantPull, the
 * explicit `pull`, and the serendipity lucky-pull never drift apart (audit
 * re-score① dedup nit). PURE: returns a NEW state.
 *
 * `message` is the reward line (caller controls flavour, e.g. the 奇遇 tag). The
 * caller is responsible for threading the pity counter onto `state` BEFORE calling
 * (so this helper never touches pity — it only handles collection/dup/set effects).
 */
function applyPulledCard(
  state: GameState,
  card: ReturnType<typeof makeCard>,
  rarity: ReturnType<typeof pull_>['rarity'],
  message: string,
  rng: Rng,
  rewards: Reward[],
): GameState {
  const { cards, completedSets, newlyCompleted, duplicate } = addCard(
    state.cards,
    state.completedSets,
    card,
  )
  rewards.push({ kind: 'card', card, rarity, message })

  let next: GameState = { ...state, cards, completedSets }
  if (duplicate) next = grantDupComp(next, rewards)
  if (newlyCompleted) next = grantSetBonus(next, newlyCompleted, rng, rewards)
  return next
}

/**
 * A completed set grants a REAL reward (audit P1): a GUARANTEED legendary pull +
 * a small PERMANENT buff the engine reads (`set:bonus:<set>`, kind 'aura', factor
 * SET_BONUS_SEED → +seeds via activeSeedBonus). Returns a NEW state. No chaining:
 * one guaranteed legendary (its own dup is still compensated).
 */
function grantSetBonus(state: GameState, set: string, rng: Rng, rewards: Reward[]): GameState {
  const buffId = `set:bonus:${set}`
  const without = state.buffs.filter((b) => b.id !== buffId)
  const buffs: Buff[] = [
    ...without,
    { id: buffId, label: `${set} set`, kind: 'aura', factor: SET_BONUS_SEED },
  ]
  rewards.push({
    kind: 'buff',
    buff: buffId,
    message: `✦ set ${set} complete · +${Math.round(SET_BONUS_SEED * 100)}% 🌰 (permanent)`,
  })

  const card = makeCard('legendary', rng)
  const { cards, completedSets, duplicate } = addCard(state.cards, state.completedSets, card)
  rewards.push({
    kind: 'card',
    card,
    rarity: 'legendary',
    message: `✦ ${card.name} · legendary`,
  })

  let next: GameState = { ...state, buffs, cards, completedSets }
  if (duplicate) next = grantDupComp(next, rewards)
  return next
}

/**
 * Perform one gacha pull on a working state, threading pity, adding the card to
 * the collection, and pushing a 'card' reward. A DUPLICATE also grants dup-comp
 * seeds; a newly-completed set grants the real set bonus (legendary + permanent
 * buff). Returns a NEW state.
 */
function grantPull(state: GameState, rng: Rng, rewards: Reward[]): GameState {
  const { rarity, pity } = pull_(state.pity, rng)
  const card = makeCard(rarity, rng)
  // Thread the new pity onto the state BEFORE the shared card application.
  return applyPulledCard(
    { ...state, pity },
    card,
    rarity,
    `${rarityMark(rarity)}${card.name} · ${rarity}`,
    rng,
    rewards,
  )
}

/**
 * Add a cosmetic buff and push a 'buff' reward. Returns a NEW state.
 * `kind` is optional (e.g. 'rest' for celebrated rest beats — never gated on low
 * energy, never shaming; ADR-0005 / anti-burnout).
 */
function grantBuff(
  state: GameState,
  id: string,
  label: string,
  rewards: Reward[],
  kind?: BuffKind,
): GameState {
  rewards.push({
    kind: 'buff',
    buff: id,
    message: `${label}`,
  })
  const buff: Buff = kind !== undefined ? { id, label, kind } : { id, label }
  return { ...state, buffs: [...state.buffs, buff] }
}

/**
 * Drop one piece of cosmetic gear onto a working state, pushing a 'gear' reward.
 * Returns a NEW state. Mirrors grantPull but for the gear collection.
 */
function grantGear(state: GameState, rng: Rng, rewards: Reward[]): GameState {
  const gear = makeGear(rng)
  rewards.push({
    kind: 'gear',
    gear,
    rarity: gear.rarity,
    message: `${gear.name} +${gear.level}`,
  })
  return { ...state, gear: [...state.gear, gear] }
}

/**
 * Credit cosmetic seeds for an outcome (×magnitude, modest), pushing a 'currency'
 * reward. Returns a NEW state. The act that earns seeds is always an OUTCOME
 * (green tests / merges / docs) — never raw activity (ADR-0005).
 */
function grantCurrency(
  state: GameState,
  type: GroveEvent['type'],
  magnitude: number,
  rewards: Reward[],
  seedScale: number,
): GameState {
  const base = CURRENCY_GRANT[type] ?? 0
  if (base <= 0) return state
  // seedScale folds in Commit Hammer (gear currencyPct) + aura/set seed bonuses.
  const amount = Math.round(base * Math.max(1, magnitude) * seedScale)
  rewards.push({
    kind: 'currency',
    amount,
    message: `+${amount} 🌰 seeds · ${XP_FLAVOUR[type] ?? 'work'}`,
  })
  return { ...state, player: { ...state.player, currency: state.player.currency + amount } }
}

/**
 * Roll the SERENDIPITY (奇遇) chance on a SUCCESSFUL outcome. Takes exactly ONE
 * rng draw to decide; on a hit, a SECOND draw splits the surprise between:
 *  - a rare-boosted FREE pull (pity floored so it skews lucky), or
 *  - a seed windfall.
 * Distinct celebratory copy. Returns a NEW state; on a miss it is a no-op clone.
 *
 * Called AFTER the base grants so its rng draws are predictable and a serendipity
 * pull threads the same pity counter. Pure: every chance is from the injected rng.
 */
function rollSerendipity(state: GameState, rng: Rng, rewards: Reward[]): GameState {
  if (rng() >= SERENDIPITY_CHANCE) return state // the common case: nothing extra

  // A hit. Split: ~60% a lucky free pull, ~40% a seed windfall.
  if (rng() < 0.6) {
    // Rare-boosted free pull: skew the DRAW lucky by rolling against a temporarily
    // floored pity (>= SOFT_PITY). CRITICAL (audit re-score① fix): we use the
    // boosted pity ONLY to bias the rarity weights — we must NOT write that
    // inflated counter back to the player's REAL pity, which would corrupt legit
    // pity progress (the old code floored sinceLegendary to SOFT_PITY → 41 next).
    // Instead we thread the REAL counter: reset to 0 on a legendary-or-better
    // lucky drop, otherwise advance by exactly +1.
    const luckyPity = {
      sinceLegendary: Math.max(state.pity.sinceLegendary, SOFT_PITY),
    }
    const { rarity } = pull_(luckyPity, rng)
    const realPity = {
      sinceLegendary:
        rarityRank(rarity) >= rarityRank('legendary')
          ? 0
          : state.pity.sinceLegendary + 1,
    }
    const card = makeCard(rarity, rng)
    return applyPulledCard(
      { ...state, pity: realPity },
      card,
      rarity,
      `✨ 奇遇 — lucky drop · ${rarityMark(rarity)}${card.name} · ${rarity}`,
      rng,
      rewards,
    )
  }

  rewards.push({
    kind: 'currency',
    amount: SERENDIPITY_SEED_WINDFALL,
    message: `✨ 奇遇 — +${SERENDIPITY_SEED_WINDFALL} 🌰 windfall`,
  })
  return {
    ...state,
    player: { ...state.player, currency: state.player.currency + SERENDIPITY_SEED_WINDFALL },
  }
}

// ---------------------------------------------------------------------------
// pull — the explicit, agency-bearing player action (the CORE DECISION).
// ---------------------------------------------------------------------------

/**
 * Spend PULL_COST seeds for ONE gacha pull. The CLI exposes this as `sq pull`.
 *
 * - If `currency >= PULL_COST`: debit the seeds, perform one pity-threaded pull,
 *   add the card to the collection, and return a 'currency' (spend) + 'card'
 *   reward (plus a set-completion reward if one was just completed).
 * - If broke: a friendly 'not enough seeds' reward and NO pull, NO debit, NO rng
 *   draw — never shaming (ADR-0005).
 *
 * PURE & IMMUTABLE: the input state is never mutated.
 */
export function pull(
  state: GameState,
  rng: Rng,
): { state: GameState; rewards: Reward[] } {
  const rewards: Reward[] = []

  if (state.player.currency < PULL_COST) {
    rewards.push({
      kind: 'currency',
      amount: state.player.currency,
      message: `not enough 🌰 — need ${PULL_COST}, have ${state.player.currency}`,
    })
    return { state: { ...state, player: { ...state.player } }, rewards }
  }

  const spent = state.player.currency - PULL_COST
  rewards.push({
    kind: 'currency',
    amount: -PULL_COST,
    message: `-${PULL_COST} 🌰 · pull`,
  })

  const { rarity, pity } = pull_(state.pity, rng)
  const card = makeCard(rarity, rng)
  const next = applyPulledCard(
    { ...state, player: { ...state.player, currency: spent }, pity },
    card,
    rarity,
    `${rarityMark(rarity)}${card.name} · ${rarity}`,
    rng,
    rewards,
  )

  return { state: next, rewards }
}

// ---------------------------------------------------------------------------
// quota_update — the anti-burnout energy signal
// ---------------------------------------------------------------------------

/** A big upward vigor jump = the fast 5h window reset. */
const VIGOR_RESET_JUMP = 40

/**
 * Token-milestone FLOOR (保底, ADR-0010). Accrue work from REAL cumulative cost
 * and, on each WORK_MILESTONE crossing, grant ONE guaranteed COSMETIC chest
 * (a pull + bonus seeds — NEVER xp/power) up to MILESTONE_CAP_PER_WINDOW per 5h
 * window. Crossings past the cap STILL drain the meter but grant NOTHING — so
 * burning more tokens past the cap yields nothing and never pressures overuse.
 *
 * Works even when rate_limits is absent (cost is usually present), so API /
 * Wellspring users still get this floor. The window is keyed off the 5h
 * vigorResetsAt epoch when known; otherwise a cost-drop (new session) re-baselines
 * the meter and resets the per-window cap. Pure: cost/delta come only from the
 * event meta; rng only feeds the chest's pull.
 *
 * Returns a NEW { work } accumulator and pushes any chest rewards.
 */
function applyWorkMeter(state: GameState, event: GroveEvent, rng: Rng, rewards: Reward[]): GameState {
  const meta = event.meta
  const costUsd = typeof meta.costUsd === 'number' && Number.isFinite(meta.costUsd) ? meta.costUsd : undefined

  // No cost signal → nothing to accrue (informational outputTokens alone never grants).
  if (costUsd === undefined) return state

  const prev = state.work
  const windowKey = typeof meta.fiveHourResetsAt === 'number' ? meta.fiveHourResetsAt : 0

  // New session when cost DROPPED below the last seen total → re-baseline from 0.
  const newSession = costUsd < prev.lastCostUsd
  const delta = newSession ? Math.max(0, costUsd) : Math.max(0, costUsd - prev.lastCostUsd)

  // Reset the per-window cap when the 5h window changed OR a new session began.
  const windowChanged = windowKey !== prev.windowKey || newSession
  let milestonesInWindow = windowChanged ? 0 : prev.milestonesInWindow

  let workMeter = prev.workMeter + delta * COST_TO_WORK

  // Fire (capped) chests for each whole milestone crossed; always drain the meter.
  let working: GameState = state
  while (workMeter >= WORK_MILESTONE) {
    workMeter -= WORK_MILESTONE
    if (milestonesInWindow < MILESTONE_CAP_PER_WINDOW) {
      milestonesInWindow += 1
      // COSMETIC chest only: a pull + bonus seeds. NEVER xp/power (ADR-0010).
      working = grantPull(working, rng, rewards)
      working = {
        ...working,
        player: {
          ...working.player,
          currency: working.player.currency + MILESTONE_BONUS_SEEDS,
        },
      }
      rewards.push({
        kind: 'currency',
        amount: MILESTONE_BONUS_SEEDS,
        message: `🎁 milestone chest · +${MILESTONE_BONUS_SEEDS} 🌰 (work tracked)`,
      })
    }
    // else: at cap → meter still drained, but no chest (can't be farmed).
  }

  return {
    ...working,
    work: { workMeter, lastCostUsd: costUsd, windowKey, milestonesInWindow },
  }
}

/**
 * Apply a `quota_update` event onto a working state. AMBIENT by design: this
 * NEVER grants xp or cards in ANY case — quota/time passage is not an outcome
 * (ADR-0005). The only thing it can ever celebrate is a 'rest' beat (Second
 * Wind) when the 5h window resets, surfaced from FRESH data only.
 *
 *  - meta.present === false → Wellspring: set energy.known=false and grant
 *    NOTHING. We never fabricate vigor=100 from an absent/unmetered frame.
 *  - meta.present === true  → compute vigor/sap REMAINING (100 - usedPct),
 *    clamped to [0,100]; detect a reset as a big upward vigor jump from a
 *    PRIOR KNOWN frame, and if so grant a 'rest' buff ONLY (never gated on the
 *    final vigor level — rest is celebrated even when energy ends high).
 *
 * Returns a NEW state; pushes at most one 'buff' reward.
 */
function applyQuota(state: GameState, event: GroveEvent, rng: Rng, rewards: Reward[]): GameState {
  const meta = event.meta

  // Token-milestone FLOOR runs FIRST and INDEPENDENTLY of present — cost is
  // usually carried even by API/Wellspring frames (ADR-0010). Energy logic below.
  const afterWork = applyWorkMeter(state, event, rng, rewards)
  const prev = afterWork.energy

  // Wellspring: unmetered → hide the bar, fabricate nothing.
  if (meta.present === false) {
    return { ...afterWork, energy: { ...prev, known: false } }
  }

  // present:true → derive REMAINING energy ONLY from windows actually present in
  // the frame. If a window's pct is absent, leave the bar undefined — never fall
  // back to 0 to invent a fabricated 100% remaining. (anti-fabrication comment at
  // line 238 is now enforced here.)
  const newVigor = typeof meta.fiveHourPct === 'number'
    ? clamp(100 - meta.fiveHourPct, 0, 100)
    : undefined
  const newSap = typeof meta.sevenDayPct === 'number'
    ? clamp(100 - meta.sevenDayPct, 0, 100)
    : undefined

  const vigorResetsAt = typeof meta.fiveHourResetsAt === 'number' ? meta.fiveHourResetsAt : undefined
  const sapResetsAt = typeof meta.sevenDayResetsAt === 'number' ? meta.sevenDayResetsAt : undefined

  // Reset detection: ONLY from a real upward jump off a PRIOR KNOWN baseline.
  // A first frame (prev.known === false) is a baseline, never a reset.
  // Guard: if either prev.vigor or newVigor is undefined the window was absent →
  // treat as no jump (no reset to celebrate from an absent window).
  const isReset =
    prev.known === true &&
    typeof prev.vigor === 'number' &&
    typeof newVigor === 'number' &&
    newVigor - prev.vigor >= VIGOR_RESET_JUMP

  const energy: EnergyState = {
    known: true,
    vigor: newVigor,
    sap: newSap,
    vigorResetsAt,
    sapResetsAt,
  }

  if (isReset) {
    // A REST beat only — no card, no xp. Fires regardless of final vigor level.
    return grantBuff(
      { ...afterWork, energy },
      'rest:second-wind',
      'Second Wind',
      rewards,
      'rest',
    )
  }

  return { ...afterWork, energy }
}

// ---------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------

export function reduce(
  state: GameState,
  event: GroveEvent,
  rng: Rng,
): { state: GameState; rewards: Reward[] } {
  // Every event advances the event clock; then expire any lapsed buffs SILENTLY
  // (no message — a lapsed buff is a renewable gain, never a shame; ADR-0005).
  let next = cloneState(state)
  next.eventCount = state.eventCount + 1
  next.buffs = next.buffs.filter(
    (b) => b.expiresAtCount === undefined || b.expiresAtCount > next.eventCount,
  )

  // FIREWALL: failures never punish — no rng draw, no progress change.
  // (eventCount still advances + buffs still expire, both silent.)
  if (event.success === false) {
    return { state: next, rewards: [] }
  }

  const magnitude = event.magnitude
  const rewards: Reward[] = []

  // ACTIVE-bonus readers, computed on the WORKING state BEFORE this event's quest
  // additions — so a prior spec_written's x2 / a running test streak boosts THIS
  // event, but neither boosts its own grant. Gear/aura/streak finally MATTER here
  // (audit P1 fix): gear level → xp/currency/crit; aura → seeds; streak → xp.
  const gearBonus = activeGearBonus(next)
  const scale =
    activeMultiplier(next) * (1 + activeFreshnessBonus(next)) *
    activeStreakMultiplier(next) * (1 + gearBonus.xpPct / 100)
  const critChance = CRIT_CHANCE + gearBonus.critPct / 100
  const seedScale = 1 + gearBonus.currencyPct / 100 + activeSeedBonus(next)

  // Successful OUTCOME events are eligible for the serendipity (奇遇) roll.
  let serendipityEligible = false

  switch (event.type) {
    // ---- Pillar A: code wins ------------------------------------------------
    case 'commit': {
      next = grantXp(next, 'commit', magnitude, rewards, scale, critChance, rng)
      next = grantCurrency(next, 'commit', magnitude, rewards, seedScale)
      serendipityEligible = true
      break
    }

    // R3: a green test/build/lint now grants SEEDS + a serendipity chance ONLY —
    // the guaranteed auto-pull is GONE. Pulls are a deliberate choice (sq pull).
    case 'test_result':
    case 'build_result':
    case 'lint_clean': {
      next = grantXp(next, event.type, magnitude, rewards, scale, critChance, rng)
      next = grantCurrency(next, event.type, magnitude, rewards, seedScale)
      serendipityEligible = true
      break
    }

    case 'pr_merged': {
      next = grantXp(next, 'pr_merged', magnitude, rewards, scale, critChance, rng)
      next = grantCurrency(next, 'pr_merged', magnitude, rewards, seedScale)
      next = grantPull(next, rng, rewards) // guaranteed pull (a big milestone)
      next = grantGear(next, rng, rewards) // one gear drop per merge
      serendipityEligible = true
      break
    }

    // ---- Pillar B: good habits (weighted higher) ---------------------------
    // Quest-specific buffs are now owned by quests.ts; here we grant base XP + seeds.
    case 'doc_updated':
    case 'spec_written':
    case 'plan_written': {
      next = grantXp(next, event.type, magnitude, rewards, scale, critChance, rng)
      next = grantCurrency(next, event.type, magnitude, rewards, seedScale)
      serendipityEligible = true
      break
    }

    case 'review_confirmed': {
      next = grantXp(next, 'review_confirmed', magnitude, rewards, scale, critChance, rng)
      next = grantCurrency(next, 'review_confirmed', magnitude, rewards, seedScale)
      serendipityEligible = true
      break
    }

    // ---- Rest, not chore ---------------------------------------------------
    case 'checkpoint': {
      // kind:'rest' for consistency with energy rest beats. Unlike a clock tick,
      // a checkpoint is a real user action/outcome → it keeps its gift pull.
      next = grantBuff(next, 'refreshed', 'Refreshed', rewards, 'rest')
      next = grantPull(next, rng, rewards) // a gentle gift for resting
      break
    }

    // ---- Ambient: usage-quota energy (NO xp, NO cards — ADR-0005) ----------
    // EXCEPT the token-milestone floor's COSMETIC chest (cosmetic-only; ADR-0010).
    case 'quota_update': {
      next = applyQuota(next, event, rng, rewards)
      break
    }

    // ---- Signals with no base reward (still flow through quests) -----------
    case 'session_start':
    case 'session_end':
    case 'file_edit':
    case 'test_added':
    case 'file_presence':
    default:
      break
  }

  // SERENDIPITY (奇遇): a small variable-ratio surprise on any successful outcome.
  // Rolled AFTER base grants so its rng draws are predictable; threads pity.
  if (serendipityEligible) {
    next = rollSerendipity(next, rng, rewards)
  }

  // Layer quest-specific effects (auras, multipliers, freshness, loot) on top.
  next = applyQuests(next, event, rng, rewards)

  return { state: next, rewards }
}

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

import { applyXp, levelUpSeedBonus } from './xp'
import {
  pull as pull_,
  makeCard,
  SOFT_PITY,
  HARD_PITY,
  PREMIUM_RARITY_ODDS,
  REALIZED_LEGENDARY_SHINY_RATE,
} from './gacha'
import { addCard, grantDupComp, craftableCardId, missingCardIds, SHARDS_PER_CRAFT } from './collection'
import type { Rarity } from '../core/rewards'
import { makeGear, activeGearBonus } from './gear'
import { cardFromDef, unlockedSets, ALL_CARD_DEFS, setUnlockLevel, SET_UNLOCK_LEVEL, cardIdsInSet } from '../core/cards'
import {
  applyQuests,
  activeMultiplier,
  activeFreshnessBonus,
  activeSeedBonus,
  activeStreakMultiplier,
  SET_BONUS_SEED,
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

/**
 * Seeds granted per outcome (before magnitude scaling). Modest by design.
 *
 * R7 FAUCET REBALANCE (economy P1): the high-frequency code grants are HALVED
 * (commit 5→3, test 8→4, build 5→3, lint 5→3) and the rarer Pillar-B / merge
 * grants trimmed (review 6→4, pr_merged 20→12, doc/spec/plan 15→10). The re-score④
 * audit found an active day (~49 outcome events) afforded ~26 standard pulls — the
 * deliberate-pull decision "barely bit". Together with the raised PULL_COST and the
 * tightened milestone faucet below, an active day now affords ≤ ~10 standard pulls,
 * restoring genuine save-vs-spend. Outcomes still pay (ADR-0010), just not a flood.
 */
const CURRENCY_GRANT: Partial<Record<GroveEvent['type'], number>> = {
  commit: 3,
  test_result: 4,
  build_result: 3,
  lint_clean: 3,
  review_confirmed: 4,
  pr_merged: 12,
  doc_updated: 10,
  spec_written: 10,
  plan_written: 10,
}

/**
 * Seeds one chosen gacha pull costs. Published / inspectable (ADR-0002).
 *
 * R7 FAUCET REBALANCE (economy P1): raised 30→45 so a standard pull is a heavier
 * decision against the (now lower) per-outcome seed grants — part of pulling the
 * affordable-pulls/active-day down to ≤ ~10.
 */
export const PULL_COST = 45

/**
 * Seeds one PREMIUM-banner pull costs (R5 escalating seed SINK, economy P1). At
 * 5x the standard cost the premium banner (PREMIUM_RARITY_ODDS — materially
 * better odds) is the late-game seed TARGET: a genuine save-vs-spend choice
 * (five cheap standard pulls, or save for one premium). Published (ADR-0002),
 * cosmetic-only (ADR-0005).
 */
export const PREMIUM_PULL_COST = 225

/**
 * R8 TARGETED 'SPARK' PREMIUM (economy A-blocker). Number of premium pulls that
 * MISS the chosen `sparkTarget` before the next premium pull GUARANTEES it. So
 * saving 225 seeds is no longer a flat better-EV gamble — it is choosing a TARGET
 * the game promises to deliver within a bounded number of pulls. Published /
 * inspectable (ADR-0002); the guaranteed card is cosmetic-only (ADR-0005).
 *
 * Worst-case premium-seed cost to a chosen card = SPARK_THRESHOLD * PREMIUM_PULL_COST
 * (the threshold-th miss plus the guarantee), so the player can reason about it.
 */
export const SPARK_THRESHOLD = 8

/**
 * R9 ECONOMY → A: FOIL IS A CURVE, NOT A FLAT DRAIN. Shards to cosmetically FOIL one
 * OWNED card, SCALED by that card's rarity — mirroring SHARDS_BY_RARITY's shape so a
 * dupe's worth and its foil's cost rise together (commons cheap, legendary/shiny
 * dear). So foiling a finished collection is a SHAPED late-game climb (polish the
 * commons early, save the legendaries for last), not a uniform sink.
 *
 * Tuned ≈ 3× the matching SHARDS_BY_RARITY tier (3/1, 6/2, 12/4, 24/8, 48/16, 72/24)
 * so a foil is a repeatable polish in the SAME shard economy. Most foils stay cheaper
 * than a fresh craft (SHARDS_PER_CRAFT = 60); the top shiny tier (72) is the deliberate
 * exception · the single dearest polish in the game, an endgame flex you earn last.
 * Every rarity stays a positive integer. Published / inspectable (ADR-0002);
 * cosmetic-only, ZERO power (ADR-0005).
 */
export const FOIL_COST_BY_RARITY: Record<Rarity, number> = {
  common: 3,
  uncommon: 6,
  rare: 12,
  epic: 24,
  legendary: 48,
  shiny: 72,
}

/** Shards to foil a card of the given rarity (the published foil CURVE). PURE. */
export function foilCost(rarity: Rarity): number {
  return FOIL_COST_BY_RARITY[rarity]
}

/**
 * Back-compat baseline: the cheapest (common) foil cost. The cost a `foilCard`
 * actually debits is the chosen card's rarity-scaled `foilCost(rarity)` — this
 * constant is just the floor of the curve, kept for callers/tests that reference it.
 */
export const FOIL_COST = FOIL_COST_BY_RARITY.common

/**
 * Seeds an ENDGAME prestige cosmetic costs (R5 endgame sink, game-design P2). A
 * one-time, expensive seed drain that grants a permanent cosmetic 'prestige'
 * buff (a flair the renderer can show) — so once the collection is complete,
 * accumulated seeds still have a meaningful target and the economy stays a
 * decision. Cosmetic-only (ADR-0005); confers NO power/xp. Published (ADR-0002).
 */
export const PRESTIGE_COST = 500

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
 * milestone fires roughly a couple of times per heavy day rather than per dollar.
 *
 * R5 FAUCET REBALANCE (economy P1): raised 1→3. The audit found ~36 pulls/day —
 * 'pull is a choice' had collapsed because the token-milestone floor was a near-
 * free faucet (a chest per $1, capped 3/window across ~4 windows ≈ 12 free pulls
 * + 180 bonus seeds/day). Raising the cost-per-chest to $3 (and lowering the cap
 * below) restores genuine save-vs-spend: the floor still pays heavy work fairly
 * (ADR-0010) but no longer drowns the deliberate-pull decision.
 */
export const WORK_MILESTONE = 3

/** Cost-USD → work-unit conversion (1 USD = 1 work unit). */
export const COST_TO_WORK = 1

/**
 * Max milestone chests per 5h window (diminishing → can't be farmed). Lowered
 * 3→2 (R5) then 2→1 (R7 faucet rebalance): a heavy day spans ~4 windows, so a
 * per-window cap of 2 still let the token floor mint ~8 free chests/day — a near-
 * free faucet that drowned the deliberate-pull decision. At 1/window the floor
 * pays at most ~4 chests/day across windows: a fair保底 (ADR-0010), not a fountain.
 */
export const MILESTONE_CAP_PER_WINDOW = 1

/**
 * Bonus seeds bundled with a milestone chest (cosmetic-adjacent, modest). Lowered
 * 15→10 (R5) then 10→6 (R7 faucet rebalance) to tighten the seed faucet further.
 */
const MILESTONE_BONUS_SEEDS = 6

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
    // R8 optional renewable/spark fields — preserve them through a clone so a
    // no-op refusal never silently drops a foiled list or spark progress.
    ...(state.foiled !== undefined ? { foiled: [...state.foiled] } : {}),
    ...(state.spark !== undefined ? { spark: state.spark } : {}),
    ...(state.sparkTarget !== undefined ? { sparkTarget: state.sparkTarget } : {}),
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
 * Push one celebratory 'set unlocked' reward per card set whose SET_UNLOCK_LEVEL
 * falls in `(oldLevel, newLevel]` — i.e. a set the player JUST unlocked by leveling
 * up. Terse, dev-grounded, never shaming (ADR-0009 / docs/TONE.md). Ordered by the
 * unlock level so multi-level jumps read sensibly. Pure (only pushes to `rewards`).
 */
function pushSetUnlockRewards(oldLevel: number, newLevel: number, rewards: Reward[]): void {
  const crossed = Object.entries(SET_UNLOCK_LEVEL)
    .filter(([, lvl]) => lvl > oldLevel && lvl <= newLevel)
    .sort((a, b) => a[1] - b[1])
  for (const [set, lvl] of crossed) {
    rewards.push({
      kind: 'buff',
      buff: `set:unlocked:${set}`,
      message: `🔓 ${set} set unlocked · L${lvl}`,
    })
  }
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

  const oldLevel = player.level - levelUps
  for (let i = 0; i < levelUps; i++) {
    rewards.push({
      kind: 'levelup',
      amount: oldLevel + i + 1,
      message: `Level ${oldLevel + i + 1}`,
    })
  }

  // R6 set-unlock reward (P1): a level-up that crosses a SET_UNLOCK_LEVEL must NOT
  // be silent — push a celebratory line per newly-unlocked set so the new-content
  // beat is visible. Cosmetic-only (ADR-0005): unlocking just widens the pull pool.
  if (levelUps > 0) {
    pushSetUnlockRewards(oldLevel, player.level, rewards)
  }

  // R5: a level-up FEEDS the economy (leveling was display-only). Each level-up
  // grants modest cosmetic seeds (ADR-0005) on top of the normal grant. Pushed
  // as a 'currency' reward AFTER the levelup lines so the cause is legible.
  let leveled = player
  if (levelUps > 0) {
    const seeds = levelUpSeedBonus(levelUps)
    leveled = { ...player, currency: player.currency + seeds }
    rewards.push({
      kind: 'currency',
      amount: seeds,
      message: `+${seeds} 🌰 · level up ×${levelUps}`,
    })
  }

  return { ...state, player: leveled }
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
  if (duplicate) next = grantDupComp(next, rarity, rewards)
  if (newlyCompleted) next = grantSetBonus(next, newlyCompleted, rng, rewards)
  return next
}

/**
 * A completed set grants a REAL reward (audit P1): a GUARANTEED legendary pull +
 * a small PERMANENT buff the engine reads (`set:bonus:<set>`, kind 'aura', factor
 * SET_BONUS_SEED → +seeds via activeSeedBonus). Returns a NEW state.
 *
 * R7 code nit (P2): the bonus legendary may ITSELF complete another set (the
 * collection is small and a legendary closes the last slot of `tools`/`syntax`/…).
 * `addCard`'s `newlyCompleted` was previously dropped here, so such a completion
 * was silent — no bonus buff, no celebratory line. We now CASCADE: if the bonus
 * card completes a further set, recursively grant its set bonus. The recursion is
 * finite (each step marks one more set complete and never re-fires a completed set).
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

  const card = makeCard('legendary', rng, state.player.level)
  const { cards, completedSets, newlyCompleted, duplicate } = addCard(
    state.cards,
    state.completedSets,
    card,
  )
  rewards.push({
    kind: 'card',
    card,
    rarity: 'legendary',
    message: `✦ ${card.name} · legendary`,
  })

  let next: GameState = { ...state, buffs, cards, completedSets }
  if (duplicate) next = grantDupComp(next, 'legendary', rewards)
  // Cascade: a bonus legendary that completes a FURTHER set fires that set's bonus too.
  if (newlyCompleted) next = grantSetBonus(next, newlyCompleted, rng, rewards)
  return next
}

/**
 * Perform one gacha pull on a working state, threading pity, adding the card to
 * the collection, and pushing a 'card' reward. A DUPLICATE also grants dup-comp
 * seeds; a newly-completed set grants the real set bonus (legendary + permanent
 * buff). Returns a NEW state.
 *
 * `odds` selects the rarity table (default RARITY_ODDS; PREMIUM_RARITY_ODDS for
 * the premium banner). Pity is threaded identically regardless of table.
 */
function grantPull(
  state: GameState,
  rng: Rng,
  rewards: Reward[],
  odds?: Parameters<typeof pull_>[2],
): GameState {
  const { rarity, pity } = pull_(state.pity, rng, odds)
  const card = makeCard(rarity, rng, state.player.level)
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
 * Buff kinds that DO NOT STACK — a second one with the same id should REPLACE the
 * existing buff, never pile up a duplicate. `rest` beats (Refreshed / Second Wind)
 * are pure cosmetic flair: a second checkpoint or window reset re-celebrates the
 * SAME flair, it does not accrue N copies of it. (Stacking kinds — multiplier /
 * freshness / streak — are owned by quests.ts via its own upsert.)
 */
const NON_STACKING_KINDS: ReadonlySet<BuffKind> = new Set<BuffKind>(['rest'])

/**
 * Add a cosmetic buff and push a 'buff' reward. Returns a NEW state.
 * `kind` is optional (e.g. 'rest' for celebrated rest beats — never gated on low
 * energy, never shaming; ADR-0005 / anti-burnout).
 *
 * R7 code nit (P3): for non-stacking kinds (rest) the buff is DEDUPED by id —
 * any existing same-id buff is replaced rather than appended, so repeated
 * checkpoints / window resets never accumulate N identical 'Refreshed' rows.
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
  const base =
    kind !== undefined && NON_STACKING_KINDS.has(kind)
      ? state.buffs.filter((b) => b.id !== id)
      : state.buffs
  return { ...state, buffs: [...base, buff] }
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
    const card = makeCard(rarity, rng, state.player.level)
    return applyPulledCard(
      { ...state, pity: realPity },
      card,
      rarity,
      `✨ lucky drop · ${rarityMark(rarity)}${card.name} · ${rarity}`,
      rng,
      rewards,
    )
  }

  rewards.push({
    kind: 'currency',
    amount: SERENDIPITY_SEED_WINDFALL,
    message: `✨ windfall · +${SERENDIPITY_SEED_WINDFALL} 🌰`,
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
      message: `not enough 🌰 · need ${PULL_COST}, have ${state.player.currency}`,
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
  const card = makeCard(rarity, rng, state.player.level)
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

/**
 * Spend PREMIUM_PULL_COST seeds for ONE pull on the PREMIUM banner (the escalating
 * seed SINK — better odds via PREMIUM_RARITY_ODDS). The CLI exposes this as
 * `sq pull --premium` (or similar). Same shape & guardrails as `pull`: debit on
 * success, friendly refusal when broke (no draw, no debit — never shaming).
 *
 * PURE & IMMUTABLE: the input state is never mutated.
 */
export function pullPremium(
  state: GameState,
  rng: Rng,
): { state: GameState; rewards: Reward[] } {
  const rewards: Reward[] = []

  if (state.player.currency < PREMIUM_PULL_COST) {
    rewards.push({
      kind: 'currency',
      amount: state.player.currency,
      message: `not enough 🌰 · premium needs ${PREMIUM_PULL_COST}, have ${state.player.currency}`,
    })
    return { state: { ...state, player: { ...state.player } }, rewards }
  }

  const spent = state.player.currency - PREMIUM_PULL_COST
  rewards.push({
    kind: 'currency',
    amount: -PREMIUM_PULL_COST,
    message: `-${PREMIUM_PULL_COST} 🌰 · premium pull`,
  })

  // --- R8 SPARK: a chosen target the premium banner GUARANTEES after enough misses.
  const spark = state.spark ?? 0
  const target = state.sparkTarget
  const missing = missingCardIdsForPlayer(state)
  const guaranteeFires = spark >= SPARK_THRESHOLD && target !== undefined && missing.includes(target)

  if (guaranteeFires) {
    // Force the chosen missing card (deterministic spark guarantee). Reset spark to 0.
    const def = ALL_CARD_DEFS.find((d) => d.id === target)!
    const card = cardFromDef(def)
    let next = applyPulledCard(
      { ...state, player: { ...state.player, currency: spent }, spark: 0 },
      card,
      def.rarity,
      `✦ SPARK guarantee · ${rarityMark(def.rarity)}${card.name} · ${def.rarity}`,
      rng,
      rewards,
    )
    // R9 SPARK NICHE craft CANNOT replicate: the guaranteed card arrives already
    // FOILED (a premium finish). Craft delivers a plain card — so spark buys a
    // strictly DIFFERENT, higher-finish outcome, not a worse-priced craft dupe.
    // Cosmetic-only (ADR-0005); deterministic (no extra rng).
    const foiled = next.foiled ?? []
    if (!foiled.includes(target!)) {
      const nextFoiled = [...foiled, target!]
      rewards.push({
        kind: 'card',
        rarity: def.rarity,
        message: `✦ FOIL finish · ${card.name} arrives foiled (spark)`,
      })
      next = { ...next, foiled: nextFoiled }
      // a foil-finish that closes a set fires the same fully-foiled capstone.
      next = grantFoiledSetCapstone(next, def.set, nextFoiled, rewards)
    }
    return { state: next, rewards }
  }

  // Normal premium roll.
  const { rarity, pity } = pull_(state.pity, rng, PREMIUM_RARITY_ODDS)
  const card = makeCard(rarity, rng, state.player.level)
  // Did this pull land the chosen target? If so the spark resets; otherwise it ticks
  // up (capped at SPARK_THRESHOLD so the guarantee stays armed). With no target the
  // counter still advances so the surface can show "saving toward a spark".
  const hitTarget = target !== undefined && card.id === target
  const nextSpark = hitTarget ? 0 : Math.min(SPARK_THRESHOLD, spark + 1)
  const next = applyPulledCard(
    { ...state, player: { ...state.player, currency: spent }, pity, spark: nextSpark },
    card,
    rarity,
    `✦ premium · ${rarityMark(rarity)}${card.name} · ${rarity}`,
    rng,
    rewards,
  )

  return { state: next, rewards }
}

// ---------------------------------------------------------------------------
// craft — SPEND shards on a chosen missing card (the dup-tail SINK).
// ---------------------------------------------------------------------------

/**
 * Spend SHARDS_PER_CRAFT shards to craft ONE chosen missing card (the SPEND side
 * of the dup tail — shards were write-only/unspendable before R6). The CLI exposes
 * this as `sq craft [cardId]`.
 *
 *  - `cardId` omitted → craft the CHEAPEST (first) missing card within the player's
 *    UNLOCKED sets (`craftableCardId`), so a default `sq craft` always does the
 *    sensible thing.
 *  - `cardId` given → it MUST be a currently-missing card within an unlocked set
 *    (validated against `missingCardIds`); an owned / locked / unknown id is
 *    refused calmly (no debit, never shaming).
 *  - Too few shards, or nothing left to craft → friendly refusal, NO debit.
 *
 * On success: debit the shards, append the card with set-completion handling
 * (same shared path as a pull — a completed set still fires its bonus), and tag
 * the 'card' reward as crafted. A crafted card targets a MISSING id, so it is
 * never a duplicate. Cosmetic-only (ADR-0005). PURE & IMMUTABLE — no I/O, no
 * wall-clock; rng only feeds a set-completion bonus legendary.
 */
export function craftCard(
  state: GameState,
  cardId?: string,
  rng: Rng = () => 0,
): { state: GameState; rewards: Reward[] } {
  const rewards: Reward[] = []
  const haveShards = state.player.shards ?? 0
  const sets = unlockedSets(state.player.level)

  // Resolve the craft target: the explicit id (validated) or the default cheapest.
  const missing = missingCardIds(state.cards, sets)
  let targetId: string | null
  if (cardId === undefined) {
    targetId = craftableCardId(state.cards, sets, haveShards)
  } else {
    // An explicit id must be a currently-missing card within an unlocked set.
    targetId = missing.includes(cardId) ? cardId : null
  }

  // Nothing craftable: distinguish "can't craft THIS id" from "nothing left at all".
  if (targetId === null) {
    if (cardId !== undefined && !missing.includes(cardId)) {
      const reason = setUnlockLevel(defSet(cardId)) > Math.max(1, state.player.level)
        ? `🔒 ${cardId} is in a locked set — can't craft yet`
        : `can't craft ${cardId} — already owned or not craftable`
      rewards.push({ kind: 'currency', amount: haveShards, message: reason })
      return { state: { ...state, player: { ...state.player } }, rewards }
    }
    if (haveShards < SHARDS_PER_CRAFT) {
      rewards.push({
        kind: 'currency',
        amount: haveShards,
        message: `not enough shards — craft needs ${SHARDS_PER_CRAFT}, have ${haveShards}`,
      })
      return { state: { ...state, player: { ...state.player } }, rewards }
    }
    // Enough shards but nothing missing → collection (unlocked) complete.
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message: 'nothing left to craft — collection complete',
    })
    return { state: { ...state, player: { ...state.player } }, rewards }
  }

  // A target exists; ensure the shards are actually affordable (the explicit-id
  // path skipped the affordability check above).
  if (haveShards < SHARDS_PER_CRAFT) {
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message: `not enough shards — craft needs ${SHARDS_PER_CRAFT}, have ${haveShards}`,
    })
    return { state: { ...state, player: { ...state.player } }, rewards }
  }

  const def = ALL_CARD_DEFS.find((d) => d.id === targetId)!
  const card = cardFromDef(def)
  const spentShards = haveShards - SHARDS_PER_CRAFT

  rewards.push({
    kind: 'currency',
    amount: -SHARDS_PER_CRAFT,
    message: `-${SHARDS_PER_CRAFT} shards · craft`,
  })

  const next = applyPulledCard(
    { ...state, player: { ...state.player, shards: spentShards } },
    card,
    def.rarity,
    `🛠 crafted · ${rarityMark(def.rarity)}${card.name} · ${def.rarity}`,
    rng,
    rewards,
  )

  return { state: next, rewards }
}

/** The set a card id belongs to (for the locked-set refusal message). */
function defSet(cardId: string): string {
  return ALL_CARD_DEFS.find((d) => d.id === cardId)?.set ?? cardId
}

/** The capstone buff id granted when every card of `set` is foiled. */
export function foiledSetBuffId(set: string): string {
  return `foiled-set:${set}`
}

/**
 * Grant the FULLY-FOILED-SET capstone (R9 economy → A) for the set just completed by
 * a foil, IF every card of that set is now foiled and the capstone has not already
 * fired. A distinct COSMETIC flair (kind 'rest' — read by NO xp/seed/crit selector,
 * so ZERO power per ADR-0005) that gives post-completion players a visible GOAL: a
 * shimmer earned by foiling a whole set, not a flat sink. Fires exactly ONCE per set.
 *
 * `set` is the set the just-foiled card belongs to; `foiled` is the NEW foiled list
 * (after the append). Returns a NEW state (buffs extended) when the capstone fires,
 * else the same state unchanged. PURE — pushes at most one celebratory reward.
 */
function grantFoiledSetCapstone(
  state: GameState,
  set: string,
  foiled: string[],
  rewards: Reward[],
): GameState {
  const required = cardIdsInSet(set)
  if (required.length === 0) return state
  const foiledIds = new Set(foiled)
  const allFoiled = required.every((id) => foiledIds.has(id))
  if (!allFoiled) return state

  const buffId = foiledSetBuffId(set)
  if (state.buffs.some((b) => b.id === buffId)) return state // already fired (idempotent)

  // kind:'rest' is purely cosmetic — NOT read by any XP/seed/crit/streak selector.
  const buff: Buff = { id: buffId, label: `${set} fully foiled`, kind: 'rest' }
  rewards.push({
    kind: 'buff',
    buff: buffId,
    message: `✦✦ ${set} set fully foiled · capstone unlocked (cosmetic)`,
  })
  return { ...state, buffs: [...state.buffs, buff] }
}

/** The buff id the FIRST prestige rank grants (legacy/back-compat constant). */
export const PRESTIGE_BUFF_ID = 'prestige:mark'

/**
 * The buff id for prestige RANK `rank` (rank ≥ 1). Rank 1 keeps the legacy
 * `prestige:mark` id for back-compat; higher ranks suffix the rank number. Each
 * rank is a DISTINCT cosmetic flair the renderer can show.
 */
export function prestigeBuffId(rank: number): string {
  return rank <= 1 ? PRESTIGE_BUFF_ID : `${PRESTIGE_BUFF_ID}:${rank}`
}

/**
 * How much each successive prestige rank escalates over the base. Rank N (0-indexed
 * current rank → buying the (N+1)th) costs PRESTIGE_COST + N*PRESTIGE_COST_STEP, so
 * the late-game sink keeps deepening (a recurring target, never "spent forever").
 */
export const PRESTIGE_COST_STEP = 250

/**
 * Whether a buff id is EXACTLY a prestige rank id (not merely prefixed by one).
 * Rank 1 is the legacy `prestige:mark`; rank ≥ 2 is `prestige:mark:<N>`. PURE.
 *
 * R7 code nit (P3): the old `startsWith(PRESTIGE_BUFF_ID)` test mis-counted — any
 * id that merely STARTS with `prestige:mark` (e.g. a hypothetical `prestige:marker`
 * or a future `prestige:mark:flair`) would be counted as a rank, inflating the
 * count and so the next prestigeCost. Matching exact rank ids closes that.
 */
const PRESTIGE_RANK_RE = new RegExp(`^${PRESTIGE_BUFF_ID}(:\\d+)?$`)

/** The player's current prestige rank = the count of prestige rank buffs owned. PURE. */
export function prestigeRank(state: GameState): number {
  return state.buffs.filter((b) => PRESTIGE_RANK_RE.test(b.id)).length
}

/**
 * Seed cost to buy the NEXT prestige rank when the current rank is `rank`. The
 * first rank (rank 0 → 1) costs PRESTIGE_COST; each further rank adds
 * PRESTIGE_COST_STEP, so the sink escalates and recurs. Published (ADR-0002). PURE.
 */
export function prestigeCost(rank: number): number {
  return PRESTIGE_COST + Math.max(0, Math.floor(rank)) * PRESTIGE_COST_STEP
}

/**
 * Spend seeds to buy the NEXT ENDGAME prestige RANK (R6 tiered/renewable, game-
 * design P2). Prestige is no longer a one-time idempotent buff: each purchase
 * grants a NEW distinct cosmetic flair at an ESCALATING cost (prestigeCost(rank)),
 * so the late-game seed sink RECURS — a finished collection always has a target.
 * Cosmetic-only (ADR-0005): each prestige buff is `kind:'rest'`, read by NO XP/
 * seed/crit/streak selector, so prestige confers ZERO economic power. Broke →
 * friendly refusal, NO debit (never shaming). PURE & IMMUTABLE.
 */
export function buyPrestige(
  state: GameState,
): { state: GameState; rewards: Reward[] } {
  const rewards: Reward[] = []

  const rank = prestigeRank(state)
  const cost = prestigeCost(rank)

  if (state.player.currency < cost) {
    rewards.push({
      kind: 'currency',
      amount: state.player.currency,
      message: `not enough 🌰 — prestige ${rank + 1} costs ${cost}, have ${state.player.currency}`,
    })
    return { state: { ...state, player: { ...state.player } }, rewards }
  }

  const nextRank = rank + 1
  const spent = state.player.currency - cost
  const buffId = prestigeBuffId(nextRank)

  rewards.push({
    kind: 'currency',
    amount: -cost,
    message: `-${cost} 🌰 · prestige ${nextRank}`,
  })
  rewards.push({
    kind: 'buff',
    buff: buffId,
    message: `✦ Prestige ${nextRank} earned (permanent cosmetic)`,
  })

  // kind:'rest' is purely cosmetic — NOT read by any XP/seed/crit selector — so
  // prestige confers ZERO economic effect (ADR-0005: cosmetic-only, no power).
  const buff: Buff = { id: buffId, label: `Prestige ${nextRank}`, kind: 'rest' }
  return {
    state: {
      ...state,
      player: { ...state.player, currency: spent },
      buffs: [...state.buffs, buff],
    },
    rewards,
  }
}

// ---------------------------------------------------------------------------
// foil — SPEND shards to cosmetically FOIL an OWNED card (the renewable axis).
// ---------------------------------------------------------------------------

/**
 * Spend FOIL_COST shards to mark an OWNED card cosmetically 'foiled' (R8 renewable
 * content axis — a completed collection is never "done"). The CLI exposes this as
 * `sq foil [cardId]`.
 *
 *  - `cardId` omitted → foil the FIRST owned, not-yet-foiled card (sensible default).
 *  - `cardId` given → it MUST be a card the player OWNS and has NOT already foiled;
 *    an unowned / already-foiled id is refused calmly (no debit, never shaming).
 *  - Too few shards, or nothing left to foil → friendly refusal, NO debit.
 *
 * On success: debit the shards and append the id to `foiled`. Cosmetic-only
 * (ADR-0005): a foiled card confers ZERO power — it is pure flair. PURE & IMMUTABLE
 * — no I/O, no wall-clock, no rng (the upgrade is fully deterministic).
 */
export function foilCard(
  state: GameState,
  cardId?: string,
): { state: GameState; rewards: Reward[] } {
  const rewards: Reward[] = []
  const haveShards = state.player.shards ?? 0
  const foiled = state.foiled ?? []
  const foiledSet = new Set(foiled)

  // Owned card ids the player has NOT yet foiled (preserve owned order → stable default).
  const ownedIds: string[] = []
  const seen = new Set<string>()
  for (const c of state.cards) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      ownedIds.push(c.id)
    }
  }
  const foilable = ownedIds.filter((id) => !foiledSet.has(id))

  // Resolve the target: explicit (validated) or the first foilable card.
  let targetId: string | null
  if (cardId === undefined) {
    targetId = foilable[0] ?? null
  } else if (!seen.has(cardId)) {
    // Not owned at all → can't foil.
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message: `can't foil ${cardId} — you don't own it`,
    })
    return { state: cloneState(state), rewards }
  } else if (foiledSet.has(cardId)) {
    // Owned but already foiled → friendly idempotent refusal, no debit.
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message: `${cardId} is already foiled`,
    })
    return { state: cloneState(state), rewards }
  } else {
    targetId = cardId
  }

  // Nothing left to foil (owns nothing, or every owned card already foiled).
  if (targetId === null) {
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message:
        ownedIds.length === 0
          ? 'nothing to foil — no cards owned yet'
          : 'nothing left to foil — all owned cards are foiled',
    })
    return { state: cloneState(state), rewards }
  }

  // R9: the cost is the chosen card's RARITY-SCALED foil cost (a curve, not flat).
  const def = ALL_CARD_DEFS.find((d) => d.id === targetId)
  const name = def?.name ?? targetId
  const rarity = def?.rarity ?? 'common'
  const cost = foilCost(rarity)

  // Affordability — calm refusal, no debit.
  if (haveShards < cost) {
    rewards.push({
      kind: 'currency',
      amount: haveShards,
      message: `not enough shards — foil ${name} needs ${cost}, have ${haveShards}`,
    })
    return { state: cloneState(state), rewards }
  }

  const spentShards = haveShards - cost
  const nextFoiled = [...foiled, targetId]
  rewards.push({
    kind: 'currency',
    amount: -cost,
    message: `-${cost} shards · foil ${rarity}`,
  })
  rewards.push({
    kind: 'card',
    rarity: def?.rarity,
    message: `✦ FOIL · ${name} now shimmers (cosmetic)`,
  })

  let next: GameState = {
    ...state,
    player: { ...state.player, shards: spentShards },
    foiled: nextFoiled,
  }
  // R9 capstone: foiling the LAST card of a set unlocks a distinct one-time flair.
  if (def) next = grantFoiledSetCapstone(next, def.set, nextFoiled, rewards)

  return { state: next, rewards }
}

// ---------------------------------------------------------------------------
// Decision-point telemetry accessors (R8) — small PURE reads the render/TUI layer
// surfaces so the player sees WHY a pull/save decision matters. No I/O, no wall-
// clock, no rng — they only read state + the published gacha constants.
// ---------------------------------------------------------------------------

/**
 * Pity progress for the standard/premium banner: the raw `sinceLegendary` counter
 * against the published SOFT_PITY / HARD_PITY thresholds, plus convenience flags.
 *  - `softActive` — soft-pity boost is in effect (sinceLegendary >= SOFT_PITY).
 *  - `hardNext`   — the NEXT pull is the hard-guaranteed one (sinceLegendary+1 >= HARD_PITY).
 *  - `pullsToHard`— pulls remaining until the hard guarantee (clamped at 0).
 * PURE — reads only state + published constants.
 */
export function pityProgress(state: GameState): {
  sinceLegendary: number
  softPity: number
  hardPity: number
  softActive: boolean
  hardNext: boolean
  pullsToHard: number
} {
  const since = state.pity.sinceLegendary
  return {
    sinceLegendary: since,
    softPity: SOFT_PITY,
    hardPity: HARD_PITY,
    softActive: since >= SOFT_PITY,
    hardNext: since + 1 >= HARD_PITY,
    pullsToHard: Math.max(0, HARD_PITY - since),
  }
}

/**
 * The card ids the player is still MISSING within their UNLOCKED sets (level-scoped).
 * The render layer surfaces this at the pull/craft/spark decision point. PURE &
 * deterministic — preserves set/def order so a default target is stable.
 */
export function missingCardIdsForPlayer(state: GameState): string[] {
  return missingCardIds(state.cards, unlockedSets(state.player.level))
}

/**
 * Spark progress for the targeted premium banner: the current `spark` counter
 * against the published SPARK_THRESHOLD, the chosen target (if any), and whether
 * the NEXT premium pull would fire the guarantee. PURE — reads only state + the
 * published threshold.
 */
export function sparkProgress(state: GameState): {
  spark: number
  threshold: number
  target?: string
  guaranteedNext: boolean
} {
  const spark = state.spark ?? 0
  return {
    spark,
    threshold: SPARK_THRESHOLD,
    target: state.sparkTarget,
    guaranteedNext: spark >= SPARK_THRESHOLD,
  }
}

/**
 * The published HONEST, pity-inclusive legendary+shiny rate a player realizes over a
 * long session (ADR-0002). A tiny accessor so the render layer surfaces the TRUE
 * long-run odds at the decision point without re-importing the gacha module. PURE.
 */
export function realizedLegendaryShinyRate(): number {
  return REALIZED_LEGENDARY_SHINY_RATE
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

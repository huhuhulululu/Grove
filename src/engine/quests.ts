/**
 * quests — the PURE Pillar-B quest engine.
 *
 * Turns skipped good-engineering chores (write CLAUDE.md, specs, keep docs in
 * sync, add tests) into rewarded game actions. Called by `reduce` AFTER the base
 * XP grant, so quest-specific effects (auras, multipliers, freshness, loot) layer
 * on top of the ordinary reward flow.
 *
 * ADR-0005 GUARDRAILS enforced here:
 *  - reward the OUTCOME (an artifact exists / a doc tracks the code), never raw activity;
 *  - first-time achievement fires ONCE, then fades to informational (anti-overjustification);
 *  - a lapsed/expired/removed buff is SILENT — no shame, no nag message;
 *  - detection false-positives never punish (a bloated/missing grimoire is simply not rewarded).
 *
 * PURE & IMMUTABLE: no I/O, no wall-clock, no Math.random — every chance is
 * threaded through the injected `rng`.
 */

import type { GameState, Buff, QuestProgress } from '../core/state'
import type { GroveEvent } from '../core/events'
import type { Reward } from '../core/rewards'
import type { Rng } from '../core/rng'

import { GRIMOIRE_FILES, GRIMOIRE_LEAN_MAX_LINES, DOC_STREAK_TIERS, docStreakTier } from '../core/quests'
import { pull, makeCard } from './gacha'
import { addCard, grantDupComp, DUP_COMP_SEEDS } from './collection'
import { msg } from '../i18n/t'

/**
 * Compensation seeds for a duplicate pull. Re-exported from collection.ts (the
 * single source of truth after the R6 dedup) so existing `./quests` importers
 * keep working.
 */
export { DUP_COMP_SEEDS }

// ---------------------------------------------------------------------------
// R3 tunables — auras / streaks / dup-comp / set bonus are now REAL effects.
// All published / inspectable (ADR-0002); all cosmetic-adjacent (ADR-0005/0008).
// ---------------------------------------------------------------------------

/** Seed-gain bonus a Grimoire aura confers while owned (e.g. +5% seeds). */
export const AURA_SEED_BONUS = 0.05

/** Seed-gain bonus a completed-set permanent buff confers (small, stacks). */
export const SET_BONUS_SEED = 0.05

/** Each consecutive test_added adds this to the Test Streak multiplier. */
export const STREAK_STEP = 0.1

/** The Test Streak multiplier bonus is capped here (factor max; 1+cap = ceiling). */
export const STREAK_CAP = 1.0

/** Permanent +seeds aura the Clean Build quest (lint_clean) confers. */
export const CLEAN_BUILD_SEED_BONUS = 0.05

// ---------------------------------------------------------------------------
// Active-buff selectors (used by reduce to scale XP / seeds / crit)
// ---------------------------------------------------------------------------

/** Product of `factor` over active `multiplier`-kind buffs (default 1). */
export function activeMultiplier(state: GameState): number {
  return state.buffs.reduce(
    (acc, b) => (b.kind === 'multiplier' ? acc * (b.factor ?? 1) : acc),
    1,
  )
}

/** Sum of `factor` over active `freshness`-kind buffs (default 0). */
export function activeFreshnessBonus(state: GameState): number {
  return state.buffs.reduce(
    (acc, b) => (b.kind === 'freshness' ? acc + (b.factor ?? 0) : acc),
    0,
  )
}

/**
 * Fraction added to SEED (currency) gains from always-on `aura`-kind buffs:
 *  - the Grimoire aura (no factor) contributes AURA_SEED_BONUS;
 *  - a completed-set permanent buff carries its own `factor`.
 * No longer decorative — `reduce.grantCurrency` reads this (audit P1 fix).
 */
export function activeSeedBonus(state: GameState): number {
  return state.buffs.reduce((acc, b) => {
    if (b.kind !== 'aura') return acc
    return acc + (b.factor ?? AURA_SEED_BONUS)
  }, 0)
}

/**
 * Escalating multiplier from `streak`-kind buffs (default 1). The Test Streak's
 * `factor` is the accumulated bonus; the multiplier is `1 + Σfactor`. No longer
 * decorative — `reduce` folds this into the XP scale (audit P1 fix).
 */
export function activeStreakMultiplier(state: GameState): number {
  return state.buffs.reduce(
    (acc, b) => (b.kind === 'streak' ? acc + (b.factor ?? 0) : acc),
    1,
  )
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** A leading ✦ marks the top tiers (legendary / shiny). Otherwise terse. */
function rarityMark(rarity: string): string {
  return rarity === 'legendary' || rarity === 'shiny' ? '✦ ' : ''
}

/** Replace a buff by id (no duplicates); returns a NEW buffs array. */
function upsertBuff(buffs: Buff[], next: Buff): Buff[] {
  const without = buffs.filter((b) => b.id !== next.id)
  return [...without, { ...next }]
}

/** Remove a buff by id; returns a NEW buffs array. */
function removeBuff(buffs: Buff[], id: string): Buff[] {
  return buffs.filter((b) => b.id !== id)
}

/** Find a quest by id (read-only). */
function findQuest(quests: QuestProgress[], id: string): QuestProgress | undefined {
  return quests.find((q) => q.id === id)
}

/**
 * Upsert quest progress immutably. If the quest is absent it is inserted with
 * `{ status, completions }`. If present it is replaced. Returns a NEW array.
 */
function setQuest(
  quests: QuestProgress[],
  id: string,
  status: QuestProgress['status'],
  completions: number,
): QuestProgress[] {
  const without = quests.filter((q) => q.id !== id)
  return [...without, { id, status, completions }]
}

/**
 * A completed set grants a REAL reward (audit P1 — not just a flavour string):
 *  1. a GUARANTEED legendary pull (added to the collection), and
 *  2. a small PERMANENT buff the engine reads (`set:bonus:<set>`, kind 'aura',
 *     factor SET_BONUS_SEED → +seeds via activeSeedBonus).
 * Returns a NEW state. The bonus legendary may itself complete/dup — that is fine;
 * we do NOT recurse the set-bonus (one guaranteed legendary, no chains).
 */
function grantSetBonus(state: GameState, set: string, rng: Rng, rewards: Reward[]): GameState {
  // 1. Permanent, engine-read buff.
  const buffId = `set:bonus:${set}`
  const buffs = upsertBuff(state.buffs, {
    id: buffId,
    label: msg('reward.buff.set', { set }).message,
    kind: 'aura',
    factor: SET_BONUS_SEED,
  })
  rewards.push({
    kind: 'buff',
    buff: buffId,
    ...msg('reward.set_complete', { set, pct: Math.round(SET_BONUS_SEED * 100) }),
  })

  // 2. Guaranteed legendary pull (drawn from the player's unlocked sets).
  const card = makeCard('legendary', rng, state.player.level)
  const { cards, completedSets, duplicate } = addCard(state.cards, state.completedSets, card)
  rewards.push({
    kind: 'card',
    card,
    rarity: 'legendary',
    ...msg('reward.legendary', { name: card.name }),
  })

  let next: GameState = { ...state, buffs, cards, completedSets }
  if (duplicate) next = grantDupComp(next, 'legendary', rewards)
  return next
}

/**
 * Perform one guaranteed gacha pull on a working state, threading pity, adding
 * the card to the collection, and pushing a 'card' reward. On a DUPLICATE it also
 * grants dup-comp seeds; on a newly-completed set it grants the real set bonus
 * (guaranteed legendary + permanent buff). Returns a NEW state.
 */
function grantPull(state: GameState, rng: Rng, rewards: Reward[]): GameState {
  const { rarity, pity } = pull(state.pity, rng)
  const card = makeCard(rarity, rng, state.player.level)
  const { cards, completedSets, newlyCompleted, duplicate } = addCard(
    state.cards,
    state.completedSets,
    card,
  )

  rewards.push({
    kind: 'card',
    card,
    rarity,
    ...msg('reward.card', { mark: rarityMark(rarity), name: card.name, rarity }),
  })

  let next: GameState = { ...state, cards, completedSets, pity }

  if (duplicate) next = grantDupComp(next, rarity, rewards)

  if (newlyCompleted) next = grantSetBonus(next, newlyCompleted, rng, rewards)

  return next
}

// ---------------------------------------------------------------------------
// applyQuests
// ---------------------------------------------------------------------------

export function applyQuests(
  state: GameState,
  event: GroveEvent,
  rng: Rng,
  rewards: Reward[],
): GameState {
  switch (event.type) {
    // ---- Forge the Grimoire ------------------------------------------------
    case 'file_presence': {
      const document = event.meta.document
      if (typeof document !== 'string' || !(GRIMOIRE_FILES as readonly string[]).includes(document)) {
        return state // not a grimoire signal — ignore entirely
      }

      const present = event.meta.present !== false
      const lines = event.meta.lines
      const lean = typeof lines !== 'number' || lines <= GRIMOIRE_LEAN_MAX_LINES

      if (!present) {
        // File deleted: drop the aura silently. No penalty, no message.
        return { ...state, buffs: removeBuff(state.buffs, 'aura:grimoire') }
      }

      if (!lean) {
        // Bloated grimoire earns no aura — and is NEVER shamed.
        return state
      }

      // present && lean → grant the permanent aura.
      const buffs = upsertBuff(state.buffs, {
        id: 'aura:grimoire',
        label: msg('reward.buff.grimoire_aura').message,
        kind: 'aura',
      })

      const q = findQuest(state.quests, 'grimoire')
      const completions = q?.completions ?? 0

      if (completions === 0) {
        // First-time achievement: heavy reward, then fade.
        rewards.push({
          kind: 'buff',
          buff: 'aura:grimoire',
          ...msg('reward.quest.grimoire_aura'),
        })
        const afterPull = grantPull({ ...state, buffs }, rng, rewards)
        return { ...afterPull, quests: setQuest(state.quests, 'grimoire', 'done', 1) }
      }

      // Already earned: just keep the aura present. Push NOTHING (anti-overjustification).
      return { ...state, buffs }
    }

    // ---- Pre-cast the Spell (multiplier) -----------------------------------
    case 'spec_written': {
      const buffs = upsertBuff(state.buffs, {
        id: 'mult:precast',
        label: msg('reward.buff.precast').message,
        kind: 'multiplier',
        factor: 2,
        expiresAtCount: state.eventCount + 6,
      })

      rewards.push({
        kind: 'buff',
        buff: 'mult:precast',
        ...msg('reward.quest.precast_armed'),
      })

      const q = findQuest(state.quests, 'precast-spec')
      const completions = (q?.completions ?? 0) + 1
      if (completions === 1) {
        rewards.push({
          kind: 'buff',
          buff: 'precast-spec',
          ...msg('reward.quest.precast_unlocked'),
        })
      }

      return { ...state, buffs, quests: setQuest(state.quests, 'precast-spec', 'done', completions) }
    }

    // ---- Tend the Living Map -----------------------------------------------
    case 'doc_updated': {
      if (event.meta.drift === true) {
        // Drift detected: surface the quest on the board, silently. No reward, no nag.
        const q = findQuest(state.quests, 'living-map')
        const completions = q?.completions ?? 0
        return { ...state, quests: setQuest(state.quests, 'living-map', 'active', completions) }
      }

      // Synced: grant the renewable freshness buff.
      const buffs = upsertBuff(state.buffs, {
        id: 'buff:living-map',
        label: msg('reward.buff.fresh_architecture').message,
        kind: 'freshness',
        factor: 0.15,
        expiresAtCount: state.eventCount + 10,
      })

      rewards.push({
        kind: 'buff',
        buff: 'buff:living-map',
        ...msg('reward.quest.living_map_buff'),
      })

      const q = findQuest(state.quests, 'living-map')
      const completions = (q?.completions ?? 0) + 1
      if (completions === 1) {
        rewards.push({
          kind: 'buff',
          buff: 'living-map',
          ...msg('reward.quest.living_map_unlocked'),
        })
      }

      let synced: GameState = {
        ...state,
        buffs,
        quests: setQuest(state.quests, 'living-map', 'done', completions),
      }

      // RENEWABLE Doc Streak (R5): each synced doc advances a tiered weekly
      // streak. The quest stays `active` (it refreshes, it never retires), so the
      // board keeps a living goal. Crossing a tier grants a celebratory seed
      // bonus the engine reads. Forgiving: a lapsed streak is never shamed.
      synced = advanceDocStreak(synced, rewards)

      return synced
    }

    // ---- Test Warden (guaranteed loot) -------------------------------------
    case 'test_added': {
      const afterPull = grantPull(state, rng, rewards)

      // Test Streak: each consecutive test_added escalates the multiplier bonus
      // by STREAK_STEP, capped at STREAK_CAP. No longer decorative — reduce reads
      // it via activeStreakMultiplier (audit P1 fix).
      const prevStreak = afterPull.buffs.find((b) => b.id === 'streak:tests')
      const nextFactor = Math.min(STREAK_CAP, (prevStreak?.factor ?? 0) + STREAK_STEP)
      const buffs = upsertBuff(afterPull.buffs, {
        id: 'streak:tests',
        label: msg('reward.buff.test_streak').message,
        kind: 'streak',
        factor: nextFactor,
      })

      const q = findQuest(afterPull.quests, 'test-warden')
      const completions = (q?.completions ?? 0) + 1
      if (completions === 1) {
        rewards.push({
          kind: 'buff',
          buff: 'test-warden',
          ...msg('reward.quest.test_warden_first'),
        })
      }

      return { ...afterPull, buffs, quests: setQuest(afterPull.quests, 'test-warden', 'done', completions) }
    }

    // ---- Close the Review (a short Fresh Eyes freshness buff) --------------
    case 'review_confirmed': {
      const buffs = upsertBuff(state.buffs, {
        id: 'buff:review-loop',
        label: msg('reward.buff.fresh_eyes').message,
        kind: 'freshness',
        factor: 0.1,
        expiresAtCount: state.eventCount + 8,
      })
      rewards.push({ kind: 'buff', buff: 'buff:review-loop', ...msg('reward.quest.review_buff') })

      const q = findQuest(state.quests, 'review-loop')
      const completions = (q?.completions ?? 0) + 1
      if (completions === 1) {
        rewards.push({ kind: 'buff', buff: 'review-loop', ...msg('reward.quest.review_unlocked') })
      }
      return { ...state, buffs, quests: setQuest(state.quests, 'review-loop', 'done', completions) }
    }

    // ---- Keep It Clean (a permanent small +seeds aura) --------------------
    case 'lint_clean': {
      const buffs = upsertBuff(state.buffs, {
        id: 'aura:clean-build',
        label: msg('reward.buff.clean_build').message,
        kind: 'aura',
        factor: CLEAN_BUILD_SEED_BONUS,
      })

      const q = findQuest(state.quests, 'clean-build')
      const completions = q?.completions ?? 0
      if (completions === 0) {
        // First-time achievement: heavy reward, then fade (anti-overjustification).
        rewards.push({ kind: 'buff', buff: 'aura:clean-build', ...msg('reward.quest.clean_build_aura') })
        return { ...state, buffs, quests: setQuest(state.quests, 'clean-build', 'done', 1) }
      }
      // Already earned: keep the aura present, push NOTHING.
      return { ...state, buffs }
    }

    // ---- Merge the PR (tracks the merge milestone + a short Momentum buff) -
    // reduce already grants the guaranteed pull + gear for a merge; this quest
    // layers a brief Momentum freshness buff and the first-time achievement only
    // (no SECOND pull — that would double the loot and inflate the economy).
    case 'pr_merged': {
      const buffs = upsertBuff(state.buffs, {
        id: 'buff:merge-momentum',
        label: msg('reward.buff.momentum').message,
        kind: 'freshness',
        factor: 0.1,
        expiresAtCount: state.eventCount + 6,
      })
      rewards.push({ kind: 'buff', buff: 'buff:merge-momentum', ...msg('reward.quest.merge_buff') })

      const q = findQuest(state.quests, 'merge-master')
      const completions = (q?.completions ?? 0) + 1
      if (completions === 1) {
        rewards.push({ kind: 'buff', buff: 'merge-master', ...msg('reward.quest.merge_unlocked') })
      }
      return { ...state, buffs, quests: setQuest(state.quests, 'merge-master', 'done', completions) }
    }

    default:
      return state
  }
}

/**
 * Advance the RENEWABLE Doc Streak by one synced doc. The quest progress's
 * `completions` IS the streak length; the quest stays `active` so the board keeps
 * a living goal (never retires to a static `done`). Crossing into a higher tier
 * grants a celebratory seed bonus the engine reads. Pure & immutable.
 */
function advanceDocStreak(state: GameState, rewards: Reward[]): GameState {
  const prev = findQuest(state.quests, 'doc-streak')
  const prevStreak = prev?.completions ?? 0
  const nextStreak = prevStreak + 1

  const prevTier = docStreakTier(prevStreak)
  const nextTier = docStreakTier(nextStreak)

  let next: GameState = state
  if (nextTier > prevTier) {
    const seeds = DOC_STREAK_TIERS[nextTier]?.seeds ?? 0
    if (seeds > 0) {
      rewards.push({
        kind: 'currency',
        amount: seeds,
        ...msg('reward.doc_streak', { streak: nextStreak, seeds }),
      })
      next = { ...state, player: { ...state.player, currency: state.player.currency + seeds } }
    }
  }

  // Renewable: stays 'active' and keeps the streak count climbing.
  return { ...next, quests: setQuest(next.quests, 'doc-streak', 'active', nextStreak) }
}

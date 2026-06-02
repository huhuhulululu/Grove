/**
 * commands/economy.ts · the risk/economy loop handlers — the player's spend-side
 * choices: pull, premium pull, enhance, repair, protect, craft, foil, convert,
 * prestige.
 *
 * Impure shell (ADR-0005): loads/saves state under the cross-process lock and
 * prints; NO game logic is re-implemented here — every state change flows through
 * the pure engine (engine/reduce, engine/gear, engine/collection).
 */

import { loadState, saveState, withStateLock } from '../../store/store'
import {
  enhance,
  repairGear,
  enhanceCost,
  repairCost,
} from '../../engine/gear'
import {
  pull as enginePull,
  pullPremium,
  craftCard,
  buyPrestige,
  foilCard,
  PULL_COST,
  PREMIUM_PULL_COST,
} from '../../engine/reduce'
import { convertShards, shardConversionSeeds } from '../../engine/collection'
import { renderEnhanceOdds, renderEnhanceResult, renderEnhanceFrames, renderPullFrames } from '../../render/enhance'
import { pickSalientReward, salientRarity } from '../../tui/juice'
import { mulberry32, hashStringToSeed } from '../../core/rng'
import type { GameState } from '../../core/state'
import type { Reward, Rarity } from '../../core/rewards'
import { t } from '../../i18n/t'
import type { Locale } from '../../i18n/types'
import {
  parseIntFlag,
  parsePositiveIntFlag,
  calmConfirm,
  playReveal,
  resolveGearRef,
  printRewards,
} from './shared'

/**
 * The rarity whose escalation the pull reveal should play · the SALIENT drop's
 * tier, so a shiny pull builds longer/brighter than a common (the rarity-scaled
 * suspense in render/enhance.ts `buildRevealFrames`). Surfaces R9's escalation on
 * the PRIMARY documented CLI command, matching the Ink TUI (src/tui/app.tsx) so a
 * common and a shiny no longer look identical on the shell. Pure; exported for the
 * surface guard (economy.reveal.test.ts). `undefined` → the neutral default build.
 */
export function revealRarityFor(rewards: Reward[]): Rarity | undefined {
  return salientRarity(pickSalientReward(rewards)) ?? undefined
}

/**
 * Seed price to arm a one-shot enhance protection. (Enhance & repair prices are
 * now LEVEL-SCALING · see the engine's enhanceCost(level) / repairCost(gear),
 * which R6 wired in place of the old flat ENHANCE_COST/REPAIR_COST constants.)
 * Exported so the help body can interpolate it and the cost-drift guard can
 * treat it as a backing constant.
 */
export const PROTECT_COST = 40

/**
 * `sq pull [--premium]` · spend seeds for one gacha pull (the core R3 decision).
 *
 * Loads state under the cross-process lock, runs the PURE engine `pull` (or
 * `pullPremium` with `--premium` · the escalating seed SINK at PREMIUM_PULL_COST,
 * better odds), persists, and prints the rewards behind a pack-opening reveal.
 * Time-seeded for variety, or a fixed --seed for tests. When broke, prints a
 * friendly earn-more-by-shipping hint.
 */
export function handlePull(flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  const premium = flags['premium'] === 'true'
  const cost = premium ? PREMIUM_PULL_COST : PULL_COST
  // --spark <id>: the missing card a PREMIUM banner builds its guarantee toward
  // (the engine reads state.sparkTarget). Choosing a target = the save-vs-spend
  // reason the targeted premium gives (SPARK_THRESHOLD misses → guaranteed).
  const sparkTarget = premium ? flags['spark'] : undefined

  const result = withStateLock(dir, () => {
    const loaded = loadState(dir)
    // Set/refresh the spark target up front (impure shell, immutable update) so the
    // premium roll below sees it; a no-op when the player passed no --spark.
    const state: GameState =
      sparkTarget !== undefined && sparkTarget !== ''
        ? { ...loaded, sparkTarget }
        : loaded
    const affordable = state.player.currency >= cost
    const seedFlag = flags['seed']
    const seed =
      seedFlag !== undefined
        ? parseIntFlag(seedFlag, 0)
        : hashStringToSeed(`pull:${premium ? 'p:' : ''}${state.eventCount}:${String(Date.now())}`)
    const rng = mulberry32(seed)

    const { state: next, rewards } = premium ? pullPremium(state, rng) : enginePull(state, rng)
    // ROBUSTNESS (R8 code-review): when the player is broke the engine returns the
    // state UNCHANGED (no draw, no debit) — persisting it is a pure no-op write
    // (touches the file mtime + re-acquires the global lock for nothing). Skip the
    // save UNLESS the player actually chose a (new) spark target, which IS a real
    // state change worth persisting even on a refused pull.
    const targetChanged = state.sparkTarget !== loaded.sparkTarget
    if (affordable || targetChanged) {
      saveState(dir, next)
    }
    return { rewards, affordable }
  })

  if (!result.affordable) {
    if (zen) {
      // Calm refusal · no spectacle, no earn-more nudge.
      calmConfirm(t(locale, 'cli.confirm.pull_skipped', { cost }), locale)
      return 0
    }
    // The engine already pushed the calm 'not enough' reward; surface it + a hint.
    printRewards(result.rewards, locale)
    console.log(t(locale, 'cli.broke_hint'))
    return 0
  }

  if (zen) {
    // Calm: the pull happened & persisted; suppress the reveal + loot line.
    calmConfirm(t(locale, premium ? 'cli.confirm.premium_pull_done' : 'cli.confirm.pull_done'), locale)
    return 0
  }

  // Affordable: play the pack-opening suspense (escalating with the salient drop's
  // rarity · a shiny builds longer than a common), then reveal the drop.
  playReveal(renderPullFrames(revealRarityFor(result.rewards)))
  printRewards(result.rewards, locale)
  return 0
}

/**
 * `sq enhance <ref>` · spend seeds to attempt to enhance a piece of cosmetic gear.
 * Prices the attempt with the engine's LEVEL-SCALING enhanceCost (chasing a high
 * +N is a deepening sink). Runs the priced attempt + persists atomically under the
 * lock so the consumed protection, the new gear level, and the seed debit can't be
 * lost to a concurrent writer. Cosmetic only · real code is NEVER affected (ADR-0005).
 */
export function handleEnhance(
  positional: string[],
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
  locale: Locale = 'en',
): number {
  const ref = positional[0]

  if (!ref) {
    console.error('Error: gear ref is required. Use a gear id, 1-based index, or "first".')
    return 2
  }

  const state = loadState(dir)

  if (state.gear.length === 0) {
    console.log(t(locale, 'cli.gear.none_pull'))
    return 0
  }

  const gearIndex = resolveGearRef(state.gear, ref)

  if (gearIndex < 0 || gearIndex >= state.gear.length) {
    console.error(`Error: no gear at ref "${ref}". You have ${state.gear.length} piece(s).`)
    return 2
  }

  const before = state.gear[gearIndex]!

  // Run the (priced) attempt + persist atomically under the lock so the consumed
  // protection, the new gear level, and the seed debit can't be lost to a
  // concurrent writer. The seed COST is checked inside the lock against fresh
  // state so a calm refusal is consistent with the actual wallet.
  const outcome = withStateLock(dir, () => {
    const fresh = loadState(dir)
    const idx = resolveGearRef(fresh.gear, ref)

    // BOUNDS GUARD inside the lock: the pre-lock check ran against a possibly
    // stale snapshot; a concurrent writer may have removed/reordered gear so the
    // ref no longer resolves. Re-validate against fresh state before any debit.
    if (idx < 0 || idx >= fresh.gear.length || fresh.gear[idx] === undefined) {
      return { kind: 'badref' as const, count: fresh.gear.length }
    }
    const cur = fresh.gear[idx]!

    // A broken gear can't be enhanced (the engine short-circuits to result:'stay');
    // refuse BEFORE pricing so neither seeds nor the one-shot protection are
    // consumed for a no-op. Mirrors handleRepair's notbroken guard (calm · ADR-0005).
    if (cur.broken) {
      return { kind: 'brokenstay' as const, gear: cur }
    }

    // R6 P0: price the attempt with the engine's LEVEL-SCALING enhanceCost (was a
    // flat 20 the CLI ignored · chasing a high +N must be a deepening sink).
    const cost = enhanceCost(cur.level)

    // CONSISTENCY (audit re-score①): enhance COSTS seeds, like repair/protect.
    // Refuse calmly when broke · no roll, no debit, no state change.
    if (fresh.player.currency < cost) {
      return { kind: 'broke' as const, have: fresh.player.currency, cost }
    }

    // One-shot protection: armed via `sq protect`. Consumed by THIS attempt
    // regardless of outcome (the pure engine softens a would-be break to a
    // downgrade when protect=true; ADR-0005 · cosmetic only).
    const isProtected = fresh.protectedGear.includes(cur.id)

    // RNG: time-seeded for variety, or a fixed --seed for tests (NaN-guarded).
    const seedFlag = flags['seed']
    const seed =
      seedFlag !== undefined
        ? parseIntFlag(seedFlag, 0)
        : hashStringToSeed(cur.id + ':' + String(cur.level) + ':' + String(Date.now()))
    const rng = mulberry32(seed)

    const { gear: enhanced, result: res } = enhance(cur, rng, isProtected)

    const newGear = fresh.gear.map((g, i) => (i === idx ? enhanced : g))
    const newProtected = isProtected
      ? fresh.protectedGear.filter((id) => id !== cur.id)
      : fresh.protectedGear
    saveState(dir, {
      ...fresh,
      gear: newGear,
      protectedGear: newProtected,
      player: { ...fresh.player, currency: fresh.player.currency - cost },
    })
    return { kind: 'enhanced' as const, after: enhanced, result: res }
  })

  if (outcome.kind === 'badref') {
    // Lost the race: the gear vanished between the pre-lock check and the lock.
    console.error(`Error: no gear at ref "${ref}". You have ${outcome.count} piece(s).`)
    return 2
  }

  if (outcome.kind === 'broke') {
    console.log(t(locale, 'cli.broke_enhance', { cost: outcome.cost, have: outcome.have }))
    console.log(t(locale, 'cli.broke_hint'))
    return 0
  }

  if (outcome.kind === 'brokenstay') {
    // No debit, no protection consumed — a broken piece is repaired, not enhanced.
    console.log(t(locale, 'cli.gear.enhance_broken', { name: outcome.gear.name, level: outcome.gear.level }))
    return 0
  }

  if (zen) {
    // Calm: the attempt ran & persisted; suppress the odds + juicy result reveal.
    calmConfirm(t(locale, 'cli.confirm.enhance_recorded', { name: before.name }), locale)
    return 0
  }

  // Print odds (the suspense), play the dice-roll reveal, then the result ·
  // only when an attempt happened. Mirrors the pull reveal (playReveal is
  // TTY-only and skipped in pipes/tests, so output stays deterministic).
  console.log(renderEnhanceOdds(before, locale))
  // The dice-roll suspense escalates with the gear's rarity (a legendary piece
  // builds longer than a common), matching the pull reveal + the Ink TUI.
  playReveal(renderEnhanceFrames(before.rarity))
  console.log(renderEnhanceResult(before, outcome.after, outcome.result, locale))

  return 0
}

/**
 * `sq repair <ref>` · spend repairCost(gear) seeds to un-break a cosmetic gear
 * (level preserved). R6 P0: the price now SCALES with the gear's level (engine
 * repairCost) · a broken +12 costs far more than a +1, instead of the old flat
 * 50. Refuses calmly when broke. Cosmetic only (ADR-0005).
 */
export function handleRepair(positional: string[], _flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  const ref = positional[0]
  if (!ref) {
    console.error('Error: gear ref is required. Use a gear id, 1-based index, or "first".')
    return 2
  }

  const outcome = withStateLock(dir, () => {
    const state = loadState(dir)
    if (state.gear.length === 0) return { kind: 'nogear' as const }

    const idx = resolveGearRef(state.gear, ref)
    if (idx < 0 || idx >= state.gear.length) return { kind: 'badref' as const, count: state.gear.length }

    const gear = state.gear[idx]!
    if (!gear.broken) return { kind: 'notbroken' as const, gear }
    // R6 P0: level-scaling repair price (was a flat 50 the CLI ignored).
    const cost = repairCost(gear)
    if (state.player.currency < cost) {
      return { kind: 'broke' as const, have: state.player.currency, cost }
    }

    const { gear: repairedGear } = repairGear(state, gear.id)
    saveState(dir, {
      ...state,
      gear: repairedGear,
      player: { ...state.player, currency: state.player.currency - cost },
    })
    return { kind: 'repaired' as const, gear, cost }
  })

  switch (outcome.kind) {
    case 'nogear':
      console.log(t(locale, 'cli.gear.none_repair'))
      return 0
    case 'badref':
      console.error(`Error: no gear at ref "${ref}". You have ${outcome.count} piece(s).`)
      return 2
    case 'notbroken':
      console.log(t(locale, 'cli.gear.not_broken', { name: outcome.gear.name, level: outcome.gear.level }))
      return 0
    case 'broke':
      console.log(t(locale, 'cli.broke_repair', { cost: outcome.cost, have: outcome.have }))
      console.log(t(locale, 'cli.broke_hint'))
      return 0
    case 'repaired':
      if (zen) {
        calmConfirm(t(locale, 'cli.confirm.repaired', { name: outcome.gear.name, level: outcome.gear.level }), locale)
      } else {
        console.log(t(locale, 'cli.gear.repaired', { name: outcome.gear.name, level: outcome.gear.level, cost: outcome.cost }))
      }
      return 0
  }
}

/**
 * `sq protect <ref>` · spend PROTECT_COST seeds to arm a ONE-SHOT protection on
 * a gear: the next enhance turns a would-be cosmetic break into a downgrade.
 * Refuses calmly when broke. Cosmetic risk-management only (ADR-0005).
 */
export function handleProtect(positional: string[], _flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  const ref = positional[0]
  if (!ref) {
    console.error('Error: gear ref is required. Use a gear id, 1-based index, or "first".')
    return 2
  }

  const outcome = withStateLock(dir, () => {
    const state = loadState(dir)
    if (state.gear.length === 0) return { kind: 'nogear' as const }

    const idx = resolveGearRef(state.gear, ref)
    if (idx < 0 || idx >= state.gear.length) return { kind: 'badref' as const, count: state.gear.length }

    const gear = state.gear[idx]!
    if (state.protectedGear.includes(gear.id)) return { kind: 'already' as const, gear }
    if (state.player.currency < PROTECT_COST) {
      return { kind: 'broke' as const, have: state.player.currency }
    }

    saveState(dir, {
      ...state,
      protectedGear: [...state.protectedGear, gear.id],
      player: { ...state.player, currency: state.player.currency - PROTECT_COST },
    })
    return { kind: 'armed' as const, gear }
  })

  switch (outcome.kind) {
    case 'nogear':
      console.log(t(locale, 'cli.gear.none_protect'))
      return 0
    case 'badref':
      console.error(`Error: no gear at ref "${ref}". You have ${outcome.count} piece(s).`)
      return 2
    case 'already':
      console.log(t(locale, 'cli.gear.already_protected', { name: outcome.gear.name, level: outcome.gear.level }))
      return 0
    case 'broke':
      console.log(t(locale, 'cli.broke_protect', { cost: PROTECT_COST, have: outcome.have }))
      console.log(t(locale, 'cli.broke_hint'))
      return 0
    case 'armed':
      if (zen) {
        calmConfirm(t(locale, 'cli.confirm.protected', { name: outcome.gear.name, level: outcome.gear.level }), locale)
      } else {
        console.log(t(locale, 'cli.gear.protected', { name: outcome.gear.name, level: outcome.gear.level, cost: PROTECT_COST }))
      }
      return 0
  }
}

/**
 * `sq craft [cardId]` · spend shards to craft one chosen missing card (the SPEND
 * side of the dup tail; shards were write-only before R6). Loads state under the
 * lock, runs the PURE engine `craftCard` (debits SHARDS_PER_CRAFT, or refuses when
 * short / nothing left), persists, and renders the rewards. Respects --zen.
 */
export function handleCraft(positional: string[], flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  const cardId = positional[0]
  const seedFlag = flags['seed']

  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const before = state.cards.length
    // rng only feeds a possible set-completion bonus legendary; time-seeded for
    // variety, fixed --seed for tests.
    const seed =
      seedFlag !== undefined
        ? parseIntFlag(seedFlag, 0)
        : hashStringToSeed(`craft:${state.eventCount}:${String(Date.now())}`)
    const rng = mulberry32(seed)

    const { state: next, rewards } = craftCard(state, cardId, rng)
    const crafted = next.cards.length > before
    // ROBUSTNESS (R8): a refused craft (short on shards / nothing left / locked id)
    // returns state UNCHANGED — skip the no-op write. A successful craft debits
    // shards + appends a card, so persist that.
    if (crafted) {
      saveState(dir, next)
    }
    return { rewards, crafted }
  })

  if (zen) {
    // Calm: the engine ran & persisted; one quiet line either way.
    calmConfirm(t(locale, result.crafted ? 'cli.confirm.crafted' : 'cli.confirm.craft_skipped'), locale)
    return 0
  }

  printRewards(result.rewards, locale)
  return 0
}

/**
 * `sq foil [cardId]` · spend FOIL_COST shards to cosmetically FOIL an OWNED card
 * (R8 renewable content axis — a completed collection still has a runway). Loads
 * state under the lock, runs the PURE engine `foilCard` (debits shards, or refuses
 * calmly when short / unowned / already foiled / nothing left), persists ONLY when
 * the foil actually applied (no no-op write), and renders the reward. Respects --zen.
 */
export function handleFoil(positional: string[], dir: string, zen: boolean, locale: Locale = 'en'): number {
  const cardId = positional[0]

  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const beforeFoiled = (state.foiled ?? []).length
    const { state: next, rewards } = foilCard(state, cardId)
    const foiled = (next.foiled ?? []).length > beforeFoiled
    // ROBUSTNESS (R8): a refused foil returns state UNCHANGED — skip the no-op
    // write. A successful foil debits shards + appends to foiled[], so persist it.
    if (foiled) {
      saveState(dir, next)
    }
    return { rewards, foiled }
  })

  if (zen) {
    calmConfirm(t(locale, result.foiled ? 'cli.confirm.foiled' : 'cli.confirm.foil_skipped'), locale)
    return 0
  }

  printRewards(result.rewards, locale)
  return 0
}

/**
 * `sq prestige` · spend seeds to buy the next ENDGAME prestige rank (the
 * escalating, recurring late-game sink). Loads state under the lock, runs the
 * PURE engine `buyPrestige` (debits prestigeCost(rank), or refuses when broke),
 * persists, and renders the rewards. Cosmetic-only (ADR-0005). Respects --zen.
 */
export function handlePrestige(_flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const before = state.buffs.length
    const { state: next, rewards } = buyPrestige(state)
    const bought = next.buffs.length > before
    // ROBUSTNESS (R8): a refused prestige (broke) returns state UNCHANGED — skip
    // the no-op write. A purchase debits seeds + adds a rank buff, so persist it.
    if (bought) {
      saveState(dir, next)
    }
    return { rewards, bought }
  })

  if (zen) {
    // Calm: the engine ran & persisted; one quiet line either way.
    calmConfirm(t(locale, result.bought ? 'cli.confirm.prestige_earned' : 'cli.confirm.prestige_skipped'), locale)
    return 0
  }

  printRewards(result.rewards, locale)
  return 0
}

/**
 * `sq convert [n]` · trade banked shards back into seeds at SHARD_TO_SEED (the
 * dead-shard-tail relief valve). Loads state under the lock, runs the PURE engine
 * `convertShards` (debits shards, credits seeds; refuses calmly at zero), persists,
 * and renders the reward. With no count, converts ALL banked shards; with `n`,
 * exactly min(n, banked). Cosmetic-only (ADR-0005). Respects --zen.
 */
export function handleConvert(positional: string[], dir: string, zen: boolean, locale: Locale = 'en'): number {
  // Optional positive count; absent → convert all (undefined). A non-numeric /
  // zero token is NaN-guarded by parsePositiveIntFlag → 0 → engine refuses calmly.
  const countToken = positional[0]
  const n = countToken === undefined ? undefined : parsePositiveIntFlag(countToken, 0)

  const result = withStateLock(dir, () => {
    const state = loadState(dir)
    const before = state.player.shards ?? 0
    const { state: next, rewards } = convertShards(state, n)
    const converted = before - (next.player.shards ?? 0)
    // ROBUSTNESS (R8): a refused convert (no shards / nothing to convert) returns
    // state UNCHANGED — skip the no-op write. A real convert moves shards→seeds.
    if (converted > 0) {
      saveState(dir, next)
    }
    return { rewards, converted }
  })

  if (zen) {
    // Calm: the engine ran & persisted; one quiet line either way.
    calmConfirm(
      result.converted > 0
        ? `${result.converted} shards → ${shardConversionSeeds(result.converted)} 🌰`
        : 'convert skipped · no shards',
      locale,
    )
    return 0
  }

  printRewards(result.rewards, locale)
  return 0
}

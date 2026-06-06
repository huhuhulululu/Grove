/**
 * dashboard.ts — full-screen, in-place dashboard renderer for Grove.
 *
 * PURE: no I/O, no filesystem, no wall-clock. Returns a multi-line string.
 * Uses box-drawing characters and Unicode block chars for progress bars.
 *
 * ADR-0007: favors in-place visual panels over scrolling text.
 * ADR-0005: celebratory tone, never shaming.
 */

import type { GameState } from '../core/state'
import { SYNERGIES } from '../core/synergies'
import {
  CARD_SETS,
  cardIdsInSet,
  setUnlockLevel,
  unlockedSets,
  nextSetUnlock,
  ALL_CARD_DEFS,
} from '../core/cards'
import { QUESTS } from '../core/quests'
import { xpForLevel } from '../engine/xp'
import { gearEffectText } from '../engine/gear'
import {
  WORK_MILESTONE,
  PRESTIGE_BUFF_ID,
  prestigeRank,
  prestigeCost,
  PULL_COST,
  PREMIUM_PULL_COST,
  FOIL_COST_BY_RARITY,
  pityProgress,
  sparkProgress,
  missingCardIdsForPlayer,
  realizedLegendaryShinyRate,
} from '../engine/reduce'
import { craftableCardId } from '../engine/collection'
import { computeLoadoutEffect, SLOT_CAP } from '../engine/loadout'
import { displayWidth, padToWidth, truncateToWidth } from './width'
import { synergyEffectLine } from './loadout'
import type { Locale } from '../i18n/types'
import { t } from '../i18n/t'

/** True when a buff is one of the prestige-rank flair buffs (rolled-up, not per-row). */
function isPrestigeBuff(buff: GameState['buffs'][number]): boolean {
  return buff.id.startsWith(PRESTIGE_BUFF_ID)
}

/** The friendly card NAME for a card id, falling back to the raw id if unknown. */
function cardName(cardId: string): string {
  return ALL_CARD_DEFS.find((d) => d.id === cardId)?.name ?? cardId
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DashboardOptions {
  /** Total character width for the dashboard. Default: 60. */
  width?: number
  /**
   * Current wall-clock epoch in milliseconds, injected for pure/deterministic
   * rendering. Used to compute "resets in <Xh Ym>" ETAs. When absent, ETA
   * lines are omitted (keeping the renderer side-effect-free).
   */
  nowEpoch?: number
  /**
   * Locale for UI chrome translation. Default: "en". Existing callers that
   * omit this field continue to receive English output unchanged.
   */
  locale?: Locale
  /**
   * A plain summary of an ACTIVE Incursion run (the dungeon), injected by the
   * impure shell from the ephemeral run.json. A small flat datum — NOT RunState —
   * so the pure renderer stays free of engine imports. When absent, NO panel
   * renders and the dashboard is byte-identical to before.
   */
  incursion?: { floor: number; floors: number; hp: number; cleared: boolean }
}

/**
 * Render a full-screen dashboard as a multi-line string.
 *
 * PURE: no I/O, no wall-clock. Pass `opts.nowEpoch` to get reset ETAs.
 *
 * @param state - Current game state (read-only).
 * @param opts  - Optional layout options.
 * @returns     - Multi-line string suitable for terminal display.
 */
/** Clamp bounds for the dashboard width. The MIN floor is load-bearing: the box
 *  borders do `'─'.repeat(width - 2)` and rows pad to `width - 4`, so a width < 2
 *  throws a RangeError (negative repeat) on a very narrow terminal. The MAX ceiling
 *  keeps an oversized terminal from producing absurdly wide boxes. */
const MIN_DASH_WIDTH = 24
const MAX_DASH_WIDTH = 100

export function renderDashboard(state: GameState, opts: DashboardOptions = {}): string {
  const width = Math.max(MIN_DASH_WIDTH, Math.min(opts.width ?? 60, MAX_DASH_WIDTH))
  const locale: Locale = opts.locale ?? 'en'

  const sections: string[] = [
    renderHeader(state, width, locale),
    renderEnergy(state, width, opts.nowEpoch, locale),
    renderWork(state, width, locale),
    renderOdds(state, width, locale),
    renderCollection(state, width, locale),
    renderGear(state, width, locale),
    renderLoadout(state, width, locale),
    renderQuests(state, width, locale),
    renderBuffs(state, width, locale),
  ]
  // Surface an ACTIVE Incursion run (the flagship loot-at-stake feature) only when one is open,
  // so a started-and-forgotten run stops being invisible. Absent run → no panel → byte-identical.
  if (opts.incursion) sections.push(renderIncursion(opts.incursion, width, locale))

  return sections.join('\n')
}

/** A factual one-line panel for an active Incursion run — no CTA arrow / nag (passive surface). */
function renderIncursion(inc: NonNullable<DashboardOptions['incursion']>, width: number, locale: Locale = 'en'): string {
  const line = inc.cleared
    ? t(locale, 'ui.incursion.dashboard_cleared', { floors: inc.floors, hp: inc.hp })
    : t(locale, 'ui.incursion.dashboard_line', { floor: inc.floor, floors: inc.floors, hp: inc.hp })
  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.incursion'), width),
    boxDivider(width),
    boxRow(line, width),
    boxBottom(width),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

/** Top border: ┌────────...────────┐ */
function boxTop(width: number): string {
  return '┌' + '─'.repeat(width - 2) + '┐'
}

/** Bottom border: └────────...────────┘ */
function boxBottom(width: number): string {
  return '└' + '─'.repeat(width - 2) + '┘'
}

/** Divider between sub-sections: ├────────...────────┤ */
function boxDivider(width: number): string {
  return '├' + '─'.repeat(width - 2) + '┤'
}

/**
 * A row padded to exactly `width` terminal CELLS with side borders: │ content │
 * The content is left-aligned and padded/truncated within (width - 4) CELLS,
 * giving a 1-space gutter on each side. Padding uses displayWidth (not .length)
 * so a wide CJK char or emoji (🌰 🎁 ⚔️ …) — which is 2 cells but 1-2 UTF-16
 * units — doesn't drift the right border out of alignment.
 */
function boxRow(content: string, width: number): string {
  const inner = width - 4 // 2 border chars + 2 gutter spaces
  // Truncate by cells first (never split a wide glyph), then pad by cells.
  const fitted = displayWidth(content) <= inner ? content : truncateToWidth(content, inner)
  const padded = padToWidth(fitted, inner)
  return '│ ' + padded + ' │'
}

/** Section header row: │ ▌ TITLE ─────...─ │ */
function boxTitle(title: string, width: number): string {
  const inner = width - 4
  const label = `▌ ${title} `
  const dashes = inner - displayWidth(label)
  const content = label + '─'.repeat(Math.max(0, dashes))
  return boxRow(truncateToWidth(content, inner), width)
}

// ---------------------------------------------------------------------------
// ETA helper
// ---------------------------------------------------------------------------

/**
 * Format a millisecond duration into a compact "Xh Ym" string.
 * Negative durations (already reset) return the locale's "soon" string.
 */
function formatEta(ms: number, locale: Locale = 'en'): string {
  if (ms <= 0) return t(locale, 'ui.eta.soon')
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

// ---------------------------------------------------------------------------
// XP progress bar
// ---------------------------------------------------------------------------

/**
 * Build a progress bar string using █ (filled) and ░ (empty).
 *
 * @param current - Current amount (0 .. max).
 * @param max     - Maximum value (denominator).
 * @param barLen  - Total bar length in chars.
 */
function xpBar(current: number, max: number, barLen: number): string {
  if (barLen <= 0) return ''
  const ratio = max > 0 ? Math.min(1, current / max) : 0
  const filled = Math.round(ratio * barLen)
  const empty = barLen - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/**
 * ENERGY panel — anti-burnout Vigor/Sap display.
 *
 * ADR-0008 / ADR-0005 framing rules (strictly enforced):
 *   - Show REMAINING energy (never "used" / "burned").
 *   - known=false → Wellspring mode: one calm line, NO bar, NO numbers.
 *   - Low energy is a rest cue, never an alarm or shame.
 *   - nowEpoch must be injected (PURE — never read from the clock here).
 */
function renderEnergy(state: GameState, width: number, nowEpoch?: number, locale: Locale = 'en'): string {
  const { energy } = state

  // ---- Wellspring mode: unmetered user — hide the bar, fabricate nothing ----
  if (!energy.known) {
    return [
      boxTop(width),
      boxTitle(t(locale, 'ui.panel.energy'), width),
      boxDivider(width),
      boxRow(t(locale, 'ui.energy.wellspring'), width),
      boxBottom(width),
    ].join('\n')
  }

  // ---- Metered mode: show bars for REMAINING energy -------------------------
  const inner = width - 4 // usable width inside border + gutter

  /**
   * Build one energy bar row.
   * Format: "⚡ Vigor ███████░░ 72%"
   */
  function energyBarRow(icon: string, label: string, remaining: number): string {
    const pctStr = `${Math.round(remaining)}%`
    // "⚡ Vigor " + bar + " " + pctStr
    const prefix = `${icon} ${label} `
    const suffix = ` ${pctStr}`
    // Size the bar by CELLS (the icon is a 2-cell emoji) so the row fits exactly.
    const barLen = Math.max(4, inner - displayWidth(prefix) - displayWidth(suffix))
    const bar = xpBar(remaining, 100, barLen)
    return prefix + bar + suffix
  }

  // Only render bars for windows actually present in the frame (vigor/sap may be
  // undefined when the corresponding quota window was absent — never fabricate).
  const vigorBarRows: string[] = energy.vigor !== undefined
    ? [boxRow(energyBarRow('⚡', t(locale, 'ui.energy.vigor'), energy.vigor), width)]
    : []
  const sapBarRows: string[] = energy.sap !== undefined
    ? [boxRow(energyBarRow('🌿', t(locale, 'ui.energy.weekly'), energy.sap), width)]
    : []

  // Optional "resets in" ETA line — only when both nowEpoch and vigorResetsAt present.
  const etaRows: string[] = []
  if (nowEpoch !== undefined && energy.vigorResetsAt !== undefined) {
    const eta = formatEta(energy.vigorResetsAt - nowEpoch, locale)
    etaRows.push(boxRow(t(locale, 'ui.energy.resets_in', { eta }), width))
  }

  // Low-energy rest cue (calm, never shaming). Threshold: either present bar < 20%.
  const restRows: string[] = []
  if (
    (energy.vigor !== undefined && energy.vigor < 20) ||
    (energy.sap !== undefined && energy.sap < 20)
  ) {
    restRows.push(boxRow(t(locale, 'ui.energy.stopping_point'), width))
  }

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.energy'), width),
    boxDivider(width),
    ...vigorBarRows,
    ...sapBarRows,
    ...etaRows,
    ...restRows,
    boxBottom(width),
  ].join('\n')
}

function renderHeader(state: GameState, width: number, locale: Locale = 'en'): string {
  const { level, xp } = state.player
  const needed = xpForLevel(level)

  // Bar occupies available space after the label: "XP [bar] xp/needed"
  // e.g. "XP [███░░░░░░░] 12/50"
  const xpNums = `${xp}/${needed}`
  // inner content width = width - 4 (borders + gutters)
  const inner = width - 4
  // "XP [" + bar + "] " + xpNums
  const fixedParts = 'XP ['.length + '] '.length + xpNums.length
  const barLen = Math.max(4, inner - fixedParts)
  const bar = xpBar(xp, needed, barLen)
  const xpLine = `XP [${bar}] ${xpNums}`

  const titleContent = t(locale, 'ui.header.title', { level })

  // R3 economy: surface the seeds balance — the currency a pull spends.
  const seedsLine = t(locale, 'ui.header.seeds', { seeds: state.player.currency })

  // R6 P1: the dup-tail shards were invisible at the surface. Surface the balance
  // and — when enough to craft — the craft target (the endgame horizon).
  // R7 P3: show the card NAME (def.name), never the raw dotted id.
  const shards = state.player.shards ?? 0
  const craftTarget = craftableCardId(state.cards, unlockedSets(level), shards)
  const shardsLine = craftTarget !== null
    ? t(locale, 'ui.header.shards_craftable', { shards, name: cardName(craftTarget) })
    : t(locale, 'ui.header.shards', { shards })

  // R7 economy/product P2: surface the ENDGAME prestige rank + the NEXT rank's
  // cost so the late-game sink is visible (was buried). e.g. "Prestige 3 · next 1250 🌰".
  const rank = prestigeRank(state)
  const prestigeLine = t(locale, 'ui.header.prestige', { rank, cost: prestigeCost(rank) })

  // R6 P1: the next-set unlock horizon — a forward goal so leveling reads as
  // progress toward richer pulls (omitted once everything is unlocked).
  const horizon = nextSetUnlock(level)
  const horizonRows = horizon !== null
    ? [boxRow(t(locale, 'ui.header.next_set', { set: horizon.set, level: horizon.level }), width)]
    : []

  // R7 product P1: an affordable-action CTA — endgame is reachable but wasn't
  // discoverable, so surface what THIS balance affords (the way the craft hint does).
  const cta = affordableCta(state, locale)
  const ctaRows = cta !== null ? [boxRow(cta, width)] : []

  return [
    boxTop(width),
    boxRow(titleContent, width),
    boxRow(xpLine, width),
    boxRow(seedsLine, width),
    boxRow(shardsLine, width),
    boxRow(prestigeLine, width),
    ...horizonRows,
    ...ctaRows,
    boxBottom(width),
  ].join('\n')
}

/**
 * R7 product P1 — the affordable-action CTA. Returns a one-line "can: …" hint of
 * the actions the current seed balance affords (pull / premium / prestige), or
 * null when nothing is affordable (so the line is omitted rather than empty).
 * PURE: reads only the balance + prestige rank; no I/O.
 */
function affordableCta(state: GameState, locale: Locale = 'en'): string | null {
  const seeds = state.player.currency
  const parts: string[] = []

  if (seeds >= PULL_COST) parts.push(t(locale, 'ui.can.pull', { cost: PULL_COST }))
  if (seeds >= PREMIUM_PULL_COST) parts.push(t(locale, 'ui.can.premium', { cost: PREMIUM_PULL_COST }))

  const nextPrestige = prestigeCost(prestigeRank(state))
  if (seeds >= nextPrestige) parts.push(t(locale, 'ui.can.prestige', { cost: nextPrestige }))

  return parts.length > 0 ? t(locale, 'ui.header.can', { actions: parts.join(' · ') }) : null
}

/**
 * WORK METER panel — token-milestone floor progress (保底, ADR-0010).
 *
 * Shows how full the work meter is toward the NEXT guaranteed COSMETIC chest.
 * Framing is strictly NEUTRAL: "work tracked" toward a 🎁, never "burn more
 * tokens" — the meter is capped & diminishing per window in the engine, so this
 * is a fair floor, not a grind incentive. PURE: reads state.work only.
 */
function renderWork(state: GameState, width: number, locale: Locale = 'en'): string {
  const { workMeter } = state.work
  // Progress within the CURRENT milestone (the meter is drained on each crossing).
  const into = ((workMeter % WORK_MILESTONE) + WORK_MILESTONE) % WORK_MILESTONE

  // No percentage suffix here: a bare "0%" would collide with the Wellspring
  // "no invented numbers" invariant. The bar alone conveys progress neutrally.
  const inner = width - 4
  const prefix = t(locale, 'ui.work.next_chest')
  // Size by CELLS — the 🎁 emoji is 2 cells wide (1 .length unit would mis-size).
  const barLen = Math.max(4, inner - displayWidth(prefix))
  const bar = xpBar(into, WORK_MILESTONE, barLen)

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.work'), width),
    boxDivider(width),
    boxRow(prefix + bar, width),
    boxBottom(width),
  ].join('\n')
}

/**
 * ODDS panel (R8) — put the honesty/odds AT the pull/save decision point.
 *
 * Surfaces, in one place: pity progress (sinceLegendary toward the HARD guarantee,
 * with a soft-pity flag), the PUBLISHED realized legendary+shiny rate, the spark
 * progress (the targeted premium guarantee), how many cards are left to collect in
 * the player's unlocked sets, and the foil shard-sink option. So the player can
 * reason about WHEN to pull / save / spark / craft / foil without leaving the board.
 * PURE: reads state + published engine constants only (ADR-0002 transparency).
 */
function renderOdds(state: GameState, width: number, locale: Locale = 'en'): string {
  const pity = pityProgress(state)
  const spark = sparkProgress(state)
  const missing = missingCardIdsForPlayer(state).length
  // Honest realized rate as a "per 100 pulls" figure. NOT a bare "X%" token —
  // the dashboard-wide Wellspring guard forbids any `\d+%` (no invented energy
  // numbers); "per 100" keeps the odds honest without tripping that invariant.
  const realizedPer100 = (realizedLegendaryShinyRate() * 100).toFixed(1)

  // Pity: raw counter toward the HARD guarantee + soft-pity status.
  const pityStatus = pity.softActive
    ? (pity.hardNext ? t(locale, 'ui.odds.pity_hard_next') : t(locale, 'ui.odds.pity_soft_on'))
    : t(locale, 'ui.odds.pity_to_hard', { n: pity.pullsToHard })
  const pityLine = t(locale, 'ui.odds.pity', {
    since: pity.sinceLegendary,
    hard: pity.hardPity,
    status: pityStatus,
  })

  // Published HONEST long-run odds (pity-inclusive) — never hide the real rate.
  const oddsLine = t(locale, 'ui.odds.rate', { per100: realizedPer100 })

  // Spark: the targeted premium guarantee progress (saving 225 = choosing a target).
  const sparkLine = spark.guaranteedNext
    ? t(locale, 'ui.odds.spark_armed', { spark: spark.spark, threshold: spark.threshold })
    : t(locale, 'ui.odds.spark', { spark: spark.spark, threshold: spark.threshold })

  // How much is left to collect within the unlocked sets (the pull/craft goal).
  const leftLine = missing > 0
    ? t(locale, 'ui.odds.cards_left', { n: missing })
    : t(locale, 'ui.odds.complete')

  // The foil shard sink — a completed collection still has a renewable target.
  // Cost scales with the card's rarity (commons cheap, shiny dearest), so surface
  // the CURVE, not just the floor — kept short so the (sq foil) CTA fits the box (R10).
  const foilLine = t(locale, 'ui.odds.foil', {
    min: FOIL_COST_BY_RARITY.common,
    max: FOIL_COST_BY_RARITY.shiny,
  })

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.odds'), width),
    boxDivider(width),
    boxRow(pityLine, width),
    boxRow(oddsLine, width),
    boxRow(sparkLine, width),
    boxRow(leftLine, width),
    boxRow(foilLine, width),
    boxBottom(width),
  ].join('\n')
}

function renderCollection(state: GameState, width: number, locale: Locale = 'en'): string {
  // Count distinct owned card ids per set
  const ownedIds = new Set(state.cards.map((c) => c.id))
  // Per-set foil progress: shards spent foiling owned cards become lasting board presence.
  const foiledSet = new Set(state.foiled ?? [])
  const level = state.player.level

  const rows = Object.keys(CARD_SETS).map((setName) => {
    const unlockLevel = setUnlockLevel(setName)
    // R6 P1: a set gated above the player's level isn't attainable yet — label it
    // with its unlock level (🔒) instead of a misleading "relics 0/6" that reads
    // like it can be filled now.
    if (unlockLevel > Math.max(1, level)) {
      return boxRow(t(locale, 'ui.collection.locked', { set: setName, level: unlockLevel }), width)
    }
    const allIds = cardIdsInSet(setName)
    const owned = allIds.filter((id) => ownedIds.has(id)).length
    const foiled = allIds.filter((id) => foiledSet.has(id)).length
    const total = allIds.length
    // ✓ marks a fully-completed set (set-completion progress).
    const done = total > 0 && owned === total ? t(locale, 'ui.collection.done') : ''
    // ✨N/total marks foil progress — suppressed at 0 so an un-foiled set stays clean (no clutter).
    const foil = foiled > 0 ? t(locale, 'ui.collection.foil', { foiled, total }) : ''
    return boxRow(t(locale, 'ui.collection.row', { set: setName, owned, total, done }) + foil, width)
  })

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.collection'), width),
    boxDivider(width),
    ...rows,
    boxBottom(width),
  ].join('\n')
}

function renderGear(state: GameState, width: number, locale: Locale = 'en'): string {
  let gearRows: string[]

  if (state.gear.length === 0) {
    gearRows = [boxRow(t(locale, 'ui.gear.none'), width)]
  } else {
    const protectedSet = new Set(state.protectedGear)
    gearRows = state.gear.map((g) => {
      const broken = g.broken ? t(locale, 'ui.gear.broken') : ''
      // ADR-0008: gear level confers a real workflow effect — show it inline.
      const effect = gearEffectText(g)
      const effectStr = effect ? ` · ${effect}` : ''
      // One-shot enhance protection armed via `sq protect`.
      const protectedStr = protectedSet.has(g.id) ? t(locale, 'ui.gear.protected') : ''
      return boxRow(t(locale, 'ui.gear.row', {
        name: g.name,
        level: g.level,
        broken,
        protected: protectedStr,
        effect: effectStr,
      }), width)
    })
  }

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.gear'), width),
    boxDivider(width),
    ...gearRows,
    boxBottom(width),
  ].join('\n')
}

/**
 * LOADOUT panel — compact slot summary + active synergies (ADR-0014 rev.2).
 *
 * Shows: filled/empty slot count and each active synergy with its effect.
 * NEUTRAL-EMPTY: no nag when the loadout is empty; slots N/3 is first-class.
 * PURE: reads state only, no I/O.
 */
function renderLoadout(state: GameState, width: number, locale: Locale = 'en'): string {
  const slots = state.loadout?.slots ?? []
  const effect = computeLoadoutEffect(state)

  // Slots summary: "slots 0/3" or "slots 2/3"
  const slotsRow = boxRow(t(locale, 'ui.loadout.dash_slots', { filled: slots.length, cap: SLOT_CAP }), width)

  // Active synergy rows — terse: "Toolsmith · +5% XP"
  const activeRows = effect.activeSynergies.map((id) => {
    const def = SYNERGIES.find((s) => s.id === id)
    if (def === undefined) return null
    return boxRow(`${def.name} · ${synergyEffectLine(def.effect, locale)}`, width)
  }).filter((r): r is string => r !== null)

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.loadout.title'), width),
    boxDivider(width),
    slotsRow,
    ...activeRows,
    boxBottom(width),
  ].join('\n')
}

function renderQuests(state: GameState, width: number, locale: Locale = 'en'): string {
  const rows = QUESTS.map((def) => {
    const progress = state.quests.find((q) => q.id === def.id)
    let glyph: string
    if (progress?.status === 'done') {
      glyph = '✓'
    } else if (progress?.status === 'active') {
      glyph = '◆'
    } else {
      glyph = '·'
    }
    // Translate quest title via i18n key; fall back to def.title if key missing.
    const titleKey = `quest.${def.id}.title`
    const title = t(locale, titleKey) !== titleKey ? t(locale, titleKey) : def.title
    return boxRow(`${glyph} ${title}`, width)
  })

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.quests'), width),
    boxDivider(width),
    ...rows,
    boxBottom(width),
  ].join('\n')
}

function renderBuffs(state: GameState, width: number, locale: Locale = 'en'): string {
  // R7 product/code: the per-rank prestige buffs are pure cosmetic flair and were
  // cluttering the panel with N near-identical rows. Collapse them into a SINGLE
  // rollup badge "✦ Prestige ×N"; render every other buff as its own row.
  const rank = prestigeRank(state)
  const otherBuffs = state.buffs.filter((b) => !isPrestigeBuff(b))

  const rollupRows = rank > 0 ? [boxRow(t(locale, 'ui.buffs.prestige_rollup', { rank }), width)] : []
  const otherRows = otherBuffs.map((b) =>
    boxRow(b.msgKey ? t(locale, b.msgKey, b.msgArgs) : b.label, width),
  )

  const bodyRows =
    rollupRows.length === 0 && otherRows.length === 0
      ? [boxRow(t(locale, 'ui.buffs.none'), width)]
      : [...rollupRows, ...otherRows]

  return [
    boxTop(width),
    boxTitle(t(locale, 'ui.panel.buffs'), width),
    boxDivider(width),
    ...bodyRows,
    boxBottom(width),
  ].join('\n')
}

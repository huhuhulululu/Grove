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
import { CARD_SETS, cardIdsInSet, setUnlockLevel, unlockedSets, nextSetUnlock } from '../core/cards'
import { QUESTS } from '../core/quests'
import { xpForLevel } from '../engine/xp'
import { gearEffectText } from '../engine/gear'
import { WORK_MILESTONE } from '../engine/reduce'
import { craftableCardId } from '../engine/collection'
import { displayWidth, padToWidth, truncateToWidth } from './width'

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
export function renderDashboard(state: GameState, opts: DashboardOptions = {}): string {
  const width = opts.width ?? 60

  const sections: string[] = [
    renderHeader(state, width),
    renderEnergy(state, width, opts.nowEpoch),
    renderWork(state, width),
    renderCollection(state, width),
    renderGear(state, width),
    renderQuests(state, width),
    renderBuffs(state, width),
  ]

  return sections.join('\n')
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
 * Negative durations (already reset) return "soon".
 */
function formatEta(ms: number): string {
  if (ms <= 0) return 'soon'
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
function renderEnergy(state: GameState, width: number, nowEpoch?: number): string {
  const { energy } = state

  // ---- Wellspring mode: unmetered user — hide the bar, fabricate nothing ----
  if (!energy.known) {
    return [
      boxTop(width),
      boxTitle('ENERGY', width),
      boxDivider(width),
      boxRow('Wellspring · unmetered', width),
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
    ? [boxRow(energyBarRow('⚡', 'Vigor', energy.vigor), width)]
    : []
  const sapBarRows: string[] = energy.sap !== undefined
    ? [boxRow(energyBarRow('🌿', 'Weekly', energy.sap), width)]
    : []

  // Optional "resets in" ETA line — only when both nowEpoch and vigorResetsAt present.
  const etaRows: string[] = []
  if (nowEpoch !== undefined && energy.vigorResetsAt !== undefined) {
    const eta = formatEta(energy.vigorResetsAt - nowEpoch)
    etaRows.push(boxRow(`  resets in ${eta}`, width))
  }

  // Low-energy rest cue (calm, never shaming). Threshold: either present bar < 20%.
  const restRows: string[] = []
  if (
    (energy.vigor !== undefined && energy.vigor < 20) ||
    (energy.sap !== undefined && energy.sap < 20)
  ) {
    restRows.push(boxRow('  good stopping point', width))
  }

  return [
    boxTop(width),
    boxTitle('ENERGY', width),
    boxDivider(width),
    ...vigorBarRows,
    ...sapBarRows,
    ...etaRows,
    ...restRows,
    boxBottom(width),
  ].join('\n')
}

function renderHeader(state: GameState, width: number): string {
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

  const titleContent = `GROVE  Level ${level}`

  // R3 economy: surface the seeds balance — the currency a pull spends.
  const seedsLine = `🌰 ${state.player.currency} seeds`

  // R6 P1: the dup-tail shards were invisible at the surface. Surface the balance
  // and — when enough to craft — the craft target (the endgame horizon).
  const shards = state.player.shards ?? 0
  const craftTarget = craftableCardId(state.cards, unlockedSets(level), shards)
  const shardsLine = craftTarget !== null
    ? `🔧 ${shards} shards · craftable: ${craftTarget} (sq craft)`
    : `🔧 ${shards} shards`

  // R6 P1: the next-set unlock horizon — a forward goal so leveling reads as
  // progress toward richer pulls (omitted once everything is unlocked).
  const horizon = nextSetUnlock(level)
  const horizonRows = horizon !== null
    ? [boxRow(`next set: ${horizon.set} @ L${horizon.level}`, width)]
    : []

  return [
    boxTop(width),
    boxRow(titleContent, width),
    boxRow(xpLine, width),
    boxRow(seedsLine, width),
    boxRow(shardsLine, width),
    ...horizonRows,
    boxBottom(width),
  ].join('\n')
}

/**
 * WORK METER panel — token-milestone floor progress (保底, ADR-0010).
 *
 * Shows how full the work meter is toward the NEXT guaranteed COSMETIC chest.
 * Framing is strictly NEUTRAL: "work tracked" toward a 🎁, never "burn more
 * tokens" — the meter is capped & diminishing per window in the engine, so this
 * is a fair floor, not a grind incentive. PURE: reads state.work only.
 */
function renderWork(state: GameState, width: number): string {
  const { workMeter } = state.work
  // Progress within the CURRENT milestone (the meter is drained on each crossing).
  const into = ((workMeter % WORK_MILESTONE) + WORK_MILESTONE) % WORK_MILESTONE

  // No percentage suffix here: a bare "0%" would collide with the Wellspring
  // "no invented numbers" invariant. The bar alone conveys progress neutrally.
  const inner = width - 4
  const prefix = '🎁 next chest '
  // Size by CELLS — the 🎁 emoji is 2 cells wide (1 .length unit would mis-size).
  const barLen = Math.max(4, inner - displayWidth(prefix))
  const bar = xpBar(into, WORK_MILESTONE, barLen)

  return [
    boxTop(width),
    boxTitle('WORK', width),
    boxDivider(width),
    boxRow(prefix + bar, width),
    boxBottom(width),
  ].join('\n')
}

function renderCollection(state: GameState, width: number): string {
  // Count distinct owned card ids per set
  const ownedIds = new Set(state.cards.map((c) => c.id))
  const level = state.player.level

  const rows = Object.keys(CARD_SETS).map((setName) => {
    const unlockLevel = setUnlockLevel(setName)
    // R6 P1: a set gated above the player's level isn't attainable yet — label it
    // with its unlock level (🔒) instead of a misleading "relics 0/6" that reads
    // like it can be filled now.
    if (unlockLevel > Math.max(1, level)) {
      return boxRow(`${setName}  🔒 L${unlockLevel}`, width)
    }
    const allIds = cardIdsInSet(setName)
    const owned = allIds.filter((id) => ownedIds.has(id)).length
    const total = allIds.length
    // ✓ marks a fully-completed set (set-completion progress).
    const done = total > 0 && owned === total ? '  ✓' : ''
    return boxRow(`${setName}  ${owned}/${total}${done}`, width)
  })

  return [
    boxTop(width),
    boxTitle('COLLECTION', width),
    boxDivider(width),
    ...rows,
    boxBottom(width),
  ].join('\n')
}

function renderGear(state: GameState, width: number): string {
  let gearRows: string[]

  if (state.gear.length === 0) {
    gearRows = [boxRow('(no gear yet · merge a PR to drop some)', width)]
  } else {
    const protectedSet = new Set(state.protectedGear)
    gearRows = state.gear.map((g) => {
      const broken = g.broken ? '  BROKEN' : ''
      // ADR-0008: gear level confers a real workflow effect — show it inline.
      const effect = gearEffectText(g)
      const effectStr = effect ? ` · ${effect}` : ''
      // One-shot enhance protection armed via `sq protect`.
      const protectedStr = protectedSet.has(g.id) ? '  PROTECTED' : ''
      return boxRow(`${g.name} +${g.level}${broken}${protectedStr}${effectStr}`, width)
    })
  }

  return [
    boxTop(width),
    boxTitle('GEAR', width),
    boxDivider(width),
    ...gearRows,
    boxBottom(width),
  ].join('\n')
}

function renderQuests(state: GameState, width: number): string {
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
    return boxRow(`${glyph} ${def.title}`, width)
  })

  return [
    boxTop(width),
    boxTitle('QUESTS', width),
    boxDivider(width),
    ...rows,
    boxBottom(width),
  ].join('\n')
}

function renderBuffs(state: GameState, width: number): string {
  let buffRows: string[]

  if (state.buffs.length === 0) {
    buffRows = [boxRow('none', width)]
  } else {
    buffRows = state.buffs.map((b) => boxRow(b.label, width))
  }

  return [
    boxTop(width),
    boxTitle('BUFFS', width),
    boxDivider(width),
    ...buffRows,
    boxBottom(width),
  ].join('\n')
}

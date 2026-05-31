/**
 * format.ts — pure string-formatting renderers for Grove.
 *
 * No I/O, no filesystem access. Accepts GameState / Reward / RecapData and
 * returns display strings. Celebratory tone throughout; never shaming
 * (ADR-0005).
 */

import type { Reward } from '../core/rewards'
import type { GameState } from '../core/state'
import type { QuestDef } from '../core/quests'
import { prestigeRank, PRESTIGE_BUFF_ID } from '../engine/reduce'

// ---------------------------------------------------------------------------
// RecapData — view-model for the "what you shipped" recap block.
// Exported so the app layer can import it without depending on format internals.
// ---------------------------------------------------------------------------

export interface RecapData {
  /** Human-facing label for the time window, e.g. "last-hour" or "today" */
  window: string
  /** Total number of events processed in this window */
  total: number
  /** Count of events per event type */
  byType: Record<string, number>
  /** Current player level at time of recap */
  level: number
  /** Total cards in collection at time of recap */
  cards: number
  /** Ids of fully-completed card sets */
  completedSets: string[]
  /** Short celebratory highlight strings, e.g. "PR merged!", "New legendary card" */
  highlights: string[]
}

// ---------------------------------------------------------------------------
// Emoji map for each RewardKind (ADR-0005: celebratory, never shaming)
// ---------------------------------------------------------------------------

const KIND_EMOJI: Record<string, string> = {
  xp: '✨',
  card: '🃏',
  gear: '⚔️',
  currency: '🪙',
  buff: '🌿',
  levelup: '🆙',
}

// ---------------------------------------------------------------------------
// formatReward
// ---------------------------------------------------------------------------

/**
 * Return a single celebratory line for a Reward.
 * Always starts with the kind's emoji, always includes r.message.
 * When amount, card name/rarity, or gear info is present, it is appended
 * for extra context.
 */
export function formatReward(r: Reward): string {
  const emoji = KIND_EMOJI[r.kind] ?? '•'

  const extras: string[] = []

  // Currency messages already carry the amount + 🌰 (e.g. "+5 🌰 seeds",
  // "-30 🌰 · pull", "🎁 milestone chest · +15 🌰"). Re-appending "(5)" / "(-30)"
  // would double-print, so suppress the numeric suffix for currency only.
  if (r.amount !== undefined && r.kind !== 'currency') {
    extras.push(`(${r.amount})`)
  }

  // R6 P3: the engine's card message already embeds the card name (e.g.
  // "Sapling · common", "✦ Refactor Blade · legendary", "🛠 crafted · …"). Only
  // append "[name]" when the message does NOT already carry it — otherwise the
  // loot line double-prints the name ("🃏 Sapling · common [Sapling]").
  if (r.card && !r.message.includes(r.card.name)) {
    extras.push(`[${r.card.name}]`)
  }

  if (r.rarity && !r.card) {
    // rarity without card already embedded in message, but surface it explicitly
    extras.push(`(${r.rarity})`)
  }

  if (r.gear) {
    extras.push(`[${r.gear.name} +${r.gear.level}]`)
  }

  const suffix = extras.length > 0 ? ` ${extras.join(' ')}` : ''
  return `${emoji} ${r.message}${suffix}`
}

// ---------------------------------------------------------------------------
// formatStatus
// ---------------------------------------------------------------------------

/**
 * Return a multi-line summary block of the current GameState.
 * Mirrors the spirit of the FINAL SUMMARY in src/demo.ts.
 */
export function formatStatus(state: GameState): string {
  const { player, cards, completedSets, buffs, pity } = state

  // Rarity breakdown
  const byRarity = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.rarity] = (acc[c.rarity] ?? 0) + 1
    return acc
  }, {})

  const rarityLine =
    Object.entries(byRarity)
      .map(([r, n]) => `${r}×${n}`)
      .join(', ') || '(none)'

  const setsLine = completedSets.length ? completedSets.join(', ') : '(none yet)'

  // R7 STATUS PARITY (product P2): the plain scriptable surface must AGREE with the
  // dashboard — show Shards next to Currency + the prestige rank, and collapse the
  // per-rank prestige flair into a single ✦ Prestige ×N badge (not N entries).
  const rank = prestigeRank(state)
  const otherBuffs = buffs.filter((b) => !b.id.startsWith(PRESTIGE_BUFF_ID))
  const buffLabels = [
    ...(rank > 0 ? [`✦ Prestige ×${rank}`] : []),
    ...otherBuffs.map((b) => b.label),
  ]
  const buffsLine = buffLabels.length ? buffLabels.join(', ') : '(none)'

  // shards is optional on legacy states → read as 0 (never fabricate a number).
  const shards = player.shards ?? 0

  return [
    '─'.repeat(52),
    '  GROVE STATUS',
    '─'.repeat(52),
    `  Level .............. ${player.level}`,
    `  XP (into level) .... ${player.xp}`,
    `  Currency ........... ${player.currency}`,
    `  Shards ............. ${shards}`,
    `  Prestige rank ...... ${prestigeRank(state)}`,
    `  Cards collected .... ${cards.length}`,
    `  Card breakdown ..... ${rarityLine}`,
    `  Completed sets ..... ${setsLine}`,
    `  Active buffs ....... ${buffsLine}`,
    `  Pity (since leg.) .. ${pity.sinceLegendary}`,
    '─'.repeat(52),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// formatRecap
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// formatQuests
// ---------------------------------------------------------------------------

/**
 * Render the Pillar-B quest board.
 *
 * For each QuestDef in `quests` shows:
 *  - a status glyph derived from state.quests (✓ done / ◆ active / · not yet)
 *  - the quest title
 *  - the quest description
 *
 * Also lists active buffs (auras / freshness / multipliers).
 */
export function formatQuests(quests: QuestDef[], state: GameState): string {
  const questLines = quests.map((def) => {
    const progress = state.quests.find((q) => q.id === def.id)
    let glyph: string
    if (progress?.status === 'done') {
      glyph = '✓'
    } else if (progress?.status === 'active') {
      glyph = '◆'
    } else {
      glyph = '·'
    }
    return `  ${glyph} ${def.title}\n      ${def.description}`
  })

  const buffsLine =
    state.buffs.length > 0
      ? state.buffs.map((b) => `    ${b.label}${b.kind ? ` (${b.kind})` : ''}`).join('\n')
      : '    (none)'

  return [
    '─'.repeat(52),
    '  QUEST BOARD',
    '─'.repeat(52),
    ...questLines,
    '─'.repeat(52),
    '  Active Buffs:',
    buffsLine,
    '─'.repeat(52),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// formatRecap
// ---------------------------------------------------------------------------

/**
 * Return a readable 'what you shipped' recap block from a RecapData snapshot.
 * Includes the window label, total events, per-type counts, highlights, and
 * current level/cards.
 */
export function formatRecap(recap: RecapData): string {
  const { window, total, byType, level, cards, completedSets, highlights } = recap

  const typeLines =
    Object.entries(byType).length > 0
      ? Object.entries(byType)
          .map(([type, count]) => `    ${type}: ${count}`)
          .join('\n')
      : '    (no events)'

  const setsLine = completedSets.length ? completedSets.join(', ') : '(none)'

  const highlightLines =
    highlights.length > 0
      ? highlights.map((h) => `  ✦ ${h}`).join('\n')
      : '  (no highlights)'

  return [
    '─'.repeat(52),
    `  RECAP — ${window}`,
    '─'.repeat(52),
    `  Total events ....... ${total}`,
    '',
    '  By type:',
    typeLines,
    '',
    `  Level .............. ${level}`,
    `  Cards collected .... ${cards}`,
    `  Completed sets ..... ${setsLine}`,
    '',
    '  Highlights:',
    highlightLines,
    '─'.repeat(52),
  ].join('\n')
}

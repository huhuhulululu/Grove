/**
 * format.ts — pure string-formatting renderers for Grove.
 *
 * No I/O, no filesystem access. Accepts GameState / Reward / RecapData and
 * returns display strings. Celebratory tone throughout; never shaming
 * (ADR-0005).
 */

import type { Reward } from '../core/rewards'
import type { GameState } from '../core/state'
import { docStreakSuffix, type QuestDef } from '../core/quests'
import { prestigeRank, PRESTIGE_BUFF_ID } from '../engine/reduce'
import type { Locale } from '../i18n/types'
import { t } from '../i18n/t'
import { sparkline } from './sparkline'

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
  /** Optional 7-day outcome counts (index 0 = 6 days ago … 6 = today) for a calm,
   *  read-only sparkline. Present only when buildRecap got an injected clock. */
  weekSparkValues?: number[]
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
 * Always starts with the kind's emoji, always includes r.message (or its
 * locale-translated equivalent when msgKey is present).
 * When amount, card name/rarity, or gear info is present, it is appended
 * for extra context.
 */
export function formatReward(r: Reward, locale: Locale = 'en'): string {
  const emoji = KIND_EMOJI[r.kind] ?? '•'

  // Use the locale-translated message when available; fall back to the
  // English message field so existing callers (no msgKey) continue to work.
  const message = r.msgKey ? t(locale, r.msgKey, r.msgArgs) : r.message

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
  if (r.card && !message.includes(r.card.name)) {
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
  return `${emoji} ${message}${suffix}`
}

// ---------------------------------------------------------------------------
// formatStatus
// ---------------------------------------------------------------------------

/**
 * Return a multi-line summary block of the current GameState.
 * Mirrors the spirit of the FINAL SUMMARY in src/demo.ts.
 */
export function formatStatus(state: GameState, locale: Locale = 'en'): string {
  const { player, cards, completedSets, buffs, pity } = state

  // Rarity breakdown
  const byRarity = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.rarity] = (acc[c.rarity] ?? 0) + 1
    return acc
  }, {})

  const rarityLine =
    Object.entries(byRarity)
      .map(([r, n]) => `${r}×${n}`)
      .join(', ') || t(locale, 'ui.status.none')

  const setsLine = completedSets.length ? completedSets.join(', ') : t(locale, 'ui.status.none_yet')

  // R7 STATUS PARITY (product P2): the plain scriptable surface must AGREE with the
  // dashboard — show Shards next to Currency + the prestige rank, and collapse the
  // per-rank prestige flair into a single ✦ Prestige ×N badge (not N entries).
  const rank = prestigeRank(state)
  const otherBuffs = buffs.filter((b) => !b.id.startsWith(PRESTIGE_BUFF_ID))
  const buffLabels = [
    ...(rank > 0 ? [t(locale, 'ui.status.prestige_badge', { rank })] : []),
    ...otherBuffs.map((b) => (b.msgKey ? t(locale, b.msgKey, b.msgArgs) : b.label)),
  ]
  const buffsLine = buffLabels.length ? buffLabels.join(', ') : t(locale, 'ui.status.none')

  // shards is optional on legacy states → read as 0 (never fabricate a number).
  const shards = player.shards ?? 0

  return [
    '─'.repeat(52),
    t(locale, 'ui.status.title'),
    '─'.repeat(52),
    t(locale, 'ui.status.level', { level: player.level }),
    t(locale, 'ui.status.xp', { xp: player.xp }),
    t(locale, 'ui.status.currency', { currency: player.currency }),
    t(locale, 'ui.status.shards', { shards }),
    t(locale, 'ui.status.prestige', { rank: prestigeRank(state) }),
    t(locale, 'ui.status.cards', { cards: cards.length }),
    t(locale, 'ui.status.breakdown', { breakdown: rarityLine }),
    t(locale, 'ui.status.sets', { sets: setsLine }),
    t(locale, 'ui.status.buffs', { buffs: buffsLine }),
    t(locale, 'ui.status.pity', { pity: pity.sinceLegendary }),
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
 *  - the quest title (translated via quest.<id>.title)
 *  - the quest description (translated via quest.<id>.desc)
 *
 * Also lists active buffs (auras / freshness / multipliers).
 */
export function formatQuests(quests: QuestDef[], state: GameState, locale: Locale = 'en'): string {
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
    // Translate title/desc via i18n keys; fall back to def fields for callers
    // that pass custom QuestDef objects without matching catalog keys.
    const title = t(locale, `quest.${def.id}.title`) !== `quest.${def.id}.title`
      ? t(locale, `quest.${def.id}.title`)
      : def.title
    const desc = t(locale, `quest.${def.id}.desc`) !== `quest.${def.id}.desc`
      ? t(locale, `quest.${def.id}.desc`)
      : def.description
    const streak = def.id === 'doc-streak' ? docStreakSuffix(progress?.completions ?? 0, locale) : ''
    return `  ${glyph} ${title}${streak}\n      ${desc}`
  })

  const buffsLine =
    state.buffs.length > 0
      ? state.buffs.map((b) => `    ${b.msgKey ? t(locale, b.msgKey, b.msgArgs) : b.label}${b.kind ? ` (${b.kind})` : ''}`).join('\n')
      : t(locale, 'ui.quests.none')

  return [
    '─'.repeat(52),
    t(locale, 'ui.quests.title'),
    '─'.repeat(52),
    ...questLines,
    '─'.repeat(52),
    t(locale, 'ui.quests.active_buffs'),
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
export function formatRecap(recap: RecapData, locale: Locale = 'en'): string {
  const { window, total, byType, level, cards, completedSets, highlights } = recap

  // Read-only 7-day outcome sparkline (a calm reflection). Empty/quiet week → '' → the
  // line is omitted entirely (no FOMO, no shaming flat row).
  const spark = recap.weekSparkValues ? sparkline(recap.weekSparkValues) : ''

  const typeLines =
    Object.entries(byType).length > 0
      ? Object.entries(byType)
          .map(([type, count]) => `    ${type}: ${count}`)
          .join('\n')
      : t(locale, 'ui.recap.no_events')

  const setsLine = completedSets.length ? completedSets.join(', ') : t(locale, 'ui.status.none')

  const highlightLines =
    highlights.length > 0
      ? highlights.map((h) => `  ✦ ${h}`).join('\n')
      : t(locale, 'ui.recap.no_highlights')

  return [
    '─'.repeat(52),
    t(locale, 'ui.recap.title', { window }),
    '─'.repeat(52),
    t(locale, 'ui.recap.total', { total }),
    '',
    t(locale, 'ui.recap.by_type'),
    typeLines,
    '',
    t(locale, 'ui.recap.level', { level }),
    t(locale, 'ui.recap.cards', { cards }),
    t(locale, 'ui.recap.sets', { sets: setsLine }),
    '',
    t(locale, 'ui.recap.highlights'),
    highlightLines,
    ...(spark !== '' ? [t(locale, 'ui.recap.week', { spark })] : []),
    '─'.repeat(52),
  ].join('\n')
}

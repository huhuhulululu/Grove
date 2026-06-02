/**
 * share.test.ts — TDD for renderShareCard + renderReadmeBadge (M6 social, ADR-0011).
 *
 * Tests: RED first, then implementation makes them GREEN.
 * Privacy-safe: no repo/path/cost in output. Pure strings.
 * Tone: terse, emoji OK, no deny-list phrases (ADR-0009 / docs/TONE.md).
 */

import { describe, it, expect } from 'vitest'
import { renderShareCard, renderReadmeBadge } from './share'
import { initialState } from '../core/state'
import { ALL_CARD_DEFS } from '../core/cards'
import type { GameState } from '../core/state'
import type { Rarity } from '../core/rewards'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stateAt(overrides: Partial<GameState['player']> & {
  cards?: GameState['cards']
  completedSets?: string[]
  buffs?: GameState['buffs']
}): GameState {
  const base = initialState()
  return {
    ...base,
    player: {
      ...base.player,
      ...(overrides.xp !== undefined ? { xp: overrides.xp } : {}),
      ...(overrides.level !== undefined ? { level: overrides.level } : {}),
      ...(overrides.currency !== undefined ? { currency: overrides.currency } : {}),
      ...(overrides.shards !== undefined ? { shards: overrides.shards } : {}),
    },
    cards: overrides.cards ?? base.cards,
    completedSets: overrides.completedSets ?? base.completedSets,
    buffs: overrides.buffs ?? base.buffs,
  }
}

const TOTAL_CARDS = ALL_CARD_DEFS.length // derive — never drift when a card set is added

function makeCards(count: number, rarity: Rarity = 'common'): GameState['cards'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `test.card-${i}`,
    name: `Card ${i}`,
    rarity,
    set: 'forest',
  }))
}

// ---------------------------------------------------------------------------
// renderShareCard — functional content
// ---------------------------------------------------------------------------

describe('renderShareCard — level + collection', () => {
  it('includes the player level', () => {
    const state = stateAt({ level: 7 })
    const card = renderShareCard(state)
    expect(card).toContain('7')
  })

  it('includes collection count as owned/total', () => {
    const state = stateAt({ level: 3, cards: makeCards(5) })
    const card = renderShareCard(state)
    // 5 cards owned out of 33 total
    expect(card).toContain('5')
    expect(card).toContain(String(TOTAL_CARDS))
  })

  it('includes collection percentage', () => {
    // 33/33 = 100%
    const fullCards = makeCards(TOTAL_CARDS)
    const state = stateAt({ level: 10, cards: fullCards })
    const card = renderShareCard(state)
    expect(card).toMatch(/100\s*%/)
  })

  it('includes a non-empty flex line', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state)
    const lines = card.split('\n').filter((l) => l.trim().length > 0)
    // at least 3 lines: headline/level line, collection line, flex line
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })
})

describe('renderShareCard — prestige rank', () => {
  it('includes prestige rank when > 0', () => {
    const state = stateAt({
      level: 8,
      buffs: [{ id: 'prestige:mark', label: 'Prestige I', kind: 'rest' }],
    })
    const card = renderShareCard(state)
    // prestige rank is 1
    expect(card).toMatch(/prestige|✦/i)
  })

  it('omits prestige line gracefully when rank is 0', () => {
    const state = stateAt({ level: 2 })
    const card = renderShareCard(state)
    // should still have level + collection, not throw
    expect(card).toContain('2')
  })
})

describe('renderShareCard — recent rarity opt', () => {
  it('highlights a legendary in the flex line', () => {
    const state = stateAt({ level: 4 })
    const card = renderShareCard(state, { recentRarity: 'legendary' })
    expect(card).toMatch(/legendary/i)
  })

  it('highlights a shiny in the flex line', () => {
    const state = stateAt({ level: 6 })
    const card = renderShareCard(state, { recentRarity: 'shiny' })
    expect(card).toMatch(/shiny/i)
  })

  it('works without recentRarity (default path)', () => {
    const state = stateAt({ level: 3 })
    expect(() => renderShareCard(state)).not.toThrow()
    expect(renderShareCard(state)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// renderShareCard — privacy + tone
// ---------------------------------------------------------------------------

describe('renderShareCard — privacy: no repo/path/cost leakage', () => {
  it('does not contain any filesystem path-like string', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state)
    // no absolute path fragments
    expect(card).not.toMatch(/\/home\/|\/usr\/|\/var\/|C:\\/)
    // no cwd-like relative paths
    expect(card).not.toMatch(/\.\.\//)
  })

  it('does not mention cost or token counts', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state)
    expect(card.toLowerCase()).not.toContain('cost')
    expect(card.toLowerCase()).not.toContain('token')
    expect(card.toLowerCase()).not.toContain('usd')
    expect(card.toLowerCase()).not.toContain('$')
  })

  it('does not mention repo or cwd', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state)
    expect(card.toLowerCase()).not.toContain('repo')
    expect(card.toLowerCase()).not.toContain('cwd')
  })
})

describe('renderShareCard — TONE.md deny-list compliance', () => {
  const DENY_LIST = [
    'the grove cheers',
    'canopy shimmers',
    'holds its breath',
    'carry it lightly',
    'future-you sends thanks',
    'sprout appears',
    'rare bloom unfurls',
    'light pours through the leaves',
    'sturdy roots',
    'tidy branches',
    'clear path through the woods',
    'trail is mapped',
    'bough unfurls',
    'forged stronger',
    'natural breath point',
    'code freely',
    'onward!',
    'seedling joins',
  ]

  it('contains no deny-list phrase', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state, { recentRarity: 'legendary' }).toLowerCase()
    const found = DENY_LIST.filter((p) => card.includes(p))
    expect(found, `deny-list hit(s): ${found.join(', ')}`).toEqual([])
  })

  it('does not use em-dash', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state)
    expect(card).not.toContain('—') // —
  })
})

describe('renderShareCard — identity/achievement framing', () => {
  it('is copy-pasteable: contains no ANSI escape codes', () => {
    const state = stateAt({ level: 5 })
    const card = renderShareCard(state)
    // eslint-disable-next-line no-control-regex
    expect(card).not.toMatch(/\x1b\[/)
  })

  it('returns a non-empty string', () => {
    expect(renderShareCard(initialState())).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// renderReadmeBadge
// ---------------------------------------------------------------------------

describe('renderReadmeBadge — markdown badge', () => {
  it('is valid markdown image syntax', () => {
    const state = stateAt({ level: 3 })
    const badge = renderReadmeBadge(state)
    // ![...](url)
    expect(badge).toMatch(/^!\[.*\]\(.*\)/)
  })

  it('includes the player level in the badge', () => {
    const state = stateAt({ level: 12 })
    const badge = renderReadmeBadge(state)
    expect(badge).toContain('12')
  })

  it('uses a shields.io static badge URL', () => {
    const state = stateAt({ level: 5 })
    const badge = renderReadmeBadge(state)
    expect(badge).toContain('shields.io')
  })

  it('does not contain filesystem paths or cost info', () => {
    const state = stateAt({ level: 5 })
    const badge = renderReadmeBadge(state)
    expect(badge).not.toMatch(/\/home\/|\/usr\//)
    expect(badge.toLowerCase()).not.toContain('cost')
  })

  it('returns a single line (no trailing newline mid-string)', () => {
    const state = stateAt({ level: 5 })
    const badge = renderReadmeBadge(state)
    // single-line badge
    expect(badge.trim().split('\n')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// zh-CN locale rendering
// ---------------------------------------------------------------------------

describe('renderShareCard — zh-CN locale', () => {
  it('renders zh-CN cards line', () => {
    const state = stateAt({ level: 3, cards: makeCards(5) })
    const card = renderShareCard(state, { locale: 'zh-CN' })
    expect(card).toContain('卡牌')
    expect(card).toContain('5')
  })

  it('renders zh-CN prestige line when rank > 0', () => {
    const state = stateAt({
      level: 8,
      buffs: [{ id: 'prestige:mark', label: 'Prestige I', kind: 'rest' }],
    })
    const card = renderShareCard(state, { locale: 'zh-CN' })
    expect(card).toContain('威望')
  })

  it('renders zh-CN legendary flex line', () => {
    const state = stateAt({ level: 4 })
    const card = renderShareCard(state, { locale: 'zh-CN', recentRarity: 'legendary' })
    expect(card).toContain('传说')
  })

  it('renders zh-CN groove flex line for low-level player', () => {
    const state = stateAt({ level: 3 })
    const card = renderShareCard(state, { locale: 'zh-CN' })
    expect(card).toContain('渐入佳境')
  })

  it('still includes the level number', () => {
    const state = stateAt({ level: 7 })
    const card = renderShareCard(state, { locale: 'zh-CN' })
    expect(card).toContain('7')
  })
})

describe('renderShareCard — completed-set roster (R3 share-roster)', () => {
  it('omits the roster line entirely when no set is complete (neutral-empty)', () => {
    const card = renderShareCard(stateAt({ level: 3, completedSets: [] }))
    expect(card).not.toContain('🎖')
    expect(card).not.toMatch(/sets/i)
  })

  it('lists completed sets under the cap with no "+more" tail', () => {
    const card = renderShareCard(stateAt({ level: 5, completedSets: ['tools', 'relics'] }))
    expect(card).toContain('tools')
    expect(card).toContain('relics')
    expect(card).not.toMatch(/\+\s*\d+\s*more/)
    expect(card).not.toContain('[') // plain text, zero ANSI
  })

  it('caps the roster at ROSTER_CAP and shows a "+k more" tail', () => {
    const card = renderShareCard(
      stateAt({ level: 8, completedSets: ['tools', 'relics', 'rituals', 'glyphs', 'wards'] }),
    )
    expect(card).toContain('tools')
    expect(card).toContain('rituals') // 3rd id shown
    expect(card).not.toContain('glyphs') // 4th id capped out
    expect(card).toContain('+2 more')
  })
})

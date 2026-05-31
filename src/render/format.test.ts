/**
 * Tests for src/render/format.ts
 * TDD: write RED first, then implement to GREEN.
 */

import { describe, it, expect } from 'vitest'
import { formatReward, formatStatus, formatRecap, formatQuests } from './format'
import type { RecapData } from './format'
import type { Reward } from '../core/rewards'
import type { GameState, QuestProgress } from '../core/state'
import type { QuestDef } from '../core/quests'
import { QUESTS } from '../core/quests'

// ---------------------------------------------------------------------------
// Helpers to build minimal test fixtures
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    player: { xp: 120, level: 3, currency: 50 },
    cards: [
      { id: 'c1', name: 'Oak Sprite', rarity: 'common', set: 'forest' },
      { id: 'c2', name: 'Pine Wisp', rarity: 'rare', set: 'forest' },
      { id: 'c3', name: 'Storm Raven', rarity: 'legendary', set: 'sky' },
    ],
    gear: [],
    pity: { sinceLegendary: 0 },
    completedSets: ['forest'],
    buffs: [{ id: 'refreshed', label: 'Refreshed' }],
    eventCount: 0,
    quests: [],
    energy: { known: false, vigor: 100, sap: 100 },
    work: { workMeter: 0, lastCostUsd: 0, windowKey: 0, milestonesInWindow: 0 },
    protectedGear: [],
    ...overrides,
  }
}

function makeRecap(overrides: Partial<RecapData> = {}): RecapData {
  return {
    window: 'last-hour',
    total: 7,
    byType: { commit: 3, test_result: 2, lint_clean: 2 },
    level: 3,
    cards: 5,
    completedSets: ['forest'],
    highlights: ['PR merged!', 'New legendary card'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// formatReward
// ---------------------------------------------------------------------------

describe('formatReward', () => {
  it('includes the message for an xp reward', () => {
    const r: Reward = { kind: 'xp', amount: 40, message: '+40 XP — Nice commit.' }
    const result = formatReward(r)
    expect(result).toContain('+40 XP — Nice commit.')
  })

  it('includes the xp emoji ✨ for kind=xp', () => {
    const r: Reward = { kind: 'xp', amount: 10, message: '+10 XP' }
    expect(formatReward(r)).toContain('✨')
  })

  it('includes the card emoji 🃏 for kind=card', () => {
    const r: Reward = {
      kind: 'card',
      card: { id: 'c1', name: 'Oak Sprite', rarity: 'rare', set: 'forest' },
      rarity: 'rare',
      message: 'Oak Sprite (rare) — A rare bloom.',
    }
    const result = formatReward(r)
    expect(result).toContain('🃏')
    expect(result).toContain('Oak Sprite (rare) — A rare bloom.')
  })

  it('includes the gear emoji ⚔️ for kind=gear', () => {
    const r: Reward = { kind: 'gear', message: 'Bronze Axe dropped.' }
    const result = formatReward(r)
    expect(result).toContain('⚔️')
    expect(result).toContain('Bronze Axe dropped.')
  })

  it('includes the currency emoji 🪙 for kind=currency', () => {
    const r: Reward = { kind: 'currency', amount: 5, message: '+5 seeds' }
    const result = formatReward(r)
    expect(result).toContain('🪙')
    expect(result).toContain('+5 seeds')
  })

  it('includes the buff emoji 🌿 for kind=buff', () => {
    const r: Reward = { kind: 'buff', buff: 'refreshed', message: 'Buff gained: Refreshed.' }
    const result = formatReward(r)
    expect(result).toContain('🌿')
    expect(result).toContain('Buff gained: Refreshed.')
  })

  it('includes the levelup emoji 🆙 for kind=levelup', () => {
    const r: Reward = { kind: 'levelup', amount: 4, message: 'Level up! You reached level 4.' }
    const result = formatReward(r)
    expect(result).toContain('🆙')
    expect(result).toContain('Level up! You reached level 4.')
  })

  it('includes amount when present', () => {
    const r: Reward = { kind: 'xp', amount: 99, message: '+99 XP' }
    expect(formatReward(r)).toContain('99')
  })

  it('includes card name when card is present', () => {
    const r: Reward = {
      kind: 'card',
      card: { id: 'c2', name: 'Storm Raven', rarity: 'legendary', set: 'sky' },
      rarity: 'legendary',
      message: 'Storm Raven (legendary)',
    }
    expect(formatReward(r)).toContain('Storm Raven')
  })

  it('includes rarity when present without card (rarity-only branch)', () => {
    // rarity set but no card object — surfaces the rarity as an extra
    const r: Reward = {
      kind: 'currency',
      rarity: 'rare',
      amount: 10,
      message: '+10 seeds (rare boost)',
    }
    const result = formatReward(r)
    expect(result).toContain('rare')
  })

  it('includes gear name and level when gear is present', () => {
    const r: Reward = {
      kind: 'gear',
      gear: { id: 'g1', name: 'Bronze Axe', level: 3, rarity: 'uncommon', broken: false },
      message: 'Bronze Axe dropped.',
    }
    const result = formatReward(r)
    expect(result).toContain('Bronze Axe')
    expect(result).toContain('+3')
  })

  // ---- currency cleanliness (R3): no redundant numeric suffix ---------------

  it('does NOT append a redundant numeric suffix for a currency reward (message carries it)', () => {
    // The engine's currency message already includes the amount + 🌰, so the
    // renderer must NOT also tack on "(5)" — that would be noisy double-printing.
    const r: Reward = { kind: 'currency', amount: 5, message: '+5 🌰 seeds · commit' }
    const result = formatReward(r)
    expect(result).toContain('+5 🌰 seeds · commit')
    expect(result).not.toContain('(5)')
  })

  it('renders a negative currency (a pull spend) without a parenthesised "(-30)"', () => {
    const r: Reward = { kind: 'currency', amount: -30, message: '-30 🌰 · pull' }
    const result = formatReward(r)
    expect(result).toContain('-30 🌰 · pull')
    expect(result).not.toContain('(-30)')
  })

  it('renders a milestone-chest currency reward terse (🎁 line)', () => {
    const r: Reward = { kind: 'currency', amount: 15, message: '🎁 milestone chest · +15 🌰 (work tracked)' }
    const result = formatReward(r)
    expect(result).toContain('🎁 milestone chest')
    expect(result).toContain('+15 🌰')
    expect(result).not.toContain('(15)')
  })

  it('renders a serendipity windfall currency reward terse (✨ 奇遇 line)', () => {
    const r: Reward = { kind: 'currency', amount: 25, message: '✨ 奇遇 — +25 🌰 windfall' }
    const result = formatReward(r)
    expect(result).toContain('✨ 奇遇')
    expect(result).toContain('+25 🌰')
    expect(result).not.toContain('(25)')
  })

  it('still appends the numeric suffix for a non-currency reward (e.g. xp)', () => {
    // Only currency suppresses the suffix; xp/levelup keep the (amount) extra.
    const r: Reward = { kind: 'levelup', amount: 4, message: 'Level 4' }
    const result = formatReward(r)
    expect(result).toContain('(4)')
  })

  // ---- card-name double-print (R6 P3) ---------------------------------------

  it('does NOT print the card name twice when the message already carries it', () => {
    // The engine's card message embeds the name (e.g. "Sapling · common"), so the
    // renderer must NOT also append "[Sapling]" — that doubles the name.
    const r: Reward = {
      kind: 'card',
      card: { id: 'forest.sapling', name: 'Sapling', rarity: 'common', set: 'forest' },
      rarity: 'common',
      message: 'Sapling · common',
    }
    const result = formatReward(r)
    expect(result).toContain('Sapling') // present once
    // The trailing "[Sapling]" suffix must be gone — name appears exactly once.
    expect(result).not.toContain('[Sapling]')
    expect(result.split('Sapling').length - 1).toBe(1)
  })

  it('still appends [name] when the message does NOT already contain the card name', () => {
    // Defensive: a card reward whose message omits the name still surfaces it,
    // so no drop is ever nameless.
    const r: Reward = {
      kind: 'card',
      card: { id: 'forest.oak', name: 'Oak', rarity: 'uncommon', set: 'forest' },
      rarity: 'uncommon',
      message: '🛠 crafted · uncommon',
    }
    const result = formatReward(r)
    expect(result).toContain('Oak')
    expect(result).toContain('[Oak]')
  })

  it('does not double-print a marked legendary card line (✦ Name · legendary)', () => {
    const r: Reward = {
      kind: 'card',
      card: { id: 'tools.refactor-blade', name: 'Refactor Blade', rarity: 'legendary', set: 'tools' },
      rarity: 'legendary',
      message: '✦ Refactor Blade · legendary',
    }
    const result = formatReward(r)
    expect(result.split('Refactor Blade').length - 1).toBe(1)
    expect(result).not.toContain('[Refactor Blade]')
  })
})

// ---------------------------------------------------------------------------
// formatStatus
// ---------------------------------------------------------------------------

describe('formatStatus', () => {
  it('includes the level number', () => {
    const state = makeState({ player: { xp: 50, level: 5, currency: 10 } })
    expect(formatStatus(state)).toContain('5')
  })

  it('includes the card count', () => {
    const state = makeState()
    // state has 3 cards
    expect(formatStatus(state)).toContain('3')
  })

  it('includes XP info', () => {
    const state = makeState({ player: { xp: 120, level: 3, currency: 50 } })
    expect(formatStatus(state)).toContain('120')
  })

  it('shows card rarity breakdown', () => {
    const state = makeState()
    // has common, rare, legendary
    const result = formatStatus(state)
    expect(result).toContain('common')
    expect(result).toContain('rare')
    expect(result).toContain('legendary')
  })

  it('shows completed sets', () => {
    const state = makeState()
    expect(formatStatus(state)).toContain('forest')
  })

  it('shows active buffs', () => {
    const state = makeState()
    expect(formatStatus(state)).toContain('Refreshed')
  })

  it('shows (none) when no buffs', () => {
    const state = makeState({ buffs: [] })
    const result = formatStatus(state)
    expect(result.toLowerCase()).toContain('none')
  })

  it('shows (none yet) or equivalent when no completed sets', () => {
    const state = makeState({ completedSets: [] })
    const result = formatStatus(state)
    expect(result.toLowerCase()).toContain('none')
  })

  it('is a multi-line string', () => {
    const state = makeState()
    expect(formatStatus(state)).toContain('\n')
  })

  // R7 STATUS PARITY (product P2): the plain scriptable `sq status` surface must
  // agree with the dashboard — show a Shards line next to Currency + the prestige rank.
  it('shows a Shards line with the player.shards balance', () => {
    const state = makeState({ player: { xp: 0, level: 1, currency: 50, shards: 17 } })
    const result = formatStatus(state)
    const shardsLine = result.split('\n').find((l) => l.toLowerCase().includes('shard'))
    expect(shardsLine).toBeDefined()
    expect(shardsLine).toContain('17')
  })

  it('treats a legacy state with undefined shards as 0 shards', () => {
    const state = makeState({ player: { xp: 0, level: 1, currency: 50 } }) // no shards
    const result = formatStatus(state)
    const shardsLine = result.split('\n').find((l) => l.toLowerCase().includes('shard'))
    expect(shardsLine).toBeDefined()
    expect(shardsLine).toMatch(/\b0\b/)
  })

  it('shows the prestige rank', () => {
    const state = makeState({
      buffs: [
        { id: 'prestige:mark', label: 'Prestige 1', kind: 'rest' },
        { id: 'prestige:mark:2', label: 'Prestige 2', kind: 'rest' },
      ],
    })
    const result = formatStatus(state)
    const line = result.split('\n').find((l) => /prestige/i.test(l))
    expect(line).toBeDefined()
    // rank 2 (two prestige buffs).
    expect(line).toContain('2')
  })

  it('shows prestige rank 0 when no prestige buffs are owned', () => {
    const state = makeState({ buffs: [] })
    const result = formatStatus(state)
    const line = result.split('\n').find((l) => /prestige/i.test(l))
    expect(line).toBeDefined()
    expect(line).toMatch(/\b0\b/)
  })

  it('rolls up the per-rank prestige buffs into a single ×N badge in Active buffs', () => {
    const state = makeState({
      buffs: [
        { id: 'prestige:mark', label: 'Prestige 1', kind: 'rest' },
        { id: 'prestige:mark:2', label: 'Prestige 2', kind: 'rest' },
        { id: 'prestige:mark:3', label: 'Prestige 3', kind: 'rest' },
        { id: 'multiplier-2x', label: 'Double XP', kind: 'multiplier' },
      ],
    })
    const result = formatStatus(state)
    const buffsLine = result.split('\n').find((l) => l.includes('Active buffs'))
    expect(buffsLine).toBeDefined()
    // ONE rollup badge with the count, plus the non-prestige buff…
    expect(buffsLine).toContain('✦ Prestige ×3')
    expect(buffsLine).toContain('Double XP')
    // …and NOT three separate "Prestige 1/2/3" entries on the buffs line.
    expect(buffsLine).not.toMatch(/Prestige 1\b/)
    expect(buffsLine).not.toMatch(/Prestige 2\b/)
  })
})

// ---------------------------------------------------------------------------
// formatRecap
// ---------------------------------------------------------------------------

describe('formatRecap', () => {
  it('includes the window label', () => {
    const recap = makeRecap({ window: 'last-hour' })
    expect(formatRecap(recap)).toContain('last-hour')
  })

  it('includes the total event count', () => {
    const recap = makeRecap({ total: 7 })
    expect(formatRecap(recap)).toContain('7')
  })

  it('includes at least one byType entry', () => {
    const recap = makeRecap({ byType: { commit: 3, test_result: 2 } })
    const result = formatRecap(recap)
    expect(result).toContain('commit')
    expect(result).toContain('3')
  })

  it('includes all byType entries', () => {
    const recap = makeRecap({ byType: { commit: 3, test_result: 2, lint_clean: 2 } })
    const result = formatRecap(recap)
    expect(result).toContain('commit')
    expect(result).toContain('test_result')
    expect(result).toContain('lint_clean')
  })

  it('includes the current level', () => {
    const recap = makeRecap({ level: 3 })
    expect(formatRecap(recap)).toContain('3')
  })

  it('includes the card count', () => {
    const recap = makeRecap({ cards: 5 })
    expect(formatRecap(recap)).toContain('5')
  })

  it('includes highlights when present', () => {
    const recap = makeRecap({ highlights: ['PR merged!', 'New legendary card'] })
    const result = formatRecap(recap)
    expect(result).toContain('PR merged!')
    expect(result).toContain('New legendary card')
  })

  it('shows completed sets in recap', () => {
    const recap = makeRecap({ completedSets: ['forest', 'sky'] })
    const result = formatRecap(recap)
    expect(result).toContain('forest')
  })

  it('is a multi-line string', () => {
    const recap = makeRecap()
    expect(formatRecap(recap)).toContain('\n')
  })

  it('handles empty highlights gracefully', () => {
    const recap = makeRecap({ highlights: [] })
    // Should not throw, should still be a string
    expect(() => formatRecap(recap)).not.toThrow()
    expect(typeof formatRecap(recap)).toBe('string')
  })

  it('handles empty byType gracefully', () => {
    const recap = makeRecap({ byType: {} })
    expect(() => formatRecap(recap)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// formatQuests
// ---------------------------------------------------------------------------

describe('formatQuests', () => {
  function makeQuestProgress(id: string, status: 'active' | 'done'): QuestProgress {
    return { id, status, completions: status === 'done' ? 1 : 0 }
  }

  it('includes each quest title from QUESTS', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state)
    for (const q of QUESTS) {
      expect(result).toContain(q.title)
    }
  })

  it('shows done glyph ✓ for a completed quest', () => {
    const state = makeState({ quests: [makeQuestProgress('grimoire', 'done')] })
    const result = formatQuests(QUESTS, state)
    expect(result).toContain('✓')
  })

  it('shows active glyph ◆ for an active quest', () => {
    const state = makeState({ quests: [makeQuestProgress('grimoire', 'active')] })
    const result = formatQuests(QUESTS, state)
    expect(result).toContain('◆')
  })

  it('shows not-started glyph · for a quest not in progress', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state)
    expect(result).toContain('·')
  })

  it('includes each quest description', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state)
    for (const q of QUESTS) {
      expect(result).toContain(q.description)
    }
  })

  it('lists active buffs section', () => {
    const state = makeState({
      quests: [],
      buffs: [{ id: 'aura:grimoire', label: 'Grimoire Aura', kind: 'aura' }],
    })
    const result = formatQuests(QUESTS, state)
    expect(result.toLowerCase()).toMatch(/buff|aura/)
    expect(result).toContain('Grimoire Aura')
  })

  it('shows no-buffs message when buffs array is empty', () => {
    const state = makeState({ quests: [], buffs: [] })
    const result = formatQuests(QUESTS, state)
    // Should mention "no buffs" or "none" in some form
    expect(result.toLowerCase()).toMatch(/none|no buff/)
  })

  it('is a multi-line string', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state)
    expect(result).toContain('\n')
  })

  it('marks the grimoire quest done when state has grimoire done', () => {
    const state = makeState({ quests: [makeQuestProgress('grimoire', 'done')] })
    const result = formatQuests(QUESTS, state)
    // The grimoire quest title line must have the done glyph
    const lines = result.split('\n')
    const grimoireLine = lines.find((l) => l.includes('Write the CLAUDE.md'))
    expect(grimoireLine).toBeDefined()
    expect(grimoireLine).toContain('✓')
  })

  it('renders every quest in the QUESTS catalog (whatever its size)', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state)
    // Count-agnostic: the catalog grows over time (R5 added more quests), so
    // assert it is non-empty and that EACH quest's title is rendered.
    expect(QUESTS.length).toBeGreaterThanOrEqual(4)
    for (const q of QUESTS) {
      expect(result).toContain(q.title)
    }
  })
})

// ---------------------------------------------------------------------------
// zh-CN locale rendering
// ---------------------------------------------------------------------------

describe('zh-CN locale — formatStatus', () => {
  it('renders the zh-CN status title', () => {
    const state = makeState()
    const result = formatStatus(state, 'zh-CN')
    expect(result).toContain('GROVE 状态')
  })

  it('renders zh-CN none-yet for empty completed sets', () => {
    const state = makeState({ completedSets: [] })
    const result = formatStatus(state, 'zh-CN')
    expect(result).toContain('尚无')
  })

  it('renders zh-CN prestige badge', () => {
    const state = makeState({
      buffs: [
        { id: 'prestige:mark', label: 'Prestige 1', kind: 'rest' },
        { id: 'prestige:mark:2', label: 'Prestige 2', kind: 'rest' },
      ],
    })
    const result = formatStatus(state, 'zh-CN')
    expect(result).toContain('威望 ×2')
  })
})

describe('zh-CN locale — formatRecap', () => {
  it('renders zh-CN recap title', () => {
    const recap = makeRecap({ window: 'last-hour' })
    const result = formatRecap(recap, 'zh-CN')
    expect(result).toContain('回顾')
    expect(result).toContain('last-hour')
  })

  it('renders zh-CN no-events placeholder', () => {
    const recap = makeRecap({ byType: {} })
    const result = formatRecap(recap, 'zh-CN')
    expect(result).toContain('无事件')
  })
})

describe('zh-CN locale — formatQuests', () => {
  it('renders zh-CN quest board title', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state, 'zh-CN')
    expect(result).toContain('任务看板')
  })

  it('renders zh-CN quest titles', () => {
    const state = makeState({ quests: [] })
    const result = formatQuests(QUESTS, state, 'zh-CN')
    expect(result).toContain('写 CLAUDE.md')
  })

  it('renders zh-CN active buffs section label', () => {
    const state = makeState({
      buffs: [{ id: 'aura:grimoire', label: '魔典光环', kind: 'aura' }],
    })
    const result = formatQuests(QUESTS, state, 'zh-CN')
    expect(result).toContain('活跃增益:')
  })
})

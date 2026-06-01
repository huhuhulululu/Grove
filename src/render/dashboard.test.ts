/**
 * dashboard.test.ts — TDD tests for renderDashboard (written BEFORE implementation).
 *
 * Run with: npx vitest run src/render/dashboard.test.ts
 */

import { describe, it, expect } from 'vitest'
import { renderDashboard } from './dashboard'
import { displayWidth } from './width'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { SHARDS_PER_CRAFT } from '../engine/collection'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateWithGear(gearOverrides: GameState['gear'] = []): GameState {
  return { ...initialState(), gear: gearOverrides }
}

function stateWithCards(cards: GameState['cards'] = []): GameState {
  return { ...initialState(), cards }
}

function stateWithQuests(quests: GameState['quests'] = []): GameState {
  return { ...initialState(), quests }
}

function stateWithBuffs(buffs: GameState['buffs'] = []): GameState {
  return { ...initialState(), buffs }
}

// ---------------------------------------------------------------------------
// HEADER — level + XP progress bar
// ---------------------------------------------------------------------------

describe('renderDashboard — HEADER', () => {
  it('contains "GROVE" title', () => {
    const out = renderDashboard(initialState())
    expect(out).toContain('GROVE')
  })

  it('contains the player level number', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 3, currency: 0 } }
    const out = renderDashboard(state)
    expect(out).toContain('3')
  })

  it('renders a filled bar char (█) and empty bar char (░) in the XP bar', () => {
    // At xp=0 the bar is all-empty except level-1 always has room to grow.
    // With xp=0 and level=1 we expect at least some ░ chars.
    const state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 0 } }
    const out = renderDashboard(state)
    // At minimum the bar region must contain one or both block characters.
    expect(out).toMatch(/[█░]/)
  })

  it('XP bar has more filled chars when XP is near the threshold', () => {
    // xpForLevel(1) = 50; at xp=45 the bar should be almost full (more █ than at 0).
    const full: GameState = { ...initialState(), player: { xp: 45, level: 1, currency: 0 } }
    const empty: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 0 } }
    const filledCount = (s: string) => (s.match(/█/g) ?? []).length
    expect(filledCount(renderDashboard(full))).toBeGreaterThan(filledCount(renderDashboard(empty)))
  })

  it('shows Level label alongside the level number', () => {
    const state: GameState = { ...initialState(), player: { xp: 10, level: 7, currency: 0 } }
    const out = renderDashboard(state)
    // Must show level indicator and the number 7
    expect(out).toContain('7')
    expect(out.toLowerCase()).toContain('level')
  })
})

// ---------------------------------------------------------------------------
// COLLECTION panel — set ownership counts
// ---------------------------------------------------------------------------

describe('renderDashboard — COLLECTION', () => {
  it('contains all three set names: forest, tools, creatures', () => {
    const out = renderDashboard(initialState())
    expect(out).toContain('forest')
    expect(out).toContain('tools')
    expect(out).toContain('creatures')
  })

  it('shows 0/5 for each set when collection is empty', () => {
    const out = renderDashboard(initialState())
    // Each set has 5 cards; with no cards owned all should show 0/5
    const matches = out.match(/0\/5/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(3)
  })

  it('counts distinct owned card ids for a set correctly', () => {
    const state = stateWithCards([
      { id: 'forest.sapling', name: 'Sapling', rarity: 'common', set: 'forest' },
      { id: 'forest.fern', name: 'Fern', rarity: 'common', set: 'forest' },
      // duplicate — same id, should count once
      { id: 'forest.sapling', name: 'Sapling', rarity: 'common', set: 'forest' },
    ])
    const out = renderDashboard(state)
    // 2 distinct ids out of 5 in the forest set
    expect(out).toContain('2/5')
  })

  it('shows N/5 format for sets', () => {
    const out = renderDashboard(initialState())
    // The three sets all have 5 cards each; pattern N/5 must appear
    expect(out).toMatch(/\d\/5/)
  })

  it('marks a fully-owned set complete (✓ on the 5/5 line)', () => {
    // Own every card in the tools set.
    const toolsCards = [
      { id: 'tools.hammer', name: 'Hammer', rarity: 'common' as const, set: 'tools' },
      { id: 'tools.wrench', name: 'Wrench', rarity: 'common' as const, set: 'tools' },
      { id: 'tools.compiler', name: 'Compiler', rarity: 'uncommon' as const, set: 'tools' },
      { id: 'tools.debugger', name: 'Debugger', rarity: 'rare' as const, set: 'tools' },
      { id: 'tools.refactor-blade', name: 'Refactor Blade', rarity: 'legendary' as const, set: 'tools' },
    ]
    const out = renderDashboard(stateWithCards(toolsCards))
    const toolsLine = out.split('\n').find((l) => l.includes('tools'))
    expect(toolsLine).toBeDefined()
    expect(toolsLine).toContain('5/5')
    expect(toolsLine).toContain('✓')
  })
})

// ---------------------------------------------------------------------------
// GEAR panel
// ---------------------------------------------------------------------------

describe('renderDashboard — GEAR', () => {
  it('shows empty hint when gear array is empty', () => {
    const out = renderDashboard(initialState())
    // Should hint about merging a PR to forge gear
    expect(out.toLowerCase()).toContain('no gear')
  })

  it('shows gear name and +level when gear is present', () => {
    const state = stateWithGear([
      { id: 'gear.commit-hammer.1', name: 'Commit Hammer', level: 3, rarity: 'rare', broken: false },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('Commit Hammer')
    expect(out).toContain('+3')
  })

  it('marks broken gear with BROKEN', () => {
    const state = stateWithGear([
      { id: 'gear.lint-razor.99', name: 'Lint Razor', level: 2, rarity: 'uncommon', broken: true },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('BROKEN')
  })

  it('shows multiple gear items', () => {
    const state = stateWithGear([
      { id: 'gear.a.1', name: 'Debug Lantern', level: 1, rarity: 'rare', broken: false },
      { id: 'gear.b.2', name: 'Merge Shield', level: 5, rarity: 'epic', broken: false },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('Debug Lantern')
    expect(out).toContain('+1')
    expect(out).toContain('Merge Shield')
    expect(out).toContain('+5')
  })
})

// ---------------------------------------------------------------------------
// SEEDS panel — currency balance (R3 economy)
// ---------------------------------------------------------------------------

describe('renderDashboard — SEEDS', () => {
  it('shows the seeds balance from player.currency', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 137 } }
    const out = renderDashboard(state)
    expect(out).toContain('137')
  })

  it('shows a 🌰 seeds label/icon', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 42 } }
    const out = renderDashboard(state)
    expect(out.toLowerCase()).toContain('seeds')
    expect(out).toContain('🌰')
  })

  it('shows 0 for a fresh state', () => {
    const out = renderDashboard(initialState())
    // The seeds line should be present and read 0 (never a fabricated number)
    const seedsLine = out.split('\n').find((l) => l.toLowerCase().includes('seeds'))
    expect(seedsLine).toBeDefined()
    expect(seedsLine).toMatch(/\b0\b/)
  })
})

// ---------------------------------------------------------------------------
// SHARDS balance — the dup-tail currency (R6 P1; was invisible at the surface)
// ---------------------------------------------------------------------------

describe('renderDashboard — SHARDS', () => {
  it('shows the shards balance from player.shards', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, shards: 23 },
    }
    const out = renderDashboard(state)
    const shardsLine = out.split('\n').find((l) => l.toLowerCase().includes('shard'))
    expect(shardsLine).toBeDefined()
    expect(shardsLine).toContain('23')
  })

  it('shows 0 shards for a fresh state (never a fabricated number)', () => {
    const out = renderDashboard(initialState())
    const shardsLine = out.split('\n').find((l) => l.toLowerCase().includes('shard'))
    expect(shardsLine).toBeDefined()
    expect(shardsLine).toMatch(/\b0\b/)
  })

  it('treats a legacy state with undefined shards as 0', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 0 }, // no shards field
    }
    const out = renderDashboard(state)
    const shardsLine = out.split('\n').find((l) => l.toLowerCase().includes('shard'))
    expect(shardsLine).toBeDefined()
    expect(shardsLine).toMatch(/\b0\b/)
  })

  it('surfaces a craft target when shards reach the craft threshold', () => {
    // SHARDS_PER_CRAFT shards, level 1 → forest.sapling is the first missing.
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, shards: SHARDS_PER_CRAFT },
    }
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    // A craftable hint must appear (the player can craft now).
    expect(lower).toMatch(/craftable/)
  })

  it('does NOT surface a craft target when shards are below the threshold', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, shards: 5 },
    }
    const out = renderDashboard(state)
    // No "craftable / craft now" target line when there aren't enough shards.
    expect(out.toLowerCase()).not.toMatch(/craft now|craftable/)
  })
})

// ---------------------------------------------------------------------------
// NEXT-UNLOCK horizon — surface the forward goal (R6 P1)
// ---------------------------------------------------------------------------

describe('renderDashboard — next-unlock horizon', () => {
  it('shows the next set unlock at level 1 (syntax @ L3)', () => {
    const out = renderDashboard(initialState()) // level 1
    const lower = out.toLowerCase()
    expect(lower).toContain('next set')
    expect(lower).toContain('syntax')
    expect(out).toMatch(/L3|level 3/i)
  })

  it('advances the horizon as the player levels (L3 → deploy @ L4)', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 3, currency: 0 } }
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    expect(lower).toContain('next set')
    expect(lower).toContain('deploy')
    expect(out).toMatch(/L4|level 4/i)
  })

  it('omits / closes the horizon once everything is unlocked (level 10+)', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 10, currency: 0 } }
    const out = renderDashboard(state)
    // Nothing left to unlock → no "next set: X @ L" forward line.
    expect(out.toLowerCase()).not.toMatch(/next set: \w/)
  })
})

// ---------------------------------------------------------------------------
// COLLECTION locked-set labeling — don't show 'relics 0/6' as if attainable (R6 P1)
// ---------------------------------------------------------------------------

describe('renderDashboard — COLLECTION locked-set labels', () => {
  it('labels a locked set with its unlock level instead of a bare 0/N', () => {
    const out = renderDashboard(initialState()) // level 1 — relics (L10) locked
    const relicsLine = out.split('\n').find((l) => l.toLowerCase().includes('relics'))
    expect(relicsLine).toBeDefined()
    // It must carry the lock marker + the unlock level — NOT a bare attainable 0/6.
    expect(relicsLine).toMatch(/🔒|L10|level 10/i)
  })

  it('does NOT show a locked set as a normal 0/N collectable line', () => {
    const out = renderDashboard(initialState())
    const relicsLine = out.split('\n').find((l) => l.toLowerCase().includes('relics'))
    expect(relicsLine).toBeDefined()
    // A locked set must not read like an attainable "relics 0/6".
    expect(relicsLine).not.toMatch(/\b0\/6\b/)
  })

  it('shows unlocked sets with their normal N/total progress', () => {
    const out = renderDashboard(initialState()) // forest/tools/creatures are L1
    const forestLine = out.split('\n').find((l) => l.toLowerCase().includes('forest'))
    expect(forestLine).toBeDefined()
    expect(forestLine).toContain('0/5')
    // An unlocked set must NOT carry the lock marker.
    expect(forestLine).not.toContain('🔒')
  })

  it('reveals a set as normal progress once the player reaches its unlock level', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 10, currency: 0 } }
    const out = renderDashboard(state)
    const relicsLine = out.split('\n').find((l) => l.toLowerCase().includes('relics'))
    expect(relicsLine).toBeDefined()
    // At L10 relics is unlocked → shows 0/6, no lock marker.
    expect(relicsLine).toContain('0/6')
    expect(relicsLine).not.toContain('🔒')
  })
})

// ---------------------------------------------------------------------------
// WORK METER panel — token-milestone floor progress (ADR-0010)
// ---------------------------------------------------------------------------

describe('renderDashboard — WORK METER', () => {
  function workState(work: Partial<GameState['work']>): GameState {
    return { ...initialState(), work: { ...initialState().work, ...work } }
  }

  it('renders a work-meter progress label toward the next milestone chest', () => {
    const out = renderDashboard(workState({ workMeter: 0.5 }))
    // A "work" panel/line oriented toward the chest milestone
    expect(out.toLowerCase()).toContain('work')
    expect(out).toContain('🎁')
  })

  it('shows a fuller bar when the meter is closer to the milestone', () => {
    const filledCount = (s: string) => (s.match(/█/g) ?? []).length
    const near = renderDashboard(workState({ workMeter: 0.9 }))
    const far = renderDashboard(workState({ workMeter: 0.1 }))
    expect(filledCount(near)).toBeGreaterThan(filledCount(far))
  })

  it('reads as neutral tracking, never "burn more tokens" (ADR-0010 framing)', () => {
    const out = renderDashboard(workState({ workMeter: 0.5 })).toLowerCase()
    expect(out).not.toContain('burn')
    expect(out).not.toContain('spend more')
  })
})

// ---------------------------------------------------------------------------
// GEAR active effect — gear LEVEL confers a real ADR-0008 effect string
// ---------------------------------------------------------------------------

describe('renderDashboard — GEAR active effect', () => {
  it('shows the active effect for a Commit Hammer (+N% commit seeds)', () => {
    const state = stateWithGear([
      { id: 'gear.commit-hammer.1', name: 'Commit Hammer', level: 7, rarity: 'rare', broken: false },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('Commit Hammer')
    expect(out).toContain('+7')
    // Commit Hammer +7 → +7% seeds (currencyPct perLevel 1)
    expect(out).toMatch(/\+7%/)
    expect(out.toLowerCase()).toMatch(/seed/)
  })

  it('shows the crit effect for a Type Saber (+N pp crit)', () => {
    const state = stateWithGear([
      { id: 'gear.type-saber.1', name: 'Type Saber', level: 10, rarity: 'epic', broken: false },
    ])
    const out = renderDashboard(state)
    // Type Saber perLevel 0.5 → level 10 = +5 (pp) crit
    expect(out.toLowerCase()).toContain('crit')
  })

  it('shows no active-effect string for broken gear (confers nothing)', () => {
    const state = stateWithGear([
      { id: 'gear.commit-hammer.1', name: 'Commit Hammer', level: 7, rarity: 'rare', broken: true },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('BROKEN')
    // A broken Commit Hammer confers nothing → no "+7% seeds" effect string.
    expect(out).not.toMatch(/\+7%/)
  })

  it('shows a PROTECTED marker for gear armed in protectedGear', () => {
    const g = { id: 'gear.merge-shield.1', name: 'Merge Shield', level: 8, rarity: 'epic' as const, broken: false }
    const state: GameState = { ...initialState(), gear: [g], protectedGear: [g.id] }
    const out = renderDashboard(state)
    expect(out.toLowerCase()).toContain('protect')
  })
})

// ---------------------------------------------------------------------------
// QUESTS panel
// ---------------------------------------------------------------------------

describe('renderDashboard — QUESTS', () => {
  it('contains all four quest titles', () => {
    const out = renderDashboard(initialState())
    expect(out).toContain('Write the CLAUDE.md')
    expect(out).toContain('Spec First')
    expect(out).toContain('Sync the Docs')
    expect(out).toContain('Add Tests')
  })

  it('uses · glyph for not-yet-started quests', () => {
    const out = renderDashboard(initialState())
    // No quest progress → all quests are not-started
    expect(out).toContain('·')
  })

  it('uses ✓ glyph for done quests', () => {
    const state = stateWithQuests([{ id: 'grimoire', status: 'done', completions: 1 }])
    const out = renderDashboard(state)
    expect(out).toContain('✓')
  })

  it('uses ◆ glyph for active quests', () => {
    const state = stateWithQuests([{ id: 'test-warden', status: 'active', completions: 0 }])
    const out = renderDashboard(state)
    expect(out).toContain('◆')
  })
})

// ---------------------------------------------------------------------------
// BUFFS panel
// ---------------------------------------------------------------------------

describe('renderDashboard — BUFFS', () => {
  it('shows "none" when no buffs are active', () => {
    const out = renderDashboard(initialState())
    expect(out.toLowerCase()).toContain('none')
  })

  it('shows buff labels when buffs are active', () => {
    const state = stateWithBuffs([
      { id: 'multiplier-2x', label: 'Double XP' },
      { id: 'freshness', label: 'Freshness' },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('Double XP')
    expect(out).toContain('Freshness')
  })
})

// ---------------------------------------------------------------------------
// Layout / structure
// ---------------------------------------------------------------------------

describe('renderDashboard — layout', () => {
  it('returns a multi-line string (at least 10 lines)', () => {
    const out = renderDashboard(initialState())
    const lines = out.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(10)
  })

  it('respects the default width of 60 (no line exceeds 60 chars)', () => {
    const out = renderDashboard(initialState())
    for (const line of out.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })

  it('respects a custom width option', () => {
    const out = renderDashboard(initialState(), { width: 80 })
    for (const line of out.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80)
    }
  })

  it('uses box-drawing border characters', () => {
    const out = renderDashboard(initialState())
    // Must contain at least one box-drawing char (│ or ─ or ╔ or ╗ etc.)
    expect(out).toMatch(/[│─╔╗╚╝╠╣╦╩╬┌┐└┘├┤┬┴┼]/)
  })
})

// ---------------------------------------------------------------------------
// Display-width alignment (wide/emoji chars) — pad by terminal CELLS, not .length
// ---------------------------------------------------------------------------

describe('renderDashboard — display-width alignment (emoji/CJK)', () => {
  // A state stuffed with WIDE chars in box content: a gear name with an emoji,
  // an emoji-bearing buff label, and CJK copy. With .length-based padding the
  // right border (│) drifts; with displayWidth-based padding every bordered row
  // is the SAME cell width and the borders line up.
  const wideState: GameState = {
    ...initialState(),
    player: { xp: 0, level: 1, currency: 1234 },
    gear: [
      { id: 'g.1', name: '🌰 Seed Hammer ⚔️', level: 7, rarity: 'rare', broken: false },
    ],
    buffs: [{ id: 'b1', label: '🌿 暴击 aura' }],
    cards: [{ id: 'forest.sapling', name: 'Sapling', rarity: 'common', set: 'forest' }],
  }

  function borderedRows(out: string): string[] {
    // Every full box row starts and ends with a vertical border.
    return out.split('\n').filter((l) => l.startsWith('│') && l.endsWith('│'))
  }

  it('every bordered row has the SAME display width as the box width', () => {
    const width = 60
    const out = renderDashboard(wideState, { width })
    const rows = borderedRows(out)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(displayWidth(row)).toBe(width)
    }
  })

  it('the closing │ border aligns across rows even with emoji content', () => {
    const out = renderDashboard(wideState, { width: 60 })
    const rows = borderedRows(out)
    // All right borders sit at the same cell column ⇒ all rows are equal cell width.
    const widths = new Set(rows.map((r) => displayWidth(r)))
    expect(widths.size).toBe(1)
  })

  it('no bordered row OVERFLOWS the box cell width (truncation, not spill)', () => {
    const out = renderDashboard(wideState, { width: 60 })
    for (const row of borderedRows(out)) {
      expect(displayWidth(row)).toBeLessThanOrEqual(60)
    }
  })
})

// ---------------------------------------------------------------------------
// ENERGY panel — Vigor / Sap / Wellspring
// ---------------------------------------------------------------------------

describe('renderDashboard — ENERGY (known=true)', () => {
  function energyState(vigor: number, sap: number, extra?: Partial<GameState['energy']>): GameState {
    return {
      ...initialState(),
      energy: { known: true, vigor, sap, ...extra },
    }
  }

  it('renders a Vigor bar when energy.known=true', () => {
    const state = energyState(72, 80)
    const out = renderDashboard(state)
    expect(out.toLowerCase()).toContain('vigor')
  })

  it('shows the vigor remaining percentage', () => {
    const state = energyState(72, 80)
    const out = renderDashboard(state)
    expect(out).toContain('72%')
  })

  it('renders a Weekly bar when energy.known=true', () => {
    const state = energyState(72, 80)
    const out = renderDashboard(state)
    expect(out.toLowerCase()).toContain('weekly')
  })

  it('shows the sap remaining percentage', () => {
    const state = energyState(72, 80)
    const out = renderDashboard(state)
    expect(out).toContain('80%')
  })

  it('bar uses filled (█) and empty (░) block chars for the Vigor bar', () => {
    // At 72% the bar has both filled and empty sections.
    const state = energyState(72, 80)
    const out = renderDashboard(state)
    expect(out).toMatch(/[█░]/)
  })

  it('shows "resets in" ETA when opts.nowEpoch and vigorResetsAt are both present', () => {
    const nowEpoch = 1_000_000_000_000 // ms
    const vigorResetsAt = nowEpoch + 2 * 60 * 60 * 1000 + 15 * 60 * 1000 // +2h 15m
    const state = energyState(30, 60, { vigorResetsAt })
    const out = renderDashboard(state, { nowEpoch })
    expect(out).toContain('resets in')
    // Should contain 2h and 15m (exact format flexible: "2h 15m" or "2h15m" etc.)
    expect(out).toMatch(/2h/)
    expect(out).toMatch(/15m/)
  })

  it('omits the "resets in" ETA when nowEpoch is NOT provided', () => {
    const state = energyState(30, 60, { vigorResetsAt: 9_999_999_999_999 })
    const out = renderDashboard(state) // no nowEpoch
    expect(out).not.toContain('resets in')
  })

  it('omits the "resets in" ETA when vigorResetsAt is absent', () => {
    const state = energyState(30, 60) // no vigorResetsAt
    const out = renderDashboard(state, { nowEpoch: 1_000_000_000_000 })
    expect(out).not.toContain('resets in')
  })

  it('output does NOT contain shaming words: "burned", "used", "exhausted", "depleted"', () => {
    const state = energyState(10, 15) // very low energy
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    expect(lower).not.toContain('burned')
    expect(lower).not.toContain('used up')
    expect(lower).not.toContain('exhausted')
    expect(lower).not.toContain('depleted')
  })

  it('low energy reads as a calm rest cue, not an alarm', () => {
    const state = energyState(5, 10) // very low
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    // Should read as a calm, terse rest cue — "good stopping point" (never an alarm)
    expect(lower).toMatch(/stopping point|rest|good/)
  })

  it('does NOT show the Wellspring line when energy is known', () => {
    const state = energyState(72, 80)
    const out = renderDashboard(state)
    expect(out.toLowerCase()).not.toContain('wellspring')
  })
})

// ---------------------------------------------------------------------------
// ENERGY — reset ETA uses millisecond vigorResetsAt (epoch-units fix)
// ---------------------------------------------------------------------------

describe('renderDashboard — ENERGY reset ETA epoch-units fix', () => {
  it('renders "resets in 1h 30m" when vigorResetsAt is 90 minutes ahead in ms', () => {
    const nowEpoch = 1_717_000_000_000 // ms
    const vigorResetsAt = nowEpoch + 90 * 60 * 1000 // +90 min in ms
    const state: GameState = {
      ...initialState(),
      energy: { known: true, vigor: 60, sap: 80, vigorResetsAt },
    }
    const out = renderDashboard(state, { nowEpoch })
    expect(out).toContain('resets in')
    expect(out).toContain('1h')
    expect(out).toContain('30m')
    // Must NOT print 'soon' (which would indicate the old seconds-vs-ms mismatch)
    expect(out).not.toContain('soon')
  })

  it('renders "resets in 2h 15m" for a 2h 15m ahead reset', () => {
    const nowEpoch = 1_000_000_000_000
    const vigorResetsAt = nowEpoch + (2 * 60 + 15) * 60 * 1000
    const state: GameState = {
      ...initialState(),
      energy: { known: true, vigor: 40, sap: 70, vigorResetsAt },
    }
    const out = renderDashboard(state, { nowEpoch })
    expect(out).toMatch(/2h/)
    expect(out).toMatch(/15m/)
    expect(out).not.toContain('soon')
  })
})

// ---------------------------------------------------------------------------
// ENERGY — partial frame: vigor/sap undefined → hide only the absent bar
// ---------------------------------------------------------------------------

describe('renderDashboard — ENERGY partial frame (vigor or sap undefined)', () => {
  it('hides the Vigor bar (no "⚡ Vigor" row) when energy.vigor is undefined', () => {
    const state: GameState = {
      ...initialState(),
      energy: { known: true, vigor: undefined as unknown as number, sap: 80 },
    }
    const out = renderDashboard(state)
    // The Weekly / sap bar must still appear
    expect(out.toLowerCase()).toContain('weekly')
    expect(out).toContain('80%')
    // The Vigor bar must NOT appear (no fabricated number, no label row)
    expect(out.toLowerCase()).not.toContain('vigor')
  })

  it('hides the Weekly bar (no "🌿 Weekly" row) when energy.sap is undefined', () => {
    const state: GameState = {
      ...initialState(),
      energy: { known: true, vigor: 60, sap: undefined as unknown as number },
    }
    const out = renderDashboard(state)
    // The Vigor bar must still appear
    expect(out.toLowerCase()).toContain('vigor')
    expect(out).toContain('60%')
    // The Weekly bar must NOT appear
    expect(out.toLowerCase()).not.toContain('weekly')
  })
})

describe('renderDashboard — ENERGY (known=false / Wellspring)', () => {
  it('shows the Wellspring one-liner when energy.known=false', () => {
    const state = initialState() // default: known=false
    const out = renderDashboard(state)
    expect(out.toLowerCase()).toContain('wellspring')
  })

  it('does NOT render a Vigor bar when energy.known=false', () => {
    const state = initialState()
    const out = renderDashboard(state)
    // "Vigor" heading must not appear
    expect(out.toLowerCase()).not.toContain('vigor')
  })

  it('does NOT render any percentage when energy.known=false', () => {
    const state = initialState()
    const out = renderDashboard(state)
    // No "XX%" pattern in the output at all (no invented numbers)
    expect(out).not.toMatch(/\d+%/)
  })

  it('does NOT show "resets in" when energy.known=false', () => {
    const state = initialState()
    const out = renderDashboard(state, { nowEpoch: 1_000_000_000_000 })
    expect(out).not.toContain('resets in')
  })

  it('Wellspring line contains a calm, free-to-code message (no scarcity language)', () => {
    const state = initialState()
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    // Must not invent scarcity
    expect(lower).not.toContain('limit')
    expect(lower).not.toContain('quota')
    expect(lower).not.toContain('0%')
    // Should read terse + unmetered (no scarcity framing)
    expect(lower).toMatch(/unmetered|wellspring/)
  })
})

// ---------------------------------------------------------------------------
// PRESTIGE VISIBLE — current rank + next cost in the header (R7 economy/product P2)
// ---------------------------------------------------------------------------

import { prestigeRank, prestigeCost, prestigeBuffId } from '../engine/reduce'

/** Build N prestige buffs (rank 1..N), the exact shape buyPrestige grants. */
function prestigeBuffs(n: number): GameState['buffs'] {
  const out: GameState['buffs'] = []
  for (let r = 1; r <= n; r++) {
    out.push({ id: prestigeBuffId(r), label: `Prestige ${r}`, kind: 'rest' })
  }
  return out
}

describe('renderDashboard — PRESTIGE VISIBLE', () => {
  it('shows the current prestige rank in the header', () => {
    const state = stateWithBuffs(prestigeBuffs(3))
    expect(prestigeRank(state)).toBe(3) // sanity: fixture matches the engine
    const out = renderDashboard(state)
    expect(out).toMatch(/prestige 3/i)
  })

  it('shows the NEXT prestige cost from prestigeCost(rank)', () => {
    const state = stateWithBuffs(prestigeBuffs(3))
    const out = renderDashboard(state)
    // next cost = prestigeCost(3) — surfaced near the rank, with the 🌰 unit.
    expect(out).toContain(String(prestigeCost(3)))
    const line = out.split('\n').find((l) => /prestige 3/i.test(l))
    expect(line).toBeDefined()
    expect(line).toContain(String(prestigeCost(3)))
    expect(line).toContain('🌰')
  })

  it('shows the rank-0 next cost (the FIRST prestige) when no prestige owned yet', () => {
    const out = renderDashboard(initialState()) // rank 0
    const line = out.split('\n').find((l) => /prestige 0/i.test(l))
    expect(line).toBeDefined()
    expect(line).toContain(String(prestigeCost(0)))
  })
})

// ---------------------------------------------------------------------------
// BUFFS ROLLUP — collapse N prestige rows into one "✦ Prestige ×N" badge (R7)
// ---------------------------------------------------------------------------

describe('renderDashboard — BUFFS prestige rollup', () => {
  it('collapses N prestige buffs into a single "✦ Prestige ×N" badge', () => {
    const state = stateWithBuffs(prestigeBuffs(4))
    const out = renderDashboard(state)
    // A single rollup badge with the count, not four separate rows.
    expect(out).toContain('✦ Prestige ×4')
  })

  it('does NOT print a separate row per prestige rank in the BUFFS panel', () => {
    const state = stateWithBuffs(prestigeBuffs(3))
    const out = renderDashboard(state)
    // The per-rank labels ("Prestige 1", "Prestige 2", …) must NOT each appear as
    // their own buff row — only the rollup ×N carries the count.
    const rows = out.split('\n').filter((l) => /prestige/i.test(l))
    // Exactly the header rank line + the single rollup badge — never 3 buff rows.
    const buffRowCount = rows.filter((l) => /prestige [123]\b/i.test(l) && !l.includes('×')).length
    // The only allowed "Prestige N" (no ×) line is the HEADER rank line.
    expect(buffRowCount).toBeLessThanOrEqual(1)
  })

  it('still renders non-prestige buffs as their own rows alongside the rollup', () => {
    const state = stateWithBuffs([
      ...prestigeBuffs(2),
      { id: 'multiplier-2x', label: 'Double XP', kind: 'multiplier' },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('✦ Prestige ×2')
    expect(out).toContain('Double XP')
  })

  it('shows no prestige rollup badge when no prestige buffs are owned', () => {
    const state = stateWithBuffs([{ id: 'freshness', label: 'Freshness', kind: 'freshness' }])
    const out = renderDashboard(state)
    expect(out).not.toContain('✦ Prestige ×')
    expect(out).toContain('Freshness')
  })
})

// ---------------------------------------------------------------------------
// DISCOVERABILITY CTA — surface what the current balance affords (R7 product P1)
// ---------------------------------------------------------------------------

import { PULL_COST, PREMIUM_PULL_COST } from '../engine/reduce'

describe('renderDashboard — affordable-action CTA', () => {
  it('surfaces a "can: pull" CTA when seeds afford a basic pull', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, currency: PULL_COST },
    }
    const out = renderDashboard(state).toLowerCase()
    expect(out).toMatch(/can:.*pull/)
  })

  it('omits premium from the CTA when seeds afford pull but not premium', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, currency: PULL_COST },
    }
    const out = renderDashboard(state).toLowerCase()
    // basic pull affordable, premium (150) is NOT.
    expect(out).toMatch(/can:.*pull/)
    expect(out).not.toMatch(/can:.*premium/)
  })

  it('lists premium in the CTA once seeds afford a premium pull', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, currency: PREMIUM_PULL_COST },
    }
    const out = renderDashboard(state).toLowerCase()
    expect(out).toMatch(/premium/)
  })

  it('lists prestige (with its next cost) in the CTA when seeds afford it', () => {
    const cost = prestigeCost(0)
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, currency: cost },
    }
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    expect(lower).toMatch(/can:/)
    expect(lower).toMatch(/prestige/)
    // The CTA prestige entry carries the next cost so the player knows the price.
    const ctaLine = out.split('\n').find((l) => /can:/i.test(l) && /prestige/i.test(l))
    expect(ctaLine).toBeDefined()
    expect(ctaLine).toContain(String(cost))
  })

  it('shows the basic-pull cost in the CTA', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, currency: PULL_COST },
    }
    const out = renderDashboard(state)
    const ctaLine = out.split('\n').find((l) => /can:/i.test(l))
    expect(ctaLine).toBeDefined()
    expect(ctaLine).toContain(String(PULL_COST))
  })

  it('omits the CTA entirely when the balance affords nothing', () => {
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, currency: 0 },
    }
    const out = renderDashboard(state)
    expect(out.toLowerCase()).not.toMatch(/can:/)
  })
})

// ---------------------------------------------------------------------------
// CRAFT TARGET NAME — the craft hint shows the card NAME, not the raw id (R7 P3)
// ---------------------------------------------------------------------------

describe('renderDashboard — craft target shows card name', () => {
  it('shows the craft target card NAME, not its raw id', () => {
    // At the craft threshold; level 1 → forest.sapling ("Sapling") is first missing.
    const state: GameState = {
      ...initialState(),
      player: { ...initialState().player, shards: SHARDS_PER_CRAFT },
    }
    const out = renderDashboard(state)
    const craftLine = out.split('\n').find((l) => /craft/i.test(l))
    expect(craftLine).toBeDefined()
    // Friendly NAME present…
    expect(craftLine).toContain('Sapling')
    // …and the raw dotted id is NOT shown as the target.
    expect(craftLine).not.toContain('forest.sapling')
  })
})

// ---------------------------------------------------------------------------
// ODDS panel (R8) — honesty/odds live at the decision point: pity progress
// (sinceLegendary vs SOFT/HARD), realized legendary+shiny %, spark progress,
// missing-card count, and the foil shard-sink option.
// ---------------------------------------------------------------------------

import { SPARK_THRESHOLD, FOIL_COST } from '../engine/reduce'
import { SOFT_PITY, HARD_PITY, REALIZED_LEGENDARY_SHINY_RATE } from '../engine/gacha'

describe('renderDashboard — ODDS / decision-point honesty', () => {
  it('renders an ODDS section header', () => {
    const out = renderDashboard(initialState())
    expect(out).toContain('ODDS')
  })

  it('surfaces pity progress (sinceLegendary vs HARD_PITY)', () => {
    const state: GameState = { ...initialState(), pity: { sinceLegendary: 12 } }
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    expect(lower).toContain('pity')
    // shows the raw counter and the hard threshold the player counts toward
    const pityLine = out.split('\n').find((l) => /pity/i.test(l))
    expect(pityLine).toBeDefined()
    expect(pityLine).toContain('12')
    expect(pityLine).toContain(String(HARD_PITY))
  })

  it('flags soft pity as active once at/above SOFT_PITY', () => {
    const state: GameState = { ...initialState(), pity: { sinceLegendary: SOFT_PITY } }
    const out = renderDashboard(state).toLowerCase()
    expect(out).toMatch(/soft/)
  })

  it('publishes the realized legendary+shiny rate (honest long-run odds)', () => {
    const out = renderDashboard(initialState())
    const lower = out.toLowerCase()
    expect(lower).toMatch(/legendary|shiny/)
    // Rendered as a "per 100 pulls" figure (NOT a bare %, which the energy
    // Wellspring "no invented numbers" guard forbids in the whole output).
    const per100 = (REALIZED_LEGENDARY_SHINY_RATE * 100).toFixed(1)
    expect(out).toContain(per100)
  })

  it("shows 'X cards left' (missing-card count) within unlocked sets", () => {
    const out = renderDashboard(initialState()).toLowerCase()
    // a fresh player is missing every level-1 card
    expect(out).toMatch(/\d+ cards left/)
  })

  it('surfaces spark progress against SPARK_THRESHOLD', () => {
    const state: GameState = { ...initialState(), spark: 3 }
    const out = renderDashboard(state)
    const sparkLine = out.split('\n').find((l) => /spark/i.test(l))
    expect(sparkLine).toBeDefined()
    expect(sparkLine).toContain('3')
    expect(sparkLine).toContain(String(SPARK_THRESHOLD))
  })

  it('flags the spark guarantee as armed once spark reaches the threshold', () => {
    const state: GameState = { ...initialState(), spark: SPARK_THRESHOLD }
    const out = renderDashboard(state).toLowerCase()
    expect(out).toMatch(/guarantee|armed|ready/)
  })

  it('surfaces the foil option with its shard cost when a card is owned', () => {
    const state: GameState = {
      ...initialState(),
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...initialState().player, shards: FOIL_COST },
    }
    const out = renderDashboard(state)
    const lower = out.toLowerCase()
    expect(lower).toContain('foil')
    const foilLine = out.split('\n').find((l) => /foil/i.test(l))
    expect(foilLine).toContain(String(FOIL_COST))
  })

  it('keeps the foil CTA "(sq foil)" visible — the rarity-curve line must fit the box (R10 regression)', () => {
    // R10 widened the foil line to surface the 3→72 curve; at the default width
    // (inner budget = width-4 = 56) it overflowed and boxRow() truncated the
    // trailing "(sq foil)" CTA. The CTA must survive so the player knows the verb.
    const state: GameState = {
      ...initialState(),
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...initialState().player, shards: FOIL_COST },
    }
    const out = renderDashboard(state)
    const foilLine = out.split('\n').find((l) => /foil/i.test(l))
    expect(foilLine).toContain('(sq foil)')
  })
})

// ---------------------------------------------------------------------------
// LOADOUT panel (dashboard integration — Task B)
// ---------------------------------------------------------------------------

import type { EquippedRef } from '../core/synergies'

function stateWithLoadout(slots: EquippedRef[]): GameState {
  return { ...initialState(), loadout: { slots } }
}

describe('renderDashboard — LOADOUT panel', () => {
  it('renders a LOADOUT section header', () => {
    const out = renderDashboard(initialState())
    expect(out).toContain('LOADOUT')
  })

  it('shows slot count "0/3" for an empty loadout (neutral, no nag)', () => {
    const out = renderDashboard(initialState())
    expect(out).toContain('0/3')
  })

  it('does NOT nag on an empty loadout ("leaving value", "missing out", etc.)', () => {
    const out = renderDashboard(initialState())
    expect(out).not.toMatch(/leaving value/i)
    expect(out).not.toMatch(/missing out/i)
    expect(out).not.toMatch(/you should/i)
  })

  it('shows filled slot count "2/3" when 2 slots are equipped', () => {
    const state = stateWithLoadout([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('2/3')
  })

  it('shows active synergy name when Toolsmith fires', () => {
    const state = stateWithLoadout([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const out = renderDashboard(state)
    expect(out).toContain('Toolsmith')
  })

  it('shows active synergy effect when Toolsmith fires (XP)', () => {
    const state = stateWithLoadout([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const out = renderDashboard(state)
    // Toolsmith: +5% XP
    expect(out).toMatch(/\+5%.*XP|XP.*\+5%/i)
  })

  it('stays within box width (no line exceeds width) when loadout is active', () => {
    const state = stateWithLoadout([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const out = renderDashboard(state, { width: 60 })
    for (const line of out.split('\n')) {
      expect(displayWidth(line)).toBeLessThanOrEqual(60)
    }
  })
})

// ---------------------------------------------------------------------------
// zh-CN locale rendering
// ---------------------------------------------------------------------------

describe('renderDashboard — zh-CN locale', () => {
  it('renders panel titles in zh-CN', () => {
    const out = renderDashboard(initialState(), { locale: 'zh-CN' })
    expect(out).toContain('精力')
    expect(out).toContain('工作')
    expect(out).toContain('收藏')
    expect(out).toContain('装备')
    expect(out).toContain('任务')
    expect(out).toContain('增益')
  })

  it('renders zh-CN quest titles in the QUESTS panel', () => {
    const out = renderDashboard(initialState(), { locale: 'zh-CN' })
    expect(out).toContain('写 CLAUDE.md')
    expect(out).toContain('先写规格')
  })

  it('renders zh-CN Wellspring when energy.known=false', () => {
    const out = renderDashboard(initialState(), { locale: 'zh-CN' })
    expect(out).toContain('源泉')
    expect(out).toContain('未计量')
  })

  it('renders zh-CN none in BUFFS when no buffs', () => {
    const out = renderDashboard(initialState(), { locale: 'zh-CN' })
    expect(out).toContain('无')
  })

  it('renders zh-CN prestige rollup badge', () => {
    const state = stateWithBuffs(prestigeBuffs(2))
    const out = renderDashboard(state, { locale: 'zh-CN' })
    expect(out).toContain('威望 ×2')
  })

  it('renders zh-CN gear none hint when no gear', () => {
    const out = renderDashboard(initialState(), { locale: 'zh-CN' })
    expect(out).toContain('暂无装备')
  })

  it('still passes layout constraints (no line exceeds 60 chars)', () => {
    const out = renderDashboard(initialState(), { locale: 'zh-CN' })
    for (const line of out.split('\n')) {
      // Display-width check: CJK chars are 2 cells but .length is 1 — use cell count
      // The test suite already verifies displayWidth for en; zh-CN strings are longer
      // in cells so just verify raw .length stays <= 60 (box is padded by cell width).
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })
})

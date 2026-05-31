/**
 * dashboard.test.ts — TDD tests for renderDashboard (written BEFORE implementation).
 *
 * Run with: npx vitest run src/render/dashboard.test.ts
 */

import { describe, it, expect } from 'vitest'
import { renderDashboard } from './dashboard'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'

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

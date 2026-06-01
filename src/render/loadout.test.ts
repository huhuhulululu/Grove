/**
 * render/loadout.test.ts — Tests for the loadout panel renderer.
 *
 * Covers:
 *  - empty loadout renders slots (neutral, no nag)
 *  - active synergies are listed
 *  - one-away synergies (the chase) are listed when a free slot exists
 *  - zen suppresses the entire HUD (returns '')
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { EquippedRef } from '../core/synergies'
import { renderLoadoutPanel } from './loadout'

function withSlots(slots: EquippedRef[]): GameState {
  return { ...initialState(), loadout: { slots } }
}

describe('renderLoadoutPanel — zen suppression', () => {
  it('returns empty string when isZen=true (no loadout HUD in calm mode)', () => {
    expect(renderLoadoutPanel(initialState(), true)).toBe('')
  })

  it('returns empty string for zen even when synergies are active', () => {
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    expect(renderLoadoutPanel(s, true)).toBe('')
  })
})

describe('renderLoadoutPanel — neutral empty loadout', () => {
  it('shows the panel title', () => {
    const panel = renderLoadoutPanel(initialState(), false)
    expect(panel).toContain('LOADOUT')
  })

  it('shows all 3 slots as empty — neutral first-class state with no nag', () => {
    const panel = renderLoadoutPanel(initialState(), false)
    expect(panel).toContain('empty')
    // All 3 slots mentioned
    expect(panel).toContain('1')
    expect(panel).toContain('2')
    expect(panel).toContain('3')
  })

  it('does NOT contain "leaving value on the table" or similar prompting', () => {
    const panel = renderLoadoutPanel(initialState(), false)
    expect(panel).not.toMatch(/leaving value/i)
    expect(panel).not.toMatch(/missing out/i)
    expect(panel).not.toMatch(/you should/i)
  })
})

describe('renderLoadoutPanel — filled slots + active synergies', () => {
  it('shows filled slot labels', () => {
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
    ])
    const panel = renderLoadoutPanel(s, false)
    // slot 1 is filled with label "tools"
    expect(panel).toContain('tools')
  })

  it('shows ACTIVE synergy name + effect when Toolsmith fires', () => {
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const panel = renderLoadoutPanel(s, false)
    expect(panel).toContain('Toolsmith')
    expect(panel).toContain('XP')
  })

  it('shows ACTIVE synergy for Merchant (seed-leaning)', () => {
    const s = withSlots([
      { kind: 'gear', id: 'gear.commit-hammer.7', tag: 'Commit Hammer' },
      { kind: 'card', id: 'deploy.commit', tag: 'deploy' },
    ])
    const panel = renderLoadoutPanel(s, false)
    expect(panel).toContain('Merchant')
    expect(panel).toContain('seeds')
  })

  it('shows ACTIVE synergy for Precision (crit-leaning)', () => {
    const s = withSlots([
      { kind: 'gear', id: 'gear.type-saber.1', tag: 'Type Saber' },
      { kind: 'buff', id: 'precast-spec' },
    ])
    const panel = renderLoadoutPanel(s, false)
    expect(panel).toContain('Precision')
    expect(panel).toContain('crit')
  })
})

describe('renderLoadoutPanel — one-away (the chase)', () => {
  it('shows a one-away synergy chase when 1 member of Toolsmith is equipped and a slot is free', () => {
    // One tools card equipped, 2 free slots → Toolsmith needs 1 more
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
    ])
    const panel = renderLoadoutPanel(s, false)
    // The one-away chase should surface Toolsmith
    expect(panel).toContain('Toolsmith')
  })

  it('does NOT show one-away when slots are full (no room to equip)', () => {
    // 3 slots full but no synergy active (diverse types) — no free slots so no chase
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'forest.oak', tag: 'forest' },
      { kind: 'card', id: 'forest.fern', tag: 'forest' },
    ])
    const panel = renderLoadoutPanel(s, false)
    // 0 free slots → no chase section
    expect(panel).not.toContain('chase')
    // But Toolsmith should not be in active either (only 1 tools card)
    // and naturalist needs 3 forest cards but has 2 — gap=1 but no free slot
    const lines = panel.split('\n')
    // There must be no "one away" header
    const hasChaseHeader = lines.some((l) => l.toLowerCase().includes('away'))
    expect(hasChaseHeader).toBe(false)
  })

  it('does NOT show already-active synergies in the one-away list', () => {
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const panel = renderLoadoutPanel(s, false)
    // Toolsmith is ACTIVE — should appear once under active, not again in chase
    const toolsmithCount = (panel.match(/Toolsmith/g) ?? []).length
    expect(toolsmithCount).toBe(1)
  })
})

describe('renderLoadoutPanel — locale', () => {
  it('renders in zh-CN locale without crashing', () => {
    const panel = renderLoadoutPanel(initialState(), false, 'zh-CN')
    expect(typeof panel).toBe('string')
    expect(panel.length).toBeGreaterThan(0)
  })

  it('renders in ja locale without crashing', () => {
    const panel = renderLoadoutPanel(initialState(), false, 'ja')
    expect(typeof panel).toBe('string')
    expect(panel.length).toBeGreaterThan(0)
  })
})

/**
 * statusline-segment.test.ts — the calm, composable Grove statusline glance.
 *
 * Guards the always-visible-surface contract: ONE short line of game-state the
 * user composes into their OWN bar; inverted-remaining energy; Wellspring invents
 * no scarcity; --zen is the quietest form; read-only and width-bounded.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { renderStatuslineSegment } from './statusline-segment'
import { displayWidth } from './width'

function metered(over: Partial<GameState['energy']> = {}): GameState {
  return {
    ...initialState(),
    player: { xp: 370, level: 7, currency: 0 },
    energy: { known: true, vigor: 78, sap: 81, ...over },
  }
}

describe('renderStatuslineSegment — composable Grove glance', () => {
  it('metered: shows tree+level, an xp bar, and energy as REMAINING (⚡ vigor · 🌿 sap)', () => {
    const line = renderStatuslineSegment(metered(), 'en', false)
    expect(line).toContain('🌲 L7')
    expect(line).toMatch(/[█░]{5}/) // a 5-cell xp bar
    expect(line).toContain('⚡78')
    expect(line).toContain('🌿81')
    expect(line).toContain(' · ') // the house separator, never em-dash
  })

  it('Wellspring (energy.known === false): invents NO scarcity — no ⚡/🌿 at all', () => {
    const s: GameState = { ...metered(), energy: { known: false, vigor: 100, sap: 100 } }
    const line = renderStatuslineSegment(s, 'en', false)
    expect(line).not.toMatch(/⚡|🌿/) // the critical anti-scarcity guard
    expect(line).toContain('🌲 L7') // just the quietly growing tree
  })

  it('a present low window adds a calm 🌙 rest cue (never red, never shaming)', () => {
    const line = renderStatuslineSegment(metered({ vigor: 15 }), 'en', false)
    expect(line).toContain('🌙')
  })

  it('no rest cue when energy is comfortable', () => {
    expect(renderStatuslineSegment(metered(), 'en', false)).not.toContain('🌙')
  })

  it('--zen is the quietest form: tree + level only (no bar, no energy, no cue)', () => {
    const line = renderStatuslineSegment(metered({ vigor: 5 }), 'en', true)
    expect(line).toBe('🌲 L7')
    expect(line).not.toMatch(/[█░]|⚡|🌿|🌙/)
  })

  it('per-window honesty: omit a window whose value is undefined', () => {
    const s: GameState = { ...metered(), energy: { known: true, vigor: 50 } } // no sap
    const line = renderStatuslineSegment(s, 'en', false)
    expect(line).toContain('⚡50')
    expect(line).not.toContain('🌿')
  })

  it('is width-bounded for an always-visible surface (<= 28 normal, <= 8 zen)', () => {
    expect(displayWidth(renderStatuslineSegment(metered({ vigor: 15 }), 'en', false))).toBeLessThanOrEqual(28)
    expect(displayWidth(renderStatuslineSegment(metered(), 'en', true))).toBeLessThanOrEqual(8)
  })

  it('is pure — never mutates the state it renders (read-only glance)', () => {
    const s = metered()
    const snap = JSON.parse(JSON.stringify(s))
    renderStatuslineSegment(s, 'en', false)
    expect(s).toEqual(snap)
  })
})

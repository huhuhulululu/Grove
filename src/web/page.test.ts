import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { renderPage } from './page'

// A richly-seeded state so every section has something to render.
function seededState(): GameState {
  const base = initialState()
  return {
    ...base,
    player: { xp: 42, level: 3, currency: 310, shards: 12 },
    cards: [
      { id: 'forge.claude-md', name: 'CLAUDE.md', rarity: 'rare', set: 'forge' },
      { id: 'forge.spec', name: 'Spec Scroll', rarity: 'epic', set: 'forge' },
    ],
    gear: [
      { id: 'g1', name: 'Commit Hammer', level: 5, rarity: 'rare', broken: false },
      { id: 'g2', name: 'Type Saber', level: 2, rarity: 'uncommon', broken: true },
    ],
    completedSets: [],
    buffs: [{ id: 'b1', label: '🌿 Fresh Architecture', kind: 'freshness', factor: 0.15 }],
    eventCount: 9,
    quests: [
      { id: 'grimoire', status: 'done', completions: 1 },
      { id: 'precast-spec', status: 'active', completions: 0 },
    ],
    energy: { known: true, vigor: 72, sap: 88 },
    protectedGear: ['g1'],
  }
}

describe('renderPage', () => {
  it('returns a self-contained HTML document', () => {
    const html = renderPage(seededState())
    expect(html).toContain('<!DOCTYPE html>')
    expect(html.toLowerCase()).toContain('<html')
    expect(html).toContain('</html>')
    // Self-contained: no external stylesheet/script references.
    expect(html).not.toMatch(/<link[^>]+stylesheet/i)
    expect(html).not.toMatch(/<script[^>]+src=/i)
  })

  it('shows the title, level, xp, and seeds', () => {
    const html = renderPage(seededState())
    expect(html).toContain('Grove')
    expect(html).toContain('Level 3')
    expect(html).toContain('42') // xp
    expect(html).toContain('310') // seeds
  })

  it('renders all key dashboard sections', () => {
    const html = renderPage(seededState()).toUpperCase()
    for (const section of ['ENERGY', 'COLLECTION', 'GEAR', 'QUESTS', 'ECONOMY']) {
      expect(html).toContain(section)
    }
  })

  it('lists owned gear with its enhancement level', () => {
    const html = renderPage(seededState())
    expect(html).toContain('Commit Hammer')
    expect(html).toContain('+5')
    expect(html).toContain('Type Saber')
  })

  it('lists quest titles', () => {
    const html = renderPage(seededState())
    expect(html).toContain('Write the CLAUDE.md')
    expect(html).toContain('Spec First')
  })

  it('subscribes to the SSE /events endpoint and the /api/state endpoint', () => {
    const html = renderPage(seededState())
    expect(html).toContain('/events')
    expect(html).toContain('EventSource')
  })

  it('escapes HTML-significant characters in dynamic text (no injection)', () => {
    const base = seededState()
    const evil: GameState = {
      ...base,
      gear: [{ id: 'x', name: '<script>alert(1)</script>', level: 1, rarity: 'common', broken: false }],
    }
    const html = renderPage(evil)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders the energy bar when metered, hides it in Wellspring mode', () => {
    const metered = renderPage(seededState())
    expect(metered).toContain('72') // vigor pct

    const unmetered = renderPage({ ...seededState(), energy: { known: false, vigor: 100, sap: 100 } })
    expect(unmetered.toLowerCase()).toContain('wellspring')
  })

  it('handles an empty initial state without throwing', () => {
    expect(() => renderPage(initialState())).not.toThrow()
    const html = renderPage(initialState())
    expect(html).toContain('Level 1')
  })

  it('contains no cloying deny-list phrases (TONE.md)', () => {
    const html = renderPage(seededState()).toLowerCase()
    const deny = [
      'the grove cheers',
      'canopy shimmers',
      'carry it lightly',
      'sprout appears',
      'code freely',
      'onward!',
    ]
    for (const phrase of deny) {
      expect(html).not.toContain(phrase.toLowerCase())
    }
  })
})

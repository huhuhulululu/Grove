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

  it('includes the collapsible "How to play" tutorial (default open), localized', () => {
    const en = renderPage(seededState())
    // English: a <details> guide with the title + a couple of section bodies.
    expect(en).toContain('<details class="guide"')
    expect(en).toContain('How to play')
    expect(en).toContain('The loop')
    expect(en).toContain('Commands')
    // collapse-state persistence wired (local only, no network).
    expect(en).toContain('grove-guide')

    // Localized: zh-CN + ja render translated tutorial copy.
    const zh = renderPage(seededState(), 'zh-CN')
    expect(zh).toContain('怎么玩')
    expect(zh).toContain('核心循环')
    const ja = renderPage(seededState(), 'ja')
    expect(ja).toContain('遊び方')
    expect(ja).toContain('ループ')
  })

  it('live-updates via the SSE snapshot WITHOUT a full location.reload()', () => {
    const html = renderPage(seededState())
    // R8: the page applies the JSON snapshot to the DOM rather than reloading.
    expect(html).not.toContain('location.reload')
    // The client parses the SSE data payload (JSON.parse) and patches the DOM.
    expect(html).toContain('JSON.parse')
  })

  it('surfaces ODDS/economy decision-point info (pity, realized odds, spark)', () => {
    const html = renderPage(seededState())
    const upper = html.toUpperCase()
    expect(upper).toContain('ODDS')
    const lower = html.toLowerCase()
    expect(lower).toContain('pity')
    expect(lower).toMatch(/legendary|shiny/)
    expect(lower).toContain('spark')
    expect(lower).toContain('foil')
  })

  it('SSE client rebuilds pity line WITH the localized prefix (not bare numbers)', () => {
    // The server renders e.g. "🎯 pity 0/50 · N to hard" into the span; the JS
    // live-patch must reconstruct the SAME full string so the prefix is never lost.
    const en = renderPage(seededState(), 'en')
    // The prefix constants must be present in the script block.
    expect(en).toContain('TXT_PITY_PREFIX')
    expect(en).toContain('TXT_SPARK_PREFIX')
    // The patch call must use TXT_PITY_PREFIX and TXT_SPARK_PREFIX, not bare numbers.
    expect(en).toMatch(/setText\('pity',\s*TXT_PITY_PREFIX/)
    expect(en).toMatch(/setText\('spark',\s*TXT_SPARK_PREFIX/)
  })

  it('SSE pity prefix is locale-aware (zh-CN uses 保底 prefix)', () => {
    const zh = renderPage(seededState(), 'zh-CN')
    // zh-CN pity template: '🎯 保底 {since}/{hard} {status}' — prefix must be present in script
    expect(zh).toContain('保底')
    // The prefix extracted into JS constant must also be in the script (not just the initial render)
    expect(zh).toContain('TXT_PITY_PREFIX')
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

  it('renders the language switcher with all four ?lang= links', () => {
    const html = renderPage(seededState())
    // All four locale query-string links must be present.
    expect(html).toContain('?lang=en')
    expect(html).toContain('?lang=zh-CN')
    expect(html).toContain('?lang=ja')
    expect(html).toContain('?lang=ko')
    // Endonyms used as labels.
    expect(html).toContain('English')
    expect(html).toContain('中文')
    expect(html).toContain('日本語')
    expect(html).toContain('한국어')
    // Active locale is marked.
    expect(html).toContain('class="lang-active"')
  })

  it('marks the active locale in the language switcher', () => {
    const enHtml = renderPage(seededState(), 'en')
    expect(enHtml).toContain('<a href="?lang=en" class="lang-active">English</a>')

    const zhHtml = renderPage(seededState(), 'zh-CN')
    expect(zhHtml).toContain('<a href="?lang=zh-CN" class="lang-active">中文</a>')

    const jaHtml = renderPage(seededState(), 'ja')
    expect(jaHtml).toContain('<a href="?lang=ja" class="lang-active">日本語</a>')
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

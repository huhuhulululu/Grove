/**
 * render.test.tsx — the live Ink <App> component, exercised with
 * ink-testing-library. Verifies the component renders the view-model and that a
 * simulated key dispatch routes to the right engine action against a temp home.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import React from 'react'
import { render } from 'ink-testing-library'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { cardFromDef, ALL_CARD_DEFS } from '../core/cards'
import { makeGear } from '../engine/gear'
import { mulberry32 } from '../core/rng'
import { PULL_COST } from '../engine/reduce'
import { loadState, saveState, withStateLock } from '../store/store'
import { App, dispatchKey } from './app'

describe('<App> — live Ink component', () => {
  let home: string
  let dir: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-tui-app-'))
    dir = path.join(home, 'repo')
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('renders the header + panels from the loaded state', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 6, currency: 88, shards: 0 },
    }
    saveState(dir, state)

    const { lastFrame, unmount } = render(<App dir={dir} initial={state} seed={1} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Level 6')
    expect(frame).toContain('88')
    expect(frame).toMatch(/COLLECTION/i)
    unmount()
  })

  it('renders a state that already reflects a pulled card', () => {
    // The live <App>'s action runner dispatches + persists under withStateLock;
    // that persist path is exercised directly here (the same code the keypress
    // handler runs) so the persisted state is asserted deterministically. NOTE:
    // ink-testing-library's mock stdin does NOT drive ink's useInput (no TTY/raw
    // mode under vitest), so the keypress→action wiring is verified via the pure
    // dispatchKey + runTui(once) tests in app.test.ts, not flaky stdin writes.
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: PULL_COST, shards: 0 },
    }
    saveState(dir, state)

    // Run the exact persist path the App's runAction uses.
    withStateLock(dir, () => {
      const fresh = loadState(dir)
      const out = dispatchKey(fresh, 'p', 'Economy', mulberry32(42))
      if (out.changed) saveState(dir, out.state)
      return out
    })

    const persisted = loadState(dir)
    expect(persisted.cards.length).toBe(1)
    expect(persisted.player.currency).toBe(0)

    // And the App renders that persisted state's header.
    const { lastFrame, unmount } = render(<App dir={dir} initial={persisted} seed={42} />)
    expect(lastFrame() ?? '').toContain('🌰 0 seeds')
    unmount()
  })

  it('renders rarity-tinted collection + gear rows without crashing (animate off)', () => {
    // A legendary card + a rare gear exercise the rarity-as-colour row paths.
    const legendary = cardFromDef(ALL_CARD_DEFS.find((d) => d.rarity === 'legendary')!)
    const gear = { ...makeGear(mulberry32(2)), name: 'Commit Hammer', level: 4, broken: false, rarity: 'rare' as const }
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 12, currency: 0, shards: 0 },
      cards: [legendary],
      gear: [gear],
    }
    saveState(dir, state)

    const { lastFrame, unmount } = render(<App dir={dir} initial={state} seed={1} animate={false} />)
    const frame = lastFrame() ?? ''
    // The set the legendary belongs to + the gear name both render.
    expect(frame).toContain(legendary.set)
    expect(frame).toContain('Commit Hammer')
    unmount()
  })

  it('mounts with animate enabled without throwing (the reveal-stepper wiring)', () => {
    const state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 0, shards: 0 } }
    saveState(dir, state)
    const { lastFrame, unmount } = render(<App dir={dir} initial={state} seed={1} animate />)
    expect(lastFrame() ?? '').toMatch(/GROVE/)
    unmount()
  })

  it('renders Chinese panel labels when locale="zh-CN"', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 3, currency: 50, shards: 0 },
    }
    saveState(dir, state)
    const { lastFrame, unmount } = render(<App dir={dir} initial={state} seed={1} locale="zh-CN" />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('收藏')
    expect(frame).toContain('装备')
    expect(frame).toContain('任务')
    expect(frame).toContain('经济')
    expect(frame).toContain('退出')
    unmount()
  })
})

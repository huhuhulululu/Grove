/**
 * app.test.ts — the navigable Ink TUI over the existing engine.
 *
 *  - renderTuiFrame(state): a single static frame string for headless/CI testing.
 *  - dispatchKey(state, key, focus, rng): the PURE action router that maps a key
 *    (p/e/c/r + nav) onto the EXISTING engine action and returns the next state +
 *    rewards (the impure runTui loop persists this under withStateLock).
 *  - runTui(dir, { once }): renders one frame to a temp home and exits.
 *
 * The router NEVER re-implements game logic — it calls pull / enhance / craftCard /
 * buyPrestige from the engine. Tests use deterministic rng + a temp home.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { cardFromDef, CARD_SETS } from '../core/cards'
import { makeGear } from '../engine/gear'
import { mulberry32 } from '../core/rng'
import { PULL_COST } from '../engine/reduce'
import { saveState } from '../store/store'
import { renderTuiFrame, dispatchKey, runTui, pulseTargetFor } from './app'
import type { Reward } from '../core/rewards'
import type { Locale } from '../i18n/types'

describe('renderTuiFrame — static frame for headless testing', () => {
  it('shows the per-set foil marker (✨) for foiled cards', () => {
    const forestCards = CARD_SETS['forest']!.map((d) => cardFromDef(d))
    const state: GameState = { ...initialState(), cards: forestCards, foiled: [forestCards[0]!.id, forestCards[1]!.id] }
    expect(renderTuiFrame(state)).toMatch(/✨2\//) // 2 of forest foiled
  })

  it('shows the Doc Streak count on the quest board when the renewable streak has climbed', () => {
    const state: GameState = { ...initialState(), quests: [{ id: 'doc-streak', status: 'active', completions: 3 }] }
    expect(renderTuiFrame(state)).toContain('🔥3')
  })

  it('shows level / seeds / shards / prestige in the header', () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 12, level: 3, currency: 99, shards: 5 },
      buffs: [{ id: 'prestige:mark', label: 'Prestige 1', kind: 'rest' }],
    }
    const frame = renderTuiFrame(state)
    expect(frame).toContain('Level 3')
    expect(frame).toContain('99')
    expect(frame).toContain('5')
    // Prestige rank is surfaced.
    expect(frame).toMatch(/Prestige/i)
  })

  it('shows the collection, gear and quest sections', () => {
    const forestCards = CARD_SETS['forest']!.slice(0, 2).map((d) => cardFromDef(d))
    const gear = { ...makeGear(mulberry32(2)), name: 'Commit Hammer', level: 4, broken: false }
    const state: GameState = { ...initialState(), cards: forestCards, gear: [gear] }
    const frame = renderTuiFrame(state)

    expect(frame).toMatch(/COLLECTION/i)
    expect(frame).toContain('forest')
    expect(frame).toMatch(/GEAR/i)
    expect(frame).toContain('Commit Hammer')
    expect(frame).toMatch(/QUESTS/i)
    // The Economy/actions footer advertises the action keys.
    expect(frame).toMatch(/ECONOMY/i)
    expect(frame.toLowerCase()).toContain('pull')
  })

  it('reflects a focused panel (the frame marks which panel has focus)', () => {
    const onGear = renderTuiFrame(initialState(), { focus: 'Gear' })
    const onQuests = renderTuiFrame(initialState(), { focus: 'Quests' })
    expect(onGear).not.toEqual(onQuests)
  })

  it('zh-CN locale renders Chinese panel labels and key hints', () => {
    const locale: Locale = 'zh-CN'
    const frame = renderTuiFrame(initialState(), { locale })
    // Panel labels are Chinese
    expect(frame).toContain('收藏')
    expect(frame).toContain('装备')
    expect(frame).toContain('任务')
    expect(frame).toContain('经济')
    // Key hint is Chinese
    expect(frame).toContain('按键:')
    expect(frame).toContain('退出')
    // English default is NOT the key hint
    expect(frame).not.toContain('keys: p pull')
  })

  it('ko locale renders Korean panel labels and key hints', () => {
    const locale: Locale = 'ko'
    const frame = renderTuiFrame(initialState(), { locale })
    // Panel labels are Korean
    expect(frame).toContain('컬렉션')
    expect(frame).toContain('장비')
    expect(frame).toContain('퀘스트')
    expect(frame).toContain('경제')
    // Key hint is Korean
    expect(frame).toContain('키:')
    expect(frame).toContain('종료')
  })

  it('en locale (default) byte-identical: panel labels and key legend unchanged', () => {
    const withLocale = renderTuiFrame(initialState(), { locale: 'en' })
    const withDefault = renderTuiFrame(initialState())
    expect(withLocale).toBe(withDefault)
    // Spot-check English labels remain
    expect(withDefault).toContain('COLLECTION')
    expect(withDefault).toContain('GEAR')
    expect(withDefault).toContain('QUESTS')
    expect(withDefault).toContain('ECONOMY')
    expect(withDefault).toContain('keys: p pull')
    expect(withDefault).toContain('q quit')
  })

  it('shows LOADOUT panel with empty slots in the default frame', () => {
    const frame = renderTuiFrame(initialState())
    expect(frame).toContain('LOADOUT')
    // 3 empty slots visible
    expect(frame).toContain('[1] empty')
    expect(frame).toContain('[2] empty')
    expect(frame).toContain('[3] empty')
  })

  it('shows ACHIEVEMENTS panel with count summary in the default frame', () => {
    const frame = renderTuiFrame(initialState())
    expect(frame).toContain('ACHIEVEMENTS')
    // Summary line: 0/11 unlocked
    expect(frame).toContain('0/')
    expect(frame).toContain('(none yet)')
  })

  it('shows unlocked achievements in the ACHIEVEMENTS panel', () => {
    const state: GameState = {
      ...initialState(),
      achievements: ['ach:level-5'],
      player: { xp: 0, level: 5, currency: 0, shards: 0 },
    }
    const frame = renderTuiFrame(state)
    expect(frame).toContain('Finding Footing')
    expect(frame).toContain('1/')
  })

  it('shows filled loadout slots and active synergies when equipped', () => {
    const state: GameState = {
      ...initialState(),
      loadout: {
        slots: [
          { kind: 'card', id: 'forest.sapling', tag: 'forest' },
        ],
      },
    }
    const frame = renderTuiFrame(state)
    expect(frame).toContain('[1] card · forest')
    expect(frame).toContain('[2] empty')
  })

  it('zen suppresses LOADOUT and ACHIEVEMENTS panels', () => {
    const frame = renderTuiFrame(initialState(), { zen: true })
    expect(frame).not.toContain('LOADOUT')
    expect(frame).not.toContain('ACHIEVEMENTS')
    // But still shows the core panels
    expect(frame).toContain('COLLECTION')
    expect(frame).toContain('ECONOMY')
  })
})

describe('dispatchKey — pure key → engine action router', () => {
  it("routes 'p' to a pull when affordable (debits seeds, adds a card)", () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: PULL_COST, shards: 0 },
    }
    const rng = mulberry32(42)
    const out = dispatchKey(state, 'p', 'Economy', rng)

    expect(out.changed).toBe(true)
    expect(out.state.player.currency).toBe(0) // PULL_COST debited
    expect(out.state.cards.length).toBe(1) // one card pulled
    expect(out.rewards.some((r) => r.kind === 'card')).toBe(true)
  })

  it("'p' when broke is a calm no-op (no debit, no card, no crash)", () => {
    const rng = mulberry32(1)
    const out = dispatchKey(initialState(), 'p', 'Economy', rng)
    expect(out.state.cards.length).toBe(0)
    expect(out.state.player.currency).toBe(0)
    // The engine still pushes a friendly 'not enough' reward; nothing changed.
    expect(out.changed).toBe(false)
  })

  it("routes 'e' to an enhance on the FOCUSED gear", () => {
    const gear = { ...makeGear(mulberry32(3)), name: 'Build Anvil', level: 0, broken: false }
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 500, shards: 0 },
      gear: [gear],
    }
    const rng = mulberry32(7)
    // focusedGearIndex 0 is the only gear.
    const out = dispatchKey(state, 'e', 'Gear', rng, { focusedGearIndex: 0 })
    expect(out.changed).toBe(true)
    // level 0..3 always succeeds → +1, and seeds were debited.
    expect(out.state.gear[0]!.level).toBe(1)
    expect(out.state.player.currency).toBeLessThan(500)
  })

  it("routes 'c' to a craft when shards suffice", () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 0, shards: 60 },
    }
    const out = dispatchKey(state, 'c', 'Economy', mulberry32(9))
    expect(out.changed).toBe(true)
    expect(out.state.cards.length).toBe(1)
    expect(out.state.player.shards).toBe(0)
  })

  it("'r' (refresh) is a no-op on state (re-read only) — changed=false", () => {
    const out = dispatchKey(initialState(), 'r', 'Economy', mulberry32(1))
    expect(out.changed).toBe(false)
    expect(out.state).toEqual(initialState())
  })

  it('an unmapped key is a calm no-op', () => {
    const out = dispatchKey(initialState(), 'x', 'Economy', mulberry32(1))
    expect(out.changed).toBe(false)
  })

  it("'e' on an already-broken gear yields the canonical '– broken' line (not 'no change')", () => {
    const gear = { ...makeGear(mulberry32(3)), name: 'Build Anvil', level: 4, broken: true }
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 500, shards: 0 },
      gear: [gear],
    }
    const out = dispatchKey(state, 'e', 'Gear', mulberry32(7), { focusedGearIndex: 0 })
    const msg = out.rewards.find((r) => r.kind === 'gear')?.message ?? ''
    // Canonical loot grammar (TONE.md / render/enhance.ts) — no stale 中二/typo tokens.
    expect(msg).toContain('– broken')
    expect(msg).not.toContain('no change')
    expect(msg).not.toContain('SHATTERED') // a 'stay' is not a shatter
  })

  it("a successful 'e' enhance renders the canonical '✓ success' token", () => {
    const gear = { ...makeGear(mulberry32(3)), name: 'Build Anvil', level: 0, broken: false }
    const state: GameState = {
      ...initialState(),
      player: { xp: 0, level: 1, currency: 500, shards: 0 },
      gear: [gear],
    }
    // level 0..3 always succeeds.
    const out = dispatchKey(state, 'e', 'Gear', mulberry32(7), { focusedGearIndex: 0 })
    const msg = out.rewards.find((r) => r.kind === 'gear')?.message ?? ''
    expect(msg).toContain('✓ success')
    expect(msg).not.toContain('broke') // never the old typo token
  })
})

describe('pulseTargetFor — the freshly-acquired row to pulse (panel motion)', () => {
  it('a card reward pulses its COLLECTION set row', () => {
    const r: Reward = {
      kind: 'card',
      message: '🃏 Sapling · common',
      card: { id: 'c1', name: 'Sapling', rarity: 'common', set: 'forest' },
    }
    expect(pulseTargetFor(r)).toEqual({ kind: 'collection', key: 'forest' })
  })

  it('a gear reward pulses its GEAR row (by id)', () => {
    const r: Reward = {
      kind: 'gear',
      message: 'ENHANCE +3→+4 · ✓ success',
      gear: { id: 'g1', name: 'Commit Hammer', level: 4, rarity: 'rare', broken: false },
    }
    expect(pulseTargetFor(r)).toEqual({ kind: 'gear', key: 'g1' })
  })

  it('a non-card/non-gear reward (level-up / currency) pulses nothing', () => {
    expect(pulseTargetFor({ kind: 'levelup', message: 'Level 4', amount: 4 })).toBeNull()
    expect(pulseTargetFor({ kind: 'currency', message: '✨ windfall · +20 🌰', amount: 20 })).toBeNull()
  })

  it('returns null for a null salient reward (no pulse on a no-op)', () => {
    expect(pulseTargetFor(null)).toBeNull()
  })
})

describe('runTui — interactive loop entry (once mode for CI)', () => {
  let home: string
  let dir: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-tui-'))
    dir = path.join(home, 'repo')
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('renders one frame from persisted state and exits when opts.once', async () => {
    const state: GameState = {
      ...initialState(),
      player: { xp: 5, level: 4, currency: 77, shards: 0 },
    }
    saveState(dir, state)

    const frame = await runTui(dir, { once: true })
    expect(typeof frame).toBe('string')
    expect(frame).toContain('Level 4')
    expect(frame).toContain('77')
  })
})

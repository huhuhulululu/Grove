/**
 * render/achievements.test.ts — TDD tests for the pure achievements renderer.
 *
 * Verifies:
 *  - DEFAULT (showAll=false, zen=false): unlocked only
 *  - --all (showAll=true, zen=false): unlocked + locked sections
 *  - --zen (isZen=true): terse count, no list
 *  - Locale smoke (zh-CN title key differs from en)
 */
import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { ACHIEVEMENTS } from '../core/achievements'
import { renderAchievementsPanel } from './achievements'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a state with specific achievement ids already unlocked. */
function withUnlocked(ids: string[]): GameState {
  return { ...initialState(), achievements: ids }
}

/** State with the first achievement unlocked (ach:level-5). */
function stateWithOneUnlocked(): GameState {
  return withUnlocked(['ach:level-5'])
}

// ---------------------------------------------------------------------------
// Default surface: unlocked-only
// ---------------------------------------------------------------------------

describe('renderAchievementsPanel — default (showAll=false, zen=false)', () => {
  it('shows the ACHIEVEMENTS title', () => {
    const out = renderAchievementsPanel(initialState(), false, false)
    expect(out).toContain('ACHIEVEMENTS')
  })

  it('shows (none yet) when nothing is unlocked', () => {
    const out = renderAchievementsPanel(initialState(), false, false)
    expect(out).toContain('none yet')
  })

  it('shows unlocked achievement name and desc', () => {
    const def = ACHIEVEMENTS.find((a) => a.id === 'ach:level-5')!
    const out = renderAchievementsPanel(stateWithOneUnlocked(), false, false)
    expect(out).toContain(def.name)
    expect(out).toContain(def.desc)
  })

  it('does NOT show locked achievements by default', () => {
    // With one unlocked, all others are locked — they must not appear.
    const out = renderAchievementsPanel(stateWithOneUnlocked(), false, false)
    const locked = ACHIEVEMENTS.filter((a) => a.id !== 'ach:level-5')
    for (const a of locked) {
      expect(out).not.toContain(a.name)
    }
  })

  it('does not include a "locked:" header by default', () => {
    const out = renderAchievementsPanel(stateWithOneUnlocked(), false, false)
    expect(out).not.toContain('locked:')
  })

  it('does not mutate the state', () => {
    const s = stateWithOneUnlocked()
    const snap = JSON.parse(JSON.stringify(s)) as GameState
    renderAchievementsPanel(s, false, false)
    expect(s).toEqual(snap)
  })
})

// ---------------------------------------------------------------------------
// --all: also shows locked achievements
// ---------------------------------------------------------------------------

describe('renderAchievementsPanel — showAll=true', () => {
  it('shows both unlocked and locked sections when some are unlocked', () => {
    const out = renderAchievementsPanel(stateWithOneUnlocked(), true, false)
    // Unlocked section present.
    const unlockedDef = ACHIEVEMENTS.find((a) => a.id === 'ach:level-5')!
    expect(out).toContain(unlockedDef.name)
    // Locked header present.
    expect(out).toContain('locked:')
    // At least one locked achievement name present.
    const lockedDef = ACHIEVEMENTS.find((a) => a.id !== 'ach:level-5')!
    expect(out).toContain(lockedDef.name)
  })

  it('shows ALL achievement names when nothing is unlocked', () => {
    const out = renderAchievementsPanel(initialState(), true, false)
    expect(out).toContain('locked:')
    for (const a of ACHIEVEMENTS) {
      expect(out).toContain(a.name)
    }
  })

  it('shows NO locked section when everything is unlocked', () => {
    const allIds = ACHIEVEMENTS.map((a) => a.id)
    const out = renderAchievementsPanel(withUnlocked(allIds), true, false)
    expect(out).not.toContain('locked:')
    for (const a of ACHIEVEMENTS) {
      expect(out).toContain(a.name)
    }
  })
})

// ---------------------------------------------------------------------------
// --zen: terse count, no list, no nag
// ---------------------------------------------------------------------------

describe('renderAchievementsPanel — zen=true', () => {
  it('returns a count string, not the full panel', () => {
    const out = renderAchievementsPanel(stateWithOneUnlocked(), false, true)
    // Should contain the fraction e.g. "1/12"
    expect(out).toContain('1/')
    expect(out).toContain(String(ACHIEVEMENTS.length))
  })

  it('does not contain ACHIEVEMENTS title under zen', () => {
    const out = renderAchievementsPanel(stateWithOneUnlocked(), false, true)
    expect(out).not.toContain('ACHIEVEMENTS')
  })

  it('does not list achievement names under zen', () => {
    const out = renderAchievementsPanel(stateWithOneUnlocked(), false, true)
    for (const a of ACHIEVEMENTS) {
      expect(out).not.toContain(a.name)
    }
  })

  it('--all flag is irrelevant under zen (still terse count only)', () => {
    const outNoAll = renderAchievementsPanel(stateWithOneUnlocked(), false, true)
    const outAll = renderAchievementsPanel(stateWithOneUnlocked(), true, true)
    expect(outNoAll).toBe(outAll)
  })
})

// ---------------------------------------------------------------------------
// Locale smoke
// ---------------------------------------------------------------------------

describe('renderAchievementsPanel — locale smoke', () => {
  it('zh-CN title differs from en title', () => {
    const en = renderAchievementsPanel(initialState(), false, false, 'en')
    const zhCN = renderAchievementsPanel(initialState(), false, false, 'zh-CN')
    // zh-CN should have the Chinese title key, not the English one.
    expect(en.split('\n')[0]).toBe('ACHIEVEMENTS')
    expect(zhCN.split('\n')[0]).toBe('成就')
  })

  it('ja produces a non-English first line', () => {
    const ja = renderAchievementsPanel(initialState(), false, false, 'ja')
    expect(ja.split('\n')[0]).toBe('アチーブメント')
  })

  it('ko produces a non-English first line', () => {
    const ko = renderAchievementsPanel(initialState(), false, false, 'ko')
    expect(ko.split('\n')[0]).toBe('업적')
  })
})

// ---------------------------------------------------------------------------
// No em-dash in any output line (ADR-0009 / ADR-0015 tone rule)
// ---------------------------------------------------------------------------

describe('renderAchievementsPanel — tone: no em-dash', () => {
  it('output never contains an em-dash character', () => {
    const out = renderAchievementsPanel(initialState(), true, false)
    expect(out.includes('—')).toBe(false)
  })
})

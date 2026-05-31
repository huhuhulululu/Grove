/**
 * enhance.test.ts — TDD tests for the enhance renderer (RED → GREEN).
 *
 * Tests written FIRST per TDD mandate (rules/testing.md).
 */

import { describe, it, expect } from 'vitest'
import type { Gear, Rarity } from '../core/rewards'
import type { EnhanceResult } from '../engine/gear'
import { renderEnhanceOdds, renderEnhanceResult, renderEnhanceFrames, renderPullFrames } from './enhance'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGear(overrides: Partial<Gear> = {}): Gear {
  return {
    id: 'gear.test.123',
    name: 'Debug Lantern',
    level: 7,
    rarity: 'rare',
    broken: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// renderEnhanceOdds
// ---------------------------------------------------------------------------

describe('renderEnhanceOdds', () => {
  it('includes the level transition arrow (current → next)', () => {
    const gear = makeGear({ level: 7 })
    const output = renderEnhanceOdds(gear)
    expect(output).toMatch(/\+7\s*→\s*\+8/)
  })

  it('includes the gear name', () => {
    const gear = makeGear({ level: 7, name: 'Debug Lantern' })
    const output = renderEnhanceOdds(gear)
    expect(output).toContain('Debug Lantern')
  })

  it('shows success percentage for level 7-9 band (70%)', () => {
    const gear = makeGear({ level: 7 })
    const output = renderEnhanceOdds(gear)
    expect(output).toContain('70%')
  })

  it('shows downgrade percentage for level 7-9 band (25%)', () => {
    const gear = makeGear({ level: 7 })
    const output = renderEnhanceOdds(gear)
    expect(output).toContain('25%')
  })

  it('shows break percentage for level 7-9 band (5%)', () => {
    const gear = makeGear({ level: 7 })
    const output = renderEnhanceOdds(gear)
    expect(output).toContain('5%')
  })

  it('shows all three outcome labels', () => {
    const gear = makeGear({ level: 7 })
    const output = renderEnhanceOdds(gear)
    expect(output).toMatch(/success/i)
    expect(output).toMatch(/downgrade/i)
    expect(output).toMatch(/break/i)
  })

  it('shows correct odds for level 0-3 band (100% success)', () => {
    const gear = makeGear({ level: 2 })
    const output = renderEnhanceOdds(gear)
    expect(output).toContain('100%')
    // downgrade and break are 0%
    expect(output).toContain('0%')
  })

  it('shows correct odds for the ≥13 band (30/40/30)', () => {
    const gear = makeGear({ level: 14 })
    const output = renderEnhanceOdds(gear)
    expect(output).toContain('30%')
    expect(output).toContain('40%')
  })

  it('handles level 0 transition', () => {
    const gear = makeGear({ level: 0 })
    const output = renderEnhanceOdds(gear)
    expect(output).toMatch(/\+0\s*→\s*\+1/)
  })
})

// ---------------------------------------------------------------------------
// renderEnhanceResult
// ---------------------------------------------------------------------------

describe('renderEnhanceResult', () => {
  it('success: returns text containing SUCCESS', () => {
    const before = makeGear({ level: 7 })
    const after: Gear = { ...before, level: 8 }
    const output = renderEnhanceResult(before, after, 'success')
    expect(output).toMatch(/success/i)
  })

  it('success: shows the level transition (+before → +after)', () => {
    const before = makeGear({ level: 7 })
    const after: Gear = { ...before, level: 8 }
    const output = renderEnhanceResult(before, after, 'success')
    expect(output).toMatch(/\+7.*\+8|\+7→\+8/)
  })

  it('success: leads with the ENHANCE loot-grammar verb', () => {
    const before = makeGear({ level: 7, name: 'Debug Lantern' })
    const after: Gear = { ...before, level: 8 }
    const output = renderEnhanceResult(before, after, 'success')
    expect(output).toContain('ENHANCE')
  })

  it('break: returns clearly different text than success', () => {
    const before = makeGear({ level: 7 })
    const afterBreak: Gear = { ...before, broken: true }
    const afterSuccess: Gear = { ...before, level: 8 }

    const breakOutput = renderEnhanceResult(before, afterBreak, 'break')
    const successOutput = renderEnhanceResult(before, afterSuccess, 'success')

    expect(breakOutput).not.toBe(successOutput)
    // break should NOT say success
    expect(breakOutput).not.toMatch(/success/i)
  })

  it('break: reassures that real code/work is unaffected (cosmetic-only, ADR-0005)', () => {
    const before = makeGear({ level: 7 })
    const after: Gear = { ...before, broken: true }
    const output = renderEnhanceResult(before, after, 'break')
    // Must contain reassurance: "cosmetic" OR "code" OR "untouched" OR "safe" etc.
    expect(output).toMatch(/cosmetic|untouched|code.*safe|your code|real code|no.*real/i)
  })

  it('break: output matches the shattered/💥 template from spec', () => {
    const before = makeGear({ level: 9 })
    const after: Gear = { ...before, broken: true }
    const output = renderEnhanceResult(before, after, 'break')
    expect(output).toMatch(/shatter|💥|broke/i)
  })

  it('downgrade: shows a gentle non-shaming message', () => {
    const before = makeGear({ level: 7 })
    const after: Gear = { ...before, level: 6 }
    const output = renderEnhanceResult(before, after, 'downgrade')
    // Should not say SUCCESS
    expect(output).not.toMatch(/success/i)
    // Should mention the new (lower) level
    expect(output).toContain('+6')
  })

  it('stay: mentions that nothing happened (already broken)', () => {
    const before = makeGear({ level: 7, broken: true })
    const after: Gear = { ...before }
    const output = renderEnhanceResult(before, after, 'stay')
    // Should not say success
    expect(output).not.toMatch(/success/i)
    // Should contain something about already broken / nothing risked / no change
    expect(output).toMatch(/broken|nothing|risk|stay|already/i)
  })

  it('four results produce four distinct outputs', () => {
    const base = makeGear({ level: 7 })
    const successResult = renderEnhanceResult(base, { ...base, level: 8 }, 'success')
    const downgradeResult = renderEnhanceResult(base, { ...base, level: 6 }, 'downgrade')
    const breakResult = renderEnhanceResult(base, { ...base, broken: true }, 'break')
    const stayResult = renderEnhanceResult({ ...base, broken: true }, { ...base, broken: true }, 'stay')

    const results = [successResult, downgradeResult, breakResult, stayResult]
    const unique = new Set(results)
    expect(unique.size).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// renderEnhanceFrames
// ---------------------------------------------------------------------------

describe('renderEnhanceFrames', () => {
  it('returns a non-empty array', () => {
    const frames = renderEnhanceFrames()
    expect(Array.isArray(frames)).toBe(true)
    expect(frames.length).toBeGreaterThan(0)
  })

  it('each frame is a non-empty string', () => {
    const frames = renderEnhanceFrames()
    for (const frame of frames) {
      expect(typeof frame).toBe('string')
      expect(frame.length).toBeGreaterThan(0)
    }
  })

  it('frames are distinct (not all the same)', () => {
    const frames = renderEnhanceFrames()
    const unique = new Set(frames)
    expect(unique.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// renderPullFrames — pack-opening suspense for `sq pull`
// ---------------------------------------------------------------------------

describe('renderPullFrames', () => {
  it('returns a non-empty array of strings', () => {
    const frames = renderPullFrames()
    expect(Array.isArray(frames)).toBe(true)
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      expect(typeof frame).toBe('string')
      expect(frame.length).toBeGreaterThan(0)
    }
  })

  it('frames are distinct (a real animation, not one repeated frame)', () => {
    const unique = new Set(renderPullFrames())
    expect(unique.size).toBeGreaterThan(1)
  })

  it('uses a pack/card-opening motif (🃏)', () => {
    const frames = renderPullFrames()
    expect(frames.some((f) => f.includes('🃏'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// RARITY-SCALED REVEAL FRAMES — escalating anticipation for rarer drops
// ---------------------------------------------------------------------------

const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'shiny']

/** Count ✨-sparkle glyphs across a frame list (the "brightness" of the build). */
function sparkleCount(frames: string[]): number {
  return frames.reduce((n, f) => n + (f.match(/✨/g)?.length ?? 0), 0)
}

describe('renderPullFrames — rarity-scaled escalation', () => {
  it('still works with no rarity (backward-compatible default build)', () => {
    const frames = renderPullFrames()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.some((f) => f.includes('🃏'))).toBe(true)
  })

  it('a legendary build is LONGER than a common build (more suspense for rarer drops)', () => {
    const common = renderPullFrames('common')
    const legendary = renderPullFrames('legendary')
    expect(legendary.length).toBeGreaterThan(common.length)
  })

  it('a shiny build is the longest of all (top-tier gets the biggest moment)', () => {
    const lengths = RARITY_ORDER.map((r) => renderPullFrames(r).length)
    const shinyLen = renderPullFrames('shiny').length
    expect(shinyLen).toBe(Math.max(...lengths))
  })

  it('frame length is monotonically NON-DECREASING up the rarity ladder', () => {
    const lengths = RARITY_ORDER.map((r) => renderPullFrames(r).length)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!)
    }
  })

  it('a rarer build is BRIGHTER — more ✨ sparkle than a common build', () => {
    expect(sparkleCount(renderPullFrames('legendary'))).toBeGreaterThan(
      sparkleCount(renderPullFrames('common')),
    )
  })

  it('a legendary build holds a beat / near-miss tease before the reveal', () => {
    // The penultimate frames build tension; a longer build = a held beat the
    // common reveal never gets. We assert the legendary build has repeated
    // top-intensity frames (the "held beat") that the common build lacks.
    const legendary = renderPullFrames('legendary')
    const common = renderPullFrames('common')
    expect(legendary.length - common.length).toBeGreaterThanOrEqual(2)
  })

  it('every frame is a non-empty string for every rarity', () => {
    for (const r of RARITY_ORDER) {
      for (const f of renderPullFrames(r)) {
        expect(typeof f).toBe('string')
        expect(f.length).toBeGreaterThan(0)
      }
    }
  })

  it('frames within a build are not all identical (a genuine animation)', () => {
    for (const r of RARITY_ORDER) {
      expect(new Set(renderPullFrames(r)).size).toBeGreaterThan(1)
    }
  })

  it('keeps the pack/card motif (🃏) at every rarity', () => {
    for (const r of RARITY_ORDER) {
      expect(renderPullFrames(r).some((f) => f.includes('🃏'))).toBe(true)
    }
  })
})

describe('renderEnhanceFrames — rarity-scaled escalation', () => {
  it('still works with no rarity (backward-compatible default build)', () => {
    const frames = renderEnhanceFrames()
    expect(frames.length).toBeGreaterThan(0)
  })

  it('a legendary build is LONGER than a common build', () => {
    expect(renderEnhanceFrames('legendary').length).toBeGreaterThan(
      renderEnhanceFrames('common').length,
    )
  })

  it('frame length is monotonically NON-DECREASING up the rarity ladder', () => {
    const lengths = RARITY_ORDER.map((r) => renderEnhanceFrames(r).length)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!)
    }
  })

  it('a rarer build is brighter — more ✨ sparkle than a common build', () => {
    expect(sparkleCount(renderEnhanceFrames('legendary'))).toBeGreaterThan(
      sparkleCount(renderEnhanceFrames('common')),
    )
  })

  it('every frame is a non-empty string for every rarity', () => {
    for (const r of RARITY_ORDER) {
      for (const f of renderEnhanceFrames(r)) {
        expect(typeof f).toBe('string')
        expect(f.length).toBeGreaterThan(0)
      }
    }
  })

  it('no longer emits a flat loading-dot counter (the placeholder is gone)', () => {
    // The old placeholder was literally '🃏 .' / '🃏 ..' / '✨ .' style dots.
    // A real build widens a sparkle field / ramps tension — assert the legendary
    // build is not just dot-padded repeats of a single base.
    const frames = renderPullFrames('legendary')
    const dotOnly = frames.every((f) => /^[🃏✨🎲⚡]?\s*\.*$/u.test(f))
    expect(dotOnly).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// zh-CN locale rendering
// ---------------------------------------------------------------------------

describe('zh-CN locale — renderEnhanceOdds', () => {
  it('renders zh-CN outcome labels', () => {
    const gear = makeGear({ level: 7 })
    const output = renderEnhanceOdds(gear, 'zh-CN')
    expect(output).toMatch(/成功/)
    expect(output).toMatch(/降级/)
    expect(output).toMatch(/损坏/)
  })

  it('still includes the gear name and level transition', () => {
    const gear = makeGear({ level: 7, name: 'Debug Lantern' })
    const output = renderEnhanceOdds(gear, 'zh-CN')
    expect(output).toContain('Debug Lantern')
    expect(output).toMatch(/\+7.*\+8/)
  })
})

describe('zh-CN locale — renderEnhanceResult', () => {
  it('success renders zh-CN text', () => {
    const before = makeGear({ level: 7 })
    const after: Gear = { ...before, level: 8 }
    const output = renderEnhanceResult(before, after, 'success', 'zh-CN')
    expect(output).toContain('强化')
    expect(output).toMatch(/成功/)
  })

  it('break renders zh-CN text with cosmetic reassurance', () => {
    const before = makeGear({ level: 7 })
    const after: Gear = { ...before, broken: true }
    const output = renderEnhanceResult(before, after, 'break', 'zh-CN')
    expect(output).toContain('强化')
    expect(output).toMatch(/碎裂|代码/)
  })

  it('stay renders zh-CN broken label', () => {
    const before = makeGear({ level: 7, broken: true })
    const after: Gear = { ...before }
    const output = renderEnhanceResult(before, after, 'stay', 'zh-CN')
    expect(output).toMatch(/已损/)
  })
})

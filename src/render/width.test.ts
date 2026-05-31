/**
 * width.test.ts — TDD tests for the display-width helper (written BEFORE impl).
 *
 * Box-drawing rows must pad by TERMINAL COLUMNS, not by `.length`: a wide CJK
 * char or an emoji occupies 2 cells but counts as 1 (or 2 with surrogates) in
 * `String.length`, so `.length`-based padding misaligns the right border.
 *
 * Run: npx vitest run src/render/width.test.ts
 */

import { describe, it, expect } from 'vitest'
import { displayWidth, padToWidth, truncateToWidth } from './width'

describe('displayWidth', () => {
  it('counts ASCII as 1 cell each', () => {
    expect(displayWidth('hello')).toBe(5)
    expect(displayWidth('')).toBe(0)
  })

  it('counts a wide CJK char as 2 cells', () => {
    // 暴击 = two full-width CJK chars → 4 cells.
    expect(displayWidth('暴击')).toBe(4)
  })

  it('counts a common emoji as 2 cells', () => {
    // 🌰 / 🎁 / 🃏 are wide. Each is a single astral codepoint → 2 cells.
    expect(displayWidth('🌰')).toBe(2)
    expect(displayWidth('🎁')).toBe(2)
  })

  it('counts a mixed ASCII + emoji string by cells, not by .length', () => {
    // "🌰 5" → emoji(2) + space(1) + '5'(1) = 4 cells, but .length is 3
    // (astral emoji is 2 UTF-16 units) — so .length would say 4, displayWidth 4.
    const s = '🌰 5'
    expect(displayWidth(s)).toBe(4)
  })

  it('does not count zero-width / combining marks as extra cells', () => {
    // A variation selector (U+FE0F) is zero-width; it must not add a cell.
    expect(displayWidth('⚔️')).toBe(displayWidth('⚔'))
  })

  it('treats a box-drawing char (─ │) as 1 cell', () => {
    expect(displayWidth('─')).toBe(1)
    expect(displayWidth('│')).toBe(1)
  })
})

describe('padToWidth', () => {
  it('pads an ASCII string with spaces to the target cell width', () => {
    expect(padToWidth('hi', 5)).toBe('hi   ')
    expect(displayWidth(padToWidth('hi', 5))).toBe(5)
  })

  it('pads an emoji-bearing string to the correct CELL width (not .length)', () => {
    // "🌰 5" is 4 cells; pad to 8 → 4 trailing spaces, total 8 cells.
    const padded = padToWidth('🌰 5', 8)
    expect(displayWidth(padded)).toBe(8)
  })

  it('returns the string unchanged when it already meets the width', () => {
    expect(padToWidth('hello', 5)).toBe('hello')
  })

  it('does not pad when the content is already wider than target', () => {
    // No negative repeat — just return as-is (truncation is a separate concern).
    expect(padToWidth('hello', 3)).toBe('hello')
  })
})

describe('truncateToWidth', () => {
  it('returns the string unchanged when within width', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello')
  })

  it('truncates ASCII to the target cell width', () => {
    expect(truncateToWidth('hello world', 5)).toBe('hello')
    expect(displayWidth(truncateToWidth('hello world', 5))).toBe(5)
  })

  it('never splits a wide char across the boundary (drops it whole)', () => {
    // '🌰🌰🌰' = 6 cells. Truncate to 5 → only two emoji fit (4 cells); the third
    // would overflow to cell 6, so it is dropped whole → 4 cells, never 5.5.
    const out = truncateToWidth('🌰🌰🌰', 5)
    expect(displayWidth(out)).toBeLessThanOrEqual(5)
    // Must not contain a broken surrogate (would render as 3 cells if split).
    expect(displayWidth(out)).toBe(4)
  })
})

import { describe, it, expect } from 'vitest'
import { sparkline } from './sparkline'

const GLYPHS = '▁▂▃▄▅▆▇█'

describe('sparkline (pure, self-scaled reflection)', () => {
  it('maps a 0..max ramp across the full glyph range', () => {
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7])).toBe('▁▂▃▄▅▆▇█')
  })

  it('empty input → "" (graceful)', () => {
    expect(sparkline([])).toBe('')
  })

  it('all-zero → "" (quiet week → no row, never a shaming flat line)', () => {
    expect(sparkline([0, 0, 0, 0, 0, 0, 0])).toBe('')
  })

  it('a single nonzero day rises above the ▁ baseline; zero days stay at baseline', () => {
    const out = sparkline([0, 0, 3, 0, 0, 0, 0])
    expect(out.length).toBe(7)
    expect(out[2]).not.toBe('▁')
    expect(out[0]).toBe('▁')
    expect(out[6]).toBe('▁')
  })

  it('a flat nonzero series renders one calm mid glyph (no fabricated trend)', () => {
    expect(sparkline([4, 4, 4, 4, 4, 4, 4])).toBe('▅▅▅▅▅▅▅')
  })

  it('output length === input length; every glyph is in the 8-glyph set', () => {
    const out = sparkline([1, 5, 2, 8, 0, 3, 9])
    expect(out.length).toBe(7)
    for (const ch of out) expect(GLYPHS.includes(ch)).toBe(true)
  })
})

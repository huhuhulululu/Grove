/**
 * sparkline.ts — a pure, self-scaled unicode sparkline for a small series of counts.
 *
 * Cosmetic REFLECTION only (a calm "this week" trend), NEVER a rank, streak, or
 * cross-week/cross-user comparison — it self-scales to the window's own max. A quiet
 * (empty / all-zero) window returns '' so the caller omits the line entirely (no
 * shaming flat row). Pure: no I/O, no clock.
 */

const GLYPHS = '▁▂▃▄▅▆▇█' // 8 levels, U+2581..U+2588
const BASELINE = '▁'
const MID = '▅'

export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max <= 0) return '' // all-zero / quiet week → nothing, never a shaming flat row
  const min = Math.min(...values)
  // A flat (single distinct value) nonzero series implies no trend — a calm mid glyph,
  // not a maxed-out top row.
  if (min === max) return MID.repeat(values.length)
  const top = GLYPHS.length - 1
  return values
    .map((v) => {
      if (v <= 0) return BASELINE
      // A nonzero day never sits at the ▁ baseline; scale (0, max] → glyph index 1..7.
      const idx = Math.max(1, Math.round((v / max) * top))
      return GLYPHS[idx] ?? MID
    })
    .join('')
}

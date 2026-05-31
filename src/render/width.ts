/**
 * width.ts — terminal display-width helpers (PURE).
 *
 * Box-drawing layout must pad/truncate by how many terminal CELLS a string
 * occupies, NOT by `String.length`. Wide chars (CJK, most emoji) take 2 cells
 * but 1-2 UTF-16 units; zero-width marks (variation selectors, combining marks,
 * ZWJ) take 0 cells. `.length` gets all of these wrong, misaligning the right
 * border on any row that contains an emoji or CJK glyph.
 *
 * This is a compact, dependency-free East-Asian-Width approximation — enough for
 * the loot-grammar emoji (🌰 🎁 🃏 ⚔️ ⚡ 🌿) and CJK copy Grove actually renders.
 * No I/O, no wall-clock.
 */

/** True if a codepoint is zero-width (combining mark / VS / ZWJ / BOM). */
function isZeroWidth(cp: number): boolean {
  return (
    cp === 0x200d || // zero-width joiner
    cp === 0xfeff || // zero-width no-break space / BOM
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space .. RTL/LTR marks
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors (incl. U+FE0F)
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining diacritical marks extended
    (cp >= 0x1dc0 && cp <= 0x1dff) // combining diacritical marks supplement
  )
}

/** True if a codepoint renders 2 cells wide (East-Asian Wide/Fullwidth + emoji). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals .. Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana .. CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs (incl. 🌰🎁🃏🌿)
    (cp >= 0x1f000 && cp <= 0x1f2ff) || // mahjong/dominoes/playing-card/enclosed
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols + dingbats (⚔ ✦ ✨ subset)
    cp === 0x2b50 || // ⭐
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+ (supplementary ideographs)
  )
}

/**
 * The number of terminal cells `s` occupies. Iterates by CODEPOINT (so astral
 * emoji count once), adding 0 for zero-width marks, 2 for wide chars, 1 otherwise.
 */
export function displayWidth(s: string): number {
  let width = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (isZeroWidth(cp)) continue
    width += isWide(cp) ? 2 : 1
  }
  return width
}

/**
 * Right-pad `s` with spaces so it occupies exactly `target` cells. If `s` is
 * already at-or-over `target`, it is returned unchanged (truncation is separate).
 */
export function padToWidth(s: string, target: number): string {
  const w = displayWidth(s)
  if (w >= target) return s
  return s + ' '.repeat(target - w)
}

/**
 * Truncate `s` to at most `target` cells WITHOUT splitting a wide char: a glyph
 * that would straddle the boundary is dropped whole (never half-rendered).
 */
export function truncateToWidth(s: string, target: number): string {
  if (target <= 0) return ''
  let width = 0
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    const cw = isZeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1
    if (width + cw > target) break
    out += ch
    width += cw
  }
  return out
}

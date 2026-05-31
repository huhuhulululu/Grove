/**
 * shquote.ts — POSIX single-quote escaping for safe shell interpolation.
 *
 * When Grove GENERATES a shell script (the post-commit hook block, the
 * statusline wrapper) it must interpolate untrusted values — most importantly
 * the repo directory path, which the user controls and which can legitimately
 * contain spaces, quotes, or even `$()`. Naive interpolation into a `"..."`
 * shell string is a remote-code-execution footgun: a repoDir like
 * `"; rm -rf ~ #` would execute on every commit.
 *
 * `shQuote` wraps a value so a POSIX shell parses it back to the EXACT literal
 * with no word splitting, globbing, or command substitution. The standard
 * idiom: wrap in single quotes; the only character special inside single
 * quotes is `'` itself, which we escape by closing the quote, emitting an
 * escaped quote, and reopening: `'` → `'\''`.
 */

/**
 * Return `s` as a single shell token that round-trips to exactly `s`.
 *
 * Examples:
 *   shQuote('/a/b')      → '/a/b'
 *   shQuote("a'b")       → 'a'\''b'
 *   shQuote('$(x)')      → '$(x)'   (literal — never executed)
 *   shQuote('')          → ''
 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

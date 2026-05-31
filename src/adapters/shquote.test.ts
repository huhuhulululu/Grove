/**
 * shquote.test.ts — POSIX single-quote escaping for safe shell interpolation.
 *
 * shQuote(s) must produce a token that a POSIX shell parses back to EXACTLY s,
 * with no command substitution, word splitting, or structure breakout possible.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { shQuote } from './shquote'

/** Run `printf %s <quoted>` through /bin/sh and return what the shell saw. */
function shellRoundTrip(raw: string): string {
  const script = `printf %s ${shQuote(raw)}`
  return execFileSync('/bin/sh', ['-c', script]).toString()
}

describe('shQuote', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shQuote('hello')).toBe("'hello'")
  })

  it('round-trips a plain path through the shell unchanged', () => {
    expect(shellRoundTrip('/home/user/repo')).toBe('/home/user/repo')
  })

  it('escapes an embedded single quote via the \' -> \'\\\'\' idiom', () => {
    // a'b  →  'a'\''b'
    expect(shQuote("a'b")).toBe("'a'\\''b'")
  })

  it('round-trips a string containing single quotes', () => {
    expect(shellRoundTrip("it's a 'test'")).toBe("it's a 'test'")
  })

  it('neutralizes command substitution — $(...) is NOT executed', () => {
    // If escaping failed, the shell would substitute the date; with proper
    // single-quoting the literal text comes back verbatim.
    const payload = '$(echo PWNED)'
    expect(shellRoundTrip(payload)).toBe(payload)
  })

  it('neutralizes backtick command substitution', () => {
    const payload = '`echo PWNED`'
    expect(shellRoundTrip(payload)).toBe(payload)
  })

  it('neutralizes a quote-and-semicolon breakout attempt', () => {
    const payload = `x'; touch HACKED; echo '`
    expect(shellRoundTrip(payload)).toBe(payload)
  })

  it('round-trips double quotes and backslashes literally', () => {
    const payload = 'a"b\\c'
    expect(shellRoundTrip(payload)).toBe(payload)
  })

  it('round-trips an empty string', () => {
    expect(shQuote('')).toBe("''")
    expect(shellRoundTrip('')).toBe('')
  })
})

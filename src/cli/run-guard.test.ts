/**
 * run-guard.test.ts — the run-as-script guard must match the BASENAME of argv[1]
 * (sq / sq.js / sq.ts), NOT any path that merely contains the substring "sq".
 *
 * The pre-fix `process.argv[1].includes('sq')` would falsely fire for an
 * unrelated entrypoint like `/home/u/sqlbox/server.js` (contains "sq").
 *
 * Run: npx vitest run src/cli/run-guard.test.ts
 */

import { describe, it, expect } from 'vitest'
import { isRunAsScript } from './sq'

describe('isRunAsScript — robust basename match', () => {
  it('matches a bare `sq` global bin', () => {
    expect(isRunAsScript('/usr/local/bin/sq')).toBe(true)
  })

  it('matches the built bundle `dist/cli/sq.js`', () => {
    expect(isRunAsScript('/repo/dist/cli/sq.js')).toBe(true)
  })

  it('matches the dev source `src/cli/sq.ts`', () => {
    expect(isRunAsScript('/repo/src/cli/sq.ts')).toBe(true)
  })

  it('does NOT match an unrelated path that merely CONTAINS "sq"', () => {
    // The fragile substring match used to fire here — the bug this fix closes.
    expect(isRunAsScript('/home/u/sqlbox/server.js')).toBe(false)
    expect(isRunAsScript('/opt/sqitch/run.js')).toBe(false)
    expect(isRunAsScript('/tmp/mysquid.js')).toBe(false)
  })

  it('does NOT match a different binary in a dir whose name contains "sq"', () => {
    expect(isRunAsScript('/projects/sq-tools/other.js')).toBe(false)
  })

  it('returns false for undefined / empty argv[1]', () => {
    expect(isRunAsScript(undefined)).toBe(false)
    expect(isRunAsScript('')).toBe(false)
  })
})

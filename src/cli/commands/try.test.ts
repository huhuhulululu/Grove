/**
 * try.test.ts — `sq try` (demo) must give a taste of the loot loop WITHOUT touching
 * the user's real state. The firewall test is the load-bearing one: with GROVE_HOME
 * pointed at a fresh empty dir, running the demo must leave that dir empty (the demo
 * works entirely in its own throwaway scratch dir).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from '../sq'

function capture(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    spy.mockRestore()
  }
  return { code, output: lines }
}

describe('sq try (demo)', () => {
  let fakeHome: string
  let savedHome: string | undefined

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-try-home-'))
    savedHome = process.env['GROVE_HOME']
    process.env['GROVE_HOME'] = fakeHome
  })
  afterEach(() => {
    if (savedHome === undefined) delete process.env['GROVE_HOME']
    else process.env['GROVE_HOME'] = savedHome
    fs.rmSync(fakeHome, { recursive: true, force: true })
  })

  it('FIREWALL: never writes to the real GROVE_HOME (demo runs in its own scratch)', () => {
    const { code } = capture(['try'])
    expect(code).toBe(0)
    expect(fs.readdirSync(fakeHome)).toEqual([]) // real home untouched
  })

  it('prints loot (XP + seeds) and a `sq init` call-to-action', () => {
    const out = capture(['try']).output.join('\n')
    expect(out).toMatch(/xp/i)
    expect(out).toContain('🌰')
    expect(out).toMatch(/demo/) // the intro
    expect(out).toMatch(/sq init/) // the CTA
  })

  it('the `demo` alias works the same', () => {
    const { code, output } = capture(['demo'])
    expect(code).toBe(0)
    expect(output.join('\n')).toMatch(/sq init/)
  })

  it('--zen is terse (a done line that still points to sq init, no loot wall)', () => {
    const out = capture(['try', '--zen']).output.join('\n')
    expect(out).toMatch(/sq init/)
    // no scratch leak even in zen
    expect(fs.readdirSync(fakeHome)).toEqual([])
  })
})

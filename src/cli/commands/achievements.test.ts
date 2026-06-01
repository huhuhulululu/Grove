/**
 * commands/achievements.test.ts — TDD tests for `sq achievements`.
 *
 * Verifies:
 *  - Default: shows unlocked achievements only
 *  - --all: also shows locked achievements
 *  - --zen: terse count, no list
 *  - Dispatched correctly from sq run()
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from '../sq'
import { saveState } from '../../store/store'
import { stateDir } from '../../store/paths'
import { initialState } from '../../core/state'
import { ACHIEVEMENTS } from '../../core/achievements'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-ach-test-'))
}

function removeTmpHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Capture console.log output from run(argv). */
function captureRun(argv: string[]): { code: number; output: string } {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    spy.mockRestore()
  }
  return { code, output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sq achievements', () => {
  let tmpHome: string
  let dir: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
    dir = stateDir(tmpHome)
  })

  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  it('exits 0 with default output (no achievements unlocked)', () => {
    const { code, output } = captureRun(['achievements', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output).toContain('ACHIEVEMENTS')
    expect(output).toContain('none yet')
  })

  it('default surface shows unlocked achievements only', () => {
    // Write a state with one unlocked achievement.
    const state = { ...initialState(), achievements: ['ach:level-5'] }
    saveState(dir, state)

    const { code, output } = captureRun(['achievements', '--home', tmpHome])
    expect(code).toBe(0)

    const def = ACHIEVEMENTS.find((a) => a.id === 'ach:level-5')!
    expect(output).toContain(def.name)

    // Locked ones must not appear.
    const lockedDef = ACHIEVEMENTS.find((a) => a.id !== 'ach:level-5')!
    expect(output).not.toContain(lockedDef.name)
    expect(output).not.toContain('locked:')
  })

  it('--all shows both unlocked and locked sections', () => {
    const state = { ...initialState(), achievements: ['ach:level-5'] }
    saveState(dir, state)

    const { code, output } = captureRun(['achievements', '--all', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output).toContain('locked:')

    const lockedDef = ACHIEVEMENTS.find((a) => a.id !== 'ach:level-5')!
    expect(output).toContain(lockedDef.name)
  })

  it('--zen prints a terse count, no list, no title', () => {
    const state = { ...initialState(), achievements: ['ach:level-5'] }
    saveState(dir, state)

    const { code, output } = captureRun(['--zen', 'achievements', '--home', tmpHome])
    expect(code).toBe(0)
    // Count in output.
    expect(output).toContain('1/')
    expect(output).toContain(String(ACHIEVEMENTS.length))
    // No panel title.
    expect(output).not.toContain('ACHIEVEMENTS')
    // No achievement names.
    for (const a of ACHIEVEMENTS) {
      expect(output).not.toContain(a.name)
    }
  })

  it('--zen combined with --all still prints only the count (no list)', () => {
    const { code, output } = captureRun(['--zen', 'achievements', '--all', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output).not.toContain('locked:')
    for (const a of ACHIEVEMENTS) {
      expect(output).not.toContain(a.name)
    }
  })

  it('no em-dash in output', () => {
    const { output } = captureRun(['achievements', '--all', '--home', tmpHome])
    expect(output.includes('—')).toBe(false)
  })
})

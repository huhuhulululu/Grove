/**
 * wrap-flags.test.ts — global flags (--zen / --home) must COMPOSE with `wrap`
 * (and with subcommands generally), in ANY position relative to the subcommand.
 *
 * The pre-fix bug: `run()` short-circuited on `argv[0] === 'wrap'`, so a global
 * flag placed BEFORE wrap (`sq --zen wrap -- cmd`) never reached the wrap path,
 * and `--zen` AFTER wrap only worked by luck of the sq-side parse. These tests
 * pin BOTH orders: `--zen wrap` and `wrap --zen`, plus `--home` either side.
 *
 * Run: npx vitest run src/cli/wrap-flags.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from './sq'
import { loadState } from '../store/store'
import { stateDir } from '../store/paths'

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wrapflags-'))
}

function captureRun(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let code: number
  try {
    code = run(argv)
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
  return { code, output: lines }
}

const SPECTACLE = ['✨', '🃏', '⚔️', '🪙', '🌿', '🆙', '✦', '💥', 'CRIT', '🎁', 'sq suggest-commit']

function hasSpectacle(output: string[]): boolean {
  const combined = output.join('\n')
  return SPECTACLE.some((m) => combined.includes(m))
}

describe('wrap composes with global flags', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('`--zen wrap -- true` (flag BEFORE wrap): calm output, engine still runs, exits 0', () => {
    const before = loadState(stateDir(tmpHome))
    const { code, output } = captureRun(['--zen', '--home', tmpHome, 'wrap', '--', 'true'])
    expect(code).toBe(0)
    // Calm: no loot spectacle.
    expect(hasSpectacle(output)).toBe(false)
    // Engine still ran on the real green exit code.
    const after = loadState(stateDir(tmpHome))
    expect(after.eventCount).toBe(before.eventCount + 1)
  })

  it('`wrap --zen -- true` (flag AFTER wrap, sq-side): calm output, exits 0', () => {
    const { code, output } = captureRun(['wrap', '--zen', '--home', tmpHome, '--', 'true'])
    expect(code).toBe(0)
    expect(hasSpectacle(output)).toBe(false)
  })

  it('`--home X wrap -- true` (home BEFORE wrap): state lands in X', () => {
    const { code } = captureRun(['--home', tmpHome, 'wrap', '--', 'true'])
    expect(code).toBe(0)
    // State must have been written into tmpHome's repo-scoped subdir.
    const dir = stateDir(tmpHome)
    expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(true)
  })

  it('`wrap --home X -- true` (home AFTER wrap): still works (regression guard)', () => {
    const { code } = captureRun(['wrap', '--home', tmpHome, '--', 'true'])
    expect(code).toBe(0)
    expect(fs.existsSync(path.join(stateDir(tmpHome), 'state.json'))).toBe(true)
  })

  it('global flags before wrap do NOT leak into the wrapped command exit code (passthrough)', () => {
    // `--zen wrap -- sh -c 'exit 3'` must still pass through exit 3.
    const { code } = captureRun(['--zen', '--home', tmpHome, 'wrap', '--', 'sh', '-c', 'exit 3'])
    expect(code).toBe(3)
  })

  it('the wrapped command still owns its OWN --zen after the `--` separator', () => {
    // A `--zen` AFTER `--` belongs to the inner command, not to sq. `printf` will
    // just print it. sq stays in normal (non-calm) mode here, so a reward emoji
    // can appear — the key invariant: the inner `--zen` is NOT consumed by sq.
    const { code } = captureRun(['wrap', '--home', tmpHome, '--', 'printf', '%s', '--zen'])
    expect(code).toBe(0)
  })
})

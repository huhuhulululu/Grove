/**
 * incursion.test.ts — the playable loop end-to-end on the CLI.
 *
 * Proves the real game: start → dive → escape COMMITS the run-bag to the real
 * collection; a DEATH forfeits the bag and touches the real collection NOTHING; and
 * the run is fully isolated in run.json (never in the persisted GameState).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { run } from '../sq'
import { loadState } from '../../store/store'
import { stateDir } from '../../store/paths'
import { rollMap, resolveFloor, RUN_HP, type RunState } from '../../engine/incursion'

let home: string
let logs: string[]
let spy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-incursion-'))
  logs = []
  spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.join(' '))
  })
  errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    logs.push(a.join(' '))
  })
})
afterEach(() => {
  spy.mockRestore()
  errSpy.mockRestore()
  fs.rmSync(home, { recursive: true, force: true })
})

const out = () => logs.join('\n')
const runFile = () => path.join(stateDir(home), 'run.json')

describe('sq incursion — the playable roguelike loop', () => {
  it('start rolls a run, writes run.json, and shows the first floor + the dive/escape choice', () => {
    expect(run(['incursion', 'start', '--seed', 'demo', '--home', home])).toBe(0)
    expect(fs.existsSync(runFile())).toBe(true)
    expect(out()).toMatch(/Floor 1\/5/)
    expect(out()).toMatch(/dive/)
    expect(out()).toMatch(/escape/)
  })

  it('refuses a second concurrent run (one incursion at a time)', () => {
    run(['incursion', 'start', '--seed', 'a', '--home', home])
    logs = []
    run(['incursion', 'start', '--seed', 'b', '--home', home])
    expect(out().toLowerCase()).toContain('already')
  })

  it('escape COMMITS the run-bag into the real collection', () => {
    run(['incursion', 'start', '--seed', 'demo', '--home', home])
    // demo + power 1.0 clears the early floors (85% / 69%) — dive twice, then bank.
    run(['incursion', 'dive', '--home', home])
    run(['incursion', 'dive', '--home', home])
    const before = loadState(stateDir(home))
    run(['incursion', 'escape', '--home', home])
    const after = loadState(stateDir(home))
    expect(after.cards.length).toBeGreaterThan(before.cards.length) // loot banked
    expect(fs.existsSync(runFile())).toBe(false) // run consumed
  })

  it('a DEATH forfeits the bag and changes the real collection NOTHING', () => {
    // Seed a near-certain death: hp 1, a wildly over-difficult floor (clamped to the
    // 10% min clear), and a seed whose dive roll fails — computed via the pure engine.
    let dyingSeed = -1
    for (let s = 0; s < 200; s++) {
      const floors = rollMap(s).map((f) => ({ ...f, difficulty: 99 })) // 10% clear floor
      const r: RunState = { seed: s, power: 0, floors, current: 0, hp: 1, bag: { cards: [], gear: [], seeds: 0 } }
      if (resolveFloor(r).dead) { dyingSeed = s; break }
    }
    expect(dyingSeed).toBeGreaterThanOrEqual(0)
    const floors = rollMap(dyingSeed).map((f) => ({ ...f, difficulty: 99 }))
    const dying: RunState = { seed: dyingSeed, power: 0, floors, current: 0, hp: 1, bag: { cards: [], gear: [], seeds: 999 } }
    fs.mkdirSync(stateDir(home), { recursive: true })
    fs.writeFileSync(runFile(), JSON.stringify(dying), 'utf-8')

    const before = loadState(stateDir(home))
    run(['incursion', 'dive', '--home', home])
    const after = loadState(stateDir(home))

    expect(out().toLowerCase()).toMatch(/forfeit|overwhelmed|took everything/)
    expect(after).toEqual(before) // the real collection is byte-identical — nothing lost or gained
    expect(fs.existsSync(runFile())).toBe(false) // dead run discarded
  })

  it('dive / escape with no active run are graceful no-ops (not errors)', () => {
    expect(run(['incursion', 'dive', '--home', home])).toBe(0)
    expect(out()).toMatch(/No active incursion/)
    logs = []
    expect(run(['incursion', 'escape', '--home', home])).toBe(0)
    expect(out()).toMatch(/No active incursion/)
  })

  it('--zen prints terse confirmations, no ASCII flourish', () => {
    run(['--zen', 'incursion', 'start', '--seed', 'demo', '--home', home])
    expect(out()).toMatch(/✓ incursion started/)
    expect(out()).not.toMatch(/🟩|Floor 1\/5/)
  })

  it('RUN_HP is the tight 2-mistake budget that keeps the escape gamble real', () => {
    run(['incursion', 'start', '--seed', 'demo', '--home', home])
    const saved = JSON.parse(fs.readFileSync(runFile(), 'utf-8')) as RunState
    expect(saved.hp).toBe(RUN_HP)
    expect(RUN_HP).toBe(2)
  })
})

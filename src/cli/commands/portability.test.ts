/**
 * portability.test.ts — sq export / import. The load-bearing guarantees: a clean
 * round-trip preserves every cosmetic field, export is read-only, and import is
 * NON-DESTRUCTIVE (a bad file changes nothing; a real import backs up first).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleExport, handleImport } from './portability'
import { loadState, saveState } from '../../store/store'
import { initialState } from '../../core/state'
import type { GameState } from '../../core/state'

function capture(fn: () => number): { code: number; out: string[] } {
  const out: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(' '))
  })
  let code: number
  try {
    code = fn()
  } finally {
    spy.mockRestore()
  }
  return { code, out }
}

describe('sq export / import', () => {
  let dirA: string
  let dirB: string
  let work: string
  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-port-a-'))
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-port-b-'))
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-port-w-'))
  })
  afterEach(() => {
    for (const d of [dirA, dirB, work]) fs.rmSync(d, { recursive: true, force: true })
  })

  const seeded = (): GameState => ({
    ...initialState(),
    player: { xp: 123, level: 4, currency: 77, shards: 9 },
    completedSets: ['tools'],
    foiled: ['tools.debugger'],
    achievements: ['ach:level-5'],
  })

  it('round-trips state through export -> import (cosmetic fields preserved)', () => {
    saveState(dirA, seeded())
    const file = path.join(work, 'save.json')
    expect(capture(() => handleExport([file], dirA, 'en')).code).toBe(0)
    expect(fs.existsSync(file)).toBe(true)
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      grove: string
      state: GameState
    }
    expect(envelope.grove).toBe('export')
    expect(envelope.state.player.currency).toBe(77)

    expect(capture(() => handleImport([file], dirB, 'en')).code).toBe(0)
    const loaded = loadState(dirB)
    expect(loaded.player.currency).toBe(77)
    expect(loaded.foiled).toEqual(['tools.debugger'])
    expect(loaded.completedSets).toEqual(['tools'])
    expect(loaded.achievements).toEqual(['ach:level-5'])
  })

  it('export with no path writes the envelope to stdout and is read-only', () => {
    saveState(dirA, seeded())
    const before = fs.statSync(path.join(dirA, 'state.json')).mtimeMs
    const { code, out } = capture(() => handleExport([], dirA, 'en'))
    expect(code).toBe(0)
    const env = JSON.parse(out.join('\n')) as { grove: string }
    expect(env.grove).toBe('export')
    expect(fs.statSync(path.join(dirA, 'state.json')).mtimeMs).toBe(before) // untouched
  })

  it('refuses a non-JSON file and changes NOTHING (non-destructive)', () => {
    saveState(dirA, seeded())
    const junk = path.join(work, 'junk.txt')
    fs.writeFileSync(junk, 'not json{')
    const { code, out } = capture(() => handleImport([junk], dirA, 'en'))
    expect(code).toBe(1)
    expect(out.join('\n')).toMatch(/nothing was changed/)
    expect(loadState(dirA).player.currency).toBe(77)
  })

  it('refuses a valid-JSON-but-not-Grove file, changing nothing', () => {
    saveState(dirA, seeded())
    const bad = path.join(work, 'bad.json')
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }))
    const { code, out } = capture(() => handleImport([bad], dirA, 'en'))
    expect(code).toBe(1)
    expect(out.join('\n')).toMatch(/not a valid Grove export/)
    expect(loadState(dirA).player.currency).toBe(77)
  })

  it('import with no file prints usage and changes nothing', () => {
    saveState(dirA, seeded())
    const { code } = capture(() => handleImport([], dirA, 'en'))
    expect(code).toBe(2)
    expect(loadState(dirA).player.currency).toBe(77)
  })

  it('import backs up the previous state before replacing it', () => {
    saveState(dirA, { ...initialState(), player: { xp: 1, level: 1, currency: 5, shards: 0 } })
    const file = path.join(work, 'save.json')
    saveState(dirB, seeded())
    capture(() => handleExport([file], dirB, 'en'))
    capture(() => handleImport([file], dirA, 'en'))
    const backups = fs.readdirSync(dirA).filter((f) => f.startsWith('state.json.bak.'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
    expect(loadState(dirA).player.currency).toBe(77) // replaced from the import
  })
})

/**
 * store.shards.test.ts — R6 SCHEMA P0: shards must PERSIST and VALIDATE.
 *
 * The R5 dup tail accrues `player.shards`, but the persistence schema
 * (GameStateSchema) omitted the field, so a saved state with shards FAILED the
 * fast-path validation and was silently dropped to 0 on the next load. This pins
 * down: shards survive a save→load round-trip, validate on the fast path, and a
 * legacy state with no shards migrates to a default 0.
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { initialState } from '../core/state'
import { loadState, saveState } from './store'

const dirs: string[] = []
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-shards-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe('shards persistence (R6 schema P0)', () => {
  it('round-trips a non-zero shards count through save→load', () => {
    const dir = tmpDir()
    const s = { ...initialState(), player: { xp: 10, level: 2, currency: 30, shards: 27 } }
    saveState(dir, s)
    const loaded = loadState(dir)
    expect(loaded.player.shards).toBe(27)
  })

  it('a saved state with shards survives the fast-path (no silent reset to 0)', () => {
    const dir = tmpDir()
    const s = { ...initialState(), player: { xp: 0, level: 1, currency: 0, shards: 99 } }
    // Write directly so we know it is the LOAD path (not the save) that must keep it.
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s), 'utf8')
    expect(loadState(dir).player.shards).toBe(99)
  })

  it('a legacy state with NO shards field migrates to default 0', () => {
    const dir = tmpDir()
    // A pre-R5 state: valid core, but no shards on player.
    const legacy = {
      version: 1,
      player: { xp: 5, level: 1, currency: 12 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy), 'utf8')
    const loaded = loadState(dir)
    expect(loaded.player.shards).toBe(0)
    // and the rest of the migration still holds
    expect(loaded.player.currency).toBe(12)
  })

  it('a corrupt/unparseable state resets to initialState with shards 0', () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'state.json'), 'NOT JSON {{{', 'utf8')
    expect(loadState(dir).player.shards).toBe(0)
  })
})

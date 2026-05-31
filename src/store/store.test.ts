import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { loadState, saveState, appendEvent, readEvents, withStateLock } from './store'

// Each test gets its own fresh temp dir to ensure full isolation.
const tempDirs: string[] = []

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  // Clean up all temp dirs created during this test.
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true })
  }
  tempDirs.length = 0
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(type = 'commit') {
  return {
    source: 'test',
    sessionId: 'sess-1',
    type: type as 'commit',
    magnitude: 3,
    success: true,
    ts: new Date().toISOString(),
    meta: {},
  }
}

// ---------------------------------------------------------------------------
// loadState
// ---------------------------------------------------------------------------

describe('loadState', () => {
  it('returns initialState when state.json does not exist', () => {
    const dir = makeTmpDir()
    const result = loadState(dir)
    expect(result).toEqual(initialState())
  })

  it('parses and returns the stored state when state.json exists', () => {
    const dir = makeTmpDir()
    const modified: GameState = {
      ...initialState(),
      player: { xp: 250, level: 3, currency: 10 },
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(modified), 'utf8')
    const result = loadState(dir)
    expect(result.player.xp).toBe(250)
    expect(result.player.level).toBe(3)
    expect(result.player.currency).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// loadState — schema migration (fills defaults for missing fields)
// ---------------------------------------------------------------------------

describe('loadState migration', () => {
  it('fills missing energy/quests/eventCount/buffs defaults from a legacy state', () => {
    const dir = makeTmpDir()
    // A legacy v1 state predating energy/quests/eventCount — only the original
    // player/cards/gear/pity/completedSets fields were written.
    const legacy = {
      version: 1,
      player: { xp: 250, level: 3, currency: 10 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 2 },
      completedSets: [],
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy), 'utf8')

    // Must NOT throw, must fill defaults for the missing fields.
    const result = loadState(dir)
    const defaults = initialState()

    // Preserved fields survive.
    expect(result.player.xp).toBe(250)
    expect(result.pity.sinceLegendary).toBe(2)

    // Missing fields are filled with defaults.
    expect(result.energy).toEqual(defaults.energy)
    expect(result.quests).toEqual(defaults.quests)
    expect(result.eventCount).toBe(defaults.eventCount)
    expect(result.buffs).toEqual(defaults.buffs)
    // R3: the token-milestone work accumulator is also defaulted for legacy states.
    expect(result.work).toEqual(defaults.work)
  })

  it('preserves a present work accumulator and fills missing work sub-fields', () => {
    const dir = makeTmpDir()
    const defaults = initialState()
    // A pre-cap-field state that has workMeter/lastCostUsd but not the newer
    // windowKey/milestonesInWindow.
    const legacy = {
      ...initialState(),
      work: { workMeter: 7, lastCostUsd: 1.5 },
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy), 'utf8')

    const result = loadState(dir)
    expect(result.work.workMeter).toBe(7)
    expect(result.work.lastCostUsd).toBe(1.5)
    expect(result.work.windowKey).toBe(defaults.work.windowKey)
    expect(result.work.milestonesInWindow).toBe(defaults.work.milestonesInWindow)
  })

  it('round-trips a full current-shape state unchanged', () => {
    const dir = makeTmpDir()
    const full: GameState = {
      ...initialState(),
      player: { xp: 999, level: 9, currency: 42 },
      eventCount: 7,
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(full), 'utf8')
    const result = loadState(dir)
    expect(result).toEqual(full)
  })
})

// ---------------------------------------------------------------------------
// loadState — unrecoverable corruption (backup + return initialState)
// ---------------------------------------------------------------------------

describe('loadState corruption recovery', () => {
  it('returns initialState and backs up a corrupt (unparseable) state.json', () => {
    const dir = makeTmpDir()
    fs.writeFileSync(path.join(dir, 'state.json'), 'NOT VALID JSON {{{', 'utf8')

    const result = loadState(dir)

    // Recovered to a fresh initialState rather than throwing.
    expect(result).toEqual(initialState())

    // A backup of the bad file was written.
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt.'))
    expect(backups.length).toBe(1)
    const backupContent = fs.readFileSync(path.join(dir, backups[0]!), 'utf8')
    expect(backupContent).toBe('NOT VALID JSON {{{')
  })

  it('returns initialState and backs up a structurally-invalid state.json', () => {
    const dir = makeTmpDir()
    // Valid JSON but not a GameState (wrong types throughout, unrecoverable).
    fs.writeFileSync(
      path.join(dir, 'state.json'),
      JSON.stringify({ player: 'not-an-object', cards: 'nope' }),
      'utf8',
    )

    const result = loadState(dir)
    expect(result).toEqual(initialState())

    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt.'))
    expect(backups.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// withStateLock — exclusive cross-process lock
// ---------------------------------------------------------------------------

describe('withStateLock', () => {
  it('runs the callback and returns its result', () => {
    const dir = makeTmpDir()
    const result = withStateLock(dir, () => 'value')
    expect(result).toBe('value')
  })

  it('holds the .lock file during the callback', () => {
    const dir = makeTmpDir()
    let lockSeenDuring = false
    withStateLock(dir, () => {
      lockSeenDuring = fs.existsSync(path.join(dir, '.lock'))
    })
    expect(lockSeenDuring).toBe(true)
  })

  it('releases the .lock file after the callback returns', () => {
    const dir = makeTmpDir()
    withStateLock(dir, () => undefined)
    expect(fs.existsSync(path.join(dir, '.lock'))).toBe(false)
  })

  it('releases the .lock file even when the callback throws', () => {
    const dir = makeTmpDir()
    expect(() => withStateLock(dir, () => { throw new Error('boom') })).toThrow('boom')
    expect(fs.existsSync(path.join(dir, '.lock'))).toBe(false)
  })

  it('steals a STALE lock (mtime older than the staleness window)', () => {
    const dir = makeTmpDir()
    fs.mkdirSync(dir, { recursive: true })
    const lockPath = path.join(dir, '.lock')
    // Plant a lock and backdate its mtime well past the staleness threshold.
    fs.writeFileSync(lockPath, String(process.pid), 'utf8')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(lockPath, old, old)

    // Should steal the stale lock and run rather than hang/throw.
    const result = withStateLock(dir, () => 'ran')
    expect(result).toBe('ran')
    // And release it again after.
    expect(fs.existsSync(lockPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveState
// ---------------------------------------------------------------------------

describe('saveState', () => {
  it('round-trips a non-trivial state through saveState + loadState', () => {
    const dir = makeTmpDir()
    const state: GameState = {
      ...initialState(),
      player: { xp: 500, level: 5, currency: 99 },
      pity: { sinceLegendary: 7 },
    }
    saveState(dir, state)
    const loaded = loadState(dir)
    expect(loaded).toEqual(state)
  })

  it('does not leave a .tmp file after save', () => {
    const dir = makeTmpDir()
    saveState(dir, initialState())
    const files = fs.readdirSync(dir)
    const tmpFiles = files.filter(f => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('creates the directory when it does not yet exist', () => {
    const dir = makeTmpDir()
    const nested = path.join(dir, 'deep', 'nested', 'dir')
    expect(fs.existsSync(nested)).toBe(false)
    saveState(nested, initialState())
    expect(fs.existsSync(path.join(nested, 'state.json'))).toBe(true)
  })

  it('overwrites state.json on a second save with new data', () => {
    const dir = makeTmpDir()
    saveState(dir, initialState())
    const updated: GameState = { ...initialState(), player: { xp: 1, level: 1, currency: 5 } }
    saveState(dir, updated)
    const loaded = loadState(dir)
    expect(loaded.player.currency).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// appendEvent + readEvents
// ---------------------------------------------------------------------------

describe('appendEvent', () => {
  it('creates events.jsonl and appends a single event', () => {
    const dir = makeTmpDir()
    appendEvent(dir, makeEvent())
    const content = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
    expect(content.trim()).not.toBe('')
  })

  it('appends three events in order; readEvents returns them in insertion order', () => {
    const dir = makeTmpDir()
    appendEvent(dir, makeEvent('commit'))
    appendEvent(dir, makeEvent('test_result'))
    appendEvent(dir, makeEvent('pr_merged'))
    const events = readEvents(dir)
    expect(events).toHaveLength(3)
    expect(events[0]?.type).toBe('commit')
    expect(events[1]?.type).toBe('test_result')
    expect(events[2]?.type).toBe('pr_merged')
  })

  it('creates the directory when it does not yet exist', () => {
    const dir = makeTmpDir()
    const nested = path.join(dir, 'sub', 'dir')
    expect(fs.existsSync(nested)).toBe(false)
    appendEvent(nested, makeEvent())
    expect(fs.existsSync(path.join(nested, 'events.jsonl'))).toBe(true)
  })
})

describe('readEvents', () => {
  it('returns [] when events.jsonl is absent', () => {
    const dir = makeTmpDir()
    expect(readEvents(dir)).toEqual([])
  })

  it('returns [] when events.jsonl is empty', () => {
    const dir = makeTmpDir()
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '', 'utf8')
    expect(readEvents(dir)).toEqual([])
  })

  it('skips lines that fail to parse and returns the rest', () => {
    const dir = makeTmpDir()
    const good = makeEvent('commit')
    // Write one good line, one corrupted line, one good line
    const lines = [
      JSON.stringify(good),
      'NOT_VALID_JSON{{{',
      JSON.stringify(makeEvent('lint_clean')),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines, 'utf8')
    const events = readEvents(dir)
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('commit')
    expect(events[1]?.type).toBe('lint_clean')
  })

  it('each returned event passes parseEvent validation', () => {
    const dir = makeTmpDir()
    appendEvent(dir, makeEvent('doc_updated'))
    const events = readEvents(dir)
    expect(events).toHaveLength(1)
    // If parseEvent would throw the event would have been skipped — it being
    // returned means it is a valid GroveEvent.
    expect(events[0]?.source).toBe('test')
  })
})

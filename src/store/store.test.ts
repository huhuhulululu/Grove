import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { loadState, saveState, appendEvent, readEvents, withStateLock, withGlobalLock } from './store'
import { activeGearBonus } from '../engine/gear'

// Each test gets its own fresh temp HOME with an isolated per-repo state dir
// nested under it (`<home>/repo`). Nesting matters: the account-global energy/
// work file lives at `<home>/_global/global.json` (a sibling of the repo dir),
// so giving every test its own home keeps that shared file isolated per test and
// out of the system tmp root. This models real usage (`<groveHome>/<repoKey>`).
const tempHomes: string[] = []

function makeTmpDir(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
  tempHomes.push(home)
  const dir = path.join(home, 'repo')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

afterEach(() => {
  // Clean up all temp homes (and their nested repo + _global dirs).
  for (const h of tempHomes) {
    fs.rmSync(h, { recursive: true, force: true })
  }
  tempHomes.length = 0
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

  // -- Track A loadout (ADR-0014 rev.2) round-trip ---------------------------
  it('a legacy state WITHOUT a loadout migrates to the default {slots:[]}', () => {
    const dir = makeTmpDir()
    const legacy = {
      version: 1,
      player: { xp: 5, level: 1, currency: 0 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
      completedSets: [],
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy), 'utf8')
    const result = loadState(dir)
    expect(result.loadout).toEqual({ slots: [] })
  })

  it('a saved state WITH a loadout round-trips intact (save → load)', () => {
    const dir = makeTmpDir()
    const withLoadout: GameState = {
      ...initialState(),
      loadout: {
        slots: [
          { kind: 'card', id: 'tools.hammer', tag: 'tools' },
          { kind: 'gear', id: 'gear.type-saber.3', tag: 'Type Saber' },
          { kind: 'buff', id: 'precast-spec' },
        ],
      },
    }
    saveState(dir, withLoadout)
    const result = loadState(dir)
    expect(result.loadout).toEqual(withLoadout.loadout)
  })

  it('migrate drops a malformed slot but keeps the well-formed ones', () => {
    const dir = makeTmpDir()
    // Legacy-shaped (missing energy/work) so it goes through migrate(), with a
    // loadout holding one good slot and one malformed (no id) entry.
    const raw = {
      version: 1,
      player: { xp: 1, level: 1, currency: 0 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
      completedSets: [],
      loadout: {
        slots: [
          { kind: 'card', id: 'tools.hammer', tag: 'tools' },
          { kind: 'card' }, // malformed — no id
        ],
      },
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(raw), 'utf8')
    const result = loadState(dir)
    expect(result.loadout.slots).toEqual([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
    ])
  })

  // -- Achievements (ADR-0015 rev.2) round-trip ------------------------------
  it('a legacy state WITHOUT achievements migrates to the default []', () => {
    const dir = makeTmpDir()
    const legacy = {
      version: 1,
      player: { xp: 5, level: 1, currency: 0 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
      completedSets: [],
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy), 'utf8')
    const result = loadState(dir)
    expect(result.achievements).toEqual([])
  })

  it('a saved state WITH achievements round-trips intact (save → load)', () => {
    const dir = makeTmpDir()
    const withAch: GameState = {
      ...initialState(),
      achievements: ['ach:level-5', 'ach:first-set'],
    }
    saveState(dir, withAch)
    const result = loadState(dir)
    expect(result.achievements).toEqual(withAch.achievements)
  })

  it('migrate drops a malformed (non-string) achievement entry', () => {
    const dir = makeTmpDir()
    const raw = {
      version: 1,
      player: { xp: 1, level: 1, currency: 0 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
      completedSets: [],
      achievements: ['ach:level-5', 42, null, 'ach:first-foil'],
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(raw), 'utf8')
    const result = loadState(dir)
    expect(result.achievements).toEqual(['ach:level-5', 'ach:first-foil'])
  })

  // coverage-2: protectedGear's malformed-entry filter mirrors achievements/loadout
  // (both of which ARE tested) but was itself untested. A non-string id leaking into
  // the engine's protected-set drives gear-break protection, so guard the filter.
  it('migrate drops a malformed (non-string) protectedGear entry', () => {
    const dir = makeTmpDir()
    const raw = {
      version: 1,
      player: { xp: 1, level: 1, currency: 0 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
      completedSets: [],
      protectedGear: ['gear.x.1', 42, null, 'gear.y.2'],
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(raw), 'utf8')
    const result = loadState(dir)
    expect(result.protectedGear).toEqual(['gear.x.1', 'gear.y.2'])
  })

  // R2 api-contract-1 (ADR-0005: rewards can never be lost). A state routed through
  // migrate() (here: missing protectedGear -> fails the FAST schema) used to lose
  // foiled / spark / sparkTarget — the fresh migrate object never copied them.
  it('migrate preserves foiled / spark / sparkTarget (rewards are never lost on load)', () => {
    const dir = makeTmpDir()
    const raw = {
      version: 1,
      player: { xp: 5, level: 2, currency: 10, shards: 3 },
      cards: [],
      gear: [],
      pity: { sinceLegendary: 0 },
      completedSets: [],
      // NO protectedGear -> fails the fast schema -> routes through migrate()
      foiled: ['tools.debugger', 'forest.oak'],
      spark: 7,
      sparkTarget: 'relics.grimoire',
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(raw), 'utf8')
    const result = loadState(dir)
    expect(result.foiled).toEqual(['tools.debugger', 'forest.oak'])
    expect(result.spark).toBe(7)
    expect(result.sparkTarget).toBe('relics.grimoire')
  })

  // R2 resilience-2: migrate() typed gear/cards as z.unknown() and cast unchecked, so
  // a `level:'abc'` element poisoned activeGearBonus with NaN. Drop malformed elements.
  it('migrate drops a malformed gear element (no NaN poisoning of activeGearBonus)', () => {
    const dir = makeTmpDir()
    const raw = {
      version: 1,
      player: { xp: 5, level: 2, currency: 0 },
      cards: [],
      gear: [
        { id: 'g.bad', name: 'Commit Hammer', level: 'abc', rarity: 'rare', broken: false },
        { id: 'g.ok', name: 'Commit Hammer', level: 5, rarity: 'rare', broken: false },
      ],
      pity: { sinceLegendary: 0 },
      completedSets: [],
      // no protectedGear -> routes through migrate()
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(raw), 'utf8')
    const result = loadState(dir)
    expect(result.gear).toEqual([
      { id: 'g.ok', name: 'Commit Hammer', level: 5, rarity: 'rare', broken: false },
    ])
    expect(Number.isFinite(activeGearBonus(result).currencyPct)).toBe(true)
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

// ---------------------------------------------------------------------------
// Cross-process lock — reentrancy + ownership release (R2 concurrency hardening)
// ---------------------------------------------------------------------------

describe('cross-process lock — reentrancy + ownership', () => {
  it('a nested same-lock acquire passes through (reentrant — no self-deadlock/steal)', () => {
    const dir = makeTmpDir()
    const r = withGlobalLock(dir, () => withGlobalLock(dir, () => 'inner'))
    expect(r).toBe('inner')
  })

  it('saveState (global-inner) nests safely inside the ingest lock ordering', () => {
    const dir = makeTmpDir()
    // per-repo OUTER, global INNER — the ingest ordering; saveState re-takes the
    // global lock internally, which must reenter rather than self-deadlock/steal.
    const ran = withStateLock(dir, () =>
      withGlobalLock(dir, () => {
        saveState(dir, {
          ...initialState(),
          player: { xp: 9, level: 1, currency: 0, shards: 0 },
        })
        return true
      }),
    )
    expect(ran).toBe(true)
    expect(loadState(dir).player.xp).toBe(9)
  })

  it('release unlinks by token — never deletes a successor lock that stole ours mid-hold', () => {
    const dir = makeTmpDir()
    const lockPath = path.join(dir, '.lock')
    withStateLock(dir, () => {
      // Simulate: our lock was stale-stolen and a successor recreated it with THEIR id.
      fs.writeFileSync(lockPath, 'SUCCESSOR-TOKEN')
    })
    // Our release must NOT have unlinked the successor's live lock.
    expect(fs.existsSync(lockPath)).toBe(true)
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('SUCCESSOR-TOKEN')
  })
})

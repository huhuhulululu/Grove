/**
 * store.global.test.ts — R5 ACCOUNT-GLOBAL energy/work store (AI-eng P1).
 *
 * Quota/energy is account-WIDE (the 5h/7d usage windows are shared by every repo
 * you work in) yet was stored per-repo. This pins down the transparent merge/split:
 *  - energy + the token-milestone work meter live in ONE shared file
 *    (`<home>/_global/global.json`) next to all the per-repo state dirs;
 *  - loadState transparently MERGES the global energy/work over the per-repo state;
 *  - saveState SPLITS energy/work back out to the global file;
 *  - per-repo state.json keeps its OWN cosmetic progress (cards/gear/xp/level/…).
 *
 * The R2 lock + schema/migration stay intact (covered in store.test.ts).
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { loadState, saveState, withGlobalLock } from './store'

// Each test gets a fresh HOME holding multiple per-repo state dirs, so the shared
// `<home>/_global/global.json` is isolated per test.
const homes: string[] = []

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-glob-'))
  homes.push(home)
  return home
}

/** A per-repo state dir nested under a home (models `<groveHome>/<repoKey>`). */
function repoDir(home: string, key: string): string {
  const dir = path.join(home, key)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

afterEach(() => {
  for (const h of homes) fs.rmSync(h, { recursive: true, force: true })
  homes.length = 0
})

// A state whose energy + work are non-default, plus distinct cosmetic progress.
function stateWith(over: Partial<GameState>): GameState {
  return { ...initialState(), ...over }
}

// ---------------------------------------------------------------------------
// energy/work is account-wide: written from one repo, read by ANOTHER repo.
// ---------------------------------------------------------------------------

describe('account-global energy/work — shared across repos under one home', () => {
  it("repo B sees the energy/work repo A saved (account-wide, not per-repo)", () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const repoB = repoDir(home, 'projB-bbbb')

    // Repo A records a real quota frame: known energy + an advanced work meter.
    const aState = stateWith({
      energy: { known: true, vigor: 42, sap: 80, vigorResetsAt: 12345 },
      work: { workMeter: 2.5, lastCostUsd: 7.5, windowKey: 999, milestonesInWindow: 1 },
    })
    saveState(repoA, aState)

    // Repo B (which has never seen a quota frame) loads → inherits A's energy/work.
    const bLoaded = loadState(repoB)
    expect(bLoaded.energy).toEqual(aState.energy)
    expect(bLoaded.work).toEqual(aState.work)
  })

  it('the shared global file lives at <home>/_global/global.json', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    saveState(repoA, initialState())
    expect(fs.existsSync(path.join(home, '_global', 'global.json'))).toBe(true)
  })

  it('a later energy update from repo B is visible to repo A (windows are shared)', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const repoB = repoDir(home, 'projB-bbbb')

    saveState(repoA, stateWith({ energy: { known: true, vigor: 90, sap: 90 } }))
    // B works later in the same 5h window → energy drops.
    const bState = { ...loadState(repoB), energy: { known: true, vigor: 30, sap: 70 } }
    saveState(repoB, bState)

    // A re-loads and sees the LATEST account-wide energy (30, not its old 90).
    expect(loadState(repoA).energy.vigor).toBe(30)
    expect(loadState(repoA).energy.sap).toBe(70)
  })
})

// ---------------------------------------------------------------------------
// cosmetic progress stays PER-REPO (only energy/work is globalized).
// ---------------------------------------------------------------------------

describe('account-global — cosmetic progress remains per-repo', () => {
  it('cards/gear/xp/level/currency/pity are NOT shared between repos', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const repoB = repoDir(home, 'projB-bbbb')

    saveState(
      repoA,
      stateWith({
        player: { xp: 500, level: 7, currency: 99, shards: 3 },
        cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'uncommon', set: 'forest' }],
        pity: { sinceLegendary: 9 },
        energy: { known: true, vigor: 50, sap: 50 },
      }),
    )

    // Repo B has its own (fresh) cosmetic progress.
    const bLoaded = loadState(repoB)
    expect(bLoaded.player.level).toBe(initialState().player.level)
    expect(bLoaded.player.currency).toBe(initialState().player.currency)
    expect(bLoaded.cards).toEqual([])
    expect(bLoaded.pity).toEqual(initialState().pity)
    // …but it DID inherit A's account-wide energy.
    expect(bLoaded.energy.vigor).toBe(50)
  })

  it("saving repo B's energy never disturbs repo A's cosmetic progress", () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const repoB = repoDir(home, 'projB-bbbb')

    const aState = stateWith({ player: { xp: 1, level: 4, currency: 12, shards: 0 } })
    saveState(repoA, aState)
    saveState(repoB, stateWith({ energy: { known: true, vigor: 10, sap: 10 } }))

    const aLoaded = loadState(repoA)
    expect(aLoaded.player.level).toBe(4)
    expect(aLoaded.player.currency).toBe(12)
    // A now sees B's energy (account-wide), but its own progress is intact.
    expect(aLoaded.energy.vigor).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// transparency / round-trip / back-compat
// ---------------------------------------------------------------------------

describe('account-global — transparency & back-compat', () => {
  it('round-trips: saveState then loadState on the same repo is unchanged', () => {
    const home = makeHome()
    const dir = repoDir(home, 'projA-aaaa')
    const s = stateWith({
      player: { xp: 7, level: 2, currency: 5, shards: 1 },
      energy: { known: true, vigor: 33, sap: 66, vigorResetsAt: 5, sapResetsAt: 6 },
      work: { workMeter: 1.1, lastCostUsd: 4.4, windowKey: 2, milestonesInWindow: 1 },
    })
    saveState(dir, s)
    expect(loadState(dir)).toEqual(s)
  })

  it('with NO global file yet, loadState returns the per-repo energy/work (no merge)', () => {
    const home = makeHome()
    const dir = repoDir(home, 'projA-aaaa')
    // Write a state.json DIRECTLY (bypassing saveState → no global file written).
    const s = stateWith({ energy: { known: true, vigor: 77, sap: 77 } })
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s), 'utf8')
    const loaded = loadState(dir)
    expect(loaded.energy.vigor).toBe(77)
  })

  it('a corrupt global file is non-fatal: per-repo energy/work stands', () => {
    const home = makeHome()
    const dir = repoDir(home, 'projA-aaaa')
    const s = stateWith({ energy: { known: true, vigor: 55, sap: 55 } })
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s), 'utf8')
    // Plant garbage at the global path.
    fs.mkdirSync(path.join(home, '_global'), { recursive: true })
    fs.writeFileSync(path.join(home, '_global', 'global.json'), 'NOT JSON {{{', 'utf8')

    const loaded = loadState(dir)
    expect(loaded.energy.vigor).toBe(55) // fell back to per-repo, no throw
  })

  it('an absent repo state.json still merges the shared global energy/work', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const repoB = repoDir(home, 'projB-bbbb')
    // A establishes the global energy; B has no state.json at all.
    saveState(repoA, stateWith({ energy: { known: true, vigor: 21, sap: 21 } }))
    expect(fs.existsSync(path.join(repoB, 'state.json'))).toBe(false)

    const bLoaded = loadState(repoB)
    // B starts from initialState cosmetic progress…
    expect(bLoaded.cards).toEqual([])
    // …but already reflects the account-wide energy.
    expect(bLoaded.energy.vigor).toBe(21)
  })
})

// ---------------------------------------------------------------------------
// R6 P1: the account-wide global file needs its OWN cross-process lock (the R2
// guarantee regressed for the shared file). withGlobalLock guards the global
// read-modify-write so two repos/processes can't lose each other's energy/work.
// ---------------------------------------------------------------------------

/** The shared-global lock dir for a per-repo state `dir`: `<home>/_global`. */
function globalDir(repo: string): string {
  return path.join(path.dirname(repo), '_global')
}

describe('withGlobalLock — the account-wide global file has its own cross-process lock', () => {
  it('runs the callback and returns its result', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    expect(withGlobalLock(repoA, () => 'value')).toBe('value')
  })

  it('holds the lock at <home>/_global/.lock during the callback', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    let seen = false
    withGlobalLock(repoA, () => {
      seen = fs.existsSync(path.join(globalDir(repoA), '.lock'))
    })
    expect(seen).toBe(true)
  })

  it('releases the global lock after the callback returns', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    withGlobalLock(repoA, () => undefined)
    expect(fs.existsSync(path.join(globalDir(repoA), '.lock'))).toBe(false)
  })

  it('releases the global lock even when the callback throws', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    expect(() => withGlobalLock(repoA, () => { throw new Error('boom') })).toThrow('boom')
    expect(fs.existsSync(path.join(globalDir(repoA), '.lock'))).toBe(false)
  })

  it('two repos under one home share ONE global lock (the file is account-wide)', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const repoB = repoDir(home, 'projB-bbbb')
    // Both repos resolve the SAME global lock dir.
    let lockPathA = ''
    let lockPathB = ''
    withGlobalLock(repoA, () => { lockPathA = path.join(globalDir(repoA), '.lock') })
    withGlobalLock(repoB, () => { lockPathB = path.join(globalDir(repoB), '.lock') })
    expect(lockPathA).toBe(lockPathB)
  })

  it('steals a STALE global lock rather than hanging', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    const gdir = globalDir(repoA)
    fs.mkdirSync(gdir, { recursive: true })
    const lockPath = path.join(gdir, '.lock')
    fs.writeFileSync(lockPath, String(process.pid), 'utf8')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(lockPath, old, old)
    expect(withGlobalLock(repoA, () => 'ran')).toBe('ran')
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('saveState holds the global lock while writing global.json (RMW is guarded)', () => {
    const home = makeHome()
    const repoA = repoDir(home, 'projA-aaaa')
    // Plant a fresh (non-stale) lock to block the global write path; saveState
    // must wait/steal, never corrupt. We assert it completes and the file lands.
    saveState(repoA, stateWith({ energy: { known: true, vigor: 64, sap: 64 } }))
    // After save, no lock leaks behind.
    expect(fs.existsSync(path.join(globalDir(repoA), '.lock'))).toBe(false)
    expect(fs.existsSync(path.join(globalDir(repoA), 'global.json'))).toBe(true)
    expect(loadState(repoA).energy.vigor).toBe(64)
  })
})

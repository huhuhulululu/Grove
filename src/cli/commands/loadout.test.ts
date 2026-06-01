/**
 * loadout.test.ts — Tests for `sq loadout` (ADR-0014 rev.2 Track A).
 *
 * Covers:
 *  - parseEquipRef parses valid / rejects invalid refs
 *  - equip / unequip via the CLI round-trip (temp dir)
 *  - the panel renders active + one-away
 *  - zen suppresses the HUD (view) but equip/unequip still work
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { parseEquipRef, handleLoadout } from './loadout'
import { loadState, saveState } from '../../store/store'
import { stateDir } from '../../store/paths'
import { initialState } from '../../core/state'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-loadout-test-'))
}

function removeTmpHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function captureHandle(
  rest: string[],
  tmpHome: string,
  zen = false,
): { code: number; lines: string[]; errLines: string[] } {
  const dir = stateDir(tmpHome)
  const lines: string[] = []
  const errLines: string[] = []
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errLines.push(a.map(String).join(' '))
  })
  let code: number
  try {
    code = handleLoadout(rest, {}, dir, zen, 'en')
  } finally {
    spyLog.mockRestore()
    spyErr.mockRestore()
  }
  return { code, lines, errLines }
}

// ---------------------------------------------------------------------------
// parseEquipRef
// ---------------------------------------------------------------------------

describe('parseEquipRef', () => {
  it('parses a card ref with tag', () => {
    const ref = parseEquipRef('card/tools.hammer/tools')
    expect(ref).toEqual({ kind: 'card', id: 'tools.hammer', tag: 'tools' })
  })

  it('parses a gear ref with tag', () => {
    const ref = parseEquipRef('gear/gear.commit-hammer.42/Commit Hammer')
    expect(ref).toEqual({ kind: 'gear', id: 'gear.commit-hammer.42', tag: 'Commit Hammer' })
  })

  it('parses a buff ref without tag', () => {
    const ref = parseEquipRef('buff/precast-spec')
    expect(ref).toEqual({ kind: 'buff', id: 'precast-spec' })
  })

  it('returns null for unknown kind', () => {
    expect(parseEquipRef('unknown/foo')).toBeNull()
  })

  it('returns null for a single-segment string', () => {
    expect(parseEquipRef('card')).toBeNull()
  })

  it('returns null for empty id', () => {
    expect(parseEquipRef('card/')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// handleLoadout — view
// ---------------------------------------------------------------------------

describe('handleLoadout — view', () => {
  let tmpHome: string
  let dir: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
    dir = stateDir(tmpHome)
    saveState(dir, initialState())
  })
  afterEach(() => removeTmpHome(tmpHome))

  it('view exits 0 and prints panel output containing LOADOUT', () => {
    const { code, lines } = captureHandle([], tmpHome)
    expect(code).toBe(0)
    const joined = lines.join('\n')
    expect(joined).toContain('LOADOUT')
  })

  it('zen view exits 0 and does NOT print the loadout HUD panel', () => {
    const { code, lines } = captureHandle([], tmpHome, true)
    expect(code).toBe(0)
    const joined = lines.join('\n')
    expect(joined).not.toContain('LOADOUT')
    // zen prints a terse confirmation instead
    expect(joined.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// handleLoadout — equip + unequip
// ---------------------------------------------------------------------------

describe('handleLoadout — equip', () => {
  let tmpHome: string
  let dir: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
    dir = stateDir(tmpHome)
    saveState(dir, initialState())
  })
  afterEach(() => removeTmpHome(tmpHome))

  it('equips a card ref and persists it (exits 0)', () => {
    const { code } = captureHandle(['equip', 'card/tools.hammer/tools'], tmpHome)
    expect(code).toBe(0)
    const state = loadState(dir)
    expect(state.loadout.slots).toHaveLength(1)
    expect(state.loadout.slots[0]).toEqual({ kind: 'card', id: 'tools.hammer', tag: 'tools' })
  })

  it('equips a gear ref and persists it', () => {
    const { code } = captureHandle(['equip', 'gear/gear.commit-hammer.1/Commit Hammer'], tmpHome)
    expect(code).toBe(0)
    const state = loadState(dir)
    expect(state.loadout.slots[0]).toMatchObject({ kind: 'gear', tag: 'Commit Hammer' })
  })

  it('equipping the same ref twice is a no-op (slots stay length 1)', () => {
    captureHandle(['equip', 'card/tools.hammer/tools'], tmpHome)
    captureHandle(['equip', 'card/tools.hammer/tools'], tmpHome)
    const state = loadState(dir)
    expect(state.loadout.slots).toHaveLength(1)
  })

  it('enforces SLOT_CAP — 4th equip returns exit 2 and does not persist', () => {
    captureHandle(['equip', 'card/tools.hammer/tools'], tmpHome)
    captureHandle(['equip', 'card/tools.wrench/tools'], tmpHome)
    captureHandle(['equip', 'buff/precast-spec'], tmpHome)
    const { code } = captureHandle(['equip', 'card/forest.oak/forest'], tmpHome)
    expect(code).toBe(2)
    const state = loadState(dir)
    expect(state.loadout.slots).toHaveLength(3)
  })

  it('invalid ref format returns exit 2', () => {
    const { code, errLines } = captureHandle(['equip', 'notaref'], tmpHome)
    expect(code).toBe(2)
    expect(errLines.some((l) => l.includes('invalid ref'))).toBe(true)
  })

  it('missing ref argument returns exit 2', () => {
    const { code } = captureHandle(['equip'], tmpHome)
    expect(code).toBe(2)
  })

  it('zen equip still persists and prints a terse confirmation', () => {
    const { code, lines } = captureHandle(['equip', 'card/tools.hammer/tools'], tmpHome, true)
    expect(code).toBe(0)
    const state = loadState(dir)
    expect(state.loadout.slots).toHaveLength(1)
    expect(lines.join('\n')).not.toContain('LOADOUT')
    expect(lines.join('\n').length).toBeGreaterThan(0)
  })
})

describe('handleLoadout — unequip', () => {
  let tmpHome: string
  let dir: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
    dir = stateDir(tmpHome)
    saveState(dir, initialState())
    // Pre-load a slot.
    captureHandle(['equip', 'card/tools.hammer/tools'], tmpHome)
  })
  afterEach(() => removeTmpHome(tmpHome))

  it('unequip slot 1 removes the first member and persists', () => {
    const { code } = captureHandle(['unequip', '1'], tmpHome)
    expect(code).toBe(0)
    const state = loadState(dir)
    expect(state.loadout.slots).toHaveLength(0)
  })

  it('unequip out-of-range slot returns exit 2', () => {
    const { code } = captureHandle(['unequip', '9'], tmpHome)
    expect(code).toBe(2)
  })

  it('unequip with no slot arg returns exit 2', () => {
    const { code } = captureHandle(['unequip'], tmpHome)
    expect(code).toBe(2)
  })
})

describe('handleLoadout — unknown sub-action', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
    const dir = stateDir(tmpHome)
    saveState(dir, initialState())
  })
  afterEach(() => removeTmpHome(tmpHome))

  it('unknown sub returns exit 2', () => {
    const { code } = captureHandle(['zap'], tmpHome)
    expect(code).toBe(2)
  })
})

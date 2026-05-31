import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ingestEvent } from './ingest'
import { initialState } from '../core/state'

// Minimal valid GroveEvent shape for a successful test_result
function makeRaw(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: 'test',
    sessionId: 'sess-1',
    type: 'test_result',
    magnitude: 5,
    success: true,
    ts: '2026-05-30T00:00:00.000Z',
    ...overrides,
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('ingestEvent', () => {
  it('successful test_result returns seed rewards and persists advanced state (R3: no auto-card)', () => {
    const { state, rewards } = ingestEvent(tmpDir, makeRaw(), 42)

    // R3 economy: a green test grants SEEDS (currency), not a guaranteed card.
    expect(rewards.length).toBeGreaterThan(0)
    const currencyReward = rewards.find((r) => r.kind === 'currency')
    expect(currencyReward).toBeDefined()

    // State must have advanced: currency > 0, XP awarded, level intact.
    expect(state.player.currency).toBeGreaterThan(0)
    expect(state.player.xp).toBeGreaterThanOrEqual(0)
    expect(state.player.level).toBeGreaterThanOrEqual(1)

    // state.json must be persisted with the advanced currency.
    const stateFile = path.join(tmpDir, 'state.json')
    expect(fs.existsSync(stateFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    expect(persisted.player.currency).toBeGreaterThan(0)

    // events.jsonl must have exactly 1 line
    const eventsFile = path.join(tmpDir, 'events.jsonl')
    expect(fs.existsSync(eventsFile)).toBe(true)
    const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n')
    expect(lines.length).toBe(1)
  })

  it('failed event (success:false) returns empty rewards and player is unchanged from initialState', () => {
    const raw = makeRaw({ success: false })
    const { state, rewards } = ingestEvent(tmpDir, raw, 42)

    expect(rewards).toEqual([])

    const init = initialState()
    expect(state.player).toEqual(init.player)
    expect(state.cards).toEqual(init.cards)
  })

  it('two successive ingests accumulate (state from second reflects first)', () => {
    const raw = makeRaw()
    const { state: first } = ingestEvent(tmpDir, raw, 42)

    // Second ingest on same dir — state must be loaded from persisted first result
    const raw2 = makeRaw({ sessionId: 'sess-2', ts: '2026-05-30T00:01:00.000Z' })
    const { state: second } = ingestEvent(tmpDir, raw2, 99)

    // Seeds accumulate across the two green tests (state loaded from the first).
    expect(second.player.currency).toBeGreaterThan(first.player.currency)

    // events.jsonl must have 2 lines
    const eventsFile = path.join(tmpDir, 'events.jsonl')
    const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
  })

  it('omitting rngSeed (auto-derive) still produces a valid result', () => {
    // exercises the hashStringToSeed fallback branch in ingest
    const { state, rewards } = ingestEvent(tmpDir, makeRaw())
    // A successful test_result must still produce rewards and persist state.
    expect(rewards.length).toBeGreaterThan(0)
    expect(state.player.currency).toBeGreaterThan(0)
    const stateFile = path.join(tmpDir, 'state.json')
    expect(fs.existsSync(stateFile)).toBe(true)
  })

  it('leaves no leftover .lock file after a normal ingest', () => {
    ingestEvent(tmpDir, makeRaw(), 42)
    expect(fs.existsSync(path.join(tmpDir, '.lock'))).toBe(false)
  })

  it('explicit rngSeed produces identical results across two fresh dirs', () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-det-'))
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-det-'))

    try {
      const raw = makeRaw()
      const result1 = ingestEvent(dir1, raw, 7777)
      const result2 = ingestEvent(dir2, raw, 7777)

      // Rewards must be identical
      expect(result1.rewards).toEqual(result2.rewards)

      // Cards in resulting state must be identical
      expect(result1.state.cards).toEqual(result2.state.cards)
      expect(result1.state.player).toEqual(result2.state.player)
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true })
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })
})

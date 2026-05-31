/**
 * convert-shards.test.ts — P3 DEAD-SHARD-TAIL (engine polish).
 *
 * Once a craftable-complete player owns every unlocked card, banked shards become
 * dead weight: there is nothing left to `craftCard`. `convertShards` is the relief
 * valve — a PURE, agency-bearing action that converts surplus shards into seeds at
 * a PUBLISHED rate (SHARD_TO_SEED), so shards always retain a horizon.
 *
 * Contract (PURE & IMMUTABLE — no I/O, no wall-clock, no rng):
 *   convertShards(state, n?) → { state, rewards }
 *  - default (n omitted): convert ALL banked shards,
 *  - n given: convert exactly min(n, banked) shards (clamped, never overdraws),
 *  - debits the converted shards, credits seeds at SHARD_TO_SEED per shard,
 *  - refuses CALMLY (no debit, no credit, never shaming) when zero shards,
 *  - never mutates the input state.
 *
 * Cosmetic-only (ADR-0005): seeds are the cosmetic currency. Rate published (ADR-0002).
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { convertShards, SHARD_TO_SEED } from './collection'

/** A state with `shards` banked and `currency` seeds on hand. */
function withShards(shards: number, currency = 0): GameState {
  return {
    ...initialState(),
    player: { xp: 0, level: 1, currency, shards },
  }
}

describe('convertShards — turns surplus shards into seeds at the published rate', () => {
  it('exports a positive, finite, integer SHARD_TO_SEED rate (published — ADR-0002)', () => {
    expect(typeof SHARD_TO_SEED).toBe('number')
    expect(Number.isFinite(SHARD_TO_SEED)).toBe(true)
    expect(SHARD_TO_SEED).toBeGreaterThan(0)
    expect(Number.isInteger(SHARD_TO_SEED)).toBe(true)
  })

  it('converts ALL banked shards by default, crediting seeds at the rate', () => {
    const { state, rewards } = convertShards(withShards(10, 100))
    // all shards spent
    expect(state.player.shards).toBe(0)
    // seeds credited at the published rate, on top of existing seeds
    expect(state.player.currency).toBe(100 + 10 * SHARD_TO_SEED)
    // a 'currency' reward fired with the credited amount and a shard tag
    const credit = rewards.find((r) => r.kind === 'currency' && (r.amount ?? 0) > 0)
    expect(credit).toBeDefined()
    expect(credit!.amount).toBe(10 * SHARD_TO_SEED)
    expect(credit!.message.toLowerCase()).toContain('shard')
  })

  it('converts exactly n shards when a count is given (the rest stays banked)', () => {
    const { state } = convertShards(withShards(10, 0), 4)
    expect(state.player.shards).toBe(6)
    expect(state.player.currency).toBe(4 * SHARD_TO_SEED)
  })

  it('clamps n to the banked balance — never overdraws into negative shards', () => {
    const { state } = convertShards(withShards(3, 0), 999)
    expect(state.player.shards).toBe(0)
    expect(state.player.currency).toBe(3 * SHARD_TO_SEED)
  })

  it('treats n <= 0 as "convert nothing" — calm refusal, no debit/credit', () => {
    const { state, rewards } = convertShards(withShards(10, 50), 0)
    expect(state.player.shards).toBe(10)
    expect(state.player.currency).toBe(50)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/no shard|nothing|zero/i)
    expect(msg).not.toMatch(/fail|lazy|shame|stupid|worthless/i)
  })

  it('refuses CALMLY at zero shards — no debit, no credit, never shaming', () => {
    const { state, rewards } = convertShards(withShards(0, 200))
    expect(state.player.shards).toBe(0)
    expect(state.player.currency).toBe(200)
    // no positive currency credit fired
    expect(rewards.some((r) => r.kind === 'currency' && (r.amount ?? 0) > 0)).toBe(false)
    const msg = rewards.map((r) => r.message).join(' ').toLowerCase()
    expect(msg).toMatch(/no shard|nothing|zero/i)
    expect(msg).not.toMatch(/fail|lazy|shame|stupid|worthless/i)
  })

  it('treats an absent shards field as 0 (legacy state) and refuses calmly', () => {
    const s0: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 0 } }
    const { state, rewards } = convertShards(s0)
    expect(state.player.shards ?? 0).toBe(0)
    expect(state.player.currency).toBe(0)
    expect(rewards.some((r) => r.kind === 'currency' && (r.amount ?? 0) > 0)).toBe(false)
  })

  it('never mutates the input state (purity)', () => {
    const s0 = withShards(7, 30)
    const snap = JSON.parse(JSON.stringify(s0))
    convertShards(s0)
    convertShards(s0, 3)
    convertShards(s0, 0)
    expect(s0).toEqual(snap)
  })

  it('is deterministic — same inputs yield the same result (no rng)', () => {
    const a = convertShards(withShards(12, 5), 5)
    const b = convertShards(withShards(12, 5), 5)
    expect(a.state).toEqual(b.state)
    expect(a.rewards).toEqual(b.rewards)
  })

  it('the credit reward never carries a shaming line (ADR-0009 tone)', () => {
    const { rewards } = convertShards(withShards(24, 0))
    const msg = rewards.map((r) => r.message).join(' ')
    expect(msg).not.toMatch(/fail|lazy|shame|stupid|worthless|wasted/i)
  })
})

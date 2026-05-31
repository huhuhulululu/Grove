import { describe, it, expect } from 'vitest'
import { xpForLevel, applyXp } from './xp'
import type { PlayerState } from '../core/state'

describe('xpForLevel', () => {
  it('level 1 -> 2 requires 50 xp', () => {
    expect(xpForLevel(1)).toBe(50)
  })

  it('level 2 -> 3 requires 141 xp', () => {
    expect(xpForLevel(2)).toBe(141)
  })

  it('level 3 -> 4 requires 260 xp', () => {
    expect(xpForLevel(3)).toBe(260)
  })

  it('high levels are capped at 2000', () => {
    // level 100: 50 * 100^1.5 = 50000, capped to 2000
    expect(xpForLevel(100)).toBe(2000)
  })

  it('level 0 uses max(1, level) so same as level 1', () => {
    expect(xpForLevel(0)).toBe(xpForLevel(1))
  })
})

describe('applyXp', () => {
  const basePlayer: PlayerState = { xp: 0, level: 1, currency: 42 }

  it('50 xp at level 1 => level 2 with 0 remainder', () => {
    const result = applyXp(basePlayer, 50)
    expect(result.player.level).toBe(2)
    expect(result.player.xp).toBe(0)
    expect(result.levelUps).toBe(1)
  })

  it('60 xp at level 1 => level 2 with 10 xp remainder', () => {
    const result = applyXp(basePlayer, 60)
    expect(result.player.level).toBe(2)
    expect(result.player.xp).toBe(10)
    expect(result.levelUps).toBe(1)
  })

  it('a big amount causes multiple level-ups in one call', () => {
    // level 1 needs 50, level 2 needs 141, level 3 needs 260
    // total to reach level 4: 50 + 141 + 260 = 451
    const result = applyXp(basePlayer, 451)
    expect(result.player.level).toBe(4)
    expect(result.player.xp).toBe(0)
    expect(result.levelUps).toBe(3)
  })

  it('amount 0 => no-op clone with levelUps 0', () => {
    const result = applyXp(basePlayer, 0)
    expect(result.player.level).toBe(1)
    expect(result.player.xp).toBe(0)
    expect(result.levelUps).toBe(0)
  })

  it('negative amount => no-op clone with levelUps 0', () => {
    const result = applyXp(basePlayer, -99)
    expect(result.player.level).toBe(1)
    expect(result.player.xp).toBe(0)
    expect(result.levelUps).toBe(0)
  })

  it('currency is preserved through level-ups', () => {
    const result = applyXp(basePlayer, 200)
    expect(result.player.currency).toBe(42)
  })

  it('input player object is not mutated', () => {
    const player: PlayerState = { xp: 0, level: 1, currency: 10 }
    applyXp(player, 999)
    expect(player.xp).toBe(0)
    expect(player.level).toBe(1)
    expect(player.currency).toBe(10)
  })

  it('remainder carryover: player with existing xp accumulates correctly', () => {
    const player: PlayerState = { xp: 40, level: 1, currency: 0 }
    // needs 50 total for level-up; has 40, adding 20 => 60 total => level 2 + 10 remainder
    const result = applyXp(player, 20)
    expect(result.player.level).toBe(2)
    expect(result.player.xp).toBe(10)
    expect(result.levelUps).toBe(1)
  })

  it('multiple level-ups with leftover remainder', () => {
    // 50 + 141 = 191 to reach level 3; adding 195 => level 3 + 4 remainder
    const result = applyXp(basePlayer, 195)
    expect(result.player.level).toBe(3)
    expect(result.player.xp).toBe(4)
    expect(result.levelUps).toBe(2)
  })
})

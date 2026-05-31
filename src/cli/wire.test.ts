/**
 * wire.test.ts — TDD tests for R6 "wire the dead engine sinks" (audit re-score③).
 *
 * Covers the new subcommands `sq craft`, `sq prestige`, `sq pull --premium`, and
 * the level-scaling enhance/repair costs that the CLI must use instead of flat
 * constants. Fresh temp --home per test for isolation.
 *
 * Run: npx vitest run src/cli/wire.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from './sq'
import { loadState, saveState } from '../store/store'
import { stateDir } from '../store/paths'
import { PULL_COST, PREMIUM_PULL_COST, PRESTIGE_COST } from '../engine/reduce'
import { SHARDS_PER_CRAFT } from '../engine/collection'
import { enhanceCost, repairCost } from '../engine/gear'
import type { GameState } from '../core/state'

// ---- Helpers ----------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-wire-test-'))
}
function removeTmpHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function captureRun(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    spy.mockRestore()
    errSpy.mockRestore()
  }
  return { code, output: lines }
}

/** Seed state directly (under the home's state dir). */
function seedState(home: string, patch: (s: GameState) => GameState): GameState {
  const dir = stateDir(home)
  const next = patch(loadState(dir))
  saveState(dir, next)
  return next
}

describe('sq wiring (R6)', () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = makeTmpHome()
  })
  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  // ===========================================================================
  // sq craft  →  craftCard (SPEND shards)
  // ===========================================================================

  describe('sq craft', () => {
    it('crafts the default (first missing) card when shards suffice', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, shards: SHARDS_PER_CRAFT } }))
      const before = loadState(stateDir(tmpHome))
      const { code } = captureRun(['craft', '--home', tmpHome])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      // A card was added and shards were debited by exactly SHARDS_PER_CRAFT.
      expect(after.cards.length).toBe(before.cards.length + 1)
      expect(after.player.shards ?? 0).toBe((before.player.shards ?? 0) - SHARDS_PER_CRAFT)
    })

    it('crafts a chosen missing card id when given', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, shards: SHARDS_PER_CRAFT } }))
      const { code } = captureRun(['craft', 'forest.oak', '--home', tmpHome])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      expect(after.cards.some((c) => c.id === 'forest.oak')).toBe(true)
    })

    it('renders the crafted card reward line', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, shards: SHARDS_PER_CRAFT } }))
      const { output } = captureRun(['craft', '--home', tmpHome])
      const combined = output.join('\n')
      expect(combined.toLowerCase()).toContain('craft')
    })

    it('refuses calmly (no debit, no card) when shards are insufficient', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, shards: 5 } }))
      const before = loadState(stateDir(tmpHome))
      const { code, output } = captureRun(['craft', '--home', tmpHome])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      expect(after.cards.length).toBe(before.cards.length)
      expect(after.player.shards ?? 0).toBe(5) // unchanged
      expect(output.join('\n').toLowerCase()).toContain('not enough shards')
    })

    it('--zen prints a single quiet confirmation, no loot spectacle', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, shards: SHARDS_PER_CRAFT } }))
      const { code, output } = captureRun(['--zen', 'craft', '--home', tmpHome])
      expect(code).toBe(0)
      const combined = output.join('\n')
      expect(combined).toContain('✓')
      // The card still persisted even in calm mode.
      const after = loadState(stateDir(tmpHome))
      expect(after.cards.length).toBe(1)
    })
  })

  // ===========================================================================
  // sq prestige  →  buyPrestige (escalating seed SINK)
  // ===========================================================================

  describe('sq prestige', () => {
    it('buys the first prestige rank, debiting PRESTIGE_COST seeds', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PRESTIGE_COST + 10 } }))
      const { code } = captureRun(['prestige', '--home', tmpHome])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      expect(after.player.currency).toBe(10)
      // A prestige buff was added.
      expect(after.buffs.some((b) => b.id.startsWith('prestige:mark'))).toBe(true)
    })

    it('renders the prestige reward line', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PRESTIGE_COST } }))
      const { output } = captureRun(['prestige', '--home', tmpHome])
      expect(output.join('\n').toLowerCase()).toContain('prestige')
    })

    it('refuses calmly (no debit) when broke', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 10 } }))
      const { code, output } = captureRun(['prestige', '--home', tmpHome])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      expect(after.player.currency).toBe(10) // unchanged
      expect(after.buffs.length).toBe(0)
      expect(output.join('\n').toLowerCase()).toContain('not enough')
    })

    it('--zen prints a quiet confirmation but still persists the rank', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PRESTIGE_COST } }))
      const { code, output } = captureRun(['--zen', 'prestige', '--home', tmpHome])
      expect(code).toBe(0)
      expect(output.join('\n')).toContain('✓')
      const after = loadState(stateDir(tmpHome))
      expect(after.buffs.some((b) => b.id.startsWith('prestige:mark'))).toBe(true)
    })
  })

  // ===========================================================================
  // sq pull --premium  →  pullPremium (PREMIUM_PULL_COST)
  // ===========================================================================

  describe('sq pull --premium', () => {
    it('spends PREMIUM_PULL_COST seeds and adds a card', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PREMIUM_PULL_COST + 5 } }))
      const before = loadState(stateDir(tmpHome))
      const { code } = captureRun(['pull', '--premium', '--home', tmpHome, '--seed', '3'])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      expect(after.player.currency).toBe(5)
      expect(after.cards.length).toBe(before.cards.length + 1)
    })

    it('uses the STANDARD cost (PULL_COST) for a non-premium pull (regression guard)', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 100 } }))
      const { code } = captureRun(['pull', '--home', tmpHome, '--seed', '3'])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      // Standard pull cost is PULL_COST (45) — premium was NOT charged.
      expect(after.player.currency).toBe(100 - PULL_COST)
    })

    it('refuses calmly when below the premium cost', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PREMIUM_PULL_COST - 1 } }))
      const before = loadState(stateDir(tmpHome))
      const { code, output } = captureRun(['pull', '--premium', '--home', tmpHome, '--seed', '3'])
      expect(code).toBe(0)
      const after = loadState(stateDir(tmpHome))
      expect(after.cards.length).toBe(before.cards.length)
      expect(after.player.currency).toBe(PREMIUM_PULL_COST - 1) // unchanged
      expect(output.join('\n').toLowerCase()).toContain('premium')
    })

    it('--zen premium pull stays quiet but still persists', () => {
      seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PREMIUM_PULL_COST } }))
      const { code, output } = captureRun(['--zen', 'pull', '--premium', '--home', tmpHome, '--seed', '3'])
      expect(code).toBe(0)
      expect(output.join('\n')).toContain('✓')
      const after = loadState(stateDir(tmpHome))
      expect(after.player.currency).toBe(0)
    })
  })

  // ===========================================================================
  // Level-scaling enhance / repair costs (P0): no more flat constants
  // ===========================================================================

  describe('level-scaling costs', () => {
    it('enhance at level 3 debits enhanceCost(3), not the flat 20', () => {
      const dir = stateDir(tmpHome)
      seedState(tmpHome, (s) => ({
        ...s,
        player: { ...s.player, currency: 500 },
        gear: [{ id: 'g.1', name: 'Commit Hammer', level: 3, rarity: 'rare' as const, broken: false }],
      }))
      const before = loadState(dir).player.currency
      // seed 1 → guaranteed success path; cost is what we assert (not the result).
      captureRun(['enhance', 'first', '--home', tmpHome, '--seed', '1'])
      const after = loadState(dir).player.currency
      expect(before - after).toBe(enhanceCost(3))
      expect(before - after).not.toBe(20) // the old flat constant
    })

    it('refuses enhance when the wallet is short of the SCALED cost', () => {
      const dir = stateDir(tmpHome)
      // enhanceCost(5) = 20 + 5*8 = 60. Fund 59 → must refuse (flat 20 would pass).
      seedState(tmpHome, (s) => ({
        ...s,
        player: { ...s.player, currency: enhanceCost(5) - 1 },
        gear: [{ id: 'g.1', name: 'Lint Razor', level: 5, rarity: 'rare' as const, broken: false }],
      }))
      const before = loadState(dir)
      const { output } = captureRun(['enhance', 'first', '--home', tmpHome, '--seed', '1'])
      const after = loadState(dir)
      // No debit, gear unchanged — refused on the scaled price.
      expect(after.player.currency).toBe(before.player.currency)
      expect(after.gear[0]!.level).toBe(5)
      expect(output.join('\n').toLowerCase()).toContain('not enough')
    })

    it('repair at level 8 debits repairCost(level), not the flat 50', () => {
      const dir = stateDir(tmpHome)
      const gear = { id: 'g.1', name: 'Merge Shield', level: 8, rarity: 'epic' as const, broken: true }
      seedState(tmpHome, (s) => ({
        ...s,
        player: { ...s.player, currency: 500 },
        gear: [gear],
      }))
      const before = loadState(dir).player.currency
      captureRun(['repair', 'first', '--home', tmpHome])
      const after = loadState(dir).player.currency
      expect(before - after).toBe(repairCost(gear))
      expect(before - after).not.toBe(50) // the old flat constant
    })

    it('refuses repair when the wallet is short of the SCALED repair cost', () => {
      const dir = stateDir(tmpHome)
      const gear = { id: 'g.1', name: 'Merge Shield', level: 8, rarity: 'epic' as const, broken: true }
      // repairCost(8) = 50 + 8*10 = 130. Fund 129 → refuse (flat 50 would pass).
      seedState(tmpHome, (s) => ({
        ...s,
        player: { ...s.player, currency: repairCost(gear) - 1 },
        gear: [gear],
      }))
      const before = loadState(dir)
      const { output } = captureRun(['repair', 'first', '--home', tmpHome])
      const after = loadState(dir)
      expect(after.player.currency).toBe(before.player.currency) // no debit
      expect(after.gear[0]!.broken).toBe(true) // still broken
      expect(output.join('\n').toLowerCase()).toContain('not enough')
    })
  })

  // ===========================================================================
  // help / usage updated
  // ===========================================================================

  describe('help / usage', () => {
    it('help mentions craft, prestige, and premium', () => {
      const { output } = captureRun(['help'])
      const combined = output.join('\n').toLowerCase()
      expect(combined).toContain('craft')
      expect(combined).toContain('prestige')
      expect(combined).toContain('premium')
    })

    it('suggests craft/prestige on a near typo (did-you-mean)', () => {
      const { code, output } = captureRun(['prestig', '--home', tmpHome])
      expect(code).toBe(2)
      expect(output.join('\n').toLowerCase()).toContain('prestige')
    })
  })
})

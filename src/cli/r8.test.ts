/**
 * r8.test.ts — TDD for the R8 surface/robustness pass (audit re-score⑥ → A).
 *
 * Covers:
 *  - `sq foil [cardId]` wiring → engine foilCard (spends shards, refuses calmly).
 *  - `sq pull --premium --spark <id>` sets the spark target the premium banner
 *    builds toward, and routes through pullPremium.
 *  - ROBUSTNESS: a broke pull / broke premium does NOT write state (no no-op save).
 *  - help/usage mentions foil + spark.
 *
 * Fresh temp --home per test for isolation. Run: npx vitest run src/cli/r8.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run } from './sq'
import { loadState, saveState, BACKUP_KEEP } from '../store/store'
import { stateDir } from '../store/paths'
import { FOIL_COST, PREMIUM_PULL_COST, PULL_COST, SPARK_THRESHOLD } from '../engine/reduce'
import type { GameState } from '../core/state'

// ---- Helpers ----------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-r8-test-'))
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

function seedState(home: string, patch: (s: GameState) => GameState): GameState {
  const dir = stateDir(home)
  const next = patch(loadState(dir))
  saveState(dir, next)
  return next
}

/** mtime (ms) of the per-repo state.json, or 0 if absent. */
function stateMtime(home: string): number {
  const file = path.join(stateDir(home), 'state.json')
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

describe('sq foil', () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = makeTmpHome()
  })
  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  it('spends FOIL_COST shards and flags an owned card foiled (default target)', () => {
    seedState(tmpHome, (s) => ({
      ...s,
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...s.player, shards: FOIL_COST + 4 },
    }))
    const { code } = captureRun(['foil', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.player.shards ?? 0).toBe(4)
    expect(after.foiled).toContain('forest.oak')
  })

  it('foils a chosen owned card id when given', () => {
    seedState(tmpHome, (s) => ({
      ...s,
      cards: [
        { id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' },
        { id: 'forest.sapling', name: 'Sapling', rarity: 'common', set: 'forest' },
      ],
      player: { ...s.player, shards: FOIL_COST },
    }))
    const { code } = captureRun(['foil', 'forest.sapling', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.foiled).toContain('forest.sapling')
    expect(after.foiled).not.toContain('forest.oak')
  })

  it('renders the foil reward line', () => {
    seedState(tmpHome, (s) => ({
      ...s,
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...s.player, shards: FOIL_COST },
    }))
    const { output } = captureRun(['foil', '--home', tmpHome])
    expect(output.join('\n').toLowerCase()).toContain('foil')
  })

  it('refuses calmly (no debit) when shards are insufficient', () => {
    seedState(tmpHome, (s) => ({
      ...s,
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...s.player, shards: FOIL_COST - 1 },
    }))
    const { code, output } = captureRun(['foil', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.player.shards ?? 0).toBe(FOIL_COST - 1)
    expect(after.foiled ?? []).toHaveLength(0)
    expect(output.join('\n').toLowerCase()).toContain('not enough')
  })

  it('--zen prints a quiet confirmation but still persists the foil', () => {
    seedState(tmpHome, (s) => ({
      ...s,
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...s.player, shards: FOIL_COST },
    }))
    const { code, output } = captureRun(['--zen', 'foil', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output.join('\n')).toContain('✓')
    expect(loadState(stateDir(tmpHome)).foiled).toContain('forest.oak')
  })
})

describe('sq pull --premium --spark <id>', () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = makeTmpHome()
  })
  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  it('records the chosen spark target before the premium roll', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PREMIUM_PULL_COST } }))
    const { code } = captureRun([
      'pull', '--premium', '--spark', 'forest.willow', '--home', tmpHome, '--seed', '3',
    ])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.sparkTarget).toBe('forest.willow')
  })

  it('a spark target at threshold guarantees that missing card on the premium pull', () => {
    seedState(tmpHome, (s) => ({
      ...s,
      spark: SPARK_THRESHOLD,
      sparkTarget: 'forest.willow',
      player: { ...s.player, currency: PREMIUM_PULL_COST },
    }))
    const { code } = captureRun(['pull', '--premium', '--home', tmpHome, '--seed', '7'])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.cards.some((c) => c.id === 'forest.willow')).toBe(true)
    expect(after.spark).toBe(0)
  })
})

describe('robustness — broke action does NOT write state (no no-op save)', () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = makeTmpHome()
  })
  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  it('a broke standard pull leaves state.json untouched (mtime unchanged)', async () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PULL_COST - 1 } }))
    const before = stateMtime(tmpHome)
    expect(before).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 15))
    const { code } = captureRun(['pull', '--home', tmpHome, '--seed', '3'])
    expect(code).toBe(0)
    expect(stateMtime(tmpHome)).toBe(before) // no rewrite
  })

  it('a broke premium pull leaves state.json untouched', async () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PREMIUM_PULL_COST - 1 } }))
    const before = stateMtime(tmpHome)
    await new Promise((r) => setTimeout(r, 15))
    captureRun(['pull', '--premium', '--home', tmpHome, '--seed', '3'])
    expect(stateMtime(tmpHome)).toBe(before)
  })

  it('a broke foil leaves state.json untouched', async () => {
    seedState(tmpHome, (s) => ({
      ...s,
      cards: [{ id: 'forest.oak', name: 'Oak', rarity: 'common', set: 'forest' }],
      player: { ...s.player, shards: FOIL_COST - 1 },
    }))
    const before = stateMtime(tmpHome)
    await new Promise((r) => setTimeout(r, 15))
    captureRun(['foil', '--home', tmpHome])
    expect(stateMtime(tmpHome)).toBe(before)
  })

  it('a broke craft leaves state.json untouched', async () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, shards: 1 } }))
    const before = stateMtime(tmpHome)
    await new Promise((r) => setTimeout(r, 15))
    captureRun(['craft', '--home', tmpHome])
    expect(stateMtime(tmpHome)).toBe(before)
  })

  it('an AFFORDABLE pull DOES write state (regression guard for the skip-save)', async () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: PULL_COST + 5 } }))
    const before = stateMtime(tmpHome)
    await new Promise((r) => setTimeout(r, 15))
    captureRun(['pull', '--home', tmpHome, '--seed', '3'])
    expect(stateMtime(tmpHome)).toBeGreaterThan(before)
    expect(loadState(stateDir(tmpHome)).player.currency).toBe(5)
  })
})

describe('statusline install rotates settings.json.bak.* (keep newest BACKUP_KEEP)', () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = makeTmpHome()
  })
  afterEach(() => {
    removeTmpHome(tmpHome)
  })

  it('keeps at most BACKUP_KEEP settings backups after repeated installs', () => {
    const claudeDir = path.join(tmpHome, 'claude')
    fs.mkdirSync(claudeDir, { recursive: true })
    const settingsPath = path.join(claudeDir, 'settings.json')
    const wrapperPath = path.join(claudeDir, 'grove-statusline-wrapper.sh')

    // Pre-create several stale backups (older mtimes) so rotation has work to do.
    const base = Date.now() - 100_000
    for (let i = 0; i < 5; i++) {
      const p = path.join(claudeDir, `settings.json.bak.${1000 + i}`)
      fs.writeFileSync(p, '{}', 'utf8')
      fs.utimesSync(p, (base + i * 1000) / 1000, (base + i * 1000) / 1000)
    }

    // A fresh settings.json with a prior statusline command (so install backs it up).
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { command: 'echo hi' } }), 'utf8')

    const { code } = captureRun(['statusline', 'install', '--settings', settingsPath])
    expect(code).toBe(0)
    // The install removed the wrapper-pointing side effect; assert backup count capped.
    void wrapperPath
    const backups = fs
      .readdirSync(claudeDir)
      .filter((f) => f.startsWith('settings.json.bak.'))
    expect(backups.length).toBeLessThanOrEqual(BACKUP_KEEP)
  })
})

describe('help / usage mentions foil + spark', () => {
  it('help lists foil and spark', () => {
    const { output } = captureRun(['help'])
    const combined = output.join('\n').toLowerCase()
    expect(combined).toContain('foil')
    expect(combined).toContain('spark')
  })

  it('suggests foil on a near typo (did-you-mean)', () => {
    const tmpHome = makeTmpHome()
    try {
      const { code, output } = captureRun(['foi', '--home', tmpHome])
      expect(code).toBe(2)
      expect(output.join('\n').toLowerCase()).toContain('foil')
    } finally {
      removeTmpHome(tmpHome)
    }
  })
})

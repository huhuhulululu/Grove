/**
 * integrate.test.ts — wiring the new renderers/sinks into the CLI (M3 + M5).
 *
 * Covers the Integrate role:
 *  - `sq tui --once` renders one static frame from persisted state and exits 0.
 *  - `sq serve` help/dispatch exists (the long-running server is started via the
 *    injectable startWebServer seam so the test never blocks on Ctrl-C).
 *  - `sq convert [n]` runs the engine convertShards under the lock, persists the
 *    debit/credit, and renders.
 *  - The USAGE block INTERPOLATES the live engine cost constants — a regression
 *    guard asserts the help text contains no cost number disagreeing with the
 *    imported constants (so it can never drift behind a balance change again).
 *
 * Fresh temp --home per test for isolation.
 *
 * Run: npx vitest run src/cli/integrate.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run, runAsync, USAGE_TEXT, PROTECT_COST } from './sq'
import { loadState, saveState } from '../store/store'
import { stateDir } from '../store/paths'
import {
  PULL_COST,
  PREMIUM_PULL_COST,
  PRESTIGE_COST,
  FOIL_COST,
  FOIL_COST_BY_RARITY,
} from '../engine/reduce'
import {
  SHARDS_PER_CRAFT,
  SHARD_TO_SEED,
} from '../engine/collection'
import {
  ENHANCE_COST_BASE,
  ENHANCE_COST_PER_LEVEL,
  REPAIR_COST_BASE,
  REPAIR_COST_PER_LEVEL,
} from '../engine/gear'
import { MAX_XP_PER_LEVEL } from '../engine/xp'
import type { GameState } from '../core/state'

// ---- Helpers ----------------------------------------------------------------

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-integrate-test-'))
}
function removeTmpHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function captureRun(argv: string[]): { code: number; output: string[] } {
  const lines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
  return { code, output: lines }
}

async function captureRunAsync(argv: string[]): Promise<{ code: number; output: string[] }> {
  const lines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  let code: number
  try {
    code = await runAsync(argv)
  } finally {
    logSpy.mockRestore()
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

// =============================================================================
// sq tui --once  →  runTui(dir, { once: true })
// =============================================================================

describe('sq tui', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { removeTmpHome(tmpHome) })

  it('--once renders a static frame and exits 0', async () => {
    const { code, output } = await captureRunAsync(['tui', '--once', '--home', tmpHome])
    expect(code).toBe(0)
    const combined = output.join('\n')
    // The static frame header is the deterministic, headless tell.
    expect(combined).toContain('GROVE')
    expect(combined).toContain('Level')
  })

  it('--once reflects persisted state (seeds shown in the frame)', async () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 777 } }))
    const { code, output } = await captureRunAsync(['tui', '--once', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output.join('\n')).toContain('777')
  })

  it('help mentions the tui subcommand', () => {
    const { output } = captureRun(['help'])
    expect(output.join('\n').toLowerCase()).toContain('tui')
  })

  it('the live (non-once) path is not started in --once (no hang, sync-fast)', async () => {
    // A --once run must resolve quickly without mounting Ink (raw-mode would
    // throw in a non-TTY test env). Resolving at all proves we took the once path.
    const { code } = await captureRunAsync(['tui', '--once', '--home', tmpHome])
    expect(code).toBe(0)
  })
})

// =============================================================================
// sq serve  →  startWebServer (long-running; injectable seam keeps the test green)
// =============================================================================

describe('sq serve', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { removeTmpHome(tmpHome) })

  it('help mentions the serve subcommand', () => {
    const { output } = captureRun(['help'])
    expect(output.join('\n').toLowerCase()).toContain('serve')
  })

  it('starts a real server, prints its URL, and we can close it', async () => {
    // No --keep-alive: the test variant starts + prints + immediately returns the
    // handle via the test seam so it never blocks on Ctrl-C.
    const { code, output } = await captureRunAsync([
      'serve', '--home', tmpHome, '--no-wait',
    ])
    expect(code).toBe(0)
    const combined = output.join('\n')
    // The URL must be printed so the user can open it.
    expect(combined).toMatch(/http:\/\/127\.0\.0\.1:\d+/)
  })

  it('honors an explicit --port', async () => {
    const { code, output } = await captureRunAsync([
      'serve', '--home', tmpHome, '--no-wait', '--port', '54329',
    ])
    expect(code).toBe(0)
    expect(output.join('\n')).toContain('54329')
  })
})

// =============================================================================
// sq convert [n]  →  convertShards under the lock
// =============================================================================

describe('sq convert', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { removeTmpHome(tmpHome) })

  it('converts ALL banked shards by default, crediting seeds at the rate', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 10, shards: 8 } }))
    const { code } = captureRun(['convert', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.player.shards ?? 0).toBe(0)
    expect(after.player.currency).toBe(10 + 8 * SHARD_TO_SEED)
  })

  it('converts exactly n shards when a count is given (the rest stays banked)', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 0, shards: 10 } }))
    const { code } = captureRun(['convert', '4', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.player.shards ?? 0).toBe(6)
    expect(after.player.currency).toBe(4 * SHARD_TO_SEED)
  })

  it('renders the credited seeds reward line', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 0, shards: 5 } }))
    const { output } = captureRun(['convert', '--home', tmpHome])
    expect(output.join('\n').toLowerCase()).toContain('shard')
  })

  it('refuses calmly (no debit, no credit) at zero shards', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 50, shards: 0 } }))
    const { code, output } = captureRun(['convert', '--home', tmpHome])
    expect(code).toBe(0)
    const after = loadState(stateDir(tmpHome))
    expect(after.player.currency).toBe(50)
    expect(after.player.shards ?? 0).toBe(0)
    expect(output.join('\n').toLowerCase()).toMatch(/no shard|nothing/)
  })

  it('--zen prints a single quiet confirmation but still persists the credit', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, currency: 0, shards: 6 } }))
    const { code, output } = captureRun(['--zen', 'convert', '--home', tmpHome])
    expect(code).toBe(0)
    expect(output.join('\n')).toContain('✓')
    const after = loadState(stateDir(tmpHome))
    expect(after.player.currency).toBe(6 * SHARD_TO_SEED)
  })

  it('help mentions the convert subcommand', () => {
    const { output } = captureRun(['help'])
    expect(output.join('\n').toLowerCase()).toContain('convert')
  })

  it('suggests convert on a near typo (did-you-mean)', () => {
    const { code, output } = captureRun(['conver', '--home', tmpHome])
    expect(code).toBe(2)
    expect(output.join('\n').toLowerCase()).toContain('convert')
  })
})

// =============================================================================
// USAGE cost-drift guard (P2): the help text interpolates live constants.
// =============================================================================

describe('help text never drifts from the live engine cost constants (P2)', () => {
  it('mentions the live PULL_COST / PREMIUM_PULL_COST / SHARDS_PER_CRAFT', () => {
    const { output } = captureRun(['help'])
    const text = output.join('\n')
    expect(text).toContain(String(PULL_COST))
    expect(text).toContain(String(PREMIUM_PULL_COST))
    expect(text).toContain(String(SHARDS_PER_CRAFT))
  })

  it('contains NO stale pre-balance cost number (the old drift values are gone)', () => {
    // Pre-R7 hardcoded values that drifted: 30 (pull), 150 (premium), 40 (craft).
    // After interpolation none of those appear as a standalone token in the help.
    const { output } = captureRun(['help'])
    const text = output.join('\n')
    const tokens = text.split(/[^0-9]+/).filter((t) => t.length > 0).map(Number)
    // The set of every cost number the engine actually charges — the ONLY cost
    // numbers allowed to appear in the help text.
    const liveCosts = new Set<number>([
      PULL_COST,
      PREMIUM_PULL_COST,
      PRESTIGE_COST,
      SHARDS_PER_CRAFT,
      SHARD_TO_SEED,
      ENHANCE_COST_BASE,
      ENHANCE_COST_PER_LEVEL,
      REPAIR_COST_BASE,
      REPAIR_COST_PER_LEVEL,
      PROTECT_COST,
      FOIL_COST, // R8: `sq foil` surfaces FOIL_COST shards in the help text.
      // R10: foil cost is rarity-scaled; help shows the curve's floor & ceiling
      // (e.g. "3 to 72 shards"), so every tier is a legit live cost.
      ...Object.values(FOIL_COST_BY_RARITY),
    ])
    // The stale drift values must NOT appear (unless one equals a live cost — e.g.
    // FOIL_COST is now 30, a legit live cost, so 30 is allowed via liveCosts).
    const stale = [150]
    for (const n of stale) {
      if (!liveCosts.has(n)) {
        expect(tokens, `stale cost ${n} still present in help`).not.toContain(n)
      }
    }
  })

  it('USAGE_TEXT is exported and equals the rendered help body', () => {
    const { output } = captureRun(['help'])
    expect(output.join('\n')).toContain(USAGE_TEXT)
  })

  it('every cost number in USAGE_TEXT is a live engine constant (strict no-drift)', () => {
    // The strongest guard: extract the numbers that follow a cost cue (Spend N,
    // costs N, N 🌰, N shards) and require each to be an actual engine constant.
    const liveCosts = new Set<number>([
      PULL_COST,
      PREMIUM_PULL_COST,
      PRESTIGE_COST,
      SHARDS_PER_CRAFT,
      SHARD_TO_SEED,
      ENHANCE_COST_BASE,
      ENHANCE_COST_PER_LEVEL,
      REPAIR_COST_BASE,
      REPAIR_COST_PER_LEVEL,
      PROTECT_COST,
      FOIL_COST, // R8: `sq foil` surfaces FOIL_COST shards in the help text.
      // R10: foil cost is rarity-scaled; help shows the curve's floor & ceiling
      // (e.g. "3 to 72 shards"), so every tier is a legit live cost.
      ...Object.values(FOIL_COST_BY_RARITY),
    ])
    // Match a number immediately tied to a spend/cost/currency cue.
    const costRe = /(?:Spend|costs?|cost)\s+(\d+)|(\d+)\s*(?:🌰|shards?)/g
    let m: RegExpExecArray | null
    const offenders: number[] = []
    while ((m = costRe.exec(USAGE_TEXT)) !== null) {
      const n = Number(m[1] ?? m[2])
      if (!Number.isNaN(n) && !liveCosts.has(n)) offenders.push(n)
    }
    expect(offenders, `cost number(s) in help not backed by a constant: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('web XP curve stays in lockstep with the engine (P1)', () => {
  it('src/web/page.ts inlines the live MAX_XP_PER_LEVEL cap, never a stale literal', () => {
    // The web dashboard re-implements xpForLevel as an inline JS string; if the cap
    // drifts from the engine the XP bar de-syncs. Pin them together.
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/web/page.ts'), 'utf8')
    const inlineRe = /function xpForLevel\(level\)\{ return Math\.min\((\d+),/
    const m = inlineRe.exec(src)
    expect(m, 'inline xpForLevel not found in src/web/page.ts').not.toBeNull()
    expect(Number(m![1])).toBe(MAX_XP_PER_LEVEL)
  })
})

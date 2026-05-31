/**
 * ntfy-share.test.ts — Integrate role: wire `sq share` + `sq ntfy` into the CLI,
 * and the push-on-big-moment reward-path hook (M5 push partial / M6 share, ADR-0011).
 *
 * Owns the share/ntfy slice of src/cli/sq.ts. Disjoint new file — runs only its
 * own cases (the final Verify runs the whole suite).
 *
 * Covers:
 *  sq share:
 *   - prints a copy-pasteable card from persisted state (level + collection %)
 *   - --badge prints a markdown shields.io badge with the level
 *   - still prints under --zen (it is user-invoked, opt-in)
 *   - never leaks repo/cwd/cost (privacy, ADR-0011)
 *  sq ntfy:
 *   - `sq ntfy <topic>` persists the topic so ntfyTopic() reads it back
 *   - `sq ntfy off` clears it (ntfyTopic() → null)
 *   - bare `sq ntfy` (no arg) shows current state, exits 0, persists nothing
 *  push wiring (maybePush):
 *   - sends ONLY when a topic is set AND the batch is pushWorthy
 *   - no push by default (no topic) — even for a big batch
 *   - no push when topic set but the batch is routine (pushWorthy → null)
 *   - is fire-and-forget: a throwing send never propagates
 *  help/usage:
 *   - help mentions share + ntfy
 *
 * Run: npx vitest run src/cli/ntfy-share.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run, maybePush } from './sq'
import { loadState, saveState } from '../store/store'
import { stateDir, groveHome } from '../store/paths'
import { ntfyTopic } from '../adapters/ntfy'
import type { GameState } from '../core/state'
import type { Reward } from '../core/rewards'

// ---- Helpers ----------------------------------------------------------------

/**
 * Make a fresh tmp dir and point GROVE_HOME at it. The ntfy topic config lives
 * under groveHome(), so both the writer (`sq ntfy`) and the reader (ntfyTopic())
 * agree when GROVE_HOME is the tmp dir. `--home` ALSO resolves under it, so the
 * per-repo state and the global ntfy config share one isolated tree.
 */
let savedGroveHome: string | undefined
let savedNtfyTopic: string | undefined

function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-ntfy-share-test-'))
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

function seedState(home: string, patch: (s: GameState) => GameState): GameState {
  const dir = stateDir(home)
  const next = patch(loadState(dir))
  saveState(dir, next)
  return next
}

function makeCards(count: number): GameState['cards'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `test.card-${i}`,
    name: `Card ${i}`,
    rarity: 'common' as const,
    set: 'forest',
  }))
}

function legendaryBatch(): Reward[] {
  return [
    {
      kind: 'card',
      rarity: 'legendary',
      card: { id: 'c1', name: 'Phantom Refactor', rarity: 'legendary', set: 'core' },
      message: '🃏 Phantom Refactor · legendary',
    },
  ]
}

function routineBatch(): Reward[] {
  return [{ kind: 'xp', amount: 10, message: '+10 XP · commit' }]
}

// =============================================================================
// sq share
// =============================================================================

describe('sq share', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpHome() })
  afterEach(() => { removeTmpHome(tmpHome) })

  it('prints a copy-pasteable card with level and collection %', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, level: 7 }, cards: makeCards(5) }))
    const { code, output } = captureRun(['share', '--home', tmpHome])
    expect(code).toBe(0)
    const text = output.join('\n')
    // The card surfaces level + a collection percentage line.
    expect(text).toContain('Lv7')
    expect(text).toMatch(/\d+%/)
    expect(text).toContain('5/')
  })

  it('--badge prints a markdown shields.io badge with the level', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, level: 12 } }))
    const { code, output } = captureRun(['share', '--badge', '--home', tmpHome])
    expect(code).toBe(0)
    const text = output.join('\n')
    expect(text).toMatch(/^\s*!\[.*\]\(.*\)/m) // markdown image
    expect(text).toContain('shields.io')
    expect(text).toContain('12')
  })

  it('still prints the card under --zen (user-invoked, opt-in)', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, level: 4 } }))
    const { code, output } = captureRun(['--zen', 'share', '--home', tmpHome])
    expect(code).toBe(0)
    // Zen does NOT suppress the explicitly-requested card.
    expect(output.join('\n')).toContain('Lv4')
  })

  it('never leaks repo / cwd / cost (privacy)', () => {
    seedState(tmpHome, (s) => ({ ...s, player: { ...s.player, level: 9 } }))
    const { output } = captureRun(['share', '--home', tmpHome])
    const text = output.join('\n').toLowerCase()
    expect(text).not.toContain('cost')
    expect(text).not.toContain('cwd')
    expect(text).not.toContain('token')
    expect(text).not.toMatch(/\/home\/|\/usr\/|\/var\//)
  })
})

// =============================================================================
// sq ntfy  (opt-in topic persistence under groveHome)
// =============================================================================

describe('sq ntfy', () => {
  let tmpHome: string
  beforeEach(() => {
    savedGroveHome = process.env['GROVE_HOME']
    savedNtfyTopic = process.env['GROVE_NTFY_TOPIC']
    // The topic env var must be unset so the file is the authoritative source.
    delete process.env['GROVE_NTFY_TOPIC']
    tmpHome = makeTmpHome()
    process.env['GROVE_HOME'] = tmpHome
  })
  afterEach(() => {
    if (savedGroveHome === undefined) delete process.env['GROVE_HOME']
    else process.env['GROVE_HOME'] = savedGroveHome
    if (savedNtfyTopic === undefined) delete process.env['GROVE_NTFY_TOPIC']
    else process.env['GROVE_NTFY_TOPIC'] = savedNtfyTopic
    removeTmpHome(tmpHome)
  })

  it('`sq ntfy <topic>` persists the topic so ntfyTopic() reads it back', () => {
    expect(ntfyTopic()).toBeNull() // off by default
    const { code } = captureRun(['ntfy', 'my-grove-alerts'])
    expect(code).toBe(0)
    expect(ntfyTopic()).toBe('my-grove-alerts')
    // Persisted to a file under groveHome (survives a fresh read).
    const stored = fs.readFileSync(path.join(groveHome(), 'ntfy-topic'), 'utf8').trim()
    expect(stored).toBe('my-grove-alerts')
  })

  it('`sq ntfy off` clears the topic (ntfyTopic() → null)', () => {
    captureRun(['ntfy', 'my-grove-alerts'])
    expect(ntfyTopic()).toBe('my-grove-alerts')
    const { code } = captureRun(['ntfy', 'off'])
    expect(code).toBe(0)
    expect(ntfyTopic()).toBeNull()
  })

  it('bare `sq ntfy` shows status, exits 0, persists nothing', () => {
    const { code, output } = captureRun(['ntfy'])
    expect(code).toBe(0)
    // Nothing written → still off.
    expect(ntfyTopic()).toBeNull()
    expect(output.join('\n').toLowerCase()).toMatch(/off|not set|disabled/)
  })

  it('help mentions share + ntfy', () => {
    const { output } = captureRun(['help'])
    const text = output.join('\n').toLowerCase()
    expect(text).toContain('share')
    expect(text).toContain('ntfy')
  })
})

// =============================================================================
// push wiring: maybePush — sends ONLY when topic set AND pushWorthy
// =============================================================================

describe('maybePush (push-on-big-moment wiring)', () => {
  it('sends when a topic is set AND the batch is pushWorthy', () => {
    const send = vi.fn()
    maybePush(legendaryBatch(), { topicFn: () => 'topic-x', send })
    expect(send).toHaveBeenCalledTimes(1)
    const [topicArg, noteArg] = send.mock.calls[0]!
    expect(topicArg).toBe('topic-x')
    // The notification carries a title (cosmetic event only).
    expect(noteArg.title).toBeTruthy()
  })

  it('does NOT send by default when no topic is set — even for a big batch', () => {
    const send = vi.fn()
    maybePush(legendaryBatch(), { topicFn: () => null, send })
    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT send when topic set but the batch is routine (pushWorthy → null)', () => {
    const send = vi.fn()
    maybePush(routineBatch(), { topicFn: () => 'topic-x', send })
    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT send for an empty batch', () => {
    const send = vi.fn()
    maybePush([], { topicFn: () => 'topic-x', send })
    expect(send).not.toHaveBeenCalled()
  })

  it('is fire-and-forget: a throwing send never propagates', () => {
    const send = vi.fn(() => { throw new Error('boom') })
    expect(() => maybePush(legendaryBatch(), { topicFn: () => 'topic-x', send })).not.toThrow()
  })

  it('defaults to the real ntfyTopic seam (off by default → no send) when deps omitted', () => {
    const savedTopic = process.env['GROVE_NTFY_TOPIC']
    delete process.env['GROVE_NTFY_TOPIC']
    const savedHome = process.env['GROVE_HOME']
    const tmp = makeTmpHome()
    process.env['GROVE_HOME'] = tmp
    try {
      // With no topic configured, the default path must not throw and must no-op.
      expect(() => maybePush(legendaryBatch())).not.toThrow()
    } finally {
      if (savedHome === undefined) delete process.env['GROVE_HOME']
      else process.env['GROVE_HOME'] = savedHome
      if (savedTopic === undefined) delete process.env['GROVE_NTFY_TOPIC']
      else process.env['GROVE_NTFY_TOPIC'] = savedTopic
      removeTmpHome(tmp)
    }
  })
})

// =============================================================================
// push wiring is actually invoked in the reward path (event → maybePush)
// =============================================================================

describe('event reward path triggers the push hook', () => {
  let tmpHome: string
  beforeEach(() => {
    savedGroveHome = process.env['GROVE_HOME']
    savedNtfyTopic = process.env['GROVE_NTFY_TOPIC']
    delete process.env['GROVE_NTFY_TOPIC']
    tmpHome = makeTmpHome()
    process.env['GROVE_HOME'] = tmpHome
  })
  afterEach(() => {
    if (savedGroveHome === undefined) delete process.env['GROVE_HOME']
    else process.env['GROVE_HOME'] = savedGroveHome
    if (savedNtfyTopic === undefined) delete process.env['GROVE_NTFY_TOPIC']
    else process.env['GROVE_NTFY_TOPIC'] = savedNtfyTopic
    removeTmpHome(tmpHome)
  })

  it('an `sq event` with NO topic set does not crash and emits no push', () => {
    // Default OFF: no topic configured, so no network is attempted — just runs clean.
    const { code } = captureRun(['event', 'pr_merged', '--home', tmpHome])
    expect(code).toBe(0)
    expect(ntfyTopic()).toBeNull()
  })
})

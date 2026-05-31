/**
 * ntfy.test.ts — TDD tests for the ntfy mobile push adapter (M5).
 *
 * Run: npx vitest run src/adapters/ntfy.test.ts
 *
 * Covers:
 *  pushWorthy (PURE):
 *  1. Legendary card drop → returns a non-null notification
 *  2. Shiny card drop → returns a non-null notification
 *  3. Level-up reward → returns a non-null notification
 *  4. Milestone chest (currency reward with message containing "chest") → non-null
 *  5. Quest/set complete reward → non-null
 *  6. Plain commit batch (common card + xp only) → null (don't spam)
 *  7. Empty rewards array → null
 *  8. Title/message contain no code/cwd/cost content
 *  9. Tags is an array of strings
 * 10. Multiple big rewards in one batch → single notification (not duplicated)
 *
 *  ntfyTopic:
 * 11. GROVE_NTFY_TOPIC not set → returns null (off by default)
 * 12. GROVE_NTFY_TOPIC set → returns that string
 * 13. Empty string GROVE_NTFY_TOPIC → returns null (treated as disabled)
 *
 *  sendNtfy:
 * 14. Does not throw on network error (fire-and-forget, mocked)
 * 15. Does not throw when called with valid args (mocked https)
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Reward } from '../core/rewards'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReward(overrides: Partial<Reward>): Reward {
  return {
    kind: 'xp',
    amount: 10,
    message: '+10 XP',
    ...overrides,
  }
}

function legendaryCardReward(): Reward {
  return makeReward({
    kind: 'card',
    rarity: 'legendary',
    card: { id: 'c1', name: 'Phantom Refactor', rarity: 'legendary', set: 'core' },
    message: '🃏 Phantom Refactor · legendary',
  })
}

function shinyCardReward(): Reward {
  return makeReward({
    kind: 'card',
    rarity: 'shiny',
    card: { id: 'c2', name: 'Null Pointer Rex', rarity: 'shiny', set: 'core' },
    message: '🃏 Null Pointer Rex · shiny',
  })
}

function levelUpReward(): Reward {
  return makeReward({
    kind: 'levelup',
    amount: 5,
    message: 'Level 5',
  })
}

function chestReward(): Reward {
  return makeReward({
    kind: 'currency',
    amount: 50,
    message: '📦 milestone chest · +50 seeds',
  })
}

function questCompleteReward(): Reward {
  return makeReward({
    kind: 'buff',
    buff: 'streak',
    message: '✅ quest complete · Spec First',
  })
}

function setCompleteReward(): Reward {
  return makeReward({
    kind: 'currency',
    amount: 100,
    message: '🏆 set complete · Core · +100 seeds',
  })
}

function commonXpBatch(): Reward[] {
  return [
    makeReward({ kind: 'xp', amount: 12, message: '+12 XP · commit' }),
    makeReward({
      kind: 'card',
      rarity: 'common',
      card: { id: 'c3', name: 'Debug Log', rarity: 'common', set: 'core' },
      message: '🃏 Debug Log · common',
    }),
  ]
}

// ---------------------------------------------------------------------------
// Tests: pushWorthy
// ---------------------------------------------------------------------------

describe('pushWorthy', () => {
  it('returns a notification for a legendary card drop', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([legendaryCardReward()])

    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
    expect(result!.message).toBeTruthy()
    expect(Array.isArray(result!.tags)).toBe(true)
  })

  it('returns a notification for a shiny card drop', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([shinyCardReward()])

    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
  })

  it('returns a notification for a level-up', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([levelUpReward()])

    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
  })

  it('returns a notification for a milestone chest', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([chestReward()])

    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
  })

  it('returns a notification for a quest complete', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([questCompleteReward()])

    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
  })

  it('returns a notification for a set complete', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([setCompleteReward()])

    expect(result).not.toBeNull()
    expect(result!.title).toBeTruthy()
  })

  it('returns null for a plain commit batch (common card + xp)', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy(commonXpBatch())

    expect(result).toBeNull()
  })

  it('returns null for an empty rewards array', async () => {
    const { pushWorthy } = await import('./ntfy')
    expect(pushWorthy([])).toBeNull()
  })

  it('title and message contain no code, cwd, or cost content', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([legendaryCardReward()])!

    // Must not leak cost/path/code data
    expect(result.title).not.toMatch(/\$|cost|cwd|\/home|\.ts|\.js/)
    expect(result.message).not.toMatch(/\$|cost|cwd|\/home|\.ts|\.js/)
  })

  it('tags is an array of strings', async () => {
    const { pushWorthy } = await import('./ntfy')
    const result = pushWorthy([legendaryCardReward()])!

    expect(Array.isArray(result.tags)).toBe(true)
    result.tags.forEach((t) => expect(typeof t).toBe('string'))
  })

  it('multiple big rewards in one batch yield a single notification', async () => {
    const { pushWorthy } = await import('./ntfy')
    // The return value is one object, not an array — always a single notification
    const result = pushWorthy([legendaryCardReward(), levelUpReward()])

    expect(result).not.toBeNull()
    // Verify it's a single object, not an array
    expect(Array.isArray(result)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: ntfyTopic
// ---------------------------------------------------------------------------

describe('ntfyTopic', () => {
  afterEach(() => {
    delete process.env['GROVE_NTFY_TOPIC']
  })

  it('returns null when GROVE_NTFY_TOPIC is not set (off by default)', async () => {
    delete process.env['GROVE_NTFY_TOPIC']
    // Re-import to avoid cached env value — use the function directly
    const { ntfyTopic } = await import('./ntfy')
    expect(ntfyTopic()).toBeNull()
  })

  it('returns the topic string when GROVE_NTFY_TOPIC is set', async () => {
    process.env['GROVE_NTFY_TOPIC'] = 'my-grove-alerts'
    const { ntfyTopic } = await import('./ntfy')
    expect(ntfyTopic()).toBe('my-grove-alerts')
  })

  it('returns null for an empty GROVE_NTFY_TOPIC', async () => {
    process.env['GROVE_NTFY_TOPIC'] = ''
    const { ntfyTopic } = await import('./ntfy')
    expect(ntfyTopic()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: sendNtfy
// ---------------------------------------------------------------------------

describe('sendNtfy', () => {
  it('does not throw when https.request errors (fire-and-forget)', async () => {
    // Mock node:https to simulate a network error
    vi.mock('node:https', () => ({
      default: {
        request: vi.fn((_url: unknown, _opts: unknown, _cb: unknown) => {
          return {
            on: vi.fn((_evt: string, handler: (err: Error) => void) => {
              // Simulate immediate error
              if (_evt === 'error') {
                setTimeout(() => handler(new Error('network failure')), 0)
              }
              return { on: vi.fn(), write: vi.fn(), end: vi.fn() }
            }),
            write: vi.fn(),
            end: vi.fn(),
          }
        }),
      },
    }))

    const { sendNtfy } = await import('./ntfy')

    // Must not throw
    expect(() =>
      sendNtfy('test-topic', {
        title: 'Grove · Legendary drop',
        message: '🃏 Phantom Refactor · legendary',
        tags: ['tada'],
      }),
    ).not.toThrow()
  })

  it('does not throw with valid args (fire-and-forget)', async () => {
    const { sendNtfy } = await import('./ntfy')

    expect(() =>
      sendNtfy('test-topic', {
        title: 'Level 5',
        message: 'Level 5 ⚡',
        tags: ['arrow_up'],
      }),
    ).not.toThrow()
  })
})

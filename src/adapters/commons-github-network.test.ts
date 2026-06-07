/**
 * commons-github-network.test.ts — behaviour tests for the GET-only commons
 * network client's list / merge-state / token surface (ADR-0013).
 *
 * On main this adapter had ONLY a source-grep firewall guard (commons-github.test.ts),
 * so listCommonsIssues / prMergeState / commonsToken ran ~0% in tests despite handling
 * UNTRUSTED network responses that must fail soft. These tests lock in that fail-soft
 * contract: any non-200 / malformed / non-array body resolves to [] / { merged:false },
 * never a throw. node:https is mocked per the ntfy.test.ts shape; `request` is exposed
 * at the namespace TOP LEVEL because the client uses `import * as https` + `https.request`.
 *
 * (Sibling commons-github-fetch.test.ts covers getCommonsIssue + the 5s timeout; this
 * file covers the remaining network surface — they use independent per-file mocks.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Per-test transport config; vi.hoisted so the hoisted vi.mock factory closes over it.
const net = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'non200' | 'parse' | 'error',
  statusCode: 200,
  body: '[]',
}))

vi.mock('node:https', () => {
  const request = (_url: unknown, _opts: unknown, cb: (res: unknown) => void) => {
    const req: Record<string, unknown> = {
      on: (evt: string, h: (e?: unknown) => void) => {
        if (evt === 'error' && net.mode === 'error') queueMicrotask(() => h(new Error('net')))
        return req
      },
      setTimeout: (_ms: number, _h: () => void) => req,
      destroy: () => {},
      end: () => {
        if (net.mode === 'ok' || net.mode === 'non200' || net.mode === 'parse') {
          const res = {
            statusCode: net.mode === 'non200' ? net.statusCode : 200,
            setEncoding: () => {},
            on: (evt: string, h: (chunk?: string) => void) => {
              if (evt === 'data') h(net.mode === 'parse' ? '{not json' : net.body)
              if (evt === 'end') h()
              return res
            },
          }
          cb(res)
        }
      },
    }
    return req
  }
  return { default: { request }, request }
})

import { listCommonsIssues, prMergeState, commonsToken } from './commons-github'

beforeEach(() => {
  net.mode = 'ok'
  net.statusCode = 200
  net.body = '[]'
})

// ---------------------------------------------------------------------------
// listCommonsIssues
// ---------------------------------------------------------------------------

describe('listCommonsIssues (GET-only, fail-soft)', () => {
  it('normalizes an array of issues into CommonsTask[] (number/title/labels/url)', async () => {
    net.body = JSON.stringify([
      {
        number: 7,
        title: 'Fix the flaky timer',
        labels: [{ name: 'commons' }, { name: 'good-first' }],
        html_url: 'https://github.com/o/r/issues/7',
      },
    ])
    const tasks = await listCommonsIssues('o/r')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual({
      number: 7,
      title: 'Fix the flaky timer',
      labels: ['commons', 'good-first'],
      url: 'https://github.com/o/r/issues/7',
    })
  })

  it('EXCLUDES pull requests (items carrying a pull_request key)', async () => {
    net.body = JSON.stringify([
      { number: 1, title: 'a real issue', labels: [], html_url: 'x' },
      { number: 2, title: 'a PR masquerading as an issue', pull_request: { url: 'y' }, labels: [] },
    ])
    const tasks = await listCommonsIssues('o/r')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.number).toBe(1)
  })

  it('tolerates missing / malformed fields with safe defaults', async () => {
    net.body = JSON.stringify([
      { number: 'not-a-number', title: 42, labels: 'nope', html_url: null },
    ])
    const tasks = await listCommonsIssues('o/r')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual({ number: 0, title: '', labels: [], url: '' })
  })

  it('drops non-string / nameless label entries, keeping only valid label names', async () => {
    net.body = JSON.stringify([
      { number: 3, title: 't', labels: [{ name: 'keep' }, { foo: 'bar' }, null, 'x'], html_url: 'u' },
    ])
    const tasks = await listCommonsIssues('o/r')
    expect(tasks[0]!.labels).toEqual(['keep'])
  })

  it('returns [] on a non-200 response', async () => {
    net.mode = 'non200'
    net.statusCode = 403
    expect(await listCommonsIssues('o/r')).toEqual([])
  })

  it('returns [] on malformed JSON', async () => {
    net.mode = 'parse'
    expect(await listCommonsIssues('o/r')).toEqual([])
  })

  it('returns [] on a network error', async () => {
    net.mode = 'error'
    expect(await listCommonsIssues('o/r')).toEqual([])
  })

  it('returns [] when the body is a JSON object rather than an array', async () => {
    net.body = JSON.stringify({ message: 'Not Found' })
    expect(await listCommonsIssues('o/r')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// prMergeState
// ---------------------------------------------------------------------------

describe('prMergeState (GET-only, fail-soft)', () => {
  it('reports merged:true ONLY when the API says merged===true', async () => {
    net.body = JSON.stringify({ merged: true })
    expect(await prMergeState('o/r', 12)).toEqual({ merged: true })
  })

  it('reports merged:false when the PR is open (merged:false)', async () => {
    net.body = JSON.stringify({ merged: false })
    expect(await prMergeState('o/r', 12)).toEqual({ merged: false })
  })

  it('reports merged:false on a non-200 (e.g. 404)', async () => {
    net.mode = 'non200'
    net.statusCode = 404
    expect(await prMergeState('o/r', 999)).toEqual({ merged: false })
  })

  it('reports merged:false on a network error (never throws)', async () => {
    net.mode = 'error'
    expect(await prMergeState('o/r', 12)).toEqual({ merged: false })
  })

  it('reports merged:false when merged is a truthy non-boolean (strict ===true)', async () => {
    net.body = JSON.stringify({ merged: 'true' })
    expect(await prMergeState('o/r', 12)).toEqual({ merged: false })
  })
})

// ---------------------------------------------------------------------------
// commonsToken
// ---------------------------------------------------------------------------

describe('commonsToken (env-only, never persisted)', () => {
  const KEY = 'GROVE_GITHUB_TOKEN'
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env[KEY]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY]
    else process.env[KEY] = saved
  })

  it('returns the token when the env var is a non-empty string', () => {
    process.env[KEY] = 'ghp_example'
    expect(commonsToken()).toBe('ghp_example')
  })

  it('returns undefined when the env var is unset', () => {
    delete process.env[KEY]
    expect(commonsToken()).toBeUndefined()
  })

  it('returns undefined when the env var is the empty string', () => {
    process.env[KEY] = ''
    expect(commonsToken()).toBeUndefined()
  })
})

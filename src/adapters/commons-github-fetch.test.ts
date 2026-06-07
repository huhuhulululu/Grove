/**
 * commons-github-fetch.test.ts — network-mocked tests for the GET-only commons
 * FETCH path: getCommonsIssue() (real GitHub issue title) + the 5s fail-soft
 * timeout in githubGet(), and handleCommons draft/open using the real title with
 * a fail-soft fallback to the "commons task #N" placeholder.
 *
 * The sibling commons-github.test.ts stays a pure SOURCE-grep firewall guard; the
 * node:https stub lives ONLY here so those guards never see a network mock.
 * Mock shape copied from ntfy.test.ts (default: { request }). ADR-0013: GET-only,
 * fail-soft (offline / non-200 / malformed / timeout -> null -> placeholder).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-test transport config; vi.hoisted so the hoisted vi.mock factory closes over it.
const net = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'non200' | 'parse' | 'error' | 'timeout',
  statusCode: 200,
  body: '{}',
}))

vi.mock('node:https', () => {
  // commons-github.ts uses `import * as https` + `https.request`, so `request`
  // must be exposed at the TOP LEVEL of the namespace (default alone is not seen).
  const request = (_url: unknown, _opts: unknown, cb: (res: unknown) => void) => {
    const req: Record<string, unknown> = {
      on: (evt: string, h: (e?: unknown) => void) => {
        if (evt === 'error' && net.mode === 'error') queueMicrotask(() => h(new Error('net')))
        return req
      },
      // The fix under test: githubGet must arm a fail-soft socket timeout.
      setTimeout: (_ms: number, h: () => void) => {
        if (net.mode === 'timeout') queueMicrotask(h)
        return req
      },
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

import { getCommonsIssue } from './commons-github'
import { handleCommons } from '../cli/commands/commons'

beforeEach(() => {
  net.mode = 'ok'
  net.statusCode = 200
  net.body = '{}'
})

function captureLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })
  return { logs, restore: () => spy.mockRestore() }
}

describe('getCommonsIssue (GET-only, fail-soft)', () => {
  it('T1 normalizes a real issue into a CommonsTask carrying the real title', async () => {
    net.body = JSON.stringify({
      number: 7,
      title: 'Fix the flaky timer',
      labels: [{ name: 'commons' }, { name: 'good-first' }],
      html_url: 'https://github.com/o/r/issues/7',
    })
    const task = await getCommonsIssue('o/r', 7)
    expect(task).not.toBeNull()
    expect(task!.title).toBe('Fix the flaky timer')
    expect(task!.number).toBe(7)
    expect(task!.labels).toEqual(['commons', 'good-first'])
    expect(task!.url).toBe('https://github.com/o/r/issues/7')
  })

  it('T2 returns null on a non-200 (e.g. a 404 deleted issue)', async () => {
    net.mode = 'non200'
    net.statusCode = 404
    expect(await getCommonsIssue('o/r', 999)).toBeNull()
  })

  it('T3 returns null when the response is a PR, not an issue (pull_request guard)', async () => {
    net.body = JSON.stringify({ number: 5, title: 'a pull request', pull_request: { url: 'x' } })
    expect(await getCommonsIssue('o/r', 5)).toBeNull()
  })

  it('T4 returns null on malformed JSON', async () => {
    net.mode = 'parse'
    expect(await getCommonsIssue('o/r', 7)).toBeNull()
  })

  it('T5 resolves null (NEVER hangs) when the request times out', async () => {
    net.mode = 'timeout'
    // Without the setTimeout fix in githubGet this await would hang forever.
    expect(await getCommonsIssue('o/r', 7)).toBeNull()
  })
})

describe('handleCommons draft/open uses the real title (fail-soft to placeholder)', () => {
  it('T6 prints the brief with the fetched issue title', async () => {
    net.body = JSON.stringify({ number: 12, title: 'Real issue title', labels: [], html_url: 'x' })
    const { logs, restore } = captureLog()
    const code = await handleCommons(['draft', '12'], {}, '/tmp', false, 'en')
    restore()
    expect(code).toBe(0)
    expect(logs.join('\n')).toContain('Real issue title')
    expect(logs.join('\n')).not.toContain('commons task #12')
  })

  it('T7 falls back to the "commons task #N" placeholder when the fetch fails', async () => {
    net.mode = 'error'
    const { logs, restore } = captureLog()
    const code = await handleCommons(['open', '12'], {}, '/tmp', false, 'en')
    restore()
    expect(code).toBe(0)
    expect(logs.join('\n')).toContain('commons task #12')
  })
})

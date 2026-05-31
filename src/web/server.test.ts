import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as http from 'node:http'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import { saveState } from '../store/store'
import { startWebServer } from './server'

// ---------------------------------------------------------------------------
// Temp-home plumbing (mirrors store.test.ts): each test gets its own home with
// a nested per-repo state dir so the account-global file stays isolated.
// ---------------------------------------------------------------------------
const tempHomes: string[] = []
const servers: Array<{ close(): void }> = []

function makeStateDir(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-web-'))
  tempHomes.push(home)
  const dir = path.join(home, 'repo')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function seededState(): GameState {
  const base = initialState()
  return {
    ...base,
    player: { xp: 42, level: 3, currency: 310, shards: 12 },
    gear: [{ id: 'g1', name: 'Commit Hammer', level: 5, rarity: 'rare', broken: false }],
    energy: { known: true, vigor: 72, sap: 88 },
  }
}

afterEach(() => {
  for (const s of servers) {
    try {
      s.close()
    } catch {
      /* ignore */
    }
  }
  servers.length = 0
  for (const h of tempHomes) {
    fs.rmSync(h, { recursive: true, force: true })
  }
  tempHomes.length = 0
})

// A tiny GET helper returning { status, body, headers }.
function get(
  url: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
        )
      })
      .on('error', reject)
  })
}

describe('startWebServer', () => {
  it('returns a url and binds to 127.0.0.1 by default', () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/)
  })

  it('GET / serves the HTML dashboard with key sections', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const res = await get(srv.url)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('<!DOCTYPE html>')
    expect(res.body).toContain('Level 3')
    const upper = res.body.toUpperCase()
    for (const section of ['ENERGY', 'COLLECTION', 'GEAR', 'QUESTS']) {
      expect(upper).toContain(section)
    }
  })

  it('GET /api/state returns the current game-state JSON', async () => {
    const dir = makeStateDir()
    const state = seededState()
    saveState(dir, state)
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const res = await get(new URL('/api/state', srv.url).toString())
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const parsed = JSON.parse(res.body) as GameState
    expect(parsed.player.level).toBe(3)
    expect(parsed.player.xp).toBe(42)
    expect(parsed.player.currency).toBe(310)
    expect(parsed.gear[0]?.name).toBe('Commit Hammer')
  })

  it('GET /api/state reflects initial state when no file is saved', async () => {
    const dir = makeStateDir()
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const res = await get(new URL('/api/state', srv.url).toString())
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body) as GameState
    expect(parsed.player.level).toBe(1)
  })

  it('returns 404 for unknown paths', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const res = await get(new URL('/nope', srv.url).toString())
    expect(res.status).toBe(404)
  })

  it('GET /events opens a Server-Sent-Events stream and pushes a snapshot on file change', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const received: string[] = []
    const port = Number(new URL(srv.url).port)

    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/events' },
        (res) => {
          expect(res.statusCode).toBe(200)
          expect(res.headers['content-type']).toMatch(/text\/event-stream/)
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            received.push(chunk)
            // Once we've seen the second snapshot (post-change) we're done.
            const dataLines = received.join('').match(/data: /g) ?? []
            if (dataLines.length >= 2) {
              req.destroy()
              resolve()
            }
          })
          res.on('error', () => {
            /* destroy() triggers an aborted error — ignore */
          })

          // Trigger a state-file change shortly after the stream is open.
          setTimeout(() => {
            const changed = seededState()
            changed.player.xp = 999
            saveState(dir, changed)
          }, 80)
        },
      )
      req.on('error', (e) => {
        // destroy() after success path can surface as ECONNRESET — only reject
        // if we haven't resolved yet.
        if (received.length === 0) reject(e)
      })
      setTimeout(() => reject(new Error('SSE: no two snapshots within timeout')), 4000)
    })

    const joined = received.join('')
    // First snapshot present immediately on connect.
    expect(joined).toContain('data: ')
    // The changed xp should appear in a pushed snapshot.
    expect(joined).toContain('999')
  })

  it('close() releases the port (a new server can rebind it)', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())

    // Bind an explicit ephemeral port, learn it, close, then rebind the SAME port.
    const first = startWebServer({ dir, port: 0 })
    const port = Number(new URL(first.url).port)
    first.close()

    // Give the OS a tick to release, then rebind the exact port.
    await new Promise((r) => setTimeout(r, 50))
    const second = startWebServer({ dir, port })
    servers.push(second)
    expect(Number(new URL(second.url).port)).toBe(port)

    const res = await get(second.url)
    expect(res.status).toBe(200)
  })

  it('binds to 0.0.0.0 only when host is explicitly opted in', () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0, host: '0.0.0.0' })
    servers.push(srv)
    expect(srv.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/?$/)
  })

  it('surfaces (does NOT silently swallow) an EADDRINUSE on an EXPLICIT port', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())

    // Hold an explicit port, then try to bind the SAME explicit port — an
    // explicit collision is never silently retried, so it must reach the operator.
    const first = startWebServer({ dir, port: 0 })
    servers.push(first)
    const port = Number(new URL(first.url).port)

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const second = startWebServer({ dir, port })
    servers.push(second)

    // The async 'error' fires on the next tick after listen() fails.
    await new Promise((r) => setTimeout(r, 100))

    const surfaced = errSpy.mock.calls.some((c) =>
      String(c[0] ?? '').includes('Grove web server error'),
    )
    errSpy.mockRestore()
    expect(surfaced).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Security response headers (R8) — defense-in-depth for the self-contained
  // inline page. Even a local read-only view should not be sniffable / cached /
  // able to load remote resources.
  // -------------------------------------------------------------------------

  it('GET / carries safe security headers (nosniff, CSP, no-store)', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const res = await get(srv.url)
    expect(res.status).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toMatch(/no-store/)
    const csp = String(res.headers['content-security-policy'] ?? '')
    expect(csp.length).toBeGreaterThan(0)
    // The page is self-contained: no remote scripts, no framing.
    expect(csp).toMatch(/default-src 'self'/)
    expect(csp).toMatch(/frame-ancestors 'none'/)
  })

  it('GET /api/state carries the nosniff + no-store headers too', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)

    const res = await get(new URL('/api/state', srv.url).toString())
    expect(res.status).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toMatch(/no-store/)
  })

  it('the SSE stream also carries the nosniff header', async () => {
    const dir = makeStateDir()
    saveState(dir, seededState())
    const srv = startWebServer({ dir, port: 0 })
    servers.push(srv)
    const port = Number(new URL(srv.url).port)

    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
        resolve(res.headers)
        req.destroy()
      })
      req.on('error', (e) => reject(e))
      setTimeout(() => reject(new Error('SSE: no headers within timeout')), 3000)
    })
    expect(headers['x-content-type-options']).toBe('nosniff')
  })
})

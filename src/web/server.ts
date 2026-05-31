/**
 * server.ts — a tiny, dependency-free local web dashboard (M5, local-first).
 *
 * Uses node:http only (no framework — boring & robust). It is a READ-ONLY view
 * over the pure engine's persisted state:
 *   - GET /            → the self-contained HTML dashboard (render/page.ts)
 *   - GET /api/state   → the current GameState as JSON (loadState — read-only)
 *   - GET /events      → a Server-Sent-Events stream that pushes a fresh state
 *                        snapshot whenever the state file changes (fs.watch), so
 *                        an open page updates LIVE.
 *
 * SECURITY (ADR-0005 spirit — never risk the user): binds to 127.0.0.1 by
 * default. host '0.0.0.0' (LAN exposure, e.g. to reach it from a phone) is
 * allowed ONLY when explicitly opted in, and prints a security note. The web
 * layer NEVER writes game state — every request is a read.
 */

import * as http from 'node:http'
import * as fs from 'node:fs'
import { loadState } from '../store/store'
import { renderPage } from './page'

export interface WebServerOptions {
  /** the per-repo Grove state dir to read (contains state.json) */
  dir: string
  /** TCP port; 0 (default) picks an ephemeral free port */
  port?: number
  /** bind host; defaults to loopback. '0.0.0.0' exposes on the LAN (opt-in). */
  host?: string
}

export interface WebServerHandle {
  /** the base URL the server is reachable at, e.g. http://127.0.0.1:54321 */
  url: string
  /** stop the server, release the port, and tear down the file watcher */
  close(): void
}

const LOOPBACK = '127.0.0.1'

/**
 * Pick a pseudo-random port in the IANA dynamic range (49152..65535).
 *
 * Why not `listen(0)`? An OS-assigned ephemeral port is only knowable
 * asynchronously (the bound port appears on `server.address()` AFTER the
 * `listening` event), but this API returns its `url` synchronously. By choosing
 * the port ourselves we know the URL up front; an unlucky collision surfaces as
 * an async 'error' and is retried on a fresh random port.
 */
function randomPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152))
}

/** Read the current state JSON string (read-only). Never throws to the caller. */
function stateJson(dir: string): string {
  return JSON.stringify(loadState(dir))
}

/** Send a one-shot response with a content-type and body. */
function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Start the local web dashboard server.
 *
 * Returns immediately with a `url` (the server binds synchronously via a 0-port
 * or explicit port; `address()` is read after `listen`) and a `close()`.
 */
export function startWebServer(opts: WebServerOptions): WebServerHandle {
  const { dir } = opts
  const host = opts.host ?? LOOPBACK
  // port 0 / omitted → we pick a concrete random port so the URL is known
  // synchronously (see randomPort). An explicit non-zero port is honored as-is.
  const explicit = opts.port !== undefined && opts.port !== 0
  let boundPort = explicit ? (opts.port as number) : randomPort()

  if (host === '0.0.0.0') {
    // LAN exposure is opt-in and loud: anyone on the network can READ this view.
    // eslint-disable-next-line no-console
    console.error(
      '⚠ Grove web bound to 0.0.0.0 · reachable from other devices on your LAN (read-only).',
    )
  }

  // The set of live SSE responses to push snapshots to.
  const clients = new Set<http.ServerResponse>()

  const server = http.createServer((req, res) => {
    // Read-only: only GET is served. HEAD is treated as GET-without-body upstream.
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', `http://${host}`)
    const pathname = url.pathname

    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'text/plain; charset=utf-8', 'method not allowed')
      return
    }

    if (pathname === '/' || pathname === '/index.html') {
      const html = renderPage(loadState(dir))
      send(res, 200, 'text/html; charset=utf-8', html)
      return
    }

    if (pathname === '/api/state') {
      send(res, 200, 'application/json; charset=utf-8', stateJson(dir))
      return
    }

    if (pathname === '/events') {
      openSseStream(res, dir, clients)
      return
    }

    send(res, 404, 'text/plain; charset=utf-8', 'not found')
  })

  // Watch the state file's directory: fs.watch on a single file is unreliable
  // across platforms (atomic rename writes replace the inode), so watch the dir
  // and filter for state.json. Debounce bursts (rename emits multiple events).
  let pushTimer: NodeJS.Timeout | null = null
  let watcher: fs.FSWatcher | null = null
  try {
    fs.mkdirSync(dir, { recursive: true })
    watcher = fs.watch(dir, (_eventType, filename) => {
      // filename can be null on some platforms — push on any dir change then.
      if (filename !== null && filename !== 'state.json' && filename !== 'state.json.tmp') {
        return
      }
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => pushSnapshot(clients, dir), 30)
    })
  } catch {
    // A missing/unwatchable dir is non-fatal: the server still serves reads;
    // live push is simply unavailable.
    watcher = null
  }

  // On a port collision for a SELF-CHOSEN random port, retry on a fresh port.
  // `url` is a getter over `boundPort`, so a retry keeps the handle's URL
  // accurate. An EXPLICIT port is never silently moved — its collision is the
  // caller's to resolve (e.g. the close()→rebind round-trip relies on stability).
  // Every OTHER error (EACCES on a privileged port, EADDRNOTAVAIL, post-listen
  // failures) is surfaced — never swallowed while the URL was already printed.
  let retries = 0
  const MAX_RETRIES = 10
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && !explicit && retries < MAX_RETRIES) {
      retries += 1
      boundPort = randomPort()
      server.listen(boundPort, host)
      return
    }
    // eslint-disable-next-line no-console
    console.error('Grove web server error:', err.message)
  })

  server.listen(boundPort, host)

  return {
    // Getter so a rare self-heal retry (random-port collision) keeps url accurate.
    get url(): string {
      return `http://${host}:${boundPort}`
    },
    close(): void {
      if (pushTimer) {
        clearTimeout(pushTimer)
        pushTimer = null
      }
      if (watcher !== null) {
        watcher.close()
        watcher = null
      }
      for (const c of clients) {
        try {
          c.end()
        } catch {
          /* already closed */
        }
      }
      clients.clear()
      server.close()
      // Force-drop keep-alive sockets so the port is freed promptly for rebind.
      server.closeAllConnections?.()
    },
  }
}

/** Open one SSE stream, register it, send the current snapshot, and clean up on close. */
function openSseStream(
  res: http.ServerResponse,
  dir: string,
  clients: Set<http.ServerResponse>,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  // Initial snapshot so a freshly-connected page renders without waiting for a change.
  writeSnapshot(res, stateJson(dir))
  clients.add(res)

  // Drop the client when the connection closes (page navigated away / reloaded).
  const drop = (): void => {
    clients.delete(res)
  }
  res.on('close', drop)
  res.on('error', drop)
}

/** Push the latest state snapshot to every connected SSE client. */
function pushSnapshot(clients: Set<http.ServerResponse>, dir: string): void {
  if (clients.size === 0) return
  const json = stateJson(dir)
  for (const res of clients) {
    writeSnapshot(res, json)
  }
}

/** Write one SSE `data:` frame. Best-effort — a dead socket is silently ignored. */
function writeSnapshot(res: http.ServerResponse, json: string): void {
  try {
    res.write(`data: ${json}\n\n`)
  } catch {
    /* socket gone — the close/error handler will evict it */
  }
}

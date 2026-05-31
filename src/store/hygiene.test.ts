/**
 * hygiene.test.ts — R8 file-rotation / hygiene (security & disk hygiene).
 *
 * Grove writes a few append-only / timestamped sidecar files. Left uncapped they
 * grow without bound:
 *  - settings.json.bak.<ts> (statusline install/uninstall) — keep newest ~3.
 *  - state.json.corrupt.<ts> (recovered corrupt state)     — keep newest ~3.
 *  - events.jsonl (the event log)                          — cap line growth.
 *
 * These tests pin the rotation/cap behavior. Run: npx vitest run src/store/hygiene.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  rotateBackups,
  appendEvent,
  readEvents,
  loadState,
  EVENTS_MAX_LINES,
  EVENTS_TRIM_MARGIN,
  BACKUP_KEEP,
} from './store'
import type { GroveEvent } from '../core/events'

const tempDirs: string[] = []
function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-hygiene-'))
  tempDirs.push(d)
  return d
}
afterEach(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true })
  tempDirs.length = 0
})

function touch(dir: string, name: string, mtimeMs: number): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, name, 'utf8')
  fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000)
  return p
}

function makeEvent(i: number): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    type: 'commit',
    magnitude: 3,
    success: true,
    ts: new Date(Date.now() + i).toISOString(),
    meta: { i },
  } as GroveEvent
}

describe('rotateBackups — keep newest BACKUP_KEEP, delete older', () => {
  it('exports a sensible positive keep count', () => {
    expect(Number.isInteger(BACKUP_KEEP)).toBe(true)
    expect(BACKUP_KEEP).toBeGreaterThan(0)
  })

  it('keeps only the newest BACKUP_KEEP settings.json.bak.* files', () => {
    const dir = makeTmpDir()
    // 6 backups with strictly increasing mtimes (older → newer).
    const base = Date.now() - 100_000
    const paths: string[] = []
    for (let i = 0; i < 6; i++) {
      paths.push(touch(dir, `settings.json.bak.${1000 + i}`, base + i * 1000))
    }
    rotateBackups(dir, 'settings.json.bak.')

    const remaining = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('settings.json.bak.'))
    expect(remaining.length).toBe(BACKUP_KEEP)
    // The newest BACKUP_KEEP survive; the oldest are gone.
    const survivors = new Set(remaining)
    const newest = paths.slice(-BACKUP_KEEP).map((p) => path.basename(p))
    for (const n of newest) expect(survivors.has(n)).toBe(true)
    const oldest = paths.slice(0, paths.length - BACKUP_KEEP).map((p) => path.basename(p))
    for (const o of oldest) expect(survivors.has(o)).toBe(false)
  })

  it('does nothing when fewer than the keep count exist', () => {
    const dir = makeTmpDir()
    touch(dir, 'settings.json.bak.1', Date.now())
    rotateBackups(dir, 'settings.json.bak.')
    expect(
      fs.readdirSync(dir).filter((f) => f.startsWith('settings.json.bak.')).length,
    ).toBe(1)
  })

  it('only touches files matching the prefix (never unrelated files)', () => {
    const dir = makeTmpDir()
    const base = Date.now() - 50_000
    for (let i = 0; i < 5; i++) touch(dir, `settings.json.bak.${i}`, base + i * 1000)
    touch(dir, 'settings.json', Date.now()) // the real file — must survive
    touch(dir, 'keep-me.txt', Date.now())
    rotateBackups(dir, 'settings.json.bak.')
    expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'keep-me.txt'))).toBe(true)
  })

  it('rotates state.json.corrupt.* backups too (same helper, different prefix)', () => {
    const dir = makeTmpDir()
    const base = Date.now() - 80_000
    for (let i = 0; i < 5; i++) touch(dir, `state.json.corrupt.${i}`, base + i * 1000)
    rotateBackups(dir, 'state.json.corrupt.')
    expect(
      fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt.')).length,
    ).toBe(BACKUP_KEEP)
  })
})

describe('events.jsonl growth cap', () => {
  it('exports a sane positive max line count', () => {
    expect(Number.isInteger(EVENTS_MAX_LINES)).toBe(true)
    expect(EVENTS_MAX_LINES).toBeGreaterThan(0)
  })

  it('appendEvent caps the log once over the trim margin, keeping the NEWEST events', () => {
    const dir = makeTmpDir()
    // Pre-seed the log near the cap+margin cheaply (one bulk write), then append a
    // few real events through appendEvent to cross the margin and trigger the trim.
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'events.jsonl')
    const seedCount = EVENTS_MAX_LINES + EVENTS_TRIM_MARGIN
    const seedLines = Array.from({ length: seedCount }, (_, i) => JSON.stringify(makeEvent(i)))
    fs.writeFileSync(file, seedLines.join('\n') + '\n', 'utf8')

    // These appends push past the margin → a trim fires (back down to the cap).
    const tail = 5
    for (let i = 0; i < tail; i++) appendEvent(dir, makeEvent(seedCount + i))

    const events = readEvents(dir)
    // A trim fired: the log is far below the pre-seeded size, and never exceeds
    // the hard bound (cap + the amortization margin).
    expect(events.length).toBeLessThanOrEqual(EVENTS_MAX_LINES + EVENTS_TRIM_MARGIN)
    expect(events.length).toBeLessThan(seedCount) // it genuinely trimmed
    // The MOST RECENT event is retained (trimming drops the oldest, never newest).
    const last = events[events.length - 1]
    expect((last?.meta as { i: number }).i).toBe(seedCount + tail - 1)
  })

  it('a short log is never trimmed', () => {
    const dir = makeTmpDir()
    for (let i = 0; i < 5; i++) appendEvent(dir, makeEvent(i))
    expect(readEvents(dir).length).toBe(5)
  })
})

describe('backupCorrupt prunes old state.json.corrupt.* beyond newest', () => {
  it('loadState on repeated corruption keeps at most BACKUP_KEEP corrupt backups', () => {
    const dir = makeTmpDir()
    const file = path.join(dir, 'state.json')
    // Repeatedly write unparseable JSON + load (each load backs up + resets).
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(file, `{ not json ${i}`, 'utf8')
      loadState(dir)
    }
    const corrupt = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt.'))
    expect(corrupt.length).toBeLessThanOrEqual(BACKUP_KEEP)
  })
})

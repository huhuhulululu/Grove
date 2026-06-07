/**
 * csv-export.test.ts — the PURE event-timeline → CSV serializer (own-your-data).
 *
 * eventsToCsv(events) turns the normalized GroveEvent log into RFC-4180 CSV so a
 * player can pipe their OUTCOME timeline into a spreadsheet/notebook. It is a pure
 * serializer: no I/O, no clock, no state. The schema is EVENT-NATIVE only — the
 * persisted GroveEvent fields — never computed game numbers (level/xp/seeds live in
 * reduce(), not the event log), so the firewall is honored by construction.
 */

import { describe, it, expect } from 'vitest'
import type { GroveEvent } from '../core/events'
import { eventsToCsv } from './csv-export'

const HEADER = 'timestamp,event_type,source,magnitude,success,session_id,cwd,repo'

function ev(overrides: Partial<GroveEvent> = {}): GroveEvent {
  return {
    source: 'git',
    sessionId: 's1',
    type: 'commit',
    magnitude: 1,
    success: true,
    ts: '2026-06-06T10:00:00.000Z',
    meta: {},
    ...overrides,
  }
}

describe('eventsToCsv — pure RFC-4180 serializer', () => {
  it('emits the exact header row as line 1', () => {
    const out = eventsToCsv([])
    expect(out.split('\n')[0]).toBe(HEADER)
  })

  it('an empty event list is the header ONLY (one line, no trailing blank)', () => {
    const out = eventsToCsv([])
    expect(out).toBe(HEADER)
    expect(out.split('\n')).toHaveLength(1)
  })

  it('one event → header + 1 row, fields in the correct column order', () => {
    const out = eventsToCsv([
      ev({
        ts: '2026-06-06T10:00:00.000Z',
        type: 'pr_merged',
        source: 'git',
        magnitude: 5,
        success: true,
        sessionId: 'sess-42',
        cwd: '/home/u/proj',
        repo: 'u/proj',
      }),
    ])
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('2026-06-06T10:00:00.000Z,pr_merged,git,5,true,sess-42,/home/u/proj,u/proj')
  })

  it('success renders the literal true / false', () => {
    expect(eventsToCsv([ev({ success: false })]).split('\n')[1]).toContain(',false,')
    expect(eventsToCsv([ev({ success: true })]).split('\n')[1]).toContain(',true,')
  })

  it('undefined cwd / repo render as EMPTY cells (not the string "undefined")', () => {
    const row = eventsToCsv([ev({ cwd: undefined, repo: undefined })]).split('\n')[1]!
    expect(row).not.toContain('undefined')
    // …,session_id,, (two trailing empty cells)
    expect(row.endsWith(',s1,,')).toBe(true)
  })

  it('RFC-4180 quotes a field containing a comma', () => {
    const row = eventsToCsv([ev({ repo: 'a,b' })]).split('\n')[1]!
    expect(row.endsWith(',"a,b"')).toBe(true)
  })

  it('RFC-4180 doubles an internal double-quote and wraps the field', () => {
    const row = eventsToCsv([ev({ cwd: 'a"b' })]).split('\n')[1]!
    expect(row).toContain('"a""b"')
  })

  it('quotes a field containing a newline (CR/LF)', () => {
    const row = eventsToCsv([ev({ repo: 'a\nb' })])
    // the embedded newline is inside a quoted field, so the row count is header + 1 logical row
    expect(row.startsWith(HEADER + '\n')).toBe(true)
    expect(row).toContain('"a\nb"')
  })

  it('preserves event order and is a stable exact string for a multi-event fixture', () => {
    const out = eventsToCsv([
      ev({ ts: '2026-06-06T09:00:00.000Z', type: 'commit', magnitude: 1, sessionId: 's1', cwd: '/a', repo: 'r' }),
      ev({ ts: '2026-06-06T09:05:00.000Z', type: 'test_result', success: false, magnitude: 2, sessionId: 's1', cwd: '/a', repo: 'r' }),
    ])
    expect(out).toBe(
      HEADER + '\n' +
      '2026-06-06T09:00:00.000Z,commit,git,1,true,s1,/a,r\n' +
      '2026-06-06T09:05:00.000Z,test_result,git,2,false,s1,/a,r',
    )
  })
})

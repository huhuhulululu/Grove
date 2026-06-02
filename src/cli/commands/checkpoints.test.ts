/**
 * checkpoints.test.ts — `sq checkpoints` is a READ-ONLY reader for the
 * checkpoints.jsonl that `sq checkpoint` writes. It must: print newest-first,
 * surface the DURABLE stash-create SHA (never a positional stash@{n}, which
 * shifts/expires), run no git, and have no --apply flag.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleCheckpoints } from './hooks'

function capture(fn: () => void): string[] {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return lines
}

describe('sq checkpoints (read-only list)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-checkpoints-test-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const write = (entries: object[]): void =>
    fs.writeFileSync(
      path.join(dir, 'checkpoints.jsonl'),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    )

  it('prints a calm hint when there are no checkpoints', () => {
    const out = capture(() => handleCheckpoints({}, dir, 'en')).join('\n')
    expect(out).toMatch(/No checkpoints yet/)
  })

  it('lists entries newest-first with branch, message, shape, and a durable-SHA recall', () => {
    write([
      {
        ts: '2026-06-01T10:00:00.000Z',
        ref: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
        branch: 'main',
        message: 'wip',
        diffStat: { fileCount: 3, insertions: 40, deletions: 5 },
      },
      {
        ts: '2026-06-01T11:00:00.000Z',
        ref: 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222',
        branch: 'feat/x',
        message: 'before refactor',
        diffStat: null,
      },
    ])
    const joined = capture(() => handleCheckpoints({}, dir, 'en')).join('\n')
    // newest-first: the later-appended feat/x entry prints before main
    expect(joined.indexOf('feat/x')).toBeLessThan(joined.indexOf('main'))
    expect(joined).toContain('before refactor')
    expect(joined).toContain('wip')
    // copyable recall uses the DURABLE create-SHA, never a positional stash@{n}
    expect(joined).toContain('git stash apply bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222')
    expect(joined).not.toMatch(/stash@\{\d+\}/)
    // change shape: counts only (no file paths), and the clean entry's localized label
    expect(joined).toContain('3f +40/-5')
    expect(joined).toMatch(/clean/)
  })

  it('--limit caps how many are shown (newest kept)', () => {
    write([
      { ts: '2026-06-01T10:00:00.000Z', ref: 'a', branch: 'a', message: 'm1', diffStat: null },
      { ts: '2026-06-01T11:00:00.000Z', ref: 'b', branch: 'b', message: 'm2', diffStat: null },
      { ts: '2026-06-01T12:00:00.000Z', ref: 'c', branch: 'c', message: 'm3', diffStat: null },
    ])
    const out = capture(() => handleCheckpoints({ limit: '2' }, dir, 'en')).join('\n')
    expect(out).toContain('m3')
    expect(out).toContain('m2')
    expect(out).not.toContain('m1')
  })

  it('skips a malformed JSONL line without throwing', () => {
    fs.writeFileSync(
      path.join(dir, 'checkpoints.jsonl'),
      'not json\n' +
        JSON.stringify({
          ts: '2026-06-01T10:00:00.000Z',
          ref: 'dddd',
          branch: 'main',
          message: 'ok',
          diffStat: null,
        }) +
        '\n',
      'utf8',
    )
    const out = capture(() => handleCheckpoints({}, dir, 'en')).join('\n')
    expect(out).toContain('ok')
  })
})

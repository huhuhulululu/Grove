/**
 * learn.test.ts — `sq learn` opt-in practice explainers (Pillar B, education).
 *
 * Guards the dual-audience contract: a newcomer gets a plain one-line WHY on
 * demand; a veteran never types it. Read-only, ingests nothing, rewards nothing,
 * never auto-shown, never condescending.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleLearn, PRACTICES } from './learn'
import { run } from '../sq'
import { t } from '../../i18n/t'

let logs: string[]
let errs: string[]
let logSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logs = []
  errs = []
  logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.join(' '))
  })
  errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errs.push(a.join(' '))
  })
})

afterEach(() => {
  logSpy.mockRestore()
  errSpy.mockRestore()
})

describe('handleLearn — opt-in practice explainers', () => {
  it('with no argument lists every practice with its one-line why', () => {
    const code = handleLearn([], false, 'en')
    expect(code).toBe(0)
    const out = logs.join('\n')
    for (const p of PRACTICES) {
      expect(out).toContain(p)
      expect(out).toContain(t('en', `learn.${p}.why`))
    }
  })

  it('with a known practice prints exactly that practice why', () => {
    const code = handleLearn(['conventional-commits'], false, 'en')
    expect(code).toBe(0)
    expect(logs.join('\n')).toContain(t('en', 'learn.conventional-commits.why'))
  })

  it('an unknown practice exits 2 with a terse stderr hint', () => {
    const code = handleLearn(['frobnicate'], false, 'en')
    expect(code).toBe(2)
    const err = errs.join('\n')
    expect(err).toContain('frobnicate')
    expect(err).toContain('sq learn')
  })

  it('--zen output is identical (read-only info, never spectacle)', () => {
    handleLearn(['spec-first'], false, 'en')
    const plain = logs.join('\n')
    logs = []
    handleLearn(['spec-first'], true, 'en')
    const zen = logs.join('\n')
    expect(zen).toBe(plain)
    expect(zen).not.toMatch(/💥|✨|🎁|🪙|🃏/) // grants nothing, no loot glyph
  })

  it('the copy is declarative WHY only — never nags, scolds, or praises', () => {
    const banned = /\byou should\b|\bdon'?t forget\b|\bmake sure to\b|\bremember to\b|great|good job|well done/i
    for (const p of PRACTICES) {
      expect(t('en', `learn.${p}.why`)).not.toMatch(banned)
    }
    expect(t('en', 'cli.learn.header')).not.toMatch(banned)
    expect(t('en', 'cli.quests.learn_tip')).not.toMatch(banned)
  })

  it('is read-only — the handler module reaches no ingest/persist/reward path', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/cli/commands/learn.ts'), 'utf8')
    expect(src).not.toMatch(/ingestEvent|saveState|loadState|reduce\(/)
  })
})

describe('sq learn dispatch + non-intrusion', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-learn-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('routes `sq learn <practice>` and lists with no arg; help mentions learn', () => {
    expect(run(['learn', 'test-first'])).toBe(0)
    expect(logs.join('\n')).toContain(t('en', 'learn.test-first.why'))
    logs = []
    expect(run(['learn'])).toBe(0)
    expect(logs.join('\n')).toContain('test-first')
    logs = []
    run(['help'])
    expect(logs.join('\n')).toContain('learn')
  })

  it('a benign command never auto-prints a learn why (opt-in only)', () => {
    run(['status', '--home', tmp])
    const out = logs.join('\n')
    for (const p of PRACTICES) {
      expect(out).not.toContain(t('en', `learn.${p}.why`))
    }
  })

  it('the quests board points at learn (a tip) but never dumps a full why', () => {
    run(['quests', '--home', tmp])
    const out = logs.join('\n')
    expect(out).toContain(t('en', 'cli.quests.learn_tip'))
    for (const p of PRACTICES) {
      expect(out).not.toContain(t('en', `learn.${p}.why`))
    }
  })
})

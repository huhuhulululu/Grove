/**
 * onboarding.test.ts — UX first-aha (audit re-score② cluster B, UX P1):
 *
 *  - `sq init` is real onboarding: it chain-installs the hook, GRANTS A STARTER
 *    (so a brand-new user sees loot immediately, not an empty dashboard), detects
 *    installed AI CLIs, and prints a clear next-step CTA.
 *  - An unknown subcommand prints a "did you mean …?" suggestion (closest match)
 *    instead of dumping the whole USAGE wall.
 *
 * Run: npx vitest run src/cli/onboarding.test.ts
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { run, suggestSubcommand, detectAiClis } from './sq'
import { loadState } from '../store/store'
import { stateDir } from '../store/paths'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-onboard-'))
}

function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "t@grove.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Grove Test"', { cwd: dir, stdio: 'pipe' })
}

function captureRunFull(argv: string[]): { code: number; output: string[]; errors: string[] } {
  const lines: string[] = []
  const errLines: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errLines.push(a.map(String).join(' '))
  })
  let code: number
  try {
    code = run(argv)
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
  }
  return { code, output: lines, errors: errLines }
}

// ---------------------------------------------------------------------------
// suggestSubcommand — "did you mean …?" (pure)
// ---------------------------------------------------------------------------

describe('suggestSubcommand', () => {
  it('suggests "dashboard" for a near-miss "dashbaord"', () => {
    expect(suggestSubcommand('dashbaord')).toBe('dashboard')
  })

  it('suggests "enhance" for "enahnce"', () => {
    expect(suggestSubcommand('enahnce')).toBe('enhance')
  })

  it('suggests "status" for "stats"', () => {
    expect(suggestSubcommand('stats')).toBe('status')
  })

  it('returns null for an input with no close match (far from any subcommand)', () => {
    expect(suggestSubcommand('zzzzzzzzzz')).toBeNull()
  })

  it('suggests "pull" for "pul" (one-char deletion)', () => {
    expect(suggestSubcommand('pul')).toBe('pull')
  })
})

// ---------------------------------------------------------------------------
// detectAiClis — PATH probe (injectable)
// ---------------------------------------------------------------------------

describe('detectAiClis', () => {
  it('returns the subset of known AI CLIs that resolve on PATH (injected probe)', () => {
    const present = detectAiClis({ onPath: (bin) => bin === 'claude' || bin === 'aider' })
    expect(present).toContain('claude')
    expect(present).toContain('aider')
    expect(present).not.toContain('cursor')
  })

  it('returns an empty list when none resolve', () => {
    expect(detectAiClis({ onPath: () => false })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// `sq init` real onboarding
// ---------------------------------------------------------------------------

describe('sq init — onboarding', () => {
  let tmpRepo: string
  let tmpHome: string

  beforeEach(() => {
    tmpRepo = makeTmpDir()
    tmpHome = makeTmpDir()
    gitInit(tmpRepo)
  })

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true })
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('still installs the post-commit hook (chains, returns 0)', () => {
    const { code } = captureRunFull(['init', '--repo', tmpRepo, '--home', tmpHome])
    expect(code).toBe(0)
    const hookPath = path.join(tmpRepo, '.git', 'hooks', 'post-commit')
    expect(fs.existsSync(hookPath)).toBe(true)
  })

  it('grants a STARTER so a brand-new user immediately has loot (not an empty board)', () => {
    const beforeExists = fs.existsSync(path.join(stateDir(tmpHome), 'state.json'))
    expect(beforeExists).toBe(false)
    captureRunFull(['init', '--repo', tmpRepo, '--home', tmpHome])
    const state = loadState(stateDir(tmpHome))
    // The starter grant means the new player owns at least one card OR some seeds —
    // the dashboard is no longer empty on first run.
    expect(state.cards.length + state.player.currency).toBeGreaterThan(0)
  })

  it('grants the starter only ONCE (a second init does not re-grant)', () => {
    captureRunFull(['init', '--repo', tmpRepo, '--home', tmpHome])
    const after1 = loadState(stateDir(tmpHome))
    captureRunFull(['init', '--repo', tmpRepo, '--home', tmpHome])
    const after2 = loadState(stateDir(tmpHome))
    // Idempotent onboarding: the second init must not stack another starter.
    expect(after2.cards.length).toBe(after1.cards.length)
    expect(after2.player.currency).toBe(after1.player.currency)
  })

  it('prints a clear next-step CTA (a concrete command to run next)', () => {
    const { output } = captureRunFull(['init', '--repo', tmpRepo, '--home', tmpHome])
    const combined = output.join('\n')
    // A real call-to-action: it tells the user the very next command.
    expect(combined.toLowerCase()).toMatch(/next|try|run/)
    expect(combined).toMatch(/sq dashboard|sq pull|git commit/)
  })

  it('mentions detected AI CLIs (or a graceful note when none are found)', () => {
    const { output } = captureRunFull(['init', '--repo', tmpRepo, '--home', tmpHome])
    const combined = output.join('\n').toLowerCase()
    // Either it names a detected tool, or it gracefully says it works with any tool.
    expect(combined).toMatch(/claude|cursor|aider|codex|copilot|gemini|any (ai )?tool|tool-agnostic|works with/)
  })
})

// ---------------------------------------------------------------------------
// unknown subcommand → "did you mean?" instead of the full USAGE wall
// ---------------------------------------------------------------------------

describe('unknown subcommand → did-you-mean', () => {
  let tmpHome: string
  beforeEach(() => { tmpHome = makeTmpDir() })
  afterEach(() => { fs.rmSync(tmpHome, { recursive: true, force: true }) })

  it('a near-miss prints a "did you mean …?" hint and exits 2', () => {
    const { code, output, errors } = captureRunFull(['dashbaord', '--home', tmpHome])
    expect(code).toBe(2)
    const combined = [...output, ...errors].join('\n').toLowerCase()
    expect(combined).toContain('did you mean')
    expect(combined).toContain('dashboard')
  })

  it('a near-miss does NOT dump the entire USAGE wall (terse correction)', () => {
    const { output, errors } = captureRunFull(['enahnce', '--home', tmpHome])
    const combined = [...output, ...errors].join('\n')
    // The full USAGE lists many subcommands; a focused suggestion must not print
    // the whole block. Assert the verbose "Global flags:" header is absent.
    expect(combined).not.toContain('Global flags:')
    expect(combined.toLowerCase()).toContain('enhance')
  })

  it('a totally unknown token still exits 2 and points to `sq help`', () => {
    const { code, output, errors } = captureRunFull(['zzzzzzzzzz', '--home', tmpHome])
    expect(code).toBe(2)
    const combined = [...output, ...errors].join('\n').toLowerCase()
    expect(combined).toMatch(/sq help|unknown/)
  })
})

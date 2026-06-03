/**
 * Pillar-B repo detector — tool-agnostic filesystem + last-git-commit scanner.
 *
 * Produces normalized GroveEvents from a repo directory:
 *  1. GRIMOIRE check   (filesystem only, no git required)
 *  2. LAST-COMMIT DIFF (git; degrades gracefully on failure)
 *
 * ADR-0005 compliance:
 *  - This module performs I/O but NEVER modifies files or git history.
 *  - All events it emits are read-only observations; the engine decides rewards.
 *  - False-positive detection (e.g. no git repo) emits a note, never punishes.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { GroveEvent } from '../core/events'
import { GRIMOIRE_FILES, ADR_FILES, ADR_NONEMPTY_MIN_LINES } from '../core/quests'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ScanResult {
  events: GroveEvent[]
  notes: string[]
}

export function scanRepo(
  repoDir: string,
  opts?: { sessionId?: string; ts?: string },
): ScanResult {
  const sessionId = opts?.sessionId ?? 'scan'
  const ts = opts?.ts ?? new Date().toISOString()
  const events: GroveEvent[] = []
  const notes: string[] = []

  // ---- Step 1: GRIMOIRE detection (filesystem, no git needed) ---------------
  detectGrimoire(repoDir, sessionId, ts, events)

  // ---- Step 1b: ADR (decisions.md) detection (filesystem) -------------------
  detectAdr(repoDir, sessionId, ts, events)

  // ---- Step 2: LAST-COMMIT DIFF (git; best-effort) --------------------------
  detectLastCommit(repoDir, sessionId, ts, events, notes)

  return { events, notes }
}

// ---------------------------------------------------------------------------
// Step 1: Grimoire
// ---------------------------------------------------------------------------

function detectGrimoire(
  repoDir: string,
  sessionId: string,
  ts: string,
  events: GroveEvent[],
): void {
  for (const name of GRIMOIRE_FILES) {
    const fullPath = path.join(repoDir, name)
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n').length
      events.push(buildEvent(sessionId, ts, 'file_presence', 1, true, {
        document: name,
        lines,
        present: true,
      }))
      // STOP after first found — idempotent, no duplicates
      return
    }
  }

  // None found — push a "present:false" sentinel so a deleted grimoire drops its aura
  events.push(buildEvent(sessionId, ts, 'file_presence', 1, true, {
    document: 'CLAUDE.md',
    present: false,
  }))
}

/**
 * ADR detection — recognize the habit of recording architectural decisions. If a
 * non-empty decisions file exists, emit ONE file_presence with meta.adr=true. An
 * absent / empty file emits NOTHING (forgiving silence — unlike the grimoire there
 * is no standing aura to drop, so no present:false sentinel is needed).
 */
function detectAdr(
  repoDir: string,
  sessionId: string,
  ts: string,
  events: GroveEvent[],
): void {
  for (const name of ADR_FILES) {
    const fullPath = path.join(repoDir, name)
    if (!fs.existsSync(fullPath)) continue
    const content = fs.readFileSync(fullPath, 'utf-8')
    const nonBlankLines = content.split('\n').filter((l) => l.trim().length > 0).length
    if (nonBlankLines > ADR_NONEMPTY_MIN_LINES) {
      events.push(buildEvent(sessionId, ts, 'file_presence', 1, true, {
        document: name,
        adr: true,
        lines: nonBlankLines,
        present: true,
      }))
    }
    return // first ADR path wins (present-but-empty also stops the search, silently)
  }
}

// ---------------------------------------------------------------------------
// Step 2: Last-commit diff
// ---------------------------------------------------------------------------

// Grimoire file basenames for exclusion from doc classification
const GRIMOIRE_BASENAMES = new Set(
  GRIMOIRE_FILES.map((f) => path.basename(f)),
)

// Regex patterns for classification
const RE_TEST = /(^|\/)(tests?|__tests__)\//i
const RE_TEST_EXT = /\.(test|spec)\.[a-z]+$/i
const RE_SPEC_MD = /\.spec\.md$/i
const RE_SPEC_NAMED = /(^|\/)(SPEC|ACCEPTANCE|REQUIREMENTS)/i
const RE_DOC = /(^|\/)(README|ARCHITECTURE|CHANGELOG)/i
const RE_DOC_DIR = /(^|\/)docs\//i
const RE_DOC_MD = /\.md$/i
const RE_CODE_EXT = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|c|cpp)$/i

function classifyPath(filePath: string): 'test' | 'spec' | 'doc' | 'code' | 'other' {
  const basename = path.basename(filePath)

  // Test files: path matches tests?/__tests__ directories, or extension .test.* / .spec.*
  // Note: .spec.* that end in .spec.md are spec docs, not test files — check RE_TEST_EXT first
  // but exclude .spec.md from test classification
  if (!RE_SPEC_MD.test(filePath) && (RE_TEST.test(filePath) || RE_TEST_EXT.test(filePath))) {
    return 'test'
  }

  // Spec docs: .spec.md files or files named SPEC / ACCEPTANCE / REQUIREMENTS
  if (RE_SPEC_MD.test(filePath) || RE_SPEC_NAMED.test(filePath)) {
    return 'spec'
  }

  // Doc files: README / ARCHITECTURE / CHANGELOG, docs/ dir, or any .md
  // Excluding grimoire files (they have their own detection) and spec files
  if (GRIMOIRE_BASENAMES.has(basename)) {
    return 'other'
  }
  if (RE_DOC.test(filePath) || RE_DOC_DIR.test(filePath) || RE_DOC_MD.test(filePath)) {
    return 'doc'
  }

  // Code files: recognized source code extensions
  if (RE_CODE_EXT.test(filePath)) {
    return 'code'
  }

  return 'other'
}

function isGitRepo(repoDir: string): boolean {
  try {
    // execFileSync (no shell): repoDir is passed as a literal argv element, so a
    // path containing quotes / `$()` / `;` can never inject a command.
    execFileSync('git', ['-C', repoDir, 'rev-parse', '--git-dir'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function hasAtLeastOneCommit(repoDir: string): boolean {
  try {
    execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function detectLastCommit(
  repoDir: string,
  sessionId: string,
  ts: string,
  events: GroveEvent[],
  notes: string[],
): void {
  if (!isGitRepo(repoDir)) {
    notes.push(`git: "${repoDir}" is not a git repository — skipping commit diff`)
    return
  }

  if (!hasAtLeastOneCommit(repoDir)) {
    notes.push(`git: "${repoDir}" has no commits yet — skipping commit diff`)
    return
  }

  let changedFiles: string[]
  try {
    // `--root` makes the FIRST (parentless) commit report its files as additions;
    // without it `diff-tree HEAD` is empty on a fresh repo's initial commit, so a
    // user's very first `sq scan` would miss test/doc signals. No-op on later commits.
    //
    // `--name-status` emits "STATUS\tPATH" lines (A=Added, M=Modified, D=Deleted,
    // R100=Renamed, etc.).  We intentionally ignore deletions (D) — rewarding a
    // deletion as if it were an addition is incorrect.  For renames (R*) we take
    // only the destination path (the new name), which appears after a second tab.
    const raw = execFileSync(
      'git',
      ['-C', repoDir, 'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', 'HEAD'],
      { stdio: 'pipe' },
    ).toString('utf-8')

    changedFiles = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const parts = line.split('\t')
        const status = parts[0] ?? ''
        if (status.startsWith('D')) {
          // Deleted file — no reward
          return []
        }
        if (status.startsWith('R')) {
          // Renamed — parts[2] is the destination path
          const dest = parts[2]
          return dest ? [dest] : []
        }
        // Added (A) or Modified (M) — parts[1] is the path
        const filePath = parts[1]
        return filePath ? [filePath] : []
      })
  } catch (err) {
    notes.push(`git: failed to read HEAD diff — ${String(err)}`)
    return
  }

  if (changedFiles.length === 0) {
    return
  }

  const testFiles: string[] = []
  const specFiles: string[] = []
  const docFiles: string[] = []
  const codeFiles: string[] = []

  for (const f of changedFiles) {
    const kind = classifyPath(f)
    if (kind === 'test') testFiles.push(f)
    else if (kind === 'spec') specFiles.push(f)
    else if (kind === 'doc') docFiles.push(f)
    else if (kind === 'code') codeFiles.push(f)
  }

  // test_added · store only the COUNT, never the file paths (ISOLATION · R-safety).
  // A path is work content (reveals module/feature names); the magnitude — the
  // reward driver — already encodes the count, and nothing downstream reads paths.
  if (testFiles.length > 0) {
    const magnitude = Math.min(10, testFiles.length) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
    events.push(buildEvent(sessionId, ts, 'test_added', magnitude, true, {
      count: testFiles.length,
    }))
  }

  // spec_written · count only, no paths (ISOLATION · see above).
  if (specFiles.length > 0) {
    events.push(buildEvent(sessionId, ts, 'spec_written', 1, true, {
      count: specFiles.length,
    }))
  }

  // doc_updated
  if (docFiles.length > 0 && codeFiles.length > 0) {
    // Code AND docs changed in same commit → synced
    events.push(buildEvent(sessionId, ts, 'doc_updated', 1, true, { synced: true }))
  } else if (codeFiles.length > 0 && docFiles.length === 0) {
    // Only code changed — check if an arch/readme doc EXISTS in the repo (drift risk)
    const archExists =
      fs.existsSync(path.join(repoDir, 'ARCHITECTURE.md')) ||
      fs.existsSync(path.join(repoDir, 'README.md'))
    if (archExists) {
      events.push(buildEvent(sessionId, ts, 'doc_updated', 1, true, { drift: true }))
    }
  }
}

// ---------------------------------------------------------------------------
// Builder helper
// ---------------------------------------------------------------------------

type EventType = GroveEvent['type']

function buildEvent(
  sessionId: string,
  ts: string,
  type: EventType,
  magnitude: number,
  success: boolean,
  meta: Record<string, unknown>,
): GroveEvent {
  return {
    source: 'detect',
    sessionId,
    ts,
    type,
    magnitude,
    success,
    meta,
  }
}

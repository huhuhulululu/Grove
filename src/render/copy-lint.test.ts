/**
 * copy-lint.test.ts — enforces the de-中二 tone pass (ADR-0009 / docs/TONE.md).
 *
 * Reads the SOURCE of every user-facing-copy file and asserts NONE contains any
 * deny-list phrase. The deny-list is hard-coded here (mirrors docs/TONE.md) so a
 * future cloying regression fails the build, not a silent docs drift.
 *
 * This is a copy guard, not a logic test — it greps source text only.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

// Resolve project root from this file: src/render/copy-lint.test.ts → root.
const thisFile = url.fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(thisFile), '..', '..')

// The copy-bearing files this pass rewrote (relative to project root).
const FILES = [
  'src/engine/reduce.ts',
  'src/engine/quests.ts',
  'src/core/quests.ts',
  'src/render/enhance.ts',
  'src/render/dashboard.ts',
  'src/render/format.ts',
  'src/app/recap.ts',
  'src/cli/sq.ts',
  'src/cli/commands/learn.ts',
  'src/render/share.ts',
  'src/i18n/catalog/en.ts',
  'src/i18n/catalog/zh-CN.ts',
  'src/i18n/catalog/ja.ts',
  'src/i18n/catalog/ko.ts',
]

// Hard-coded deny-list (from docs/TONE.md). Matched case-insensitively.
const DENY_LIST = [
  'the grove cheers',
  'canopy shimmers',
  'holds its breath',
  'Carry it lightly',
  'future-you sends thanks',
  'sprout appears',
  'rare bloom unfurls',
  'Light pours through the leaves',
  'sturdy roots',
  'tidy branches',
  'clear path through the woods',
  'trail is mapped',
  'bough unfurls',
  'forged stronger',
  'natural breath point',
  'code freely',
  'Onward!',
  'seedling joins',
]

describe('copy-lint: no cloying deny-list phrases in user-facing copy (ADR-0009)', () => {
  for (const rel of FILES) {
    it(`${rel} contains no deny-list phrase`, () => {
      const abs = path.join(ROOT, rel)
      const source = fs.readFileSync(abs, 'utf-8').toLowerCase()

      const found = DENY_LIST.filter((phrase) => source.includes(phrase.toLowerCase()))

      expect(found, `cloying phrase(s) found in ${rel}: ${found.join(', ')}`).toEqual([])
    })
  }

  it('the deny-list is non-empty (guards against an accidentally disabled lint)', () => {
    expect(DENY_LIST.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Em-dash guard (TONE.md: "no-em-dash"). User-facing copy must use ' · ',
// a period, or parentheses instead of '—'. The deny-list above never checks the
// '—' character, so em-dashes used to ship silently in the most-read surfaces
// (e.g. `sq help` / USAGE_TEXT). This asserts the CODE/STRING lines of the
// copy-bearing surfaces carry no em-dash. Pure code comments are exempt (they
// are not user-facing); only non-comment lines are scanned.
//
// Scope note: the engine/core copy files (reduce.ts, *quests.ts) still carry
// em-dashes in their reward `message:` strings and are intentionally NOT listed
// here — they live outside this surface pass and are tracked separately.
const EM_DASH_FILES = [
  'src/render/enhance.ts',
  'src/render/dashboard.ts',
  'src/render/format.ts',
  'src/app/recap.ts',
  'src/cli/sq.ts',
  'src/cli/commands/learn.ts',
  'src/render/share.ts',
  'src/i18n/catalog/en.ts',
  'src/i18n/catalog/zh-CN.ts',
  'src/i18n/catalog/ja.ts',
  'src/i18n/catalog/ko.ts',
]

/** True for a line whose content is purely a comment (//, * , /* ). */
function isCommentLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

describe('copy-lint: no em-dash (—) in user-facing copy (docs/TONE.md)', () => {
  for (const rel of EM_DASH_FILES) {
    it(`${rel} has no em-dash in non-comment lines`, () => {
      const abs = path.join(ROOT, rel)
      const lines = fs.readFileSync(abs, 'utf-8').split('\n')

      const offenders = lines
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => line.includes('—') && !isCommentLine(line))
        .map(({ line, n }) => `${rel}:${n} ${line.trim()}`)

      expect(offenders, `em-dash in user-facing copy:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})

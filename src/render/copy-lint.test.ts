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
  'src/render/share.ts',
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

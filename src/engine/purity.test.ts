/**
 * purity.test.ts — R8 makes the ARCHITECTURE "engine purity is verified by a test"
 * claim TRUE (architecture A-blocker).
 *
 * The ethics firewall (ADR-0005) rests on `src/core` + `src/engine` being a PURE
 * function (GameState, GroveEvent, Rng) → (GameState, Reward[]): no I/O, no
 * wall-clock, no nondeterministic randomness, only the injected `rng`. This test
 * READS every non-test source file in those two directories and ASSERTS none
 * reaches for a forbidden capability — so the purity guarantee is structurally
 * enforced, not merely documented.
 *
 * Scanning the SOURCE files (not the test files) is deliberate: test files
 * legitimately mention these tokens (e.g. asserting they are absent), so a naive
 * grep of everything would self-trip. We exclude `*.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')

/** Every non-test .ts file under src/engine and src/core (the PURE layer). */
function pureSourceFiles(): string[] {
  const out: string[] = []
  for (const dir of ['engine', 'core']) {
    const base = join(SRC, dir)
    for (const name of readdirSync(base)) {
      if (!name.endsWith('.ts')) continue
      if (name.endsWith('.test.ts')) continue // tests legitimately mention these tokens
      out.push(join(base, name))
    }
  }
  return out
}

/**
 * Forbidden capability signatures. Each is a substring/regex that would only appear
 * if the pure layer reached for I/O, the wall-clock, the process/network, or a
 * nondeterministic random source instead of the injected `rng`.
 *
 * `Math.random` is the canonical leak (the engine MUST thread the injected rng);
 * `Date.now`/`new Date(`/`performance.now` are wall-clock; `fs`/`child_process`/
 * `fetch`/`process.` are I/O & environment.
 */
const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "import 'fs'", re: /from\s+['"]fs['"]/ },
  { label: "import 'node:fs'", re: /from\s+['"]node:fs['"]/ },
  { label: "require('fs')", re: /require\(\s*['"](?:node:)?fs['"]\s*\)/ },
  { label: "import 'child_process'", re: /from\s+['"](?:node:)?child_process['"]/ },
  { label: 'process.', re: /\bprocess\./ },
  { label: 'fetch(', re: /\bfetch\s*\(/ },
  { label: 'Math.random', re: /\bMath\.random\b/ },
  { label: 'Date.now', re: /\bDate\.now\b/ },
  { label: 'new Date(', re: /\bnew\s+Date\s*\(/ },
  { label: 'performance.now', re: /\bperformance\.now\b/ },
]

describe('engine + core purity (the ADR-0005 ethics firewall, structurally enforced)', () => {
  const files = pureSourceFiles()

  it('finds the pure source files to scan (sanity: the glob is not empty)', () => {
    expect(files.length).toBeGreaterThan(0)
    // the two crown-jewel modules must be in scope
    expect(files.some((f) => f.endsWith('reduce.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('cards.ts'))).toBe(true)
  })

  for (const { label, re } of FORBIDDEN) {
    it(`no pure source file contains a forbidden \`${label}\``, () => {
      const offenders: string[] = []
      for (const file of files) {
        const text = readFileSync(file, 'utf8')
        // strip line comments + block comments so a doc-comment mentioning a token
        // (e.g. "no Math.random") is not a false positive.
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        if (re.test(code)) {
          const lines = code
            .split('\n')
            .map((l, i) => ({ l, i: i + 1 }))
            .filter(({ l }) => re.test(l))
            .map(({ i }) => i)
          offenders.push(`${file}:${lines.join(',')}`)
        }
      }
      expect(offenders, `forbidden \`${label}\` found in:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { stateDir } from '../store/paths'
import { loadState, readEvents } from '../store/store'

const execFileP = promisify(execFile)

// Resolve the grove repo root from this test file: src/app/*.test.ts → ../../
const repoRoot = path.resolve(__dirname, '..', '..')
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx')
const sqEntry = path.join(repoRoot, 'src', 'cli', 'sq.ts')

let tmpHome: string

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-conc-'))
})

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe('ingestEvent concurrency (cross-process lock)', () => {
  it(
    'N=20 parallel `sq event commit` processes all land — no lost updates',
    async () => {
      const N = 20

      // Spawn N real CLI processes IN PARALLEL, each ingesting one commit event
      // into the same grove home. Without a cross-process lock these race on the
      // load→reduce→save→appendEvent sequence and lose updates.
      const procs = Array.from({ length: N }, () =>
        execFileP(tsxBin, [sqEntry, 'event', 'commit', '--home', tmpHome], {
          cwd: repoRoot,
        }),
      )

      const results = await Promise.allSettled(procs)
      const failed = results.filter((r) => r.status === 'rejected')
      expect(failed).toEqual([])

      // The spawned CLIs resolve their state dir as stateDir(tmpHome) using the
      // repo's repoKey() — running from repoRoot makes that deterministic, so we
      // recompute the same path here.
      const dir = stateDir(tmpHome)

      // Final committed state must reflect ALL 20 events (no lost updates).
      expect(loadState(dir).eventCount).toBe(N)

      // The append-only log must likewise have exactly 20 lines (no divergence
      // between the reduced state and the event log).
      expect(readEvents(dir)).toHaveLength(N)

      // No leftover lock after the storm settles.
      expect(fs.existsSync(path.join(dir, '.lock'))).toBe(false)
    },
    60_000,
  )
})

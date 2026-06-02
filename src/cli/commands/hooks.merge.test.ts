/**
 * hooks.merge.test.ts — the LOAD-BEARING heuristic for the auto-pr_merged hook,
 * exercised against a REAL temp git repo: a true (--no-ff) merge commit emits a
 * pr_merged outcome; a fast-forward merge (single-parent) emits NOTHING (a routine
 * `git pull` must never over-reward).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { handleMergeHook } from './hooks'
import { readEvents } from '../../store/store'
import { stateDir } from '../../store/paths'

function git(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' })
}

describe('handleMergeHook heuristic (real git repo)', () => {
  let repo: string
  let home: string

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-merge-repo-'))
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-merge-home-'))
    git('git init', repo)
    git('git config user.email t@t.test', repo)
    git('git config user.name Tester', repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), '1\n')
    git('git add -A', repo)
    git('git commit -m base', repo)
  })
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  const dir = (): string => stateDir(home)
  const prMerges = (): number => {
    try {
      return readEvents(dir()).filter((e) => e.type === 'pr_merged').length
    } catch {
      return 0
    }
  }
  // zen=true keeps the test output quiet (the engine still records).
  const run = (): void => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      handleMergeHook({ repo }, dir(), true)
    } finally {
      spy.mockRestore()
    }
  }

  it('emits pr_merged on a REAL --no-ff merge commit (2nd parent)', () => {
    git('git checkout -b feat', repo)
    fs.writeFileSync(path.join(repo, 'b.txt'), '2\n')
    git('git add -A', repo)
    git('git commit -m feat', repo)
    git('git checkout -', repo) // back to the default branch
    git('git merge --no-ff -m "merge feat" feat', repo) // creates a merge commit
    run()
    expect(prMerges()).toBe(1)
  })

  it('does NOT emit on a fast-forward merge (single-parent — a routine pull)', () => {
    git('git checkout -b feat2', repo)
    fs.writeFileSync(path.join(repo, 'c.txt'), '3\n')
    git('git add -A', repo)
    git('git commit -m feat2', repo)
    git('git checkout -', repo)
    git('git merge --ff-only feat2', repo) // fast-forward → HEAD stays single-parent
    run()
    expect(prMerges()).toBe(0)
  })
})

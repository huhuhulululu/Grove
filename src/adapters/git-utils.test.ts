/**
 * git-utils.test.ts — TDD tests for git-utils adapter (read-only helpers).
 *
 * Each test uses a fresh temp git repo / grove home to stay isolated.
 * Tests verify NON-DESTRUCTIVE guarantees: working tree must be byte-identical
 * before/after createStashSnapshot.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  stagedDiffStat,
  createStashSnapshot,
  currentBranch,
} from './git-utils'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grove-git-utils-test-'))
}

function removeTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Init a bare git repo with a user config and an initial commit. */
function makeGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@grove.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Grove Test"', { cwd: dir, stdio: 'pipe' })
  // Initial commit so HEAD exists
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n')
  execSync('git add README.md', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
}

// ---------------------------------------------------------------------------
// stagedDiffStat
// ---------------------------------------------------------------------------

describe('stagedDiffStat', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    removeTmp(tmpDir)
  })

  it('returns null for a non-git directory', () => {
    const result = stagedDiffStat(tmpDir)
    expect(result).toBeNull()
  })

  it('returns null when nothing is staged', () => {
    makeGitRepo(tmpDir)
    const result = stagedDiffStat(tmpDir)
    expect(result).toBeNull()
  })

  it('returns file list and counts when a new test file is staged', () => {
    makeGitRepo(tmpDir)
    // Stage a test file
    const testFile = path.join(tmpDir, 'foo.test.ts')
    fs.writeFileSync(testFile, 'it("works", () => {})\n')
    execSync('git add foo.test.ts', { cwd: tmpDir, stdio: 'pipe' })

    const result = stagedDiffStat(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.files).toContain('foo.test.ts')
    expect(result!.insertions).toBeGreaterThan(0)
  })

  it('counts deletions when a file is partially deleted and staged', () => {
    makeGitRepo(tmpDir)
    // Stage a modified README with fewer lines
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '') // delete all content
    execSync('git add README.md', { cwd: tmpDir, stdio: 'pipe' })

    const result = stagedDiffStat(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.deletions).toBeGreaterThan(0)
  })

  it('lists multiple staged files', () => {
    makeGitRepo(tmpDir)
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const a = 1\n')
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'const b = 2\n')
    execSync('git add a.ts b.ts', { cwd: tmpDir, stdio: 'pipe' })

    const result = stagedDiffStat(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.files.length).toBe(2)
  })

  it('degrades gracefully (returns null) when git is unavailable path-wise', () => {
    // Pass a directory that exists but isn't a git repo
    const plain = makeTmpDir()
    try {
      const result = stagedDiffStat(plain)
      expect(result).toBeNull()
    } finally {
      removeTmp(plain)
    }
  })
})

// ---------------------------------------------------------------------------
// createStashSnapshot
// ---------------------------------------------------------------------------

describe('createStashSnapshot', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    removeTmp(tmpDir)
  })

  it('returns null for a non-git directory', () => {
    const result = createStashSnapshot(tmpDir)
    expect(result).toBeNull()
  })

  it('returns null (or { ref: "" }) on a clean repo with nothing to snapshot', () => {
    makeGitRepo(tmpDir)
    // Nothing modified — stash create returns empty
    const result = createStashSnapshot(tmpDir)
    // Either null or empty ref is acceptable
    expect(result === null || result?.ref === '').toBe(true)
  })

  it('returns a { ref } with a non-empty SHA when there are changes', () => {
    makeGitRepo(tmpDir)
    // Add an unstaged change
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# changed\n')

    const result = createStashSnapshot(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.ref).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('leaves the working tree BYTE-IDENTICAL (non-destructive)', () => {
    makeGitRepo(tmpDir)
    const filePath = path.join(tmpDir, 'README.md')
    const newContent = '# changed content for snapshot test\n'
    fs.writeFileSync(filePath, newContent)
    // Stage a change too to test fully
    fs.writeFileSync(path.join(tmpDir, 'extra.ts'), 'export const x = 1\n')
    execSync('git add extra.ts', { cwd: tmpDir, stdio: 'pipe' })

    // Capture git status + file bytes BEFORE
    const statusBefore = execSync('git status --porcelain', { cwd: tmpDir }).toString()
    const bytesBefore = fs.readFileSync(filePath)

    createStashSnapshot(tmpDir)

    // Capture AFTER
    const statusAfter = execSync('git status --porcelain', { cwd: tmpDir }).toString()
    const bytesAfter = fs.readFileSync(filePath)

    // Working tree and index must be identical
    expect(statusAfter).toBe(statusBefore)
    expect(bytesAfter.equals(bytesBefore)).toBe(true)
  })

  it('does NOT modify the working tree (never runs plain git stash)', () => {
    // This is the critical safety guarantee for ADR-0008
    makeGitRepo(tmpDir)
    fs.writeFileSync(path.join(tmpDir, 'dirty.ts'), 'const x = "dirty"\n')

    const statusBefore = execSync('git status --porcelain', { cwd: tmpDir }).toString()
    createStashSnapshot(tmpDir)
    const statusAfter = execSync('git status --porcelain', { cwd: tmpDir }).toString()

    expect(statusAfter).toBe(statusBefore)
  })
})

// ---------------------------------------------------------------------------
// shell-injection safety (git helper)
// ---------------------------------------------------------------------------

describe('git helper — shell injection safety', () => {
  it('does not execute injected shell commands when repoDir contains special chars', () => {
    // Create a parent temp dir, then a subdirectory whose NAME contains shell
    // metacharacters: a double-quote and a semicolon followed by a command.
    // Under the old execSync(`git -C "${repoDir}" ${args}`) implementation the
    // double-quote would close the -C argument and the semicolon would start a
    // fresh shell command, creating a marker file.
    const parent = makeTmpDir()
    try {
      // Subdir name designed to break out of a quoted shell argument
      const injectedName = 'a";touch INJECTED #'
      const repoDir = path.join(parent, injectedName)
      fs.mkdirSync(repoDir)
      makeGitRepo(repoDir)

      // Call a read-only helper that exercises the git() internal helper
      const branch = currentBranch(repoDir)

      // Must return a valid branch name (not null, not an error)
      expect(branch).not.toBeNull()
      expect(['main', 'master']).toContain(branch)

      // The injected command must NOT have run — no INJECTED file anywhere
      const injectedInParent = path.join(parent, 'INJECTED')
      const injectedInCwd = path.join(process.cwd(), 'INJECTED')
      expect(fs.existsSync(injectedInParent)).toBe(false)
      expect(fs.existsSync(injectedInCwd)).toBe(false)
    } finally {
      removeTmp(parent)
      // Clean up if injection somehow placed INJECTED in cwd
      const cwd = path.join(process.cwd(), 'INJECTED')
      if (fs.existsSync(cwd)) fs.rmSync(cwd)
    }
  })

  it('does not execute $() command substitution in the repo path (single-quote + $())', () => {
    // Adversarial directory path: a single quote (to break out of a single-
    // quoted shell arg) followed by a $(touch <sentinel>) substitution. Under a
    // shell-string exec this would create the sentinel; with execFileSync (no
    // shell) it is just a literal directory name.
    const parent = makeTmpDir()
    // BARE sentinel filename so the $() payload has no `/` (a path component
    // cannot contain a separator). A leaked exec would drop it in cwd/parent/repo.
    const SENTINEL = 'GITUTILS_PWNED'
    const injectedName = `repo'$(touch ${SENTINEL})`
    try {
      const repoDir = path.join(parent, injectedName)
      fs.mkdirSync(repoDir)
      makeGitRepo(repoDir)

      // Stage a change so stagedDiffStat / createStashSnapshot have work to do.
      fs.writeFileSync(path.join(repoDir, 'x.ts'), 'export const x = 1\n')
      execFileSync('git', ['-C', repoDir, 'add', 'x.ts'], { stdio: 'pipe' })

      // Exercise every read-only helper against the hostile path.
      const branch = currentBranch(repoDir)
      const diff = stagedDiffStat(repoDir)
      const snap = createStashSnapshot(repoDir)

      // The substitution must NEVER have executed (check every plausible cwd).
      expect(fs.existsSync(path.join(process.cwd(), SENTINEL))).toBe(false)
      expect(fs.existsSync(path.join(parent, SENTINEL))).toBe(false)
      expect(fs.existsSync(path.join(repoDir, SENTINEL))).toBe(false)

      // And the helpers must still WORK through the hostile path.
      expect(['main', 'master']).toContain(branch)
      expect(diff).not.toBeNull()
      expect(diff!.files).toContain('x.ts')
      expect(snap).not.toBeNull()
    } finally {
      removeTmp(parent)
      const cwdSentinel = path.join(process.cwd(), SENTINEL)
      if (fs.existsSync(cwdSentinel)) fs.rmSync(cwdSentinel)
    }
  })
})

// ---------------------------------------------------------------------------
// currentBranch
// ---------------------------------------------------------------------------

describe('currentBranch', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    removeTmp(tmpDir)
  })

  it('returns null for a non-git directory', () => {
    const result = currentBranch(tmpDir)
    expect(result).toBeNull()
  })

  it('returns a non-empty string for a git repo on a branch', () => {
    makeGitRepo(tmpDir)
    const result = currentBranch(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })

  it('returns "main" or "master" for a freshly-inited repo', () => {
    makeGitRepo(tmpDir)
    const result = currentBranch(tmpDir)
    expect(['main', 'master']).toContain(result)
  })

  it('reflects a new branch after checkout', () => {
    makeGitRepo(tmpDir)
    execSync('git checkout -b feat/my-feature', { cwd: tmpDir, stdio: 'pipe' })
    const result = currentBranch(tmpDir)
    expect(result).toBe('feat/my-feature')
  })
})

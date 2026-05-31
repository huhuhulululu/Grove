/**
 * git-utils.ts — read-only git helpers for the Grove CLI.
 *
 * All functions are wrapped in try/catch and degrade gracefully (return null)
 * when git is unavailable, the directory is not a git repo, or any other
 * failure occurs. NON-DESTRUCTIVE by design: nothing here modifies the
 * working tree or the index.
 *
 * ADR-0005 / ADR-0008 compliance:
 *  - createStashSnapshot uses `git stash create` (object creation only) —
 *    never `git stash push/pop` which would modify the tree.
 *  - All other helpers are pure reads.
 */

import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffStat {
  /** Files touched in the staged diff (name-only). */
  files: string[]
  /** Total inserted lines across all staged files. */
  insertions: number
  /** Total deleted lines across all staged files. */
  deletions: number
}

export interface StashSnapshot {
  /**
   * The commit SHA produced by `git stash create`, capturing the working state
   * WITHOUT touching the working tree or index. Empty string when git returned
   * no output (nothing to snapshot).
   */
  ref: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a git command in repoDir; return stdout trimmed or null on any error. */
function git(repoDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repoDir, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// stagedDiffStat
// ---------------------------------------------------------------------------

/**
 * Return stats about what's currently in the git index (staged), or null if
 * the directory is not a git repo or nothing is staged.
 *
 * Uses two separate git reads:
 *  - `git diff --cached --numstat` for insertion/deletion counts
 *  - `git diff --cached --name-only` for the file list (handles renames)
 */
export function stagedDiffStat(repoDir: string): DiffStat | null {
  try {
    const numstat = git(repoDir, ['diff', '--cached', '--numstat'])
    if (numstat === null || numstat === '') return null

    let insertions = 0
    let deletions = 0
    for (const line of numstat.split('\n')) {
      if (line.trim() === '') continue
      const parts = line.split('\t')
      const ins = parseInt(parts[0] ?? '0', 10)
      const del = parseInt(parts[1] ?? '0', 10)
      if (!isNaN(ins)) insertions += ins
      if (!isNaN(del)) deletions += del
    }

    const nameOnly = git(repoDir, ['diff', '--cached', '--name-only'])
    if (nameOnly === null || nameOnly === '') return null

    const files = nameOnly.split('\n').filter((f) => f.trim() !== '')

    return { files, insertions, deletions }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// createStashSnapshot
// ---------------------------------------------------------------------------

/**
 * Create a stash object capturing the current working state WITHOUT modifying
 * the working tree or the index. Returns the commit SHA or null.
 *
 * Uses `git stash create` which creates a stash commit object and prints its
 * SHA — it DOES NOT call `git stash push/pop` and therefore NEVER modifies the
 * tree. When there is nothing to snapshot (clean repo) git returns empty output;
 * in that case we return `{ ref: '' }` so callers can distinguish "clean" from
 * "error" (both are safe).
 *
 * ADR-0008 SAFETY BOUNDARY: NEVER run plain `git stash` here.
 */
export function createStashSnapshot(repoDir: string): StashSnapshot | null {
  try {
    const out = git(repoDir, ['stash', 'create'])
    if (out === null) return null
    // out is either a SHA (40 hex chars) or '' (nothing to stash)
    return { ref: out }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// currentBranch
// ---------------------------------------------------------------------------

/**
 * Return the name of the current git branch, or null if the directory is not
 * a git repo or git is unavailable.
 */
export function currentBranch(repoDir: string): string | null {
  try {
    const result = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (result === null || result === '' || result === 'HEAD') return null
    return result
  } catch {
    return null
  }
}

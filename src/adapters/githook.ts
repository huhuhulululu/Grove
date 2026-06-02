/**
 * githook.ts — chain-safe git post-commit adapter (ADR-0004).
 *
 * Impure adapter: uses node:fs / node:path / node:child_process. This is allowed
 * here (adapter layer); the engine stays pure.
 *
 * The whole point of ADR-0004: installing Grove's hook must NEVER disable a
 * developer's existing git hooks or hook framework (husky / lefthook / a hand-
 * written post-commit). We therefore:
 *  - honor `core.hooksPath` (husky/lefthook set this) so we write where the
 *    framework actually looks, not into the now-bypassed .git/hooks;
 *  - chain (append) onto any pre-existing hook, preserving it verbatim;
 *  - delimit our contribution with sentinels so install is idempotent and
 *    uninstall can surgically remove ONLY our block;
 *  - emit `... || true` so a Grove failure can never block a commit.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Sentinels — delimit Grove's contribution to a (possibly shared) hook file.
// ---------------------------------------------------------------------------

export const GROVE_BEGIN = '# >>> grove >>>'
export const GROVE_END = '# <<< grove <<<'

// ---------------------------------------------------------------------------
// resolveHooksDir
// ---------------------------------------------------------------------------

/**
 * Resolve the directory git will look in for hooks.
 *
 * If `core.hooksPath` is set (husky/lefthook do this), resolve it relative to
 * `repoDir` and return that — writing into .git/hooks would be silently ignored
 * by git in that case. Otherwise return `<repoDir>/.git/hooks`.
 *
 * git is wrapped in try/catch: a missing repo or missing git binary falls back
 * to the default .git/hooks rather than throwing.
 */
export function resolveHooksDir(repoDir: string): string {
  try {
    // execFileSync (no shell): repoDir is a literal argv element — a path with
    // quotes / `$()` / `;` cannot inject a command here.
    const out = execFileSync('git', ['-C', repoDir, 'config', '--get', 'core.hooksPath'], {
      stdio: 'pipe',
    })
      .toString('utf-8')
      .trim()
    if (out) {
      // git returns the configured value verbatim; resolve relative paths
      // against the repo so callers get an absolute, usable directory.
      return path.isAbsolute(out) ? out : path.join(repoDir, out)
    }
  } catch {
    // not a repo / git unavailable / key unset → fall through to default
  }
  return path.join(repoDir, '.git', 'hooks')
}

// ---------------------------------------------------------------------------
// buildHookBlock
// ---------------------------------------------------------------------------

/**
 * Build the sentinel-delimited POSIX-sh block Grove contributes to a hook.
 *
 * The `|| true` is load-bearing: it guarantees that a Grove failure (bad binary,
 * crash, anything) NEVER causes the post-commit hook to exit non-zero, so the
 * developer's commit is never blocked by the game layer.
 *
 * PORTABILITY + ISOLATION: the repo dir is resolved at RUNTIME via
 * `git rev-parse --show-toplevel`, not hardcoded as the install-time absolute
 * path. This (a) keeps the developer's machine path OUT of the hook file — so if
 * the hook lives in a tracked dir (husky/lefthook `.husky/`) and gets committed,
 * no absolute home path leaks into the shared repo — and (b) makes the hook
 * correct on any clone/worktree. No external value is interpolated into the shell
 * line, so there is no command-substitution surface at all.
 */
export function buildHookBlock(invocation: string): string {
  return [
    GROVE_BEGIN,
    `${invocation} commit-hook --repo "$(git rev-parse --show-toplevel)" 2>/dev/null || true`,
    GROVE_END,
  ].join('\n')
}

/**
 * Build the post-MERGE block. HEURISTIC (load-bearing): git runs post-merge after the
 * merge step of BOTH `git merge` AND `git pull`, so we must NOT fire on a routine
 * fast-forward pull. We gate on `git rev-parse --verify -q HEAD^2` — which succeeds
 * ONLY when HEAD is a real merge COMMIT (has a 2nd parent), and fails for a single-
 * parent fast-forward/squash/rebase. So a `git pull --ff` never emits pr_merged. Same
 * `|| true` fail-open + runtime-resolved repo (no machine path leaked) as the commit block.
 */
export function buildMergeHookBlock(invocation: string): string {
  return [
    GROVE_BEGIN,
    `if git rev-parse --verify -q HEAD^2 >/dev/null 2>&1; then ${invocation} merge-hook --repo "$(git rev-parse --show-toplevel)" 2>/dev/null || true; fi`,
    GROVE_END,
  ].join('\n')
}

/**
 * True when the resolved hooks dir is a TRACKED part of the working tree (e.g.
 * husky/lefthook point `core.hooksPath` at `.husky`), as opposed to the untracked
 * `.git/hooks`. A hook installed into a tracked dir can be `git add`ed, committed,
 * and shared with the team — so the caller warns. Pure path arithmetic, no I/O.
 */
export function hooksDirInWorktree(repoDir: string, hooksDir: string): boolean {
  const rel = path.relative(repoDir, hooksDir)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false
  return rel.split(path.sep)[0] !== '.git'
}

// ---------------------------------------------------------------------------
// installPostCommit
// ---------------------------------------------------------------------------

/**
 * Generic chain-safe installer for a named hook with a prebuilt sentinel block.
 * Shared by installPostCommit + installPostMerge — same create/chain/idempotent
 * semantics (ADR-0004), parameterized only by the hook file name + the block.
 */
function installHookFile(
  repoDir: string,
  hookName: string,
  block: string,
): { action: 'created' | 'chained' | 'already'; hookPath: string; inWorktree: boolean } {
  const hooksDir = resolveHooksDir(repoDir)
  fs.mkdirSync(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, hookName)
  // A tracked hooks dir (husky/lefthook `.husky`) means the hook file can be
  // committed + shared; `.git/hooks` (the default) is never tracked. The caller
  // warns in the former case. The hook itself carries no machine path either way.
  const inWorktree = hooksDirInWorktree(repoDir, hooksDir)

  if (!fs.existsSync(hookPath)) {
    // Fresh hook: shebang + our block.
    fs.writeFileSync(hookPath, `#!/bin/sh\n\n${block}\n`, { mode: 0o755 })
    return { action: 'created', hookPath, inWorktree }
  }

  const existing = fs.readFileSync(hookPath, 'utf-8')

  if (existing.includes(GROVE_BEGIN)) {
    // Already installed — idempotent no-op, never duplicate.
    return { action: 'already', hookPath, inWorktree }
  }

  // Someone else's hook (e.g. husky). Append our block, preserving theirs verbatim.
  fs.appendFileSync(hookPath, `\n${block}\n`)
  ensureExecutable(hookPath)
  return { action: 'chained', hookPath, inWorktree }
}

export function installPostCommit(
  repoDir: string,
  invocation: string,
): { action: 'created' | 'chained' | 'already'; hookPath: string; inWorktree: boolean } {
  return installHookFile(repoDir, 'post-commit', buildHookBlock(invocation))
}

/** Chain-safe install of the post-MERGE hook (auto-emits pr_merged on a real merge). */
export function installPostMerge(
  repoDir: string,
  invocation: string,
): { action: 'created' | 'chained' | 'already'; hookPath: string; inWorktree: boolean } {
  return installHookFile(repoDir, 'post-merge', buildMergeHookBlock(invocation))
}

// ---------------------------------------------------------------------------
// uninstallPostCommit
// ---------------------------------------------------------------------------

function uninstallHookFile(
  repoDir: string,
  hookName: string,
): { action: 'removed' | 'unchained' | 'absent'; hookPath: string } {
  const hooksDir = resolveHooksDir(repoDir)
  const hookPath = path.join(hooksDir, hookName)

  if (!fs.existsSync(hookPath)) {
    return { action: 'absent', hookPath }
  }

  const content = fs.readFileSync(hookPath, 'utf-8')
  if (!content.includes(GROVE_BEGIN)) {
    return { action: 'absent', hookPath }
  }

  const stripped = stripBlock(content)

  // If only a shebang and/or whitespace remains, the hook was grove-only → delete it.
  if (isShebangOrBlankOnly(stripped)) {
    fs.rmSync(hookPath, { force: true })
    return { action: 'removed', hookPath }
  }

  // Otherwise another hook coexists — write back the remainder, preserving it.
  fs.writeFileSync(hookPath, stripped, { mode: 0o755 })
  return { action: 'unchained', hookPath }
}

export function uninstallPostCommit(
  repoDir: string,
): { action: 'removed' | 'unchained' | 'absent'; hookPath: string } {
  return uninstallHookFile(repoDir, 'post-commit')
}

/** Remove ONLY Grove's block from the post-merge hook (preserving any other hook). */
export function uninstallPostMerge(
  repoDir: string,
): { action: 'removed' | 'unchained' | 'absent'; hookPath: string } {
  return uninstallHookFile(repoDir, 'post-merge')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Remove exactly the GROVE_BEGIN..GROVE_END block (inclusive) from `content`.
 * Also collapses the surrounding blank-line padding our installer added so the
 * remaining content does not accumulate stray empty lines across cycles.
 */
function stripBlock(content: string): string {
  const startIdx = content.indexOf(GROVE_BEGIN)
  if (startIdx === -1) return content

  const endMarkerIdx = content.indexOf(GROVE_END, startIdx)
  if (endMarkerIdx === -1) {
    // Malformed (no END) — strip from BEGIN to end of file to be safe.
    return content.slice(0, startIdx).replace(/\n+$/, '\n').replace(/^\n+|\n+$/g, '\n')
  }

  // Extend the end to consume the END line itself.
  let endIdx = endMarkerIdx + GROVE_END.length
  // Consume a trailing newline that belonged to the END line.
  if (content[endIdx] === '\n') endIdx++

  // Trim trailing blank padding we inserted before the block when chaining.
  let before = content.slice(0, startIdx)
  before = before.replace(/\n+$/, '\n')

  const after = content.slice(endIdx)

  return `${before}${after}`
}

/** True if the content is only a shebang line and/or whitespace. */
function isShebangOrBlankOnly(content: string): boolean {
  const meaningful = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#!'))
  return meaningful.length === 0
}

/** chmod 0o755 the file, ignoring platforms where it is a no-op. */
function ensureExecutable(file: string): void {
  try {
    fs.chmodSync(file, 0o755)
  } catch {
    // best-effort — some filesystems / platforms don't support chmod
  }
}

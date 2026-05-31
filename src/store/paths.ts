import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { hashStringToSeed } from '../core/rng'

/**
 * Returns the root directory for all Grove state.
 * Respects the GROVE_HOME environment variable; defaults to ~/.grove.
 */
export function groveHome(): string {
  return process.env['GROVE_HOME'] ?? path.join(os.homedir(), '.grove')
}

/**
 * Derives a stable, filesystem-safe per-project key from a directory path.
 *
 * Algorithm:
 * 1. Start at `cwd` (defaults to process.cwd()).
 * 2. Walk up the directory tree looking for a `.git` entry (file or dir).
 * 3. `base` = the directory containing `.git`, or `cwd` if none is found.
 * 4. Return `${path.basename(base)}-${hashStringToSeed(base).toString(16)}`
 *
 * The hex suffix makes the key unique even if two projects share a basename,
 * and eliminates all path separators, making it safe as a directory name.
 */
export function repoKey(cwd?: string): string {
  const start = cwd ?? process.cwd()
  const base = findGitRoot(start) ?? start
  const slug = path.basename(base)
  const hash = hashStringToSeed(base).toString(16)
  return `${slug}-${hash}`
}

/**
 * Returns the directory where Grove stores state for a specific project.
 * Defaults: home = groveHome(), key = repoKey().
 */
export function stateDir(home?: string, key?: string): string {
  return path.join(home ?? groveHome(), key ?? repoKey())
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Walk up from `dir` to the filesystem root, returning the first directory
 * that contains a `.git` entry. Returns `null` if none is found.
 */
function findGitRoot(dir: string): string | null {
  let current = path.resolve(dir)
  while (true) {
    try {
      fs.accessSync(path.join(current, '.git'))
      return current
    } catch {
      // .git not found here — try parent
    }
    const parent = path.dirname(current)
    if (parent === current) {
      // Reached filesystem root without finding .git
      return null
    }
    current = parent
  }
}

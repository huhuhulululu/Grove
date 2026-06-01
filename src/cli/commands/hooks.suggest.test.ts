/**
 * hooks.suggest.test.ts · unit tests for the pure suggest-commit helpers.
 *
 * These helpers live in hooks.ts but are tested in isolation here so that
 * the conventional-commit inference rules have clear, fast coverage without
 * spinning up a real git repo.
 */

import { describe, it, expect } from 'vitest'
import { inferCommitType, inferCommitScope } from './hooks'

// ---------------------------------------------------------------------------
// inferCommitType
// ---------------------------------------------------------------------------

describe('inferCommitType', () => {
  it('returns "test" when a .test.ts file is staged', () => {
    expect(inferCommitType(['src/engine/reduce.test.ts'])).toBe('test')
  })

  it('returns "test" when a .spec.ts file is staged', () => {
    expect(inferCommitType(['src/cli/sq.spec.ts'])).toBe('test')
  })

  it('returns "test" for a file inside __tests__', () => {
    expect(inferCommitType(['src/__tests__/util.ts'])).toBe('test')
  })

  it('returns "docs" for a staged .md file', () => {
    expect(inferCommitType(['docs/GUIDE.md'])).toBe('docs')
  })

  it('returns "docs" for a staged CHANGELOG file', () => {
    expect(inferCommitType(['CHANGELOG'])).toBe('docs')
  })

  it('returns "chore" for a staged package.json', () => {
    expect(inferCommitType(['package.json'])).toBe('chore')
  })

  it('returns "chore" for tsconfig', () => {
    expect(inferCommitType(['tsconfig.json'])).toBe('chore')
  })

  it('returns "feat" for a normal source file', () => {
    expect(inferCommitType(['src/engine/reduce.ts'])).toBe('feat')
  })

  it('test wins over docs when both are present', () => {
    expect(inferCommitType(['docs/GUIDE.md', 'src/foo.test.ts'])).toBe('test')
  })

  it('docs wins over chore when both are present', () => {
    expect(inferCommitType(['package.json', 'docs/README.md'])).toBe('docs')
  })

  it('returns "fix" when the filename contains "fix"', () => {
    expect(inferCommitType(['src/engine/fix-race.ts'])).toBe('fix')
  })
})

// ---------------------------------------------------------------------------
// inferCommitScope
// ---------------------------------------------------------------------------

describe('inferCommitScope', () => {
  it('returns null for an empty file list', () => {
    expect(inferCommitScope([])).toBeNull()
  })

  it('returns the top-level dir when all files share one', () => {
    expect(inferCommitScope(['src/engine/reduce.ts', 'src/engine/gear.ts'])).toBe('src')
  })

  it('returns the top-level dir for a single nested file', () => {
    expect(inferCommitScope(['src/cli/commands/hooks.ts'])).toBe('src')
  })

  it('returns null when files span multiple top-level dirs', () => {
    expect(inferCommitScope(['src/engine/reduce.ts', 'docs/GUIDE.md'])).toBeNull()
  })

  it('returns null when files are at the repo root (no slash)', () => {
    expect(inferCommitScope(['package.json', 'README.md'])).toBeNull()
  })

  it('handles a single root-level file', () => {
    expect(inferCommitScope(['README.md'])).toBeNull()
  })

  it('returns "docs" when all files are under docs/', () => {
    expect(inferCommitScope(['docs/GUIDE.md', 'docs/decisions.md'])).toBe('docs')
  })

  it('handles Windows-style backslash separators', () => {
    expect(inferCommitScope(['src\\engine\\reduce.ts', 'src\\cli\\sq.ts'])).toBe('src')
  })

  it('a test file inside src still returns "src" as scope', () => {
    expect(inferCommitScope(['src/engine/reduce.test.ts'])).toBe('src')
    expect(inferCommitType(['src/engine/reduce.test.ts'])).toBe('test')
  })
})

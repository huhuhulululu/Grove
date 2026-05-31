import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { groveHome, repoKey, stateDir } from './paths'

// ---------------------------------------------------------------------------
// groveHome
// ---------------------------------------------------------------------------

describe('groveHome', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env['GROVE_HOME']
  })

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['GROVE_HOME']
    } else {
      process.env['GROVE_HOME'] = savedEnv
    }
  })

  it('returns the default ~/.grove when GROVE_HOME is not set', () => {
    delete process.env['GROVE_HOME']
    expect(groveHome()).toBe(path.join(os.homedir(), '.grove'))
  })

  it('respects GROVE_HOME when set', () => {
    process.env['GROVE_HOME'] = '/custom/grove/path'
    expect(groveHome()).toBe('/custom/grove/path')
  })

  it('returns the GROVE_HOME value verbatim, no trailing slash', () => {
    process.env['GROVE_HOME'] = '/my/grove'
    expect(groveHome()).toBe('/my/grove')
  })
})

// ---------------------------------------------------------------------------
// repoKey
// ---------------------------------------------------------------------------

describe('repoKey', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('is stable: same input path always produces the same key', () => {
    const key1 = repoKey(tmpDir)
    const key2 = repoKey(tmpDir)
    expect(key1).toBe(key2)
  })

  it('differs for two distinct paths', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    try {
      const key1 = repoKey(tmpDir)
      const key2 = repoKey(tmpDir2)
      expect(key1).not.toBe(key2)
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true })
    }
  })

  it('returns a filesystem-safe slug (no path separators)', () => {
    const key = repoKey(tmpDir)
    expect(key).not.toContain('/')
    expect(key).not.toContain('\\')
    expect(key).not.toContain(':')
  })

  it('has the format <basename>-<hex> (slug dash hex)', () => {
    // Use a tmpDir with a known basename that has no hyphens for a clean test
    const namedDir = path.join(tmpDir, 'myproject')
    fs.mkdirSync(namedDir)
    const key = repoKey(namedDir)
    // basename is 'myproject' (no hyphens), so format is <word>-<hex>
    expect(key).toMatch(/^[^-]+-[0-9a-f]+$/)
  })

  it('uses the git root basename when a .git directory exists', () => {
    // Create a fake git root inside tmpDir
    const gitRoot = path.join(tmpDir, 'myproject')
    fs.mkdirSync(gitRoot)
    fs.mkdirSync(path.join(gitRoot, '.git'))
    // A subdirectory inside the git repo
    const subDir = path.join(gitRoot, 'src', 'lib')
    fs.mkdirSync(subDir, { recursive: true })

    const keyFromSub = repoKey(subDir)
    const keyFromRoot = repoKey(gitRoot)

    // Both should resolve to the git root key
    expect(keyFromSub).toBe(keyFromRoot)
    // And the basename portion should be 'myproject'
    expect(keyFromSub.startsWith('myproject-')).toBe(true)
  })

  it('falls back to cwd basename when no .git is found', () => {
    // tmpDir has no .git, so basename(tmpDir) is used
    const key = repoKey(tmpDir)
    const base = path.basename(tmpDir)
    expect(key.startsWith(base + '-')).toBe(true)
  })

  it('uses process.cwd() when no argument is passed', () => {
    const keyWithCwd = repoKey()
    const keyExplicit = repoKey(process.cwd())
    expect(keyWithCwd).toBe(keyExplicit)
  })
})

// ---------------------------------------------------------------------------
// stateDir
// ---------------------------------------------------------------------------

describe('stateDir', () => {
  let tmpDir: string
  let savedEnv: string | undefined

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'))
    savedEnv = process.env['GROVE_HOME']
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    if (savedEnv === undefined) {
      delete process.env['GROVE_HOME']
    } else {
      process.env['GROVE_HOME'] = savedEnv
    }
  })

  it('composes home and key: path.join(home, key)', () => {
    const home = '/some/home'
    const key = 'myproject-deadbeef'
    expect(stateDir(home, key)).toBe(path.join(home, key))
  })

  it('uses groveHome() when home is undefined', () => {
    process.env['GROVE_HOME'] = tmpDir
    const key = 'testkey-abc123'
    expect(stateDir(undefined, key)).toBe(path.join(tmpDir, key))
  })

  it('uses repoKey() when key is undefined', () => {
    const key = repoKey()
    expect(stateDir(tmpDir, undefined)).toBe(path.join(tmpDir, key))
  })

  it('uses both defaults when both are undefined', () => {
    process.env['GROVE_HOME'] = tmpDir
    const expected = path.join(tmpDir, repoKey())
    expect(stateDir()).toBe(expected)
  })

  it('returns a path nested under home', () => {
    const result = stateDir('/custom/home', 'proj-abc123')
    expect(result.startsWith('/custom/home')).toBe(true)
  })
})

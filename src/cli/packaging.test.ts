/**
 * packaging.test.ts — guards the package NAME ↔ README install-command ↔ bin
 * consistency (strategy P0: the published name and the documented install must
 * agree, and the binary the README invokes must be the one package.json declares).
 *
 * Greps the manifest + README text only — no install, no network.
 *
 * Run: npx vitest run src/cli/packaging.test.ts
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const thisFile = url.fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(thisFile), '..', '..')

interface Manifest {
  name: string
  bin: Record<string, string>
}

function readManifest(): Manifest {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
  return JSON.parse(raw) as Manifest
}

function readReadme(): string {
  return fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8')
}

describe('packaging: name ↔ README install ↔ bin are consistent', () => {
  it('package.json name is a publishable, non-empty string', () => {
    const { name } = readManifest()
    expect(typeof name).toBe('string')
    expect(name.length).toBeGreaterThan(0)
    // Lowercase, npm-legal (scoped or plain) — no spaces/uppercase.
    expect(name).toMatch(/^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/)
  })

  it('package.json name is NOT the taken "grove" package', () => {
    // `grove` is already published on npm (v0.4.0) — the install command would
    // pull a stranger's package. The chosen name must be distinct.
    expect(readManifest().name).not.toBe('grove')
  })

  it('the README `npm i -g` command installs the package by its package.json name', () => {
    const { name } = readManifest()
    const readme = readReadme()
    // The global install line must reference the real package name.
    const re = new RegExp(`npm i -g ${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`)
    expect(readme).toMatch(re)
  })

  it('the README does NOT still say `npm i -g grove` (the mismatched/taken name)', () => {
    expect(readReadme()).not.toMatch(/npm i -g grove\b/)
  })

  it('the README npx examples reference the real package name (not "grove")', () => {
    const { name } = readManifest()
    const readme = readReadme()
    // Any `npx -p <pkg>` example must use the real name.
    const npxLines = readme.split('\n').filter((l) => l.includes('npx -p '))
    expect(npxLines.length).toBeGreaterThan(0)
    for (const line of npxLines) {
      expect(line).toContain(`npx -p ${name}`)
    }
  })

  it('the declared bin command (`sq`) is the binary the README invokes', () => {
    const { bin } = readManifest()
    // The global bin is `sq` — every README usage drives `sq <subcommand>`.
    expect(Object.keys(bin)).toContain('sq')
    expect(readReadme()).toMatch(/\bsq (init|dashboard|pull|help)\b/)
  })
})

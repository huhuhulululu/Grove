/**
 * commons-github.test.ts — structural firewall guards for the commons client
 * (ADR-0013). These are SOURCE-grep guards (no network): they prove the adapter
 * is read-only and the handler never ingests, so the engine firewall can never be
 * reached from this surface. Live network calls are deliberately NOT exercised in
 * unit tests (they would be flaky and slow).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { handleCommons } from '../cli/commands/commons'

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')

/** Source with comment lines stripped, so guards scan CODE, not prose describing it. */
const codeOnly = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'))
    })
    .join('\n')

describe('commons-github adapter is strictly read-only (firewall)', () => {
  const src = codeOnly('src/adapters/commons-github.ts')

  it('issues only GET requests — no POST/PUT/PATCH/DELETE', () => {
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/)
  })

  it('never shells out — no child_process / exec / spawn', () => {
    expect(src).not.toMatch(/child_process|execSync|\bexec\(|\bspawn\(/)
  })

  it('never persists the optional token to disk', () => {
    expect(src).not.toMatch(/writeFileSync|appendFileSync/)
  })
})

describe('handleCommons never ingests an event (reward flows only via sq event)', () => {
  it('the handler module imports no ingest path', () => {
    const src = codeOnly('src/cli/commands/commons.ts')
    expect(src).not.toMatch(/ingestEvent|reduce\(|saveState/)
  })

  it('unknown / missing action returns 2 without touching the network', async () => {
    const code = await handleCommons([], {}, '/tmp', false, 'en')
    expect(code).toBe(2)
  })

  it('draft / open without a valid issue number returns 2', async () => {
    expect(await handleCommons(['draft'], {}, '/tmp', false, 'en')).toBe(2)
    expect(await handleCommons(['open', 'x'], {}, '/tmp', false, 'en')).toBe(2)
  })
})

/**
 * portability.ts — `sq export` / `sq import`: own-your-data for the local state.
 *
 * FIREWALL/SAFETY: export is strictly READ-ONLY (loadState + serialize). import is the
 * only writer and is NON-DESTRUCTIVE by construction — it validates via the SAME
 * recovery ladder loadState uses, BACKS UP the current state.json before writing,
 * writes atomically under the per-repo lock, and on ANY read/parse/validate failure
 * returns early WITHOUT touching state. No cloud, no account: pure local file I/O in
 * the CLI layer. No reward is minted (importing is not an "outcome").
 */
import * as fs from 'node:fs'
import { loadState, saveState, validateImported, backupStateFile, withStateLock } from '../../store/store'
import { t } from '../../i18n/t'
import type { Locale } from '../../i18n/types'

/** `sq export [file]` — write the current state as a portable, versioned envelope to a
 *  file (atomic) or stdout. Read-only: never mutates state. */
export function handleExport(positional: string[], dir: string, locale: Locale = 'en'): number {
  const state = loadState(dir)
  const envelope = {
    grove: 'export',
    envelopeVersion: 1,
    exportedStateVersion: state.version,
    state,
  }
  const json = JSON.stringify(envelope, null, 2)

  const outPath = positional[0]
  if (outPath === undefined) {
    // No path → stdout, so it pipes cleanly (the ONLY output).
    console.log(json)
    return 0
  }
  // Atomic write (tmp-then-rename), mirroring saveState.
  const tmp = `${outPath}.tmp`
  fs.writeFileSync(tmp, json, 'utf8')
  fs.renameSync(tmp, outPath)
  console.log(t(locale, 'cli.export.wrote', { path: outPath }))
  return 0
}

/** `sq import <file>` — SAFELY replace local state from a sq-export JSON. Validates +
 *  backs up the current state first; refuses a bad file without changing anything. */
export function handleImport(positional: string[], dir: string, locale: Locale = 'en'): number {
  const inPath = positional[0]
  if (inPath === undefined) {
    console.log(t(locale, 'cli.import.usage'))
    return 2
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(inPath, 'utf8'))
  } catch {
    // Unreadable / not JSON → nothing changed.
    console.log(t(locale, 'cli.import.bad_file'))
    return 1
  }

  // Accept the wrapped export envelope (use its .state) or a bare state object.
  let candidate: unknown = parsed
  if (parsed !== null && typeof parsed === 'object' && (parsed as Record<string, unknown>)['grove'] === 'export') {
    candidate = (parsed as Record<string, unknown>)['state']
  }

  const valid = validateImported(candidate)
  if (valid === null) {
    console.log(t(locale, 'cli.import.invalid'))
    return 1
  }

  // Back up the current state BEFORE the destructive write, then write atomically
  // under the lock so a concurrent ingest can't interleave.
  withStateLock(dir, () => {
    backupStateFile(dir)
    saveState(dir, valid)
  })
  console.log(t(locale, 'cli.import.done', { path: inPath }))
  return 0
}

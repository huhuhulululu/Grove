/**
 * statusline-install.ts — chain-safe Claude Code statusline installer.
 *
 * ADR-0004 applied to the statusline: NEVER clobbers the user's existing
 * statusline. Chain-safe design:
 *
 *  install:
 *    1. Read settings.json, back up the current .statusLine.command as ORIGINAL.
 *    2. Write a small wrapper script that:
 *         a. Reads stdin ONCE into a var.
 *         b. In the BACKGROUND (non-blocking, fail-open || true) pipes the SAME
 *            bytes to `grove statusline-ingest`.
 *         c. Runs the ORIGINAL command with the same stdin bytes, passing its
 *            stdout through byte-for-byte.
 *    3. SURGICALLY set settings.json .statusLine.command to the wrapper (preserve
 *       all other keys exactly).
 *    4. Write a timestamped backup of settings.json before editing.
 *    Idempotent: if already installed, return 'already-installed'.
 *
 *  uninstall:
 *    1. Read settings.json for the stored ORIGINAL command.
 *    2. Restore .statusLine.command to ORIGINAL verbatim.
 *    3. Remove the wrapper script.
 *    Idempotent: if not installed, return 'not-installed'.
 *
 * Impure (node:fs / node:path / node:child_process allowed here — adapter layer).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { shQuote } from './shquote'

// ---------------------------------------------------------------------------
// Sentinel embedded in wrapper so we can detect install state
// ---------------------------------------------------------------------------

const WRAPPER_SENTINEL = '# grove-statusline-wrapper'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InstallResult {
  /** 'installed' | 'already-installed' */
  action: 'installed' | 'already-installed'
  /** The command that was in .statusLine.command before install */
  original: string
}

export interface UninstallResult {
  /** 'uninstalled' | 'not-installed' */
  action: 'uninstalled' | 'not-installed'
}

// ---------------------------------------------------------------------------
// installStatusline
// ---------------------------------------------------------------------------

/**
 * Install Grove's statusline wrapper.
 *
 * @param settingsPath - Absolute path to Claude Code's settings.json.
 * @param wrapperPath  - Absolute path where the wrapper script will be written.
 * @returns            InstallResult with action and the original command.
 */
export function installStatusline(
  settingsPath: string,
  wrapperPath: string,
  ingestCmd = 'grove statusline-ingest',
): InstallResult {
  const settings = readSettings(settingsPath)

  // Extract the current statusLine command (may be absent)
  const sl = isRecord(settings['statusLine']) ? settings['statusLine'] : {}
  const original: string = typeof sl['command'] === 'string' ? sl['command'] : ''

  // Idempotency: if the wrapper already exists and settings already points to it,
  // we're already installed.
  if (sl['command'] === wrapperPath && fs.existsSync(wrapperPath)) {
    return { action: 'already-installed', original }
  }

  // Write a timestamped backup before any mutation. On a first-time install there
  // is no settings.json yet (readSettings already failed soft to {}), so there is
  // nothing to back up — skip it rather than crash on copyFileSync(ENOENT).
  if (fs.existsSync(settingsPath)) {
    const ts = Date.now()
    const backupPath = path.join(path.dirname(settingsPath), `settings.json.bak.${ts}`)
    fs.copyFileSync(settingsPath, backupPath)
  }

  // Write the wrapper script that:
  //  1. reads stdin into a variable
  //  2. background-pipes to grove statusline-ingest (fail-open)
  //  3. runs the original command with the same stdin bytes, passes stdout through
  const wrapper = buildWrapper(original, wrapperPath, ingestCmd)
  fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755, encoding: 'utf-8' })

  // Surgically set ONLY settings.statusLine.command, preserving all other keys.
  const newSl: Record<string, unknown> = { ...sl, command: wrapperPath }
  const newSettings: Record<string, unknown> = { ...settings, statusLine: newSl }
  fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8')

  return { action: 'installed', original }
}

// ---------------------------------------------------------------------------
// uninstallStatusline
// ---------------------------------------------------------------------------

/**
 * Uninstall Grove's statusline wrapper, restoring the original command.
 *
 * @param settingsPath - Absolute path to Claude Code's settings.json.
 * @returns            UninstallResult with action taken.
 */
export function uninstallStatusline(settingsPath: string): UninstallResult {
  const settings = readSettings(settingsPath)
  const sl = isRecord(settings['statusLine']) ? settings['statusLine'] : {}
  const currentCommand: string = typeof sl['command'] === 'string' ? sl['command'] : ''

  // Check if currently pointing to a grove wrapper
  if (!isGroveWrapper(currentCommand)) {
    return { action: 'not-installed' }
  }

  // Read the original command from the wrapper script
  const original = extractOriginalFromWrapper(currentCommand)

  // Restore the original command in settings
  const newSl: Record<string, unknown> = { ...sl, command: original }
  const newSettings: Record<string, unknown> = { ...settings, statusLine: newSl }
  fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8')

  // Remove the wrapper script if it exists
  try {
    fs.unlinkSync(currentCommand)
  } catch {
    // wrapper already gone — fine
  }

  return { action: 'uninstalled' }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip characters that could break the single-line `# grove-original:` comment
 * (and the human-readable "Original command backed up:" line) out of the script.
 *
 * SECURITY (P0): the stored-original lines are COMMENTS. A newline in `original`
 * would terminate the comment and turn the remainder into an executable script
 * statement (and would also corrupt the value `extractOriginalFromWrapper`
 * parses back). We collapse CR/LF to spaces so the comment stays exactly one
 * line and round-trips cleanly. Quotes are harmless inside a `#` comment.
 */
function sanitizeComment(s: string): string {
  return s.replace(/[\r\n]+/g, ' ')
}

/**
 * Build the wrapper shell script content.
 *
 * The wrapper:
 *  1. Reads stdin ONCE into $INPUT.
 *  2. In the background (non-blocking, || true fail-open) pipes $INPUT to the
 *     grove ingest command. The command is executed via `sh -c <shQuoted>` so any
 *     special characters in its arguments (e.g. a grove-home path containing a
 *     quote or `$()`) are a single literal argument and cannot inject.
 *  3. Runs the ORIGINAL command (the chain) with $INPUT piped as stdin, also via
 *     `sh -c <shQuoted>`, passing stdout through byte-for-byte. The original IS
 *     intentionally executed, but `sh -c` + single-quoting keeps its placement
 *     from breaking the surrounding script structure.
 *
 * Note: if original is empty (no prior command), step 3 runs `true` (no-op).
 */
function buildWrapper(original: string, wrapperPath: string, ingestCmd: string): string {
  const originalCmd = original || 'true'
  return [
    '#!/bin/sh',
    WRAPPER_SENTINEL,
    `# Grove statusline chain wrapper — DO NOT EDIT (grove manages this file)`,
    `# Original command backed up: ${sanitizeComment(original) || '(none)'}`,
    ``,
    `# Read stdin once into a variable so it can be replayed`,
    `INPUT=$(cat)`,
    ``,
    `# background: pipe to grove for energy ingestion (fail-open, never blocks the HUD)`,
    `# grove-original: ${sanitizeComment(original)}`,
    `printf '%s' "$INPUT" | sh -c ${shQuote(ingestCmd)} 2>/dev/null &`,
    ``,
    `# Pass through to the ORIGINAL command (byte-for-byte stdout passthrough)`,
    `printf '%s' "$INPUT" | sh -c ${shQuote(originalCmd)}`,
  ].join('\n') + '\n'
}

/**
 * Returns true if `command` points to a grove wrapper script that we wrote
 * (identified by the sentinel line).
 */
function isGroveWrapper(command: string): boolean {
  if (!command || !fs.existsSync(command)) return false
  try {
    const content = fs.readFileSync(command, 'utf-8')
    return content.includes(WRAPPER_SENTINEL)
  } catch {
    return false
  }
}

/**
 * Parse the ORIGINAL command out of a grove wrapper script.
 * Reads the `# grove-original:` comment line.
 * Returns '' if parsing fails (safe default).
 */
function extractOriginalFromWrapper(wrapperPath: string): string {
  try {
    const content = fs.readFileSync(wrapperPath, 'utf-8')
    const match = content.match(/^# grove-original: (.*)$/m)
    if (match) {
      return match[1]?.trim() ?? ''
    }
  } catch {
    // fall through
  }
  return ''
}

/** Read and JSON-parse settings.json; return {} on any error. */
function readSettings(settingsPath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

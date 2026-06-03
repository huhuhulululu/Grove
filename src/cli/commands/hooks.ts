/**
 * commands/hooks.ts · integration handlers — the git post-commit hook (init /
 * uninstall / commit-hook), the Claude Code statusline (ingest / install /
 * uninstall), suggest-commit, and checkpoint.
 *
 * Impure shell (ADR-0005): installs/removes generated scripts (never clobbers ·
 * always chains), reads stdin, and ingests events through the pure engine. Grove
 * failures NEVER block a commit · the hook is fail-open by design.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadState, saveState, withStateLock, rotateBackups } from '../../store/store'
import { ingestEvent } from '../../app/ingest'
import { scanRepo } from '../../detect/pillarb'
import {
  installPostCommit,
  uninstallPostCommit,
  installPostMerge,
  uninstallPostMerge,
} from '../../adapters/githook'
import { parseStatuslinePayload } from '../../adapters/statusline'
import { installStatusline, uninstallStatusline } from '../../adapters/statusline-install'
import { renderStatuslineSegment } from '../../render/statusline-segment'
import { stagedDiffStat, createStashSnapshot, currentBranch, isMergeCommit } from '../../adapters/git-utils'
import { t } from '../../i18n/t'
import type { Locale } from '../../i18n/types'
import {
  calmConfirm,
  groveInvocation,
  detectAiClis,
  printContextualOffers,
  maybePush,
  printRewards,
} from './shared'

// ---------------------------------------------------------------------------
// init / uninstall (the post-commit git hook)
// ---------------------------------------------------------------------------

/** Starter seeds granted ONCE on first `sq init` so the dashboard isn't empty. */
const STARTER_SEEDS = 40

/**
 * Grant the first-run starter exactly once. Idempotency is tracked by an
 * `.onboarded` marker file in the grove state dir (the impure shell) · so a
 * second `init` never re-grants, and the engine state shape is untouched. The
 * grant is COSMETIC seeds only (ADR-0005). Returns true if it granted this call.
 */
function grantStarterOnce(dir: string): boolean {
  const marker = path.join(dir, '.onboarded')
  return withStateLock(dir, () => {
    if (fs.existsSync(marker)) return false
    const state = loadState(dir)
    saveState(dir, {
      ...state,
      player: { ...state.player, currency: state.player.currency + STARTER_SEEDS },
    })
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(marker, new Date().toISOString() + '\n', 'utf8')
    } catch {
      // Non-fatal: if the marker can't be written, worst case is a re-grant on
      // the next init · never a crash, never a blocked install.
    }
    return true
  })
}

export function handleInit(flags: Record<string, string>, dir: string, locale: Locale = 'en'): number {
  const repo = flags['repo'] ?? process.cwd()
  const res = installPostCommit(repo, groveInvocation())
  // Also chain the post-merge hook so a REAL PR merge (a merge commit) auto-drops loot
  // without a manual `sq event pr_merged`. Chain-safe + fail-open like post-commit.
  installPostMerge(repo, groveInvocation())

  let message: string
  if (res.action === 'created') {
    message = `Grove post-commit hook installed.`
  } else if (res.action === 'chained') {
    message = `Grove chained onto your existing hook · your existing hooks are preserved.`
  } else {
    message = `Grove hook already installed (no change).`
  }

  console.log(`  🌳 ${message}`)
  console.log(`  Hook path: ${res.hookPath}`)
  console.log(`  Grove failures never block commits · the hook is fail-open by design.`)

  // ISOLATION: when the hooks dir is a TRACKED part of the working tree
  // (husky/lefthook point core.hooksPath at .husky), the hook file can be
  // committed + shared with the team. The hook carries no machine path (it
  // resolves the repo at runtime), but a teammate without Grove would carry a
  // dormant no-op hook line — so disclose it and offer to keep it local.
  if (res.inWorktree) {
    console.log(`  ⚠️  ${res.hookPath} is tracked by git (husky/lefthook).`)
    console.log(`     A later \`git add\` can commit the Grove hook line · it stays a harmless no-op`)
    console.log(`     for teammates without Grove. To keep it out of the repo, add the file to .gitignore`)
    console.log(`     or remove the Grove block (between the sentinel comments) before committing.`)
  }

  // First-run starter: a brand-new player gets seeds so the dashboard has loot
  // to show before their first commit lands (avoids the empty-board first-aha).
  const granted = grantStarterOnce(dir)
  if (granted) {
    console.log(`  🪙 starter grant · +${STARTER_SEEDS} 🌰 seeds · your board isn't empty.`)
  }

  // Detect the AI CLIs the user already runs (tool-agnostic · ADR-0001).
  const clis = detectAiClis()
  if (clis.length > 0) {
    console.log(`  Detected: ${clis.join(', ')} · Grove rides alongside, doesn't replace.`)
  } else {
    console.log(`  Works with any AI-coding tool (Claude Code, Cursor, Aider, Codex…) · tool-agnostic.`)
  }

  console.log(t(locale, 'cli.init.merge_hook'))

  // Clear next-step CTA (the first-aha): one concrete command to run next.
  console.log(`  Next: git commit like normal, then \`sq dashboard\` to see your loot.`)

  // Surface `sq wrap` — the post-commit hook only carries Pillar-B signals, so wrap is
  // the ONLY real test/build signal source, and nothing else tells the user it exists.
  // Read-only probe of the repo's package.json offers a ready-to-paste command; printed
  // once at setup, never a nag (ADR-0003: we surface the command, never auto-run it).
  let hasTestScript = false
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>
    }
    hasTestScript = typeof pkg.scripts?.['test'] === 'string'
  } catch {
    /* no / unreadable package.json → fall back to the generic hint */
  }
  console.log(t(locale, hasTestScript ? 'cli.init.wrap_hint_npm' : 'cli.init.wrap_hint_generic'))
  return 0
}

export function handleUninstall(flags: Record<string, string>): number {
  const repo = flags['repo'] ?? process.cwd()
  const res = uninstallPostCommit(repo)
  // Remove BOTH grove hook blocks (post-commit + post-merge); each is surgical and
  // preserves any other hook content.
  uninstallPostMerge(repo)

  let message: string
  if (res.action === 'removed') {
    message = `Grove hook removed.`
  } else if (res.action === 'unchained') {
    message = `Grove block removed · your other hooks remain intact.`
  } else {
    message = `Grove hook was not installed (nothing to remove).`
  }

  console.log(`  ${message}`)
  console.log(`  Hook path: ${res.hookPath}`)
  return 0
}

export function handleCommitHook(flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  // Banner first in normal mode (kept for the loot reveal). Calm mode stays quiet
  // until the single confirmation below · no banner, no loot, no offers.
  if (!zen) console.log('  🌳 grove')

  try {
    const repo = flags['repo'] ?? process.cwd()
    const { events } = scanRepo(repo)

    const allRewards: ReturnType<typeof ingestEvent>['rewards'] = []

    for (const event of events) {
      const { rewards } = ingestEvent(dir, event)
      allRewards.push(...rewards)
      if (zen) continue
      printRewards(rewards, locale)
    }

    // Push-on-big-moment for the whole commit's reward batch (opt-in, default
    // OFF, fire-and-forget). Done before the zen early-return so a calm user who
    // opted into push still gets their phone alert.
    maybePush(allRewards)

    if (zen) {
      // Calm: engine ran & persisted; one quiet line, no banner/loot/offers.
      calmConfirm(t(locale, 'cli.commit_recorded', { n: events.length }), locale)
      return 0
    }

    // Contextual offers after all events are processed
    printContextualOffers(allRewards, dir, locale)
  } catch {
    // Never fail a commit · swallow all errors silently
  }

  return 0
}

/**
 * Runtime entry for the installed post-merge hook. Emits a pr_merged outcome ONLY for
 * a real merge COMMIT (a 2nd parent) — the runtime guard hardens the shell HEAD^2 gate
 * (defense-in-depth) so a fast-forward `git pull` / squash / rebase never over-rewards.
 * Fail-open: a Grove failure NEVER breaks the user's merge. pr_merged is an EXISTING
 * outcome (no new reward); this only auto-captures it.
 */
export function handleMergeHook(flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  try {
    const repo = flags['repo'] ?? process.cwd()
    // Honest guard: not a real merge commit → nothing happened, emit nothing.
    if (!isMergeCommit(repo)) return 0

    const { rewards } = ingestEvent(dir, {
      source: 'git-merge',
      sessionId: 'merge',
      type: 'pr_merged',
      magnitude: 1,
      success: true,
      ts: new Date().toISOString(),
      meta: {},
    })
    maybePush(rewards)

    if (zen) {
      calmConfirm(t(locale, 'cli.merge_recorded'), locale)
      return 0
    }
    console.log('  🌳 grove')
    printRewards(rewards, locale)
    printContextualOffers(rewards, dir, locale)
  } catch {
    // Never fail a merge · swallow all errors silently
  }
  return 0
}

// ---------------------------------------------------------------------------
// statusline-ingest handler
// ---------------------------------------------------------------------------

/**
 * Read the Claude Code statusline JSON from STDIN (or --test-stdin for tests),
 * parse it via parseStatuslinePayload, and ingest the resulting quota_update
 * event. Prints NOTHING to stdout. Always returns 0 (never disrupts the HUD).
 */
export function handleStatuslineIngest(flags: Record<string, string>, dir: string): number {
  try {
    // --test-stdin allows tests to inject JSON without real stdin plumbing.
    const raw = flags['test-stdin'] !== undefined
      ? flags['test-stdin']
      : readStdinSync()

    const payload: unknown = JSON.parse(raw)
    const { events } = parseStatuslinePayload(payload, {
      sessionId: 'statusline',
    })

    for (const event of events) {
      // Add a real timestamp at the impure shell layer.
      const eventWithTs = { ...event, ts: new Date().toISOString() }
      ingestEvent(dir, eventWithTs)
    }
  } catch {
    // Never disrupt the HUD · swallow all errors silently.
  }

  return 0
}

/**
 * `sq statusline-segment` — print ONE calm Grove line (level · xp · energy) for a
 * statusline the user composes it into. READ-ONLY (loadState only, never ingests or
 * saves), always returns 0 (never disrupts the HUD). Energy comes from persisted
 * state (the ingest wrapper keeps it current); one-frame staleness is fine here.
 */
export function handleStatuslineSegment(
  _flags: Record<string, string>,
  dir: string,
  zen: boolean,
  locale: Locale = 'en',
): number {
  try {
    console.log(renderStatuslineSegment(loadState(dir), locale, zen))
  } catch {
    // Never disrupt the HUD · swallow all errors silently.
  }
  return 0
}

// ---------------------------------------------------------------------------
// statusline install/uninstall handlers
// ---------------------------------------------------------------------------

function defaultSettingsPath(): string {
  return path.join(process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/root', '.claude', 'settings.json')
}

export function handleStatuslineInstall(flags: Record<string, string>, _dir: string, locale: Locale = 'en'): number {
  const settingsPath = flags['settings'] ?? defaultSettingsPath()
  const wrapperPath = path.join(path.dirname(settingsPath), 'grove-statusline-wrapper.sh')

  // Use the portable, injection-safe invocation the git-hook adapter uses:
  // a bare `sq` when installed, else `node '<abs>/dist/cli/sq.js'` (shQuote'd).
  const ingestCmd = `${groveInvocation()} statusline-ingest`
  const result = installStatusline(settingsPath, wrapperPath, ingestCmd)

  // R8 hygiene: the installer writes a timestamped settings.json.bak.<ts> each
  // install; rotate so only the newest few survive (never an unbounded pile).
  rotateBackups(path.dirname(settingsPath), 'settings.json.bak.')

  if (result.action === 'already-installed') {
    console.log('  Grove statusline wrapper is already installed (no change).')
  } else {
    console.log(`  Grove statusline wrapper installed.`)
    console.log(`  Original command preserved: ${result.original || '(none)'}`)
    console.log(`  Wrapper: ${wrapperPath}`)
    // Point to backup
    const backupFiles = fs.readdirSync(path.dirname(settingsPath))
      .filter((f: string) => f.startsWith('settings.json.bak'))
      .sort()
      .reverse()
    const latestBackup = backupFiles[0]
    if (latestBackup !== undefined) {
      console.log(`  Backup: ${path.join(path.dirname(settingsPath), latestBackup)}`)
    }
  }

  console.log(`  Your original statusline is fully preserved and chained · it still runs.`)

  // One-time, opt-in offer to ALSO show the Grove glance (level/xp/energy). We PRINT
  // the exact chain (ADR-0003: surface the command, never write it) and never nag.
  if (result.action !== 'already-installed') {
    const orig = result.original ? `${result.original} ; ` : ''
    const chain = `"${orig}sq statusline-segment"`
    console.log(t(locale, 'cli.statusline.segment_offer', { chain }))
  }
  return 0
}

export function handleStatuslineUninstall(flags: Record<string, string>): number {
  const settingsPath = flags['settings'] ?? defaultSettingsPath()
  const result = uninstallStatusline(settingsPath)

  // R8 hygiene: cap the timestamped settings backups here too (keep newest few).
  rotateBackups(path.dirname(settingsPath), 'settings.json.bak.')

  if (result.action === 'not-installed') {
    console.log('  Grove statusline wrapper was not installed (nothing to remove).')
  } else {
    console.log('  Grove statusline wrapper removed.')
    console.log('  Your original statusline command has been restored.')
  }

  return 0
}

// ---------------------------------------------------------------------------
// Minimal synchronous stdin reader
// ---------------------------------------------------------------------------

/**
 * Read all of stdin synchronously (blocking). Used by statusline-ingest which
 * is invoked from a shell pipe · it's fine to block here.
 */
function readStdinSync(): string {
  const BUFSIZE = 65536
  let data = ''
  let bytesRead: number
  const buf = Buffer.alloc(BUFSIZE)

  // Use fs.readSync on fd 0 (stdin)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      bytesRead = fs.readSync(0, buf, 0, BUFSIZE, null)
      if (bytesRead === 0) break
      data += buf.subarray(0, bytesRead).toString('utf-8')
    } catch {
      break
    }
  }
  return data
}

// ---------------------------------------------------------------------------
// Commit type + scope inference (pure helpers for suggest-commit)
// ---------------------------------------------------------------------------

/**
 * Infer a conventional-commit type from staged file paths.
 * Priority order: test > docs > chore > feat/fix heuristic.
 */
export function inferCommitType(files: string[]): string {
  const hasTest = files.some((f) =>
    /\.test\.[tj]sx?$|\.spec\.[tj]sx?$|__tests__/.test(f),
  )
  if (hasTest) return 'test'

  const hasDocs = files.some((f) =>
    /\.md$|^docs\/|CHANGELOG|ARCHITECTURE|DECISIONS/i.test(f),
  )
  if (hasDocs) return 'docs'

  const hasChore = files.some((f) =>
    /package\.json$|package-lock\.json$|tsconfig|\.eslintrc|\.prettierrc|vitest\.config|vite\.config/.test(f),
  )
  if (hasChore) return 'chore'

  // feat/fix heuristic: if any file name contains "fix", "bug", or "patch" → fix
  const hasFix = files.some((f) =>
    /[/\\](fix|bug|patch)[^/\\]*$|[/\\][^/\\]*(fix|bug|patch)[^/\\]*\.[tj]sx?$/.test(f),
  )
  return hasFix ? 'fix' : 'feat'
}

/**
 * Infer the conventional-commit scope from staged file paths.
 * Returns the top-level directory segment common to the files (e.g. "src"),
 * or null when files live at root or there is no common directory.
 */
export function inferCommitScope(files: string[]): string | null {
  if (files.length === 0) return null

  // Normalise separators to forward-slash
  const normed = files.map((f) => f.replace(/\\/g, '/'))

  // Collect the first path segment of each file (ignore root-level files)
  const dirs = normed
    .map((f) => {
      const slash = f.indexOf('/')
      return slash > 0 ? f.slice(0, slash) : null
    })
    .filter((d): d is string => d !== null)

  if (dirs.length === 0) return null

  // If all files share the same first segment, use it as scope
  const first = dirs[0]!
  const allSame = dirs.every((d) => d === first)
  return allSame ? first : null
}

// ---------------------------------------------------------------------------
// suggest-commit handler
// ---------------------------------------------------------------------------

export function handleSuggestCommit(flags: Record<string, string>, locale: Locale = 'en'): number {
  const repo = flags['repo'] ?? process.cwd()

  const diff = stagedDiffStat(repo)

  if (diff === null || diff.files.length === 0) {
    console.log(t(locale, 'cli.suggest.nothing_staged'))
    return 0
  }

  const type = inferCommitType(diff.files)
  const scope = inferCommitScope(diff.files)
  const topFile = diff.files[0] ?? ''
  // Subject: basename of the top changed path (no extension)
  const subject = path.basename(topFile, path.extname(topFile))

  // First line: type(scope): subject  — or  type: subject when no scope
  const header = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`

  const fileList = diff.files.join(', ')
  const statsLine = `+${diff.insertions}/-${diff.deletions}`

  // Suggested message (conventional-commit two-part style)
  const suggested = [
    header,
    ``,
    `Changed: ${fileList} (${statsLine})`,
  ].join('\n')

  console.log(t(locale, 'cli.suggest.header'))
  console.log('  ─'.repeat(26))
  console.log(suggested.split('\n').map((l) => `  ${l}`).join('\n'))
  console.log('  ─'.repeat(26))

  return 0
}

// ---------------------------------------------------------------------------
// checkpoint handler
// ---------------------------------------------------------------------------

export function handleCheckpoint(flags: Record<string, string>, dir: string, zen: boolean, locale: Locale = 'en'): number {
  const repo = flags['repo'] ?? process.cwd()
  const message = flags['m'] ?? 'checkpoint'

  // 1. Non-destructive snapshot via git stash create
  const snapshot = createStashSnapshot(repo)
  const ref = snapshot?.ref ?? ''
  const branch = currentBranch(repo) ?? 'unknown'

  // 2. Collect diffStat for the record (may be null on clean repo · that's fine)
  const diffStat = stagedDiffStat(repo)

  // 3. Record to checkpoints.jsonl in the grove state dir. ISOLATION (R-safety):
  // store the change SHAPE (counts) only, never the changed file PATHS — paths are
  // work content. branch + the user's own -m message are deliberate labels they
  // chose for their own local recall, so those stay.
  const diffShape = diffStat
    ? { fileCount: diffStat.files.length, insertions: diffStat.insertions, deletions: diffStat.deletions }
    : null

  const entry = {
    ts: new Date().toISOString(),
    ref,
    branch,
    message,
    diffStat: diffShape,
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    const checkpointsFile = path.join(dir, 'checkpoints.jsonl')
    fs.appendFileSync(checkpointsFile, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    // Non-fatal · continue even if write fails
  }

  // 4. Ingest a 'checkpoint' GroveEvent (fires rest-buff + gift pull)
  const rewards = (() => {
    try {
      const result = ingestEvent(dir, {
        source: 'sq-checkpoint',
        sessionId: 'checkpoint',
        type: 'checkpoint',
        magnitude: 1,
        success: true,
        ts: new Date().toISOString(),
        meta: { ref, branch },
      })
      return result.rewards
    } catch {
      return []
    }
  })()

  // 5. Print checkpoint confirmation (the safety-net purpose · kept even in calm
  //    mode; it is the command's reason for existing, not loot spectacle).
  if (ref !== '') {
    console.log(t(locale, 'cli.checkpoint.saved', { branch }))
    console.log(t(locale, 'cli.checkpoint.restore', { ref }))
  } else {
    console.log(t(locale, 'cli.checkpoint.nothing', { branch }))
  }

  // Push-on-big-moment (opt-in, default OFF, fire-and-forget) · independent of zen.
  maybePush(rewards)

  if (zen) {
    // Calm: engine ran & persisted the rest-buff; suppress loot + offers.
    return 0
  }

  // Print rewards
  printRewards(rewards, locale)

  // 6. Contextual offers
  printContextualOffers(rewards, dir, locale)

  return 0
}

/** One persisted checkpoint record (mirrors the writer in handleCheckpoint). */
interface CheckpointRecord {
  ts: string
  ref: string
  branch: string
  message: string
  diffStat: { fileCount: number; insertions: number; deletions: number } | null
}

/** Terse localized "N{m,h,d} ago" from an ISO timestamp (CLI display only). */
function relTime(iso: string, locale: Locale): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000))
  if (mins < 1) return t(locale, 'cli.time.just_now')
  if (mins < 60) return t(locale, 'cli.time.min_ago', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t(locale, 'cli.time.hr_ago', { n: hrs })
  return t(locale, 'cli.time.day_ago', { n: Math.floor(hrs / 24) })
}

/**
 * `sq checkpoints` · READ-ONLY list of the safety-net snapshots `sq checkpoint`
 * writes (checkpoints.jsonl). Prints branch, message, change shape, and a copyable
 * `git stash apply <durable SHA>` per entry. Runs ZERO git commands, mutates no
 * state, and has NO --apply flag (the user runs the printed command) — firewall-clean.
 * The durable stash-create SHA (not a positional stash@{n}, which shifts/expires) is
 * what makes days-later recall actually work.
 */
export function handleCheckpoints(
  flags: Record<string, string>,
  dir: string,
  locale: Locale = 'en',
): number {
  const rawLimit = Number(flags['limit'])
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10

  let raw = ''
  try {
    raw = fs.readFileSync(path.join(dir, 'checkpoints.jsonl'), 'utf8')
  } catch {
    /* missing file → treated as empty */
  }
  const entries = raw
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l): unknown => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    // Validate SHAPE, not just non-null: a line that parses to a primitive (5,
    // "oops") or an object missing fields would otherwise render a literal
    // "undefined" + a bogus `git stash apply undefined` recall. Drop wrong-shape
    // records the same way unparseable lines are dropped.
    .filter((e): e is CheckpointRecord => {
      if (typeof e !== 'object' || e === null) return false
      const r = e as Record<string, unknown>
      return (
        typeof r['ts'] === 'string' &&
        typeof r['ref'] === 'string' &&
        typeof r['branch'] === 'string' &&
        typeof r['message'] === 'string'
      )
    })

  if (entries.length === 0) {
    console.log(t(locale, 'cli.checkpoints.empty'))
    return 0
  }

  const recent = entries.slice(-limit).reverse()
  console.log(t(locale, 'cli.checkpoints.header', { count: recent.length }))
  for (const e of recent) {
    const ds = e.diffStat
    const shape =
      ds &&
      typeof ds.fileCount === 'number' &&
      typeof ds.insertions === 'number' &&
      typeof ds.deletions === 'number'
        ? `${ds.fileCount}f +${ds.insertions}/-${ds.deletions}`
        : t(locale, 'cli.checkpoints.clean')
    console.log(
      t(locale, 'cli.checkpoints.entry', {
        ago: relTime(e.ts, locale),
        branch: e.branch,
        message: e.message,
        shape,
      }),
    )
    if (e.ref !== '') console.log(t(locale, 'cli.checkpoints.recall', { ref: e.ref }))
  }
  return 0
}

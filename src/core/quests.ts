// The Pillar-B quest catalog. Quests turn skipped good-engineering chores into
// rewarded game actions. Design guardrails (ADR-0005):
//  - reward the OUTCOME (an artifact exists / a doc tracks the code), never raw activity;
//  - first-time achievement fires once, then fades to informational (anti-overjustification);
//  - forgiving: a lapsed buff is a renewable gain, never a shame; no guilt nags.

export interface QuestDef {
  id: string
  title: string
  /** player-facing, encouraging description */
  description: string
  pillar: 'A' | 'B'
}

export const QUESTS: QuestDef[] = [
  {
    id: 'grimoire',
    title: 'Write the CLAUDE.md',
    description: 'Add a lean CLAUDE.md / AGENTS.md · permanent repo aura.',
    pillar: 'B',
  },
  {
    id: 'precast-spec',
    title: 'Spec First',
    description: 'Write acceptance criteria before coding · arms an XP x2.',
    pillar: 'B',
  },
  {
    id: 'living-map',
    title: 'Sync the Docs',
    description: 'Keep architecture docs in sync with the code · Fresh Architecture buff.',
    pillar: 'B',
  },
  {
    id: 'test-warden',
    title: 'Add Tests',
    description: 'Add a test (edge/error paths and tests-first count extra) · guaranteed loot.',
    pillar: 'B',
  },
  // --- R5: the remaining four Pillar-B quests (8 total) --------------------
  {
    id: 'review-loop',
    title: 'Close the Review',
    description: 'Land a confirmed review · Fresh Eyes buff.',
    pillar: 'B',
  },
  {
    id: 'clean-build',
    title: 'Keep It Clean',
    description: 'Ship a lint-clean build · permanent +seeds aura.',
    pillar: 'B',
  },
  {
    id: 'merge-master',
    title: 'Merge the PR',
    description: 'Merge a pull request · guaranteed loot + gear.',
    pillar: 'B',
  },
  {
    id: 'doc-streak',
    title: 'Doc Streak',
    description: 'Keep docs fresh, week over week · a tiered, renewable streak.',
    pillar: 'B',
  },
  {
    id: 'plan-ahead',
    title: 'Plan Ahead',
    description: 'Write a plan before you build · marks the chore done.',
    pillar: 'B',
  },
  {
    id: 'adr-kept',
    title: 'Decisions Recorded',
    description: 'Keep docs/decisions.md · record why the code is shaped this way.',
    pillar: 'B',
  },
]

// ---------------------------------------------------------------------------
// Renewable quests (R5) — a refreshing board, not a static one. A renewable
// quest stays `active` and re-pays as it is repeated, instead of going `done`
// and disappearing. Forgiving by default (ADR-0005): a lapsed streak is a
// renewable gain, never a shame.
// ---------------------------------------------------------------------------

/** Quest ids that REFRESH rather than retire after completion. */
export const RENEWABLE_QUEST_IDS = ['doc-streak'] as const

/** Whether `id` is a renewable (refreshing) quest. */
export function isRenewable(id: string): boolean {
  return (RENEWABLE_QUEST_IDS as readonly string[]).includes(id)
}

/**
 * The Doc Streak's tiers (the renewable, tiered weekly doc-freshness variant).
 * `at` is the streak length at which the tier is reached; `seeds` is the
 * celebratory bonus granted on reaching it. Ascending; the engine reads these
 * to escalate the reward as the streak grows. The exact numbers are A2-tunable.
 */
export const DOC_STREAK_TIERS: ReadonlyArray<{ at: number; seeds: number }> = [
  { at: 0, seeds: 0 },
  { at: 3, seeds: 10 },
  { at: 6, seeds: 20 },
  { at: 10, seeds: 40 },
]

/**
 * The tier INDEX a streak of the given length has reached (0-based), capped at
 * the top tier. Pure; deterministic.
 */
export function docStreakTier(streak: number): number {
  let tier = 0
  for (let i = 0; i < DOC_STREAK_TIERS.length; i++) {
    if (streak >= DOC_STREAK_TIERS[i]!.at) tier = i
  }
  return tier
}

/** Document filenames that count as a project-memory "grimoire" for any AI-coding tool. */
export const GRIMOIRE_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'GEMINI.md',
] as const

/** Canonical ADR (architecture-decision record) file + a short fallback list. One
 *  path only per habit (no tool-specific layouts — ADR-0001 anti-coupling). */
export const ADR_FILES = [
  'docs/decisions.md',
  'docs/DECISIONS.md',
  'ARCHITECTURE-DECISIONS.md',
  'docs/architecture/decisions/README.md',
] as const

/** An ADR file must carry more than this many NON-BLANK lines to count (an empty
 *  or single-line file is not yet a real decision record — forgiving, never shamed). */
export const ADR_NONEMPTY_MIN_LINES = 1

/** A lean grimoire is concise; bloated files add noise and earn no aura (but are never shamed). */
export const GRIMOIRE_LEAN_MAX_LINES = 80

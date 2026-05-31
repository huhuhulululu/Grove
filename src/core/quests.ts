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
]

export function questById(id: string): QuestDef | undefined {
  return QUESTS.find((q) => q.id === id)
}

export function allQuestIds(): string[] {
  return QUESTS.map((q) => q.id)
}

/** Document filenames that count as a project-memory "grimoire" for any AI-coding tool. */
export const GRIMOIRE_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'GEMINI.md',
] as const

/** A lean grimoire is concise; bloated files add noise and earn no aura (but are never shamed). */
export const GRIMOIRE_LEAN_MAX_LINES = 80

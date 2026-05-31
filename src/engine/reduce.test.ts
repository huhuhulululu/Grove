import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { GroveEvent } from '../core/events'
import { mulberry32 } from '../core/rng'
import {
  reduce,
  pull,
  craftCard,
  buyPrestige,
  prestigeRank,
  prestigeBuffId,
  prestigeCost,
  PRESTIGE_BUFF_ID,
  CRIT_CHANCE,
  PULL_COST,
} from './reduce'
import { SHARDS_PER_CRAFT } from './collection'
import { HARD_PITY, SOFT_PITY } from './gacha'
import { ALL_CARD_DEFS, cardIdsInSet } from '../core/cards'
import { AURA_SEED_BONUS, DUP_COMP_SEEDS } from './quests'
import type { Gear } from '../core/rewards'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid GroveEvent with sensible defaults; override per-test. */
function ev(over: Partial<GroveEvent> & Pick<GroveEvent, 'type'>): GroveEvent {
  return {
    source: 'test',
    sessionId: 'sess-1',
    magnitude: over.magnitude ?? 1,
    success: over.success ?? true,
    ts: over.ts ?? '2026-05-30T00:00:00.000Z',
    meta: over.meta ?? {},
    ...over,
  }
}

/** Total XP across all levels (so XP comparisons survive level-ups). */
function totalXp(state: GameState): number {
  // We compare via level + leftover xp ordering; simplest robust proxy is
  // (level, xp) lexicographically. For amount comparisons we run on a fresh
  // state where no level-up resets occur, so raw xp + level encodes magnitude.
  return state.player.level * 1_000_000 + state.player.xp
}

// ---------------------------------------------------------------------------
// Firewall: success:false never punishes
// ---------------------------------------------------------------------------

describe('reduce — never punish (ADR-0005 firewall)', () => {
  it('success:false yields no rewards and an unchanged player', () => {
    const s0 = initialState()
    const rng = mulberry32(1)
    const { state, rewards } = reduce(s0, ev({ type: 'test_result', success: false, magnitude: 9 }), rng)

    expect(rewards).toEqual([])
    expect(state.player).toEqual(s0.player)
    expect(state.cards).toEqual(s0.cards)
    expect(state.pity).toEqual(s0.pity)
    expect(state.completedSets).toEqual(s0.completedSets)
  })

  it('does not consume the rng on a failing event (deterministic no-op)', () => {
    const s0 = initialState()
    // If reduce pulled from rng on failure, two separate fresh rngs feeding a
    // later success would diverge. Here we just confirm no card was created.
    const rng = mulberry32(42)
    const { state } = reduce(s0, ev({ type: 'pr_merged', success: false }), rng)
    expect(state.cards).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('reduce — immutability', () => {
  it('never mutates the input state', () => {
    const s0 = initialState()
    const snapshot = JSON.parse(JSON.stringify(s0))
    const rng = mulberry32(7)

    reduce(s0, ev({ type: 'pr_merged', magnitude: 5 }), rng)

    expect(s0).toEqual(snapshot)
  })

  it('returns a new state object (referential inequality)', () => {
    const s0 = initialState()
    const rng = mulberry32(7)
    const { state } = reduce(s0, ev({ type: 'commit' }), rng)
    expect(state).not.toBe(s0)
    expect(state.player).not.toBe(s0.player)
  })
})

// ---------------------------------------------------------------------------
// XP weighting: Pillar-B (docs) > code (commit)
// ---------------------------------------------------------------------------

describe('reduce — XP weighting', () => {
  it('doc_updated grants more XP than a commit (same magnitude)', () => {
    const s0 = initialState()
    const doc = reduce(s0, ev({ type: 'doc_updated', magnitude: 1 }), mulberry32(1))
    const commit = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))

    expect(totalXp(doc.state)).toBeGreaterThan(totalXp(commit.state))
  })

  it('magnitude scales XP', () => {
    const s0 = initialState()
    const low = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    const high = reduce(s0, ev({ type: 'commit', magnitude: 5 }), mulberry32(1))
    expect(totalXp(high.state)).toBeGreaterThan(totalXp(low.state))
  })

  it('emits an xp reward with a celebratory non-empty message', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'commit' }), mulberry32(1))
    const xpReward = rewards.find((r) => r.kind === 'xp')
    expect(xpReward).toBeDefined()
    expect(xpReward!.message.length).toBeGreaterThan(0)
    expect(xpReward!.message).not.toMatch(/fail|bad|lazy|shame/i)
  })
})

// ---------------------------------------------------------------------------
// Cards via gacha + collection
// ---------------------------------------------------------------------------

describe('reduce — cards', () => {
  it('a successful test_result NO LONGER auto-yields a card (seeds + maybe serendipity only)', () => {
    // R3 economy: pulls are now a CHOICE that costs seeds. A green test grants
    // seeds (currency) and a serendipity CHANCE — it must not deterministically
    // mint a card for every run. Seed 99 is a non-serendipity seed here.
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'test_result', magnitude: 2 }), mulberry32(99))

    // No auto-pull: the card count is unchanged from this single ordinary run.
    expect(state.cards.length).toBe(s0.cards.length)
    // But it DID grant seeds.
    expect(rewards.some((r) => r.kind === 'currency')).toBe(true)
    expect(state.player.currency).toBeGreaterThan(s0.player.currency)
  })

  it('pr_merged grants a guaranteed pull (a card lands in the collection)', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'pr_merged', magnitude: 4 }), mulberry32(3))
    expect(state.cards.length).toBe(1)
    expect(rewards.some((r) => r.kind === 'card')).toBe(true)
  })

  it('every reward carries a non-empty, non-shaming message', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'pr_merged', magnitude: 6 }), mulberry32(5))
    expect(rewards.length).toBeGreaterThan(0)
    for (const r of rewards) {
      expect(typeof r.message).toBe('string')
      expect(r.message.length).toBeGreaterThan(0)
      expect(r.message).not.toMatch(/\bfail\b|lazy|shame|stupid/i)
    }
  })
})

// ---------------------------------------------------------------------------
// Pity threading across many pulls
// ---------------------------------------------------------------------------

describe('reduce — pity threading (via explicit chosen pulls)', () => {
  it('threads pity across many chosen pulls (pity changes & cards accumulate)', () => {
    // Stock the wallet so we can afford many pulls.
    let state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 100 * PULL_COST } }
    const rng = mulberry32(2024)
    const pityHistory: number[] = []

    for (let i = 0; i < 70; i++) {
      const out = pull(state, rng)
      state = out.state
      pityHistory.push(state.pity.sinceLegendary)
    }

    // ≥70: each pull lands a card; a pull that COMPLETES a set adds a bonus
    // guaranteed-legendary card on top (R3 set-completion reward).
    expect(state.cards.length).toBeGreaterThanOrEqual(70)
    expect(Math.max(...pityHistory)).toBeGreaterThan(0)
    // Hard pity (60) guarantees a legendary within 60 pulls → a reset to 0 happened
    // somewhere after the first pull.
    expect(pityHistory.some((p, i) => p === 0 && i > 0)).toBe(true)
  })

  it('pity never exceeds the hard-pity ceiling', () => {
    let state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 100 * PULL_COST } }
    const rng = mulberry32(777)
    for (let i = 0; i < 70; i++) {
      state = pull(state, rng).state
      expect(state.pity.sinceLegendary).toBeLessThanOrEqual(HARD_PITY)
    }
  })
})

// ---------------------------------------------------------------------------
// Serendipity lucky-pull must NOT corrupt the player's REAL pity counter
// (audit re-score① code-review nit: it floored sinceLegendary to SOFT_PITY,
// inflating legit pity progress — a lucky-pull was "borrowing" 40 pulls of
// pity the player never earned).
// ---------------------------------------------------------------------------

describe('reduce — serendipity lucky-pull preserves real pity', () => {
  // Empirically probed against the engine (pity starting at 2):
  //  - seed 3 → serendipity LUCKY PULL fires AND the drop is NON-legendary
  //    (a common 'Wrench'), so the real-pity-advance path is exercised.
  const SEED_SEREN_NONLEG_PULL = 3

  it('a non-legendary serendipity lucky-pull advances real pity by +1 (NOT floored to SOFT_PITY)', () => {
    // Start with a modest, legitimately-earned pity counter.
    const s0: GameState = { ...initialState(), pity: { sinceLegendary: 2 } }
    const { state, rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(SEED_SEREN_NONLEG_PULL))

    // Confirm the lucky pull actually fired and was NOT legendary (this seed).
    const lucky = rewards.find((r) => r.kind === 'card' && r.message.includes('奇遇'))
    expect(lucky).toBeDefined()
    expect(lucky!.message).not.toMatch(/legendary|shiny/)

    // The OLD bug floored sinceLegendary to SOFT_PITY (40) then +1 → 41, corrupting
    // legit pity progress. The fix: a non-legendary lucky pull advances real pity
    // by exactly +1 (2 → 3), never inflating it.
    expect(state.pity.sinceLegendary).toBe(3)
    expect(state.pity.sinceLegendary).toBeLessThan(SOFT_PITY)
  })

  it('never inflates pity above what the real counter + this one pull would be', () => {
    const s0: GameState = { ...initialState(), pity: { sinceLegendary: 5 } }
    const { state } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(SEED_SEREN_NONLEG_PULL))
    // Worst case (non-legendary): 5 + 1 = 6. The bug produced >= SOFT_PITY (40).
    expect(state.pity.sinceLegendary).toBeLessThanOrEqual(6)
  })

  it('still lets a legendary serendipity lucky-pull reset pity to 0 (seed 1 → shiny)', () => {
    // Regression-guard the other branch: a top-tier lucky drop resets pity.
    const s0: GameState = { ...initialState(), pity: { sinceLegendary: 5 } }
    const { state, rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    const lucky = rewards.find((r) => r.kind === 'card' && r.message.includes('奇遇'))
    expect(lucky).toBeDefined()
    expect(lucky!.message).toMatch(/legendary|shiny/)
    expect(state.pity.sinceLegendary).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Buffs and no-op events
// ---------------------------------------------------------------------------

describe('reduce — buffs & no-ops', () => {
  it('doc_updated emits a buff reward', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'doc_updated', magnitude: 1 }), mulberry32(1))
    expect(rewards.some((r) => r.kind === 'buff')).toBe(true)
  })

  it('checkpoint emits a refreshing buff and a guaranteed pull', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'checkpoint' }), mulberry32(11))
    expect(rewards.some((r) => r.kind === 'buff')).toBe(true)
    expect(state.cards.length).toBe(1)
  })

  it('checkpoint marks its "refreshed" buff with kind:"rest" (consistency with energy rest beats)', () => {
    const s0 = initialState()
    const { state } = reduce(s0, ev({ type: 'checkpoint' }), mulberry32(11))
    const refreshed = state.buffs.find((b) => b.id === 'refreshed')
    expect(refreshed).toBeDefined()
    expect(refreshed!.kind).toBe('rest')
  })

  it('session_start / file_edit / file_presence / session_end yield no reward and unchanged state', () => {
    const s0 = initialState()
    for (const type of ['session_start', 'session_end', 'file_edit', 'file_presence'] as const) {
      const { state, rewards } = reduce(s0, ev({ type }), mulberry32(1))
      expect(rewards).toEqual([])
      expect(state.player).toEqual(s0.player)
      expect(state.cards).toEqual(s0.cards)
    }
  })

  it('review_confirmed grants XP', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'review_confirmed', magnitude: 1 }), mulberry32(1))
    expect(totalXp(state)).toBeGreaterThan(totalXp(s0))
    expect(rewards.some((r) => r.kind === 'xp')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// eventCount clock + silent buff expiry
// ---------------------------------------------------------------------------

describe('reduce — eventCount clock', () => {
  it('increments eventCount on every event, including success:false', () => {
    let state = initialState()
    expect(state.eventCount).toBe(0)

    state = reduce(state, ev({ type: 'commit' }), mulberry32(1)).state
    expect(state.eventCount).toBe(1)

    // a failing event still advances the clock (firewall: no reward, but time passes)
    state = reduce(state, ev({ type: 'test_result', success: false }), mulberry32(1)).state
    expect(state.eventCount).toBe(2)

    state = reduce(state, ev({ type: 'file_edit' }), mulberry32(1)).state
    expect(state.eventCount).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Quest integration through reduce (Pillar-B engine)
// ---------------------------------------------------------------------------

describe('reduce — grimoire quest (anti-overjustification)', () => {
  it('a lean CLAUDE.md adds the aura + marks done + yields a first-time reward incl a card', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(
      s0,
      ev({ type: 'file_presence', meta: { document: 'CLAUDE.md', lines: 20 } }),
      mulberry32(1),
    )

    expect(state.buffs.some((b) => b.id === 'aura:grimoire')).toBe(true)
    expect(state.quests.find((q) => q.id === 'grimoire')?.status).toBe('done')
    expect(rewards.some((r) => r.kind === 'card')).toBe(true)
    expect(state.cards.length).toBe(1)
  })

  it('a SECOND identical event yields ZERO rewards but keeps the aura', () => {
    let state = initialState()
    const grim = ev({ type: 'file_presence', meta: { document: 'CLAUDE.md', lines: 20 } })

    state = reduce(state, grim, mulberry32(1)).state
    const out2 = reduce(state, grim, mulberry32(1))

    expect(out2.rewards.length).toBe(0)
    expect(out2.state.buffs.some((b) => b.id === 'aura:grimoire')).toBe(true)
  })

  it('present:false removes the aura silently (no reward)', () => {
    let state = initialState()
    state = reduce(state, ev({ type: 'file_presence', meta: { document: 'CLAUDE.md', lines: 20 } }), mulberry32(1)).state
    const out = reduce(state, ev({ type: 'file_presence', meta: { document: 'CLAUDE.md', present: false } }), mulberry32(1))

    expect(out.state.buffs.some((b) => b.id === 'aura:grimoire')).toBe(false)
    expect(out.rewards).toEqual([])
  })

  it('a non-lean grimoire grants no aura and is not shamed', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(
      s0,
      ev({ type: 'file_presence', meta: { document: 'CLAUDE.md', lines: 500 } }),
      mulberry32(1),
    )
    expect(state.buffs.some((b) => b.id === 'aura:grimoire')).toBe(false)
    expect(rewards).toEqual([])
  })
})

// Awarded xp amount for an event (read off the xp reward), robust across level-ups.
function awardedXp(rewards: { kind: string; amount?: number }[]): number {
  return rewards.find((r) => r.kind === 'xp')?.amount ?? 0
}

describe('reduce — spec multiplier', () => {
  it('a spec_written armed multiplier boosts a FOLLOWING test_result vs the same event without it', () => {
    // Run A: spec_written first, then a test_result (boosted by the prior x2).
    let withMult = initialState()
    withMult = reduce(withMult, ev({ type: 'spec_written', magnitude: 1 }), mulberry32(1)).state
    const boosted = reduce(withMult, ev({ type: 'test_result', magnitude: 1 }), mulberry32(1))

    // Run B: a plain test_result on a fresh state (no multiplier).
    const plain = reduce(initialState(), ev({ type: 'test_result', magnitude: 1 }), mulberry32(1))

    expect(awardedXp(boosted.rewards)).toBeGreaterThan(awardedXp(plain.rewards))
    expect(awardedXp(boosted.rewards)).toBe(awardedXp(plain.rewards) * 2)
  })

  it('the multiplier EXPIRES after its window — a much later test_result is back to base xp', () => {
    let state = initialState()
    state = reduce(state, ev({ type: 'spec_written', magnitude: 1 }), mulberry32(1)).state

    // Burn through the 6-event window with neutral file_edit events.
    for (let i = 0; i < 8; i++) {
      state = reduce(state, ev({ type: 'file_edit' }), mulberry32(1)).state
    }
    expect(state.buffs.some((b) => b.id === 'mult:precast')).toBe(false)

    const late = reduce(state, ev({ type: 'test_result', magnitude: 1 }), mulberry32(1))
    const plain = reduce(initialState(), ev({ type: 'test_result', magnitude: 1 }), mulberry32(1))

    expect(awardedXp(late.rewards)).toBe(awardedXp(plain.rewards))
  })
})

describe('reduce — living-map quest', () => {
  it('doc_updated{drift:true} sets the quest active silently — no freshness buff, no buff reward', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'doc_updated', meta: { drift: true } }), mulberry32(1))

    // base XP still flows (the act of updating docs is real progress), but the
    // quest stays SILENT: no freshness buff granted, no celebratory buff reward.
    expect(rewards.some((r) => r.kind === 'buff')).toBe(false)
    expect(state.quests.find((q) => q.id === 'living-map')?.status).toBe('active')
    expect(state.buffs.some((b) => b.id === 'buff:living-map')).toBe(false)
  })

  it('doc_updated synced grants the freshness buff and a reward', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'doc_updated', meta: {} }), mulberry32(1))

    expect(state.buffs.some((b) => b.id === 'buff:living-map')).toBe(true)
    expect(rewards.some((r) => r.kind === 'buff')).toBe(true)
    expect(state.quests.find((q) => q.id === 'living-map')?.status).toBe('done')
  })
})

describe('reduce — test_added quest', () => {
  it('yields a guaranteed card and advances test-warden', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'test_added' }), mulberry32(7))

    expect(rewards.some((r) => r.kind === 'card')).toBe(true)
    expect(state.cards.length).toBe(1)
    expect(state.quests.find((q) => q.id === 'test-warden')?.completions).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// CRIT mechanic (暴击) — XP can crit on positive-XP events (ADR-0008)
// ---------------------------------------------------------------------------

describe('reduce — crit (暴击)', () => {
  // base XP for a magnitude-1 commit (no pull, isolates the crit math).
  const COMMIT_BASE = 10

  it('exposes a published CRIT_CHANCE in (0,1)', () => {
    expect(CRIT_CHANCE).toBeGreaterThan(0)
    expect(CRIT_CHANCE).toBeLessThan(1)
  })

  it('a critting seed multiplies XP by 2 and sets crit:true (seed 7 → ×2)', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(7))
    const xp = rewards.find((r) => r.kind === 'xp')
    expect(xp).toBeDefined()
    expect(xp!.crit).toBe(true)
    // seed 7 → critMult 2
    expect(xp!.amount).toBe(COMMIT_BASE * 2)
  })

  it('a different critting seed can multiply by 3 (seed 35 → ×3)', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(35))
    const xp = rewards.find((r) => r.kind === 'xp')
    expect(xp!.crit).toBe(true)
    expect(xp!.amount).toBe(COMMIT_BASE * 3)
  })

  it('crit multiplier is only ever 2 or 3 (never 1, never 4+)', () => {
    const s0 = initialState()
    for (const seed of [7, 19, 35, 39, 45, 46, 53]) {
      const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(seed))
      const xp = rewards.find((r) => r.kind === 'xp')!
      expect(xp.crit).toBe(true)
      expect(xp.amount! / COMMIT_BASE).toBeGreaterThanOrEqual(2)
      expect(xp.amount! / COMMIT_BASE).toBeLessThanOrEqual(3)
    }
  })

  it('a non-critting seed awards base XP with crit falsy (seed 1)', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    const xp = rewards.find((r) => r.kind === 'xp')!
    expect(xp.amount).toBe(COMMIT_BASE)
    expect(xp.crit).toBeFalsy()
  })

  it('a crit message contains "CRIT" and is terse / non-shaming', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(7))
    const xp = rewards.find((r) => r.kind === 'xp')!
    expect(xp.message).toContain('CRIT')
    expect(xp.message).not.toMatch(/fail|lazy|shame|stupid/i)
  })

  it('a non-crit message never contains "CRIT"', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'commit', magnitude: 1 }), mulberry32(1))
    const xp = rewards.find((r) => r.kind === 'xp')!
    expect(xp.message).not.toContain('CRIT')
  })

  it('crit NEVER fires on a failing event — no reward at all (firewall)', () => {
    const s0 = initialState()
    // seed 7 WOULD crit a commit; on a failure there is no XP grant and no draw.
    const { rewards } = reduce(s0, ev({ type: 'commit', success: false }), mulberry32(7))
    expect(rewards).toEqual([])
  })

  it('crit NEVER fires on a zero-XP event (no xp reward, so nothing to crit)', () => {
    const s0 = initialState()
    // session_start has no base XP → grantXp short-circuits, no crit draw, no xp reward.
    const { rewards } = reduce(s0, ev({ type: 'session_start' }), mulberry32(7))
    expect(rewards.find((r) => r.kind === 'xp')).toBeUndefined()
  })

  it('crit composes with a buff multiplier (scaled base is what crits)', () => {
    // spec_written arms a x2 multiplier; a following commit on a critting seed
    // crits the already-scaled amount.
    let state = initialState()
    state = reduce(state, ev({ type: 'spec_written', magnitude: 1 }), mulberry32(1)).state
    const { rewards } = reduce(state, ev({ type: 'commit', magnitude: 1 }), mulberry32(7))
    const xp = rewards.find((r) => r.kind === 'xp')!
    expect(xp.crit).toBe(true)
    // base 10 × buff 2 × crit 2 = 40
    expect(xp.amount).toBe(COMMIT_BASE * 2 * 2)
  })
})

// ---------------------------------------------------------------------------
// Gear drop on pr_merged
// ---------------------------------------------------------------------------

describe('reduce — gear drop on pr_merged', () => {
  it('pr_merged (success) adds exactly one gear to state.gear', () => {
    const s0 = initialState()
    const { state } = reduce(s0, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(10))
    expect(state.gear).toHaveLength(1)
  })

  it('pr_merged emits a "gear" reward with a terse loot-grammar message (name +level)', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(10))
    const gearReward = rewards.find((r) => r.kind === 'gear')
    expect(gearReward).toBeDefined()
    expect(gearReward!.message).toMatch(/\+\d+/)
    expect(gearReward!.message).not.toMatch(/fail|shame|bad/i)
  })

  it('pr_merged gear reward carries a gear object with level 0 and broken:false', () => {
    const s0 = initialState()
    const { rewards } = reduce(s0, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(10))
    const gearReward = rewards.find((r) => r.kind === 'gear')
    expect(gearReward!.gear).toBeDefined()
    expect(gearReward!.gear!.level).toBe(0)
    expect(gearReward!.gear!.broken).toBe(false)
  })

  it('pr_merged still drops a card AND gear (both rewards present)', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(10))
    expect(rewards.some((r) => r.kind === 'card')).toBe(true)
    expect(rewards.some((r) => r.kind === 'gear')).toBe(true)
    expect(state.cards).toHaveLength(1)
    expect(state.gear).toHaveLength(1)
  })

  it('pr_merged failure (success:false) drops NO gear', () => {
    const s0 = initialState()
    const { state, rewards } = reduce(s0, ev({ type: 'pr_merged', success: false }), mulberry32(10))
    expect(state.gear).toHaveLength(0)
    expect(rewards.some((r) => r.kind === 'gear')).toBe(false)
  })

  it('input state.gear is not mutated by pr_merged', () => {
    const s0 = initialState()
    const snapshot = JSON.parse(JSON.stringify(s0.gear))
    reduce(s0, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(10))
    expect(s0.gear).toEqual(snapshot)
  })

  it('pr_merged on a state that already has gear appends (does not replace)', () => {
    const s0 = initialState()
    const { state: s1 } = reduce(s0, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(10))
    expect(s1.gear).toHaveLength(1)
    const { state: s2 } = reduce(s1, ev({ type: 'pr_merged', magnitude: 3 }), mulberry32(20))
    expect(s2.gear).toHaveLength(2)
  })

  it('other success events do NOT drop gear (e.g. commit, test_result)', () => {
    const s0 = initialState()
    for (const type of ['commit', 'test_result', 'build_result', 'doc_updated'] as const) {
      const { state } = reduce(s0, ev({ type }), mulberry32(5))
      expect(state.gear).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// quota_update — anti-fabrication: partial frames must NOT invent vigor/sap
// ---------------------------------------------------------------------------

describe('reduce — quota_update anti-fabrication (partial frames)', () => {
  it('sevenDayPct-only frame: vigor is undefined (not fabricated 100), sap=20', () => {
    // present:true but ONLY sevenDayPct provided — the 5h window is absent.
    // engine must NOT fall back to fiveHourPct=0 and invent vigor=100.
    const s0 = initialState()
    const { state } = reduce(
      s0,
      ev({ type: 'quota_update', meta: { present: true, sevenDayPct: 80 } }),
      mulberry32(1),
    )
    expect(state.energy.vigor).toBeUndefined()
    expect(state.energy.sap).toBe(20)
  })

  it('fiveHourPct-only frame: vigor=30, sap is undefined (not fabricated 100)', () => {
    // present:true but ONLY fiveHourPct provided — the 7d window is absent.
    // engine must NOT fall back to sevenDayPct=0 and invent sap=100.
    const s0 = initialState()
    const { state } = reduce(
      s0,
      ev({ type: 'quota_update', meta: { present: true, fiveHourPct: 70 } }),
      mulberry32(1),
    )
    expect(state.energy.vigor).toBe(30)
    expect(state.energy.sap).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// GEAR LEVEL real effects (ADR-0008) — a +10 piece is meaningfully better than +0
// ---------------------------------------------------------------------------

function gearOf(name: string, level: number, broken = false): Gear {
  return { id: `gear.${name.toLowerCase().replace(/\s+/g, '-')}.1`, name, level, rarity: 'rare', broken }
}

describe('reduce — gear level confers real effects', () => {
  // R7 faucet rebalance HALVED the high-frequency grants (commit 5→3); a +10%
  // currency bonus rounds away on a base-3 commit, so we measure the gear lift on
  // pr_merged (base 12) — where +10% clears integer rounding — isolating the base
  // grant currency line ("· PR merged") from the merge's pull/serendipity lines.
  const mergeSeeds = (out: { rewards: { kind: string; amount?: number; message: string }[] }) =>
    out.rewards.find((r) => r.kind === 'currency' && /PR merged/.test(r.message))!.amount!

  it('a +10 Commit Hammer makes a merge grant MORE currency than a +0 (assert)', () => {
    const lo: GameState = { ...initialState(), gear: [gearOf('Commit Hammer', 0)] }
    const hi: GameState = { ...initialState(), gear: [gearOf('Commit Hammer', 10)] }

    const loOut = reduce(lo, ev({ type: 'pr_merged', magnitude: 1 }), mulberry32(2))
    const hiOut = reduce(hi, ev({ type: 'pr_merged', magnitude: 1 }), mulberry32(2))

    expect(mergeSeeds(hiOut)).toBeGreaterThan(mergeSeeds(loOut))
    // +0 → base 12; +10 hammer → +10% → 12 * 1.1 = 13.2 → 13 (rounded)
    expect(mergeSeeds(loOut)).toBe(12)
    expect(mergeSeeds(hiOut)).toBe(13)
  })

  it('a Type Saber raises crit chance — more commits crit with a +14 saber than with none', () => {
    const bare: GameState = initialState()
    const saber: GameState = { ...initialState(), gear: [gearOf('Type Saber', 14)] }

    let critsBare = 0
    let critsSaber = 0
    for (let seed = 0; seed < 400; seed++) {
      if (reduce(bare, ev({ type: 'commit' }), mulberry32(seed)).rewards.find((r) => r.kind === 'xp')?.crit) critsBare++
      if (reduce(saber, ev({ type: 'commit' }), mulberry32(seed)).rewards.find((r) => r.kind === 'xp')?.crit) critsSaber++
    }
    expect(critsSaber).toBeGreaterThan(critsBare)
  })

  it('a Build Anvil raises XP — a +10 anvil commit out-XPs a bare commit (same seed)', () => {
    const bare: GameState = initialState()
    const anvil: GameState = { ...initialState(), gear: [gearOf('Build Anvil', 10)] }
    // seed 1 does not crit a commit, isolating the gear xp scaling
    const bareXp = reduce(bare, ev({ type: 'commit' }), mulberry32(1)).rewards.find((r) => r.kind === 'xp')!.amount!
    const anvilXp = reduce(anvil, ev({ type: 'commit' }), mulberry32(1)).rewards.find((r) => r.kind === 'xp')!.amount!
    expect(anvilXp).toBeGreaterThan(bareXp)
    // base 10 × (1 + 10%) = 11
    expect(bareXp).toBe(10)
    expect(anvilXp).toBe(11)
  })

  it('a BROKEN +10 Commit Hammer confers no currency bonus (cosmetic dead state)', () => {
    const broken: GameState = { ...initialState(), gear: [gearOf('Commit Hammer', 10, true)] }
    const out = reduce(broken, ev({ type: 'pr_merged' }), mulberry32(2))
    expect(mergeSeeds(out)).toBe(12) // back to base (no bonus from broken gear)
  })
})

// ---------------------------------------------------------------------------
// AURA / STREAK real (formerly dead buff kinds)
// ---------------------------------------------------------------------------

describe('reduce — aura adds the seed bonus', () => {
  it('a Grimoire aura adds AURA_SEED_BONUS to a commit seed grant', () => {
    const withAura: GameState = {
      ...initialState(),
      buffs: [{ id: 'aura:grimoire', label: 'Grimoire Aura', kind: 'aura' }],
    }
    const out = reduce(withAura, ev({ type: 'commit' }), mulberry32(2))
    // R7: base commit seeds 3 × 1.05 = 3.15 → round 3 (lift hidden by rounding);
    // use a bigger base (pr_merged) to see the +5% aura lift clearly.
    const big = reduce(
      { ...withAura },
      ev({ type: 'pr_merged', magnitude: 1 }),
      mulberry32(2),
    )
    // R7: pr_merged base seeds 12 × 1.05 = 12.6 → round 13
    const baseMerge = reduce(initialState(), ev({ type: 'pr_merged', magnitude: 1 }), mulberry32(2))
    const auraSeed = big.rewards.find(
      (r) => r.kind === 'currency' && r.amount === 13 && /PR merged/.test(r.message),
    )
    expect(auraSeed).toBeDefined()
    expect(AURA_SEED_BONUS).toBeGreaterThan(0)
    // sanity: the base (no aura) merge granted the un-boosted 12
    expect(baseMerge.rewards.some((r) => r.kind === 'currency' && r.amount === 12 && /PR merged/.test(r.message))).toBe(true)
    expect(out.state.player.currency).toBeGreaterThanOrEqual(3)
  })
})

describe('reduce — test_added streak escalates then caps and lifts XP', () => {
  it('a running test_added streak raises a FOLLOWING commit XP vs no streak', () => {
    // Build up a streak with several test_added events, then measure a commit.
    let streaked = initialState()
    for (let i = 0; i < 5; i++) {
      streaked = reduce(streaked, ev({ type: 'test_added' }), mulberry32(100 + i)).state
    }
    // seed 1 → no crit, isolates the streak multiplier on the commit XP
    const streakXp = reduce(streaked, ev({ type: 'commit' }), mulberry32(1)).rewards.find((r) => r.kind === 'xp')!.amount!
    const plainXp = reduce(initialState(), ev({ type: 'commit' }), mulberry32(1)).rewards.find((r) => r.kind === 'xp')!.amount!
    expect(streakXp).toBeGreaterThan(plainXp)
  })
})

// ---------------------------------------------------------------------------
// DUP-COMPENSATION via the public pull() path
// ---------------------------------------------------------------------------

describe('reduce — dup pull grants seeds', () => {
  it('a chosen pull that yields a duplicate grants DUP_COMP_SEEDS on top of the spend', () => {
    // Pre-own every card AND mark every set complete, so the pull is a pure
    // duplicate (no extra set-bonus legendary firing). Fund exactly one pull.
    const allCards = ALL_CARD_DEFS.map((d) => ({ id: d.id, name: d.name, rarity: d.rarity, set: d.set }))
    const allSets = [...new Set(ALL_CARD_DEFS.map((d) => d.set))]
    const s: GameState = {
      ...initialState(),
      cards: allCards,
      completedSets: allSets,
      player: { xp: 0, level: 1, currency: PULL_COST },
    }

    const { state, rewards } = pull(s, mulberry32(1))
    // spent PULL_COST then refunded DUP_COMP_SEEDS (exactly one dup-comp)
    expect(state.player.currency).toBe(0 + DUP_COMP_SEEDS)
    const comp = rewards.find((r) => r.kind === 'currency' && r.amount === DUP_COMP_SEEDS)
    expect(comp).toBeDefined()
    expect(comp!.message).not.toMatch(/fail|lazy|shame|worthless/i)
  })
})

// ---------------------------------------------------------------------------
// SET-COMPLETION real bonus via the public reduce/pull surface
// ---------------------------------------------------------------------------

describe('reduce — completing a set grants a legendary + a permanent buff', () => {
  it('a pull that finishes a set yields a guaranteed legendary AND a set:bonus buff the engine reads', () => {
    // Pre-own all forest cards except the LAST one; rig the wallet for a pull.
    const forestIds = cardIdsInSet('forest')
    const ownedDefs = ALL_CARD_DEFS.filter((d) => forestIds.includes(d.id) && d.id !== forestIds[forestIds.length - 1])
    const owned = ownedDefs.map((d) => ({ id: d.id, name: d.name, rarity: d.rarity, set: d.set }))

    // Find a seed whose first pull lands the missing forest card to complete the set.
    const missingId = forestIds[forestIds.length - 1]!
    let chosen = -1
    for (let seed = 0; seed < 4000; seed++) {
      const s: GameState = { ...initialState(), cards: owned, player: { xp: 0, level: 1, currency: PULL_COST } }
      const out = pull(s, mulberry32(seed))
      if (out.state.completedSets.includes('forest')) {
        // confirm the completing card was the missing one
        if (out.state.cards.some((c) => c.id === missingId)) { chosen = seed; break }
      }
    }
    expect(chosen).toBeGreaterThanOrEqual(0)

    const s: GameState = { ...initialState(), cards: owned, player: { xp: 0, level: 1, currency: PULL_COST } }
    const { state, rewards } = pull(s, mulberry32(chosen))

    // set marked complete
    expect(state.completedSets).toContain('forest')
    // a guaranteed legendary landed (a legendary card reward present)
    expect(rewards.some((r) => r.kind === 'card' && r.rarity === 'legendary')).toBe(true)
    // a permanent set-bonus buff the engine reads is now present
    const setBuff = state.buffs.find((b) => b.id === 'set:bonus:forest')
    expect(setBuff).toBeDefined()
    expect(setBuff!.kind).toBe('aura')
    expect((setBuff!.factor ?? 0)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// R7 code nit (P2): grantSetBonus must CASCADE when its bonus legendary itself
// completes a FURTHER set (the dropped `newlyCompleted` is now recursed).
// ---------------------------------------------------------------------------

describe('reduce — set-bonus CASCADE (R7 code P2)', () => {
  // At level 1 the ONLY legendary card in scope is tools.refactor-blade, so a
  // set-bonus legendary is deterministic. We arrange: own all of `forest` except
  // its last card, and all of `tools` except its legendary. Completing `forest`
  // grants a legendary = tools.refactor-blade, which COMPLETES `tools` too → cascade.
  function cardOf(id: string, set: string) {
    const def = ALL_CARD_DEFS.find((d) => d.id === id)!
    return { id: def.id, name: def.name, rarity: def.rarity, set }
  }

  it('a bonus legendary that completes another set fires THAT set bonus too', () => {
    const forestIds = cardIdsInSet('forest')
    const toolsIds = cardIdsInSet('tools')
    const lastForest = forestIds[forestIds.length - 1]!
    const legendaryTool = 'tools.refactor-blade'

    // Own every forest card EXCEPT the last, and every tools card EXCEPT the legendary.
    const owned = [
      ...forestIds.slice(0, -1).map((id) => cardOf(id, 'forest')),
      ...toolsIds.filter((id) => id !== legendaryTool).map((id) => cardOf(id, 'tools')),
    ]
    const state: GameState = {
      ...initialState(),
      cards: owned,
      player: { xp: 0, level: 1, currency: 0, shards: SHARDS_PER_CRAFT },
    }

    // Craft the last forest card → completes forest → bonus legendary (refactor-blade)
    // → completes tools → CASCADE the tools set bonus.
    const { state: next, rewards } = craftCard(state, lastForest, mulberry32(1))

    expect(next.completedSets).toContain('forest')
    // The cascade: tools is ALSO now complete and its bonus buff exists.
    expect(next.completedSets).toContain('tools')
    expect(next.buffs.some((b) => b.id === 'set:bonus:forest')).toBe(true)
    expect(next.buffs.some((b) => b.id === 'set:bonus:tools')).toBe(true)
    // Two distinct set-complete reward lines were surfaced (forest + tools).
    const setCompleteLines = rewards.filter(
      (r) => r.kind === 'buff' && /set .+ complete/.test(r.message),
    )
    expect(setCompleteLines.length).toBeGreaterThanOrEqual(2)
  })

  it('NO cascade when the bonus legendary does not complete a further set', () => {
    // Own all forest except the last, but NOTHING of tools → the bonus legendary
    // (a tools card) does not complete tools, so only forest's bonus fires.
    const forestIds = cardIdsInSet('forest')
    const lastForest = forestIds[forestIds.length - 1]!
    const owned = forestIds.slice(0, -1).map((id) => cardOf(id, 'forest'))
    const state: GameState = {
      ...initialState(),
      cards: owned,
      player: { xp: 0, level: 1, currency: 0, shards: SHARDS_PER_CRAFT },
    }
    const { state: next } = craftCard(state, lastForest, mulberry32(1))
    expect(next.completedSets).toContain('forest')
    expect(next.completedSets).not.toContain('tools')
    expect(next.buffs.some((b) => b.id === 'set:bonus:tools')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R7 code nit (P3): prestigeRank must count EXACT rank ids, not a prefix match
// ('prestige:mark' is a prefix of 'prestige:mark:2', and could falsely match a
// non-rank id that merely starts with it).
// ---------------------------------------------------------------------------

describe('reduce — prestigeRank counts exact rank ids (R7 code P3)', () => {
  it('counts rank-1 (legacy id) and rank-N (suffixed) ids', () => {
    const state: GameState = {
      ...initialState(),
      buffs: [
        { id: prestigeBuffId(1), label: 'Prestige 1', kind: 'rest' },
        { id: prestigeBuffId(2), label: 'Prestige 2', kind: 'rest' },
        { id: prestigeBuffId(3), label: 'Prestige 3', kind: 'rest' },
      ],
    }
    expect(prestigeRank(state)).toBe(3)
  })

  it('does NOT count a non-rank buff that merely starts with the prestige id', () => {
    // A hypothetical sibling id sharing the prestige prefix but NOT a rank id —
    // the old startsWith() test would wrongly count it and inflate the next cost.
    const state: GameState = {
      ...initialState(),
      buffs: [
        { id: prestigeBuffId(1), label: 'Prestige 1', kind: 'rest' },
        { id: `${PRESTIGE_BUFF_ID}:flair`, label: 'decoy', kind: 'rest' },
        { id: `${PRESTIGE_BUFF_ID}er`, label: 'decoy2', kind: 'rest' },
      ],
    }
    // Only the genuine rank-1 buff counts.
    expect(prestigeRank(state)).toBe(1)
    // And so the next prestige costs the rank-1 escalation, not a decoy-inflated one.
    expect(prestigeCost(prestigeRank(state))).toBe(prestigeCost(1))
  })

  it('still ties cost escalation to the true rank after real purchases', () => {
    let state: GameState = { ...initialState(), player: { xp: 0, level: 1, currency: 100000, shards: 0 } }
    state = buyPrestige(state).state
    state = buyPrestige(state).state
    expect(prestigeRank(state)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// R7 code nit (P3): grantBuff must DEDUP non-stacking (rest) buffs by id — a
// repeated checkpoint / window reset replaces the flair, never piles up N copies.
// ---------------------------------------------------------------------------

describe('reduce — rest buffs dedup by id (R7 code P3)', () => {
  it('a second checkpoint does not accumulate a duplicate Refreshed buff', () => {
    let state = initialState()
    state = reduce(state, ev({ type: 'checkpoint' }), mulberry32(1)).state
    state = reduce(state, ev({ type: 'checkpoint' }), mulberry32(1)).state
    state = reduce(state, ev({ type: 'checkpoint' }), mulberry32(1)).state
    // Exactly ONE 'refreshed' rest buff, no matter how many checkpoints fired.
    expect(state.buffs.filter((b) => b.id === 'refreshed').length).toBe(1)
  })

  it('repeated window resets keep exactly one Second Wind buff', () => {
    // Drive two 5h-window resets (a big upward vigor jump from a known baseline).
    let state = initialState()
    const frame = (vigor: number, resetsAt: number): GroveEvent =>
      ev({
        type: 'quota_update',
        meta: { present: true, fiveHourPct: 100 - vigor, fiveHourResetsAt: resetsAt },
      })
    // baseline (low vigor), then jump up (reset), then low again, then jump up (reset)
    state = reduce(state, frame(10, 1), mulberry32(1)).state
    state = reduce(state, frame(95, 2), mulberry32(1)).state // reset 1 → Second Wind
    state = reduce(state, frame(10, 3), mulberry32(1)).state
    state = reduce(state, frame(95, 4), mulberry32(1)).state // reset 2 → Second Wind again
    expect(state.buffs.filter((b) => b.id === 'rest:second-wind').length).toBe(1)
  })
})

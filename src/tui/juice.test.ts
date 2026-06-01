/**
 * juice.test.ts — the PURE "feel" helpers that wire CLI-grade juice into the TUI.
 *
 * Ink's useInput key routing isn't testable headless (no TTY/raw-mode under
 * vitest), so we test the PURE pieces the live <App> composes:
 *  - pickSalientReward — picks the HIGHEST-salience reward in a batch so the flash
 *    celebrates the level-up / set-complete / prestige / windfall, not the common card.
 *  - rarityColor — maps a Rarity onto an Ink color (+ bold for the top tier).
 *  - flashFor — builds the transient flash line from a DispatchResult: the salient
 *    reward's message on a change, OR a terse "can't: …" on a blocked/unaffordable action.
 *  - revealFrames — the pure frame list a mutating key plays BEFORE the result settles,
 *    honouring reduced-motion / non-TTY (no animation → empty list).
 *  - revealSteps — the pure stepper: the frames THEN the settled flash, in order.
 */

import { describe, it, expect } from 'vitest'
import type { Reward, Card, Gear } from '../core/rewards'
import {
  pickSalientReward,
  rarityColor,
  salientRarity,
  flashFor,
  revealFrames,
  revealSteps,
  xpBarSteps,
  synergyActivationFlash,
} from './juice'
import type { Rarity } from '../core/rewards'
import type { DispatchResult } from './app'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'

// --- fixtures --------------------------------------------------------------

function commonCard(): Card {
  return { id: 'c1', name: 'Sapling', rarity: 'common', set: 'forest' }
}
function legendaryCard(): Card {
  return { id: 'c2', name: 'Refactor Blade', rarity: 'legendary', set: 'tools' }
}
function someGear(): Gear {
  return { id: 'g1', name: 'Commit Hammer', level: 3, rarity: 'rare', broken: false }
}

function reward(kind: Reward['kind'], message: string, extra: Partial<Reward> = {}): Reward {
  return { kind, message, ...extra }
}

// ---------------------------------------------------------------------------
// pickSalientReward — salience ordering
// ---------------------------------------------------------------------------

describe('pickSalientReward — highest-salience pick', () => {
  it('chooses level-up over a common card', () => {
    const rewards: Reward[] = [
      reward('card', '🃏 Sapling · common', { card: commonCard(), rarity: 'common' }),
      reward('levelup', 'Level 4', { amount: 4 }),
    ]
    const pick = pickSalientReward(rewards)
    expect(pick?.kind).toBe('levelup')
    expect(pick?.message).toBe('Level 4')
  })

  it('chooses a set-complete buff over a legendary card', () => {
    const rewards: Reward[] = [
      reward('card', '✦ Refactor Blade · legendary', { card: legendaryCard(), rarity: 'legendary' }),
      reward('buff', '✦ set forest complete · +10% 🌰 (permanent)', { buff: 'set:bonus:forest' }),
    ]
    expect(pickSalientReward(rewards)?.kind).toBe('buff')
  })

  it('chooses a serendipity windfall over a common card', () => {
    const rewards: Reward[] = [
      reward('card', '🃏 Sapling · common', { card: commonCard(), rarity: 'common' }),
      reward('currency', '✨ windfall · +20 🌰', { amount: 20 }),
    ]
    expect(pickSalientReward(rewards)?.message).toContain('windfall')
  })

  it('chooses a prestige buff over a gear drop', () => {
    const rewards: Reward[] = [
      reward('gear', 'ENHANCE +3→+4 · ✓ success', { gear: someGear(), rarity: 'rare' }),
      reward('buff', '✦ Prestige 2 earned (permanent cosmetic)', { buff: 'prestige:mark:2' }),
    ]
    expect(pickSalientReward(rewards)?.message).toContain('Prestige')
  })

  it('chooses a legendary card over a gear drop', () => {
    const rewards: Reward[] = [
      reward('gear', 'ENHANCE +3→+4 · ✓ success', { gear: someGear(), rarity: 'rare' }),
      reward('card', '✦ Refactor Blade · legendary', { card: legendaryCard(), rarity: 'legendary' }),
    ]
    expect(pickSalientReward(rewards)?.kind).toBe('card')
  })

  it('chooses a gear drop over a common card', () => {
    const rewards: Reward[] = [
      reward('card', '🃏 Sapling · common', { card: commonCard(), rarity: 'common' }),
      reward('gear', 'ENHANCE +3→+4 · ✓ success', { gear: someGear(), rarity: 'rare' }),
    ]
    expect(pickSalientReward(rewards)?.kind).toBe('gear')
  })

  it('falls back to a plain card when nothing more salient exists', () => {
    const rewards: Reward[] = [
      reward('xp', '+30 XP · tests green', { amount: 30 }),
      reward('card', '🃏 Sapling · common', { card: commonCard(), rarity: 'common' }),
    ]
    expect(pickSalientReward(rewards)?.kind).toBe('card')
  })

  it('returns null for an empty batch', () => {
    expect(pickSalientReward([])).toBeNull()
  })

  it('never throws on a malformed reward array (missing optional fields)', () => {
    const rewards: Reward[] = [reward('currency', 'just seeds')]
    expect(() => pickSalientReward(rewards)).not.toThrow()
    expect(pickSalientReward(rewards)?.kind).toBe('currency')
  })
})

// ---------------------------------------------------------------------------
// rarityColor — rarity → Ink color
// ---------------------------------------------------------------------------

describe('rarityColor — rarity → Ink color', () => {
  it('maps common → gray (not bold)', () => {
    expect(rarityColor('common')).toEqual({ color: 'gray', bold: false })
  })
  it('maps uncommon → green', () => {
    expect(rarityColor('uncommon')).toEqual({ color: 'green', bold: false })
  })
  it('maps rare → blue', () => {
    expect(rarityColor('rare')).toEqual({ color: 'blue', bold: false })
  })
  it('maps epic → magenta', () => {
    expect(rarityColor('epic')).toEqual({ color: 'magenta', bold: false })
  })
  it('maps legendary → yellow + bold', () => {
    expect(rarityColor('legendary')).toEqual({ color: 'yellow', bold: true })
  })
  it('maps shiny → yellow + bold', () => {
    expect(rarityColor('shiny')).toEqual({ color: 'yellow', bold: true })
  })
  it('orders brightness with rarityRank (epic outranks rare)', () => {
    // sanity: higher tiers are visually hotter than lower tiers
    expect(rarityColor('legendary').bold).toBe(true)
    expect(rarityColor('rare').bold).toBe(false)
  })
})

describe('salientRarity — rarity of the picked reward (drives the flash tint)', () => {
  it('returns null for null', () => {
    expect(salientRarity(null)).toBeNull()
  })
  it("reads a card reward's rarity", () => {
    expect(salientRarity(reward('card', '✦ Refactor Blade · legendary', { card: legendaryCard() }))).toBe('legendary')
  })
  it("reads a gear reward's rarity", () => {
    expect(salientRarity(reward('gear', 'ENHANCE +3→+4 · ✓ success', { gear: someGear() }))).toBe('rare')
  })
  it("prefers an explicit reward.rarity when present", () => {
    expect(salientRarity(reward('card', 'x', { rarity: 'epic', card: commonCard() }))).toBe('epic')
  })
  it('returns null for a reward with no rarity (e.g. level-up / windfall)', () => {
    expect(salientRarity(reward('levelup', 'Level 4', { amount: 4 }))).toBeNull()
    expect(salientRarity(reward('currency', '✨ windfall · +20 🌰', { amount: 20 }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// flashFor — DispatchResult → transient flash line
// ---------------------------------------------------------------------------

describe('flashFor — the transient flash line', () => {
  it('flashes the SALIENT reward message on a change (level-up beats the card)', () => {
    const res: DispatchResult = {
      state: initialState(),
      changed: true,
      rewards: [
        reward('card', '🃏 Sapling · common', { card: commonCard(), rarity: 'common' }),
        reward('levelup', 'Level 4', { amount: 4 }),
      ],
    }
    const flash = flashFor(res)
    expect(flash).toContain('Level 4')
  })

  it("surfaces a terse 'can't: …' when an action is blocked/unaffordable", () => {
    // The enhanceFocused refusal pushes a currency reward whose message starts
    // with the engine's 'not enough …' copy; changed=false drives the can't flash.
    const res: DispatchResult = {
      state: initialState(),
      changed: false,
      rewards: [
        reward('currency', 'not enough 🌰 · enhance costs 40, have 0'),
      ],
    }
    const flash = flashFor(res)
    expect(flash).not.toBeNull()
    expect(flash!.toLowerCase()).toContain("can't")
    expect(flash).toContain('not enough')
  })

  it('returns null when nothing changed AND there is no refusal message', () => {
    const res: DispatchResult = { state: initialState(), changed: false, rewards: [] }
    expect(flashFor(res)).toBeNull()
  })

  it("flashes a generic can't when blocked with no engine message (e.g. no gear to enhance)", () => {
    const res: DispatchResult = { state: initialState(), changed: false, rewards: [] }
    // With an explicit blocked key context the helper still yields a can't line.
    const flash = flashFor(res, 'e')
    expect(flash).not.toBeNull()
    expect(flash!.toLowerCase()).toContain("can't")
  })

  it.each([
    ['e', 'no gear to enhance'],
    ['c', 'nothing to craft'],
    ['p', 'not enough'],
    ['P', 'not enough'],
    ['b', 'prestige'],
  ])("blocked action key '%s' (no engine msg) yields a specific can't line", (key, frag) => {
    const res: DispatchResult = { state: initialState(), changed: false, rewards: [] }
    const flash = flashFor(res, key)
    expect(flash).not.toBeNull()
    expect(flash!.toLowerCase()).toContain("can't")
    expect(flash!.toLowerCase()).toContain(frag.toLowerCase())
  })

  it("a blocked nav/unmapped key (no engine msg) is NOT flashed (intentional no-op)", () => {
    const res: DispatchResult = { state: initialState(), changed: false, rewards: [] }
    expect(flashFor(res, 'r')).toBeNull()
    expect(flashFor(res, 'x')).toBeNull()
  })

  it('never throws on a changed result with an empty reward batch', () => {
    const res: DispatchResult = { state: initialState(), changed: true, rewards: [] }
    expect(() => flashFor(res)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// revealFrames — the pre-result animation frames
// ---------------------------------------------------------------------------

describe('revealFrames — the reveal animation frame list', () => {
  it('plays the PULL frames for a pull key (p)', () => {
    const frames = revealFrames('p', { animate: true })
    expect(frames.length).toBeGreaterThan(0)
    expect(frames[0]).toContain('🃏')
  })

  it('plays the PULL frames for a premium pull key (P)', () => {
    const frames = revealFrames('P', { animate: true })
    expect(frames.length).toBeGreaterThan(0)
    expect(frames[0]).toContain('🃏')
  })

  it('plays the ENHANCE (dice) frames for an enhance key (e)', () => {
    const frames = revealFrames('e', { animate: true })
    expect(frames.length).toBeGreaterThan(0)
    expect(frames[0]).toContain('🎲')
  })

  it('plays no frames for a non-mutating / non-reveal key (r refresh)', () => {
    expect(revealFrames('r', { animate: true })).toEqual([])
  })

  it('plays NO frames when animation is disabled (reduced-motion / non-TTY / tests)', () => {
    expect(revealFrames('p', { animate: false })).toEqual([])
    expect(revealFrames('e', { animate: false })).toEqual([])
  })

  it('defaults to no animation when opts omitted (test/CI-safe default)', () => {
    expect(revealFrames('p')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// revealSteps — the pure stepper: frames THEN the settled flash
// ---------------------------------------------------------------------------

describe('revealSteps — pure stepper yields frames then settles', () => {
  it('emits each animation frame in order, then the final settled flash', () => {
    const res: DispatchResult = {
      state: initialState(),
      changed: true,
      rewards: [reward('card', '🃏 Sapling · common', { card: commonCard(), rarity: 'common' })],
    }
    const steps = revealSteps('p', res, { animate: true })
    const frames = revealFrames('p', { animate: true })
    // frames first…
    expect(steps.slice(0, frames.length)).toEqual(frames)
    // …then exactly one settled step (the flash)
    expect(steps.length).toBe(frames.length + 1)
    expect(steps[steps.length - 1]).toContain('Sapling')
  })

  it('with animation OFF yields ONLY the settled flash (no frames)', () => {
    const res: DispatchResult = {
      state: initialState(),
      changed: true,
      rewards: [reward('levelup', 'Level 4', { amount: 4 })],
    }
    const steps = revealSteps('p', res, { animate: false })
    expect(steps.length).toBe(1)
    expect(steps[0]).toContain('Level 4')
  })

  it('settles to the can\'t flash (no frames) on a blocked action', () => {
    const res: DispatchResult = {
      state: initialState(),
      changed: false,
      rewards: [reward('currency', 'not enough 🌰 · enhance costs 40, have 0')],
    }
    // A blocked action plays NO frames (nothing to reveal) and settles on the can't line.
    const steps = revealSteps('e', res, { animate: true })
    expect(steps.length).toBe(1)
    expect(steps[0]!.toLowerCase()).toContain("can't")
  })

  it('a no-op refresh yields zero steps (no frames, no flash)', () => {
    const res: DispatchResult = { state: initialState(), changed: false, rewards: [] }
    expect(revealSteps('r', res, { animate: true })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// revealFrames / revealSteps — rarity-SCALED (rarer drop → longer build)
// ---------------------------------------------------------------------------

describe('revealFrames — rarity scales the build', () => {
  it('a legendary pull plays a LONGER build than a common pull', () => {
    const common = revealFrames('p', { animate: true, rarity: 'common' })
    const legendary = revealFrames('p', { animate: true, rarity: 'legendary' })
    expect(legendary.length).toBeGreaterThan(common.length)
  })

  it('a legendary enhance plays a LONGER build than a common enhance', () => {
    const common = revealFrames('e', { animate: true, rarity: 'common' })
    const legendary = revealFrames('e', { animate: true, rarity: 'legendary' })
    expect(legendary.length).toBeGreaterThan(common.length)
  })

  it('omitting rarity still yields a non-empty build (backward-compatible)', () => {
    expect(revealFrames('p', { animate: true }).length).toBeGreaterThan(0)
  })

  it('rarity has no effect when animation is OFF (always empty)', () => {
    expect(revealFrames('p', { animate: false, rarity: 'legendary' })).toEqual([])
  })
})

describe('revealSteps — feeds rarity through so a rarer drop suspends longer', () => {
  function cardRes(rarity: Rarity): DispatchResult {
    return {
      state: initialState(),
      changed: true,
      rewards: [reward('card', `🃏 X · ${rarity}`, { rarity })],
    }
  }

  it('a legendary drop produces MORE total steps than a common drop', () => {
    const common = revealSteps('p', cardRes('common'), { animate: true, rarity: 'common' })
    const legendary = revealSteps('p', cardRes('legendary'), { animate: true, rarity: 'legendary' })
    expect(legendary.length).toBeGreaterThan(common.length)
  })

  it('the LAST step is always the settled flash regardless of rarity', () => {
    const steps = revealSteps('p', cardRes('legendary'), { animate: true, rarity: 'legendary' })
    expect(steps[steps.length - 1]).toContain('legendary')
  })
})

// ---------------------------------------------------------------------------
// flashFor — refusal regex must catch the NEW foil/premium refusals
// ---------------------------------------------------------------------------

describe('flashFor — completed refusal regex (foil / premium / craft variants)', () => {
  // The exact engine refusal copy (src/engine/reduce.ts) — every line MUST surface
  // as a can't flash, not be silently dropped.
  it.each([
    'not enough 🌰 · need 45, have 0',
    'not enough 🌰 · premium needs 225, have 0',
    'not enough shards — craft needs 60, have 0',
    'not enough 🌰 — prestige 1 costs 100, have 0',
    'not enough shards — foil needs 30, have 0',
    "can't foil card.forest.1 — you don't own it",
    'card.forest.1 is already foiled',
    'nothing to foil — no cards owned yet',
    'nothing left to foil — all owned cards are foiled',
    'nothing left to craft — collection complete',
    '🔒 card.x is in a locked set — can\'t craft yet',
    "can't craft card.x — already owned or not craftable",
  ])('surfaces a can\'t flash for refusal copy: %s', (msg) => {
    const res: DispatchResult = {
      state: initialState(),
      changed: false,
      rewards: [reward('currency', msg)],
    }
    const flash = flashFor(res)
    expect(flash).not.toBeNull()
    expect(flash!.toLowerCase()).toContain("can't")
  })

  it('a non-refusal reward on a no-op (no key) is still NOT flashed', () => {
    // A neutral currency line that is not a refusal should not produce a can't.
    const res: DispatchResult = {
      state: initialState(),
      changed: false,
      rewards: [reward('currency', '+12 🌰 · work tracked')],
    }
    expect(flashFor(res)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// xpBarSteps — the pure XP-bar fill interpolation stepper (panel motion)
// ---------------------------------------------------------------------------

describe('xpBarSteps — interpolates the fill fraction toward the target', () => {
  it('starts at the FROM fraction and ENDS exactly at the target', () => {
    const steps = xpBarSteps(0, 1, { animate: true })
    expect(steps[0]).toBeCloseTo(0)
    expect(steps[steps.length - 1]).toBeCloseTo(1)
  })

  it('is monotonically non-decreasing when filling UP (0 → 1)', () => {
    const steps = xpBarSteps(0.2, 0.9, { animate: true })
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!)
    }
  })

  it('produces MULTIPLE intermediate steps for a visible fill (animate on)', () => {
    const steps = xpBarSteps(0, 1, { animate: true })
    expect(steps.length).toBeGreaterThan(2)
  })

  it('a level-up wrap (0.9 → 0.1) interpolates UP to 1 then settles at the target', () => {
    // When XP wraps past a level the bar fills to full, then the new level
    // starts low — the stepper must still END at the final target.
    const steps = xpBarSteps(0.9, 0.1, { animate: true, wrapped: true })
    expect(steps[steps.length - 1]).toBeCloseTo(0.1)
    // It visibly fills toward full before resetting (a step reaches near 1).
    expect(Math.max(...steps)).toBeGreaterThan(0.9)
  })

  it('with animation OFF yields ONLY the target (instant, no motion)', () => {
    expect(xpBarSteps(0, 1, { animate: false })).toEqual([1])
  })

  it('a no-change gain (from === to) yields a single settled step', () => {
    expect(xpBarSteps(0.5, 0.5, { animate: true })).toEqual([0.5])
  })

  it('clamps fractions into [0,1]', () => {
    const steps = xpBarSteps(-0.5, 1.5, { animate: true })
    for (const s of steps) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  it('never throws on degenerate input', () => {
    expect(() => xpBarSteps(0, 0, { animate: true })).not.toThrow()
    expect(() => xpBarSteps(1, 0, { animate: true })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// synergyActivationFlash — celebratory TUI flash for a newly-active synergy
// ---------------------------------------------------------------------------

describe('synergyActivationFlash — celebratory flash for a freshly-active synergy', () => {
  it('returns a non-empty string containing the synergy name', () => {
    const flash = synergyActivationFlash('Toolsmith')
    expect(flash).not.toBeNull()
    expect(flash!.length).toBeGreaterThan(0)
    expect(flash).toContain('Toolsmith')
  })

  it('contains the ✦ sparkle marker (celebration, not a plain message)', () => {
    expect(synergyActivationFlash('Merchant')).toContain('✦')
  })

  it('zen mode returns null — no flash in calm mode', () => {
    expect(synergyActivationFlash('Toolsmith', { isZen: true })).toBeNull()
  })

  it('non-zen mode (default) returns a non-null flash', () => {
    expect(synergyActivationFlash('Precision')).not.toBeNull()
  })

  it('never throws on an empty synergy name', () => {
    expect(() => synergyActivationFlash('')).not.toThrow()
  })

  it('the flash is terse — no em-dash (uses · separator per tone)', () => {
    const flash = synergyActivationFlash('Naturalist')
    expect(flash).not.toContain('—')
  })
})

// type-only: keep GameState import meaningful for fixtures
const _typecheck: GameState = initialState()
void _typecheck

/**
 * economy.reveal.test.ts — guards that the CLI pull reveal ESCALATES by rarity
 * (the R10 FEEL-surface fix). R9 built rarity-scaled suspense (render/enhance.ts
 * buildRevealFrames) + wired it in the Ink TUI, but the PRIMARY documented CLI
 * commands (`sq pull` / `sq enhance`) still played the flat default build — a
 * common pull looked identical to a shiny on the shell. This guards the pure
 * decision the CLI now composes (revealRarityFor) + the escalation it feeds, so
 * the marquee anticipation reaches the surface most players hit first and stays
 * wired. (playReveal itself is TTY-only / skipped in pipes, so we test the seam.)
 */
import { describe, it, expect } from 'vitest'
import { revealRarityFor } from './economy'
import { renderPullFrames } from '../../render/enhance'
import type { Reward } from '../../core/rewards'

const cardReward = (rarity: Reward['rarity']): Reward => ({
  kind: 'card',
  rarity,
  message: `card · ${rarity}`,
})

describe('revealRarityFor — the CLI reveal escalates by the salient drop (R10 FEEL surface)', () => {
  it('returns the salient card rarity from a one-card pull batch', () => {
    expect(revealRarityFor([cardReward('legendary')])).toBe('legendary')
    expect(revealRarityFor([cardReward('common')])).toBe('common')
  })

  it('picks the headline tier when a batch mixes rarities (legendary outranks common)', () => {
    // pickSalientReward scores a legendary card (3) over a common card (1).
    const batch = [cardReward('common'), cardReward('legendary')]
    expect(revealRarityFor(batch)).toBe('legendary')
  })

  it('is undefined for an empty batch (so the reveal falls back to the neutral build)', () => {
    expect(revealRarityFor([])).toBeUndefined()
  })

  it('feeds a STRICTLY longer reveal for a legendary pull than a common (escalation reaches the CLI)', () => {
    const legendary = renderPullFrames(revealRarityFor([cardReward('legendary')]))
    const common = renderPullFrames(revealRarityFor([cardReward('common')]))
    expect(legendary.length).toBeGreaterThan(common.length)
  })
})

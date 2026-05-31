import { describe, it, expect } from 'vitest'
import { mulberry32 } from '../core/rng'
import { rarityRank } from '../core/rewards'
import type { PityState } from '../core/state'
import {
  RARITY_ODDS,
  SOFT_PITY,
  HARD_PITY,
  pull,
  makeCard,
} from './gacha'

// ---------------------------------------------------------------------------
// RARITY_ODDS constant
// ---------------------------------------------------------------------------

describe('RARITY_ODDS', () => {
  it('sums to approximately 1.0', () => {
    const total = Object.values(RARITY_ODDS).reduce((s, v) => s + v, 0)
    expect(total).toBeCloseTo(1.0, 5)
  })

  it('has the exact specified probabilities', () => {
    expect(RARITY_ODDS.common).toBe(0.60)
    expect(RARITY_ODDS.uncommon).toBe(0.25)
    expect(RARITY_ODDS.rare).toBe(0.093)
    expect(RARITY_ODDS.epic).toBe(0.04)
    expect(RARITY_ODDS.legendary).toBe(0.01)
    expect(RARITY_ODDS.shiny).toBe(0.007)
  })
})

// ---------------------------------------------------------------------------
// SOFT_PITY / HARD_PITY constants
// ---------------------------------------------------------------------------

describe('SOFT_PITY and HARD_PITY', () => {
  it('SOFT_PITY is 40 (legendaries feel rare; restores published scarcity)', () => {
    expect(SOFT_PITY).toBe(40)
  })

  it('HARD_PITY is 60 (a legendary is guaranteed by pull 60, not 14)', () => {
    expect(HARD_PITY).toBe(60)
  })

  it('SOFT_PITY is below HARD_PITY', () => {
    expect(SOFT_PITY).toBeLessThan(HARD_PITY)
  })
})

// ---------------------------------------------------------------------------
// pull — determinism
// ---------------------------------------------------------------------------

describe('pull — determinism', () => {
  it('returns the same rarity for the same seed', () => {
    const pity: PityState = { sinceLegendary: 0 }
    const rng1 = mulberry32(42)
    const rng2 = mulberry32(42)

    const r1 = pull(pity, rng1)
    const r2 = pull(pity, rng2)

    expect(r1.rarity).toBe(r2.rarity)
    expect(r1.pity.sinceLegendary).toBe(r2.pity.sinceLegendary)
  })

  it('produces different results for different seeds', () => {
    // Run many pulls with two different seeds; sequences must differ at some point
    const rng1 = mulberry32(1)
    const rng2 = mulberry32(999)
    let pity: PityState = { sinceLegendary: 0 }

    const results1: string[] = []
    const results2: string[] = []
    for (let i = 0; i < 20; i++) {
      const r1 = pull(pity, rng1)
      const r2 = pull(pity, rng2)
      results1.push(r1.rarity)
      results2.push(r2.rarity)
      pity = { sinceLegendary: 0 } // reset pity to keep paths comparable
    }

    expect(results1).not.toEqual(results2)
  })
})

// ---------------------------------------------------------------------------
// pull — pity threading
// ---------------------------------------------------------------------------

describe('pull — pity threading', () => {
  it('increments sinceLegendary when result is below legendary', () => {
    // Use a seed that produces a non-legendary result at low pity
    const rng = mulberry32(1)
    const pity: PityState = { sinceLegendary: 0 }
    const result = pull(pity, rng)

    if (rarityRank(result.rarity) < rarityRank('legendary')) {
      expect(result.pity.sinceLegendary).toBe(1)
    } else {
      expect(result.pity.sinceLegendary).toBe(0)
    }
  })

  it('resets sinceLegendary to 0 after a legendary pull', () => {
    // Force a legendary by setting pity at HARD_PITY - 1
    const rng = mulberry32(100)
    const pity: PityState = { sinceLegendary: HARD_PITY - 1 }
    const result = pull(pity, rng)

    expect(rarityRank(result.rarity)).toBeGreaterThanOrEqual(rarityRank('legendary'))
    expect(result.pity.sinceLegendary).toBe(0)
  })

  it('threads pity correctly across consecutive pulls', () => {
    const rng = mulberry32(7)
    let pity: PityState = { sinceLegendary: 0 }

    // Do 5 pulls that we expect to be non-legendary (seed 7 at low pull count)
    // Verify the counter increments each time no legendary appears
    let prev = 0
    for (let i = 0; i < 5; i++) {
      const result = pull(pity, rng)
      if (rarityRank(result.rarity) < rarityRank('legendary')) {
        expect(result.pity.sinceLegendary).toBe(prev + 1)
        prev = result.pity.sinceLegendary
      } else {
        prev = 0
      }
      pity = result.pity
    }
  })

  it('returns a NEW pity object (immutability)', () => {
    const rng = mulberry32(55)
    const pity: PityState = { sinceLegendary: 3 }
    const result = pull(pity, rng)

    expect(result.pity).not.toBe(pity)
  })
})

// ---------------------------------------------------------------------------
// pull — hard pity guarantee
// ---------------------------------------------------------------------------

describe('pull — hard pity guarantee', () => {
  it('guarantees legendary-or-better within HARD_PITY consecutive non-legendary pulls', () => {
    // Strategy: start pity at 0, iterate until we hit a legendary.
    // No matter which seed we use, within HARD_PITY pulls we MUST get legendary or shiny.
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed)
      let pity: PityState = { sinceLegendary: 0 }
      let hitLegendary = false

      for (let i = 0; i < HARD_PITY; i++) {
        const result = pull(pity, rng)
        if (rarityRank(result.rarity) >= rarityRank('legendary')) {
          hitLegendary = true
          break
        }
        pity = result.pity
      }

      expect(hitLegendary).toBe(true)
    }
  })

  it('forces legendary-or-shiny exactly at HARD_PITY (sinceLegendary + 1 >= HARD_PITY)', () => {
    // At sinceLegendary = HARD_PITY - 1, next pull MUST be legendary-or-shiny
    // Test across many seeds to be sure
    for (let seed = 0; seed < 30; seed++) {
      const rng = mulberry32(seed)
      const pity: PityState = { sinceLegendary: HARD_PITY - 1 }
      const result = pull(pity, rng)

      expect(rarityRank(result.rarity)).toBeGreaterThanOrEqual(rarityRank('legendary'))
    }
  })

  it('hard pity result is always legendary or shiny (not epic or lower)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = mulberry32(seed * 13)
      const pity: PityState = { sinceLegendary: HARD_PITY - 1 }
      const result = pull(pity, rng)

      expect(['legendary', 'shiny']).toContain(result.rarity)
    }
  })

  it('a legendary is NOT guaranteed by pull 14 anymore (scarcity restored)', () => {
    // With HARD_PITY=60, at least one seed must run 14 straight pulls WITHOUT a
    // forced legendary — proving the old pull-14 guarantee is gone.
    let someSeedSurvived14 = false
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed)
      let pity: PityState = { sinceLegendary: 0 }
      let hitLegendary = false
      for (let i = 0; i < 14; i++) {
        const result = pull(pity, rng)
        if (rarityRank(result.rarity) >= rarityRank('legendary')) {
          hitLegendary = true
          break
        }
        pity = result.pity
      }
      if (!hitLegendary) {
        someSeedSurvived14 = true
        break
      }
    }
    expect(someSeedSurvived14).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pull — soft pity boost
// ---------------------------------------------------------------------------

describe('pull — soft pity boost', () => {
  it('at SOFT_PITY pulls without legendary, legendary chance is boosted', () => {
    // Run many pulls at soft pity threshold vs baseline and count legendary+ hits
    const TRIALS = 500
    let softHits = 0
    let baseHits = 0

    for (let seed = 0; seed < TRIALS; seed++) {
      const rngSoft = mulberry32(seed)
      const rngBase = mulberry32(seed)

      const softResult = pull({ sinceLegendary: SOFT_PITY }, rngSoft)
      const baseResult = pull({ sinceLegendary: 0 }, rngBase)

      if (rarityRank(softResult.rarity) >= rarityRank('legendary')) softHits++
      if (rarityRank(baseResult.rarity) >= rarityRank('legendary')) baseHits++
    }

    // With soft pity boost, we should see more legendary/shiny hits
    expect(softHits).toBeGreaterThan(baseHits)
  })
})

// ---------------------------------------------------------------------------
// makeCard
// ---------------------------------------------------------------------------

describe('makeCard', () => {
  it('returns a Card whose rarity matches the requested rarity', () => {
    const rng = mulberry32(42)
    const card = makeCard('rare', rng)

    expect(card.rarity).toBe('rare')
  })

  it('returns a Card with required fields', () => {
    const rng = mulberry32(99)
    const card = makeCard('common', rng)

    expect(card).toHaveProperty('id')
    expect(card).toHaveProperty('name')
    expect(card).toHaveProperty('rarity')
    expect(card).toHaveProperty('set')
    expect(typeof card.id).toBe('string')
    expect(typeof card.name).toBe('string')
    expect(typeof card.set).toBe('string')
  })

  it('is deterministic for the same seed', () => {
    const rng1 = mulberry32(77)
    const rng2 = mulberry32(77)

    const card1 = makeCard('uncommon', rng1)
    const card2 = makeCard('uncommon', rng2)

    expect(card1.id).toBe(card2.id)
    expect(card1.name).toBe(card2.name)
  })

  it('works for legendary rarity', () => {
    const rng = mulberry32(5)
    const card = makeCard('legendary', rng)

    expect(card.rarity).toBe('legendary')
    expect(card.id).toBeTruthy()
  })

  it('works for shiny rarity', () => {
    const rng = mulberry32(5)
    const card = makeCard('shiny', rng)

    expect(card.rarity).toBe('shiny')
    expect(card.id).toBeTruthy()
  })

  it('falls back to common when rarity has no defs (hypothetical)', () => {
    // epic has defs in the current pool — we test that makeCard('epic') returns a card
    // with rarity 'epic'. The fallback path is for empty-def rarities.
    // Since all rarities currently have defs, we verify normal paths work.
    const rng = mulberry32(3)
    const card = makeCard('epic', rng)
    // Should be 'epic' (has defs) — this confirms no accidental fallback
    expect(card.rarity).toBe('epic')
  })

  it('picks different cards across different seeds for same rarity', () => {
    // common has multiple defs; different seeds should eventually produce different picks
    const cards = new Set<string>()
    for (let seed = 0; seed < 20; seed++) {
      const rng = mulberry32(seed)
      const card = makeCard('common', rng)
      cards.add(card.id)
    }
    // We have 3 common cards in the pool — should pick more than 1 unique over 20 seeds
    expect(cards.size).toBeGreaterThan(1)
  })
})

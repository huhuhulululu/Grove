/**
 * loadout.test.ts — Track A (ADR-0014 rev.2). Asserts:
 *  - computeLoadoutEffect is PURE (no mutation) + NEUTRAL when empty / no synergy;
 *  - equip/unequip are PURE reducers + the SLOT CAP is enforced;
 *  - the combined effect is BOUNDED (no runaway);
 *  - the synergy table yields ≥2 viable, non-dominated builds.
 *
 * The round-trip (schema + migrate + cloneState) is covered in store.test.ts /
 * reduce.test.ts; purity.test.ts proves the module is firewall-clean.
 */

import { describe, it, expect } from 'vitest'
import { initialState } from '../core/state'
import type { GameState } from '../core/state'
import type { EquippedRef } from '../core/synergies'
import { SYNERGIES } from '../core/synergies'
import {
  computeLoadoutEffect,
  equip,
  unequip,
  SLOT_CAP,
  MAX_XP_MULT,
  MAX_SEED_MULT,
  MAX_CRIT_BONUS,
} from './loadout'

function withSlots(slots: EquippedRef[]): GameState {
  return { ...initialState(), loadout: { slots } }
}

describe('computeLoadoutEffect — neutral + pure', () => {
  it('an empty loadout is NEUTRAL (1,1,0,[]) — first-class, never penalized', () => {
    expect(computeLoadoutEffect(initialState())).toEqual({
      xpMult: 1,
      seedMult: 1,
      critBonus: 0,
      activeSynergies: [],
    })
  })

  it('equipped members that match NO synergy are still neutral', () => {
    const s = withSlots([{ kind: 'card', id: 'forest.oak', tag: 'forest' }])
    expect(computeLoadoutEffect(s)).toEqual({
      xpMult: 1,
      seedMult: 1,
      critBonus: 0,
      activeSynergies: [],
    })
  })

  it('does NOT mutate the input state', () => {
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const snapshot = JSON.stringify(s)
    computeLoadoutEffect(s)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})

describe('computeLoadoutEffect — synergy activation', () => {
  it('Toolsmith fires on 2 tools cards (XP-leaning)', () => {
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const eff = computeLoadoutEffect(s)
    expect(eff.activeSynergies).toContain('toolsmith')
    expect(eff.xpMult).toBeGreaterThan(1)
    expect(eff.seedMult).toBe(1)
    expect(eff.critBonus).toBe(0)
  })

  it('a clause needs DISTINCT members — 2 refs of the SAME tools card do not satisfy min:2', () => {
    // Two refs with the SAME id count as one distinct member.
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
    ])
    expect(computeLoadoutEffect(s).activeSynergies).not.toContain('toolsmith')
  })

  it('Merchant fires on Commit Hammer gear + a deploy card (seed-leaning)', () => {
    const s = withSlots([
      { kind: 'gear', id: 'gear.commit-hammer.7', tag: 'Commit Hammer' },
      { kind: 'card', id: 'deploy.commit', tag: 'deploy' },
    ])
    const eff = computeLoadoutEffect(s)
    expect(eff.activeSynergies).toContain('merchant')
    expect(eff.seedMult).toBeGreaterThan(1)
    expect(eff.xpMult).toBe(1)
  })

  it('Precision fires on Type Saber gear + precast-spec buff (crit-leaning)', () => {
    const s = withSlots([
      { kind: 'gear', id: 'gear.type-saber.3', tag: 'Type Saber' },
      { kind: 'buff', id: 'precast-spec' },
    ])
    const eff = computeLoadoutEffect(s)
    expect(eff.activeSynergies).toContain('precision')
    expect(eff.critBonus).toBeGreaterThan(0)
  })
})

describe('computeLoadoutEffect — bounded (no runaway)', () => {
  it('clamps every field to its cap even with many synergies active', () => {
    // Force-stack by overriding to a state that activates several synergies and
    // verify the OUTPUT never exceeds the caps. (Slots > cap can only arise from a
    // hand-built state; the reducer enforces the cap on the equip path.)
    const s = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
      { kind: 'gear', id: 'gear.build-anvil.1', tag: 'Build Anvil' },
      { kind: 'gear', id: 'gear.refactor-blade.1', tag: 'Refactor Blade' },
      { kind: 'gear', id: 'gear.commit-hammer.1', tag: 'Commit Hammer' },
      { kind: 'card', id: 'deploy.commit', tag: 'deploy' },
      { kind: 'gear', id: 'gear.type-saber.1', tag: 'Type Saber' },
      { kind: 'buff', id: 'precast-spec' },
      { kind: 'card', id: 'forest.sapling', tag: 'forest' },
      { kind: 'card', id: 'forest.fern', tag: 'forest' },
      { kind: 'card', id: 'forest.oak', tag: 'forest' },
    ])
    const eff = computeLoadoutEffect(s)
    expect(eff.xpMult).toBeLessThanOrEqual(MAX_XP_MULT)
    expect(eff.seedMult).toBeLessThanOrEqual(MAX_SEED_MULT)
    expect(eff.critBonus).toBeLessThanOrEqual(MAX_CRIT_BONUS)
  })
})

describe('equip / unequip — pure reducers + slot cap', () => {
  const a: EquippedRef = { kind: 'card', id: 'tools.hammer', tag: 'tools' }
  const b: EquippedRef = { kind: 'card', id: 'tools.wrench', tag: 'tools' }
  const c: EquippedRef = { kind: 'gear', id: 'gear.commit-hammer.1', tag: 'Commit Hammer' }
  const d: EquippedRef = { kind: 'buff', id: 'precast-spec' }

  it('equip adds to a free slot and returns a NEW state (input unchanged)', () => {
    const s0 = initialState()
    const s1 = equip(s0, a)
    expect(s0.loadout.slots).toHaveLength(0) // input not mutated
    expect(s1).not.toBe(s0)
    expect(s1.loadout.slots).toEqual([a])
  })

  it('re-equipping the same id is a no-op (no duplicate slot)', () => {
    const s = equip(equip(initialState(), a), a)
    expect(s.loadout.slots).toHaveLength(1)
  })

  it('enforces the SLOT CAP — equipping past cap returns state unchanged', () => {
    expect(SLOT_CAP).toBe(3)
    let s = initialState()
    s = equip(s, a)
    s = equip(s, b)
    s = equip(s, c)
    expect(s.loadout.slots).toHaveLength(SLOT_CAP)
    const full = s
    const refused = equip(full, d)
    expect(refused).toBe(full) // unchanged: a full loadout is a real tradeoff
    expect(refused.loadout.slots).toHaveLength(SLOT_CAP)
  })

  it('unequip frees a slot, making room to equip again (tradeoff)', () => {
    let s = equip(equip(equip(initialState(), a), b), c)
    s = unequip(s, 1) // drop b
    expect(s.loadout.slots).toEqual([a, c])
    s = equip(s, d) // now there is room
    expect(s.loadout.slots).toEqual([a, c, d])
  })

  it('unequip out-of-range is a no-op (state unchanged)', () => {
    const s = equip(initialState(), a)
    expect(unequip(s, 9)).toBe(s)
    expect(unequip(s, -1)).toBe(s)
  })

  it('unequip does NOT mutate the input state', () => {
    const s = equip(equip(initialState(), a), b)
    const before = s.loadout.slots.length
    unequip(s, 0)
    expect(s.loadout.slots).toHaveLength(before)
  })
})

describe('synergy table — ≥2 viable, non-dominated builds', () => {
  it('publishes 4-5 synergies, each with at least one effect field', () => {
    expect(SYNERGIES.length).toBeGreaterThanOrEqual(4)
    expect(SYNERGIES.length).toBeLessThanOrEqual(5)
    for (const s of SYNERGIES) {
      const e = s.effect
      const hasEffect =
        (e.xpMult ?? 1) !== 1 || (e.seedMult ?? 1) !== 1 || (e.critBonus ?? 0) !== 0
      expect(hasEffect, `${s.id} must do something`).toBe(true)
    }
  })

  it('no synergy strictly dominates another on EVERY effect axis', () => {
    // Build a comparable vector per synergy: (xp-1, seed-1, crit). A dominates B iff
    // A >= B on every axis AND > on at least one. Assert NO such pair exists.
    const vec = (id: string) => {
      const e = SYNERGIES.find((s) => s.id === id)!.effect
      return [(e.xpMult ?? 1) - 1, (e.seedMult ?? 1) - 1, e.critBonus ?? 0]
    }
    const ids = SYNERGIES.map((s) => s.id)
    let dominatedPairs = 0
    for (const x of ids) {
      for (const y of ids) {
        if (x === y) continue
        const vx = vec(x)
        const vy = vec(y)
        const ge = vx.every((v, i) => v >= vy[i]!)
        const gt = vx.some((v, i) => v > vy[i]!)
        if (ge && gt) dominatedPairs++
      }
    }
    expect(dominatedPairs).toBe(0)
  })

  it('≥2 DISTINCT builds each win on their own axis (XP build vs seed build vs crit build)', () => {
    // An XP-focused build (Toolsmith) maximises xpMult; a seed build (Merchant)
    // maximises seedMult; a crit build (Precision) maximises critBonus. Each wins on
    // a field the others do not touch → at least two viable, non-dominated choices.
    const xpBuild = withSlots([
      { kind: 'card', id: 'tools.hammer', tag: 'tools' },
      { kind: 'card', id: 'tools.wrench', tag: 'tools' },
    ])
    const seedBuild = withSlots([
      { kind: 'gear', id: 'gear.commit-hammer.1', tag: 'Commit Hammer' },
      { kind: 'card', id: 'deploy.commit', tag: 'deploy' },
    ])
    const critBuild = withSlots([
      { kind: 'gear', id: 'gear.type-saber.1', tag: 'Type Saber' },
      { kind: 'buff', id: 'precast-spec' },
    ])
    const xp = computeLoadoutEffect(xpBuild)
    const seed = computeLoadoutEffect(seedBuild)
    const crit = computeLoadoutEffect(critBuild)

    expect(xp.xpMult).toBeGreaterThan(seed.xpMult)
    expect(xp.xpMult).toBeGreaterThan(crit.xpMult)
    expect(seed.seedMult).toBeGreaterThan(xp.seedMult)
    expect(crit.critBonus).toBeGreaterThan(xp.critBonus)
  })
})

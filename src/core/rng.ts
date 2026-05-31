// Deterministic, seedable RNG (mulberry32) — same family Claude Code's /buddy uses.
// We deliberately embrace transparency: a solo, local, cosmetic-only game has nothing to
// hide, determinism makes the engine testable, and we never stake anything real or
// competitive on the RNG (see ADR-0002).

/** A pseudo-random generator returning a float in [0, 1). */
export type Rng = () => number

/** mulberry32 — tiny, fast, deterministic PRNG seeded by a 32-bit integer. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a hash of a string to a 32-bit seed (e.g. seed an RNG from a sessionId). */
export function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Weighted choice. Entries with weight 0 are never picked (unless all are 0). */
export function weightedPick<T>(
  rng: Rng,
  entries: ReadonlyArray<{ value: T; weight: number }>,
): T {
  if (entries.length === 0) throw new Error('weightedPick: no entries')
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0)
  if (total <= 0) return entries[entries.length - 1]!.value
  let r = rng() * total
  for (const e of entries) {
    r -= Math.max(0, e.weight)
    if (r < 0) return e.value
  }
  return entries[entries.length - 1]!.value
}

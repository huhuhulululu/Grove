/**
 * juice.ts — the PURE "feel" helpers that bring the CLI's juice into the Ink TUI.
 *
 * The live <App> dispatches a key onto an engine action; this module decides WHAT
 * to celebrate and HOW, with zero I/O so it's trivially testable headless (Ink's
 * useInput key routing can't run under vitest, so the juice logic lives here, not
 * inside the component):
 *
 *  - pickSalientReward — given a batch of rewards from one action, pick the
 *    HIGHEST-salience one so the flash celebrates the level-up / set-complete /
 *    prestige / serendipity-windfall (not the incidental common card).
 *  - rarityColor — map a Rarity onto an Ink color (+ bold for the top tier), used
 *    on the flash line AND the collection/gear rows.
 *  - flashFor — the transient flash line: the salient reward's celebratory message
 *    on a change, OR a terse "can't: …" on a blocked / unaffordable action.
 *  - revealFrames — the pure pre-result animation frames a mutating key plays
 *    (the EXISTING renderPullFrames / renderEnhanceFrames), honouring a
 *    reduced-motion / non-TTY / test escape (no animation → empty list).
 *  - revealSteps — the pure stepper: the animation frames in order, THEN the
 *    settled flash. The component drives this on a ~120ms interval.
 *
 * ADR-0005: everything here reads cosmetic state read-only and is firewall-safe.
 */

import type { Reward, Rarity } from '../core/rewards'
import { rarityRank } from '../core/rewards'
import { renderPullFrames, renderEnhanceFrames } from '../render/enhance'
import type { DispatchResult } from './app'

// ---------------------------------------------------------------------------
// pickSalientReward — the highest-salience reward in a batch
// ---------------------------------------------------------------------------

/**
 * Salience tiers (high → low), per the R8 spec:
 *   level-up / set-complete / prestige / serendipity-windfall   (4 · headline)
 *   legendary | shiny card                                      (3)
 *   gear                                                        (2)
 *   any other card (common…epic)                               (1)
 *   anything else (xp, plain currency, generic buff)           (0)
 *
 * The set-complete / prestige / windfall events are NOT distinct reward KINDS —
 * they ride on `buff` / `currency` rewards carrying a celebratory ✦/✨ marker in
 * their message (see engine/reduce.ts). We detect them by that marker so the
 * picker stays decoupled from the engine's exact wording.
 */
function salience(r: Reward): number {
  const msg = r.message ?? ''

  if (r.kind === 'levelup') return 4
  // set-complete · prestige (both ride a `buff` reward with a ✦ banner marker)
  if (r.kind === 'buff' && (msg.includes('set ') || msg.includes('Prestige')) && msg.includes('✦')) {
    return 4
  }
  // serendipity windfall (rides a `currency` reward with the ✨ windfall marker)
  if (r.kind === 'currency' && msg.includes('windfall')) return 4

  if (r.kind === 'card') {
    const rar = r.rarity ?? r.card?.rarity
    return rar !== undefined && rarityRank(rar) >= rarityRank('legendary') ? 3 : 1
  }
  if (r.kind === 'gear') return 2

  return 0
}

/**
 * Pick the single most celebration-worthy reward from one action's batch, or null
 * when the batch is empty. Stable: on a salience tie the FIRST reward wins (the
 * engine pushes the primary outcome first). Pure, never throws on sparse rewards.
 */
export function pickSalientReward(rewards: Reward[]): Reward | null {
  if (rewards.length === 0) return null
  let best = rewards[0]!
  let bestScore = salience(best)
  for (let i = 1; i < rewards.length; i++) {
    const r = rewards[i]!
    const s = salience(r)
    if (s > bestScore) {
      best = r
      bestScore = s
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// rarityColor — rarity → Ink color
// ---------------------------------------------------------------------------

/** An Ink-renderable color spec: a `<Text color=… bold=…>` pair. */
export interface RarityColor {
  /** an Ink color name (`gray` | `green` | `blue` | `magenta` | `yellow`). */
  color: string
  /** the top tier (legendary / shiny) renders bold for extra pop. */
  bold: boolean
}

/**
 * Map a rarity onto an Ink color, brightening with the tier (rarityRank order):
 *   common → gray · uncommon → green · rare → blue · epic → magenta ·
 *   legendary | shiny → yellow + bold.
 * Pure; an unknown rarity falls back to a neutral gray.
 */
export function rarityColor(rarity: Rarity): RarityColor {
  switch (rarity) {
    case 'common':
      return { color: 'gray', bold: false }
    case 'uncommon':
      return { color: 'green', bold: false }
    case 'rare':
      return { color: 'blue', bold: false }
    case 'epic':
      return { color: 'magenta', bold: false }
    case 'legendary':
    case 'shiny':
      return { color: 'yellow', bold: true }
    default:
      return { color: 'gray', bold: false }
  }
}

/** The rarity of the salient reward (card → its rarity, gear → its rarity), or null. */
export function salientRarity(r: Reward | null): Rarity | null {
  if (r === null) return null
  return r.rarity ?? r.card?.rarity ?? r.gear?.rarity ?? null
}

// ---------------------------------------------------------------------------
// flashFor — the transient flash line
// ---------------------------------------------------------------------------

/**
 * Matches every calm engine REFUSAL line (src/engine/reduce.ts + the TUI's own
 * enhance refusal). The engine never shames, so a blocked action just pushes a
 * friendly currency reward whose message we recognise here and surface as a terse
 * `can't: …` flash (rather than letting the action silently no-op). Each alt maps
 * to a concrete refusal so a NEW refusal copy is never silently dropped:
 *   - `not enough …`   → pull / premium / craft / prestige / foil / enhance shortfalls
 *   - `premium needs`  → the premium-pull shortfall (also caught by 'not enough')
 *   - `nothing to|left to …` → nothing to craft/foil · collection complete · all foiled
 *   - `no gear`         → no gear to enhance
 *   - `can't (foil|craft) …` → unowned / not-craftable target
 *   - `already foiled`  → idempotent foil refusal
 *   - `locked set`      → crafting a level-gated card
 *   - `costs \d`        → any "… costs N" shortfall phrasing
 */
const REFUSAL_RE =
  /not enough|premium needs|broke|nothing (?:to|left)|no gear|can't (?:foil|craft)|already foiled|locked set|costs \d/

/**
 * Detect an engine "refusal" reward — the calm line the engine pushes when an
 * action can't proceed (it carries no state change). Returns its message, or null.
 */
function refusalMessage(rewards: Reward[]): string | null {
  const refusal = rewards.find((r) => REFUSAL_RE.test(r.message ?? ''))
  return refusal ? refusal.message : null
}

/** A terse generic "can't" line per blocked key, when the engine gave no message. */
function genericCant(key?: string): string {
  switch (key) {
    case 'e':
      return "can't: no gear to enhance"
    case 'c':
      return "can't: nothing to craft"
    case 'p':
    case 'P':
      return "can't: not enough 🌰"
    case 'b':
      return "can't: not enough 🌰 for prestige"
    default:
      return "can't: nothing to do"
  }
}

/**
 * Build the transient flash line for one dispatched action:
 *  - changed=true  → the SALIENT reward's celebratory message (level-up / set /
 *    prestige / windfall / legendary > gear > card), prefixed with a ✨ spark.
 *  - changed=false → a terse `can't: …`: the engine's refusal copy when present,
 *    else a generic blocked-key line (so a blocked action never silently no-ops).
 *  - a true no-op (refresh / unmapped key with no rewards and no key context) → null.
 *
 * `key` (optional) lets a blocked action with no engine message still show a
 * specific can't line; a refresh ('r') / undefined key with nothing to say → null.
 * Pure, never throws on a sparse reward batch.
 */
export function flashFor(result: DispatchResult, key?: string): string | null {
  if (result.changed) {
    const salient = pickSalientReward(result.rewards)
    return salient ? `✨ ${salient.message}` : null
  }

  // Blocked / refused: surface the engine's calm refusal, else a generic can't.
  const refusal = refusalMessage(result.rewards)
  if (refusal !== null) return `can't: ${refusal}`

  // No engine message: only flash a generic can't for a real (mappable) action key,
  // not for refresh / nav / unmapped keys (those are intentional no-ops).
  if (key !== undefined && ['p', 'P', 'e', 'c', 'b'].includes(key)) {
    return genericCant(key)
  }
  return null
}

// ---------------------------------------------------------------------------
// revealFrames + revealSteps — the pre-result animation
// ---------------------------------------------------------------------------

/** Options for the reveal stepper. */
export interface RevealOpts {
  /**
   * whether to PLAY the suspense frames. The component sets this false under
   * reduced-motion (--no-anim), a non-TTY stdout, or tests/CI — so the reveal
   * settles instantly with no animation (matches the CLI's playReveal TTY guard).
   * Defaults to false (test/CI-safe).
   */
  animate?: boolean
  /**
   * the SALIENT rarity of the drop being revealed (the picked reward's rarity).
   * Scales the build: a rarer drop earns a longer, brighter, held-beat build so
   * the suspense itself signals "something big". Omitted → a neutral default build.
   */
  rarity?: Rarity
}

/**
 * The pure list of pre-result animation frames for a key. A pull (p / P) plays the
 * pack-opening frames; an enhance (e) plays the dice-roll frames; any other key
 * (refresh, nav, unmapped) plays nothing. Returns [] when animation is disabled.
 * The salient `rarity` (when known) SCALES the build — rarer drops suspend longer.
 * Re-uses the EXISTING render frame helpers — no animation re-implemented.
 */
export function revealFrames(key: string, opts: RevealOpts = {}): string[] {
  if (opts.animate !== true) return []
  switch (key) {
    case 'p':
    case 'P':
      return renderPullFrames(opts.rarity)
    case 'e':
      return renderEnhanceFrames(opts.rarity)
    default:
      return []
  }
}

/**
 * The full pure step sequence the component plays for one action: the suspense
 * frames (if animating) in order, THEN the settled flash line. The component
 * advances through these on a ~120ms interval, rendering each as the flash, so the
 * reveal plays BEFORE the drop settles (mirrors the CLI's playReveal → result).
 *
 *  - a CHANGED action: [frame₀ … frameₙ, settledFlash]
 *  - a BLOCKED action: [cantFlash]  (no frames — there's nothing to reveal)
 *  - a true no-op:      []          (refresh / unmapped → nothing happens)
 *
 * The `opts.rarity` scales the frame build (rarer → longer suspense). Pure; never throws.
 */
export function revealSteps(key: string, result: DispatchResult, opts: RevealOpts = {}): string[] {
  const settled = flashFor(result, key)
  // Frames only precede a real reveal (a changed action); a refusal has nothing to reveal.
  const frames = result.changed ? revealFrames(key, opts) : []
  return settled === null ? frames : [...frames, settled]
}

// ---------------------------------------------------------------------------
// xpBarSteps — the pure XP-bar fill interpolation (light panel motion, R9)
// ---------------------------------------------------------------------------

/** Options for the XP-bar fill stepper. */
export interface XpBarOpts {
  /**
   * whether to ANIMATE the fill. The component sets this false under reduced-motion
   * (--no-anim), a non-TTY stdout, or tests — so the bar jumps straight to the
   * target ([target]) with no motion. Defaults to false (test/CI-safe).
   */
  animate?: boolean
  /**
   * the gain crossed a level boundary: the bar fills toward FULL (1) first, then
   * resets and fills the new level from low toward `to`. Without this a level-up
   * would look like the bar shrinking. Defaults to false (a same-level gain).
   */
  wrapped?: boolean
}

/** Number of interpolation steps for one bar-fill leg (the 120ms-stepped beats). */
const XP_BAR_STEPS = 6

/** Clamp a fraction into [0,1]. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * The pure fill-fraction sequence the XP bar animates through, from `from` to
 * `to` (both 0..1 fill fractions). The component renders each fraction through the
 * SAME progress-bar formatter on the 120ms stepper, so the bar visibly fills
 * toward its new value (light panel motion — the last feel item).
 *
 *  - animate OFF                → `[to]` (instant jump, no motion).
 *  - from === to (no gain)      → `[to]` (nothing to animate).
 *  - a same-level gain          → a monotonic ramp `from → to`.
 *  - a level-up (`wrapped`)     → fill `from → 1` (full), THEN `0 → to` on the new
 *                                 level, so the wrap reads as "filled up & reset".
 *
 * Every fraction is clamped to [0,1]. Pure; never throws. The terminal fraction is
 * ALWAYS the clamped `to` so the bar settles exactly on the new value.
 */
export function xpBarSteps(from: number, to: number, opts: XpBarOpts = {}): number[] {
  const f = clamp01(from)
  const t = clamp01(to)

  if (opts.animate !== true || f === t) return [t]

  if (opts.wrapped === true) {
    // Two legs: fill up to full on the old level, then up from empty to the target.
    // Drop the second leg's leading 0 — the wrap is a single continuous motion.
    return [...ramp(f, 1), ...ramp(0, t).slice(1)]
  }
  return ramp(f, t)
}

/**
 * A monotonic interpolation from `a` to `b` over XP_BAR_STEPS beats, INCLUDING both
 * endpoints (so the leg starts where the bar IS and settles exactly on its target).
 * Pure.
 */
function ramp(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = 0; i <= XP_BAR_STEPS; i++) {
    out.push(clamp01(a + ((b - a) * i) / XP_BAR_STEPS))
  }
  return out
}

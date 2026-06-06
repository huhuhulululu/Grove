/**
 * app.tsx — the navigable, live-updating Ink TUI over the existing engine (M3).
 *
 * Three public seams:
 *  - `renderTuiFrame(state, opts?)` — a single STATIC frame string (headless/CI;
 *    pure, no I/O). The same view-model the live <App> renders.
 *  - `dispatchKey(state, key, focus, rng, opts?)` — the PURE key → engine-action
 *    router. Maps p=pull · e=enhance (focused gear) · c=craft · r=refresh · the
 *    premium pull (P) · prestige (b) onto the EXISTING engine actions and returns
 *    the next state + rewards + a `changed` flag. NO game logic re-implemented.
 *  - `<App dir initial seed?>` — the Ink component: renders the view-model as
 *    keyboard-navigable panels, dispatches keys, and PERSISTS each mutating
 *    action under withStateLock (then re-reads, so it reflects live state).
 *  - `runTui(dir, opts?)` — the interactive loop entry. `opts.once` renders one
 *    frame from persisted state and resolves it (for tests/CI) without an
 *    interactive session.
 *
 * The component is the IMPURE shell (fs via the store, wall-clock seed); the
 * router + frame renderer stay pure so they are trivially testable.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Box, Text, useApp, useInput, render as inkRender } from 'ink'

import type { GameState } from '../core/state'
import type { Reward, Rarity } from '../core/rewards'
import type { Rng } from '../core/rng'
import { mulberry32, hashStringToSeed } from '../core/rng'
import {
  pull as enginePull,
  pullPremium,
  buyPrestige,
} from '../engine/reduce'
import { craftCard } from '../engine/reduce'
import { enhance, enhanceCost } from '../engine/gear'
import { loadState, saveState, withStateLock } from '../store/store'

import { tuiModel, PANELS } from './model'
import type { Panel, TuiModel } from './model'
import {
  rarityColor,
  salientRarity,
  pickSalientReward,
  flashFor,
  revealSteps,
  xpBarSteps,
} from './juice'

import type { Locale } from '../i18n/types'
import { resolveLocale } from '../i18n/locale'
import { t } from '../i18n/t'
import { synergyEffectLine } from '../render/loadout'

// ---------------------------------------------------------------------------
// dispatchKey — the PURE key → engine-action router
// ---------------------------------------------------------------------------

/** Extra context a dispatch may need (which gear row is focused). */
export interface DispatchOpts {
  /** index of the focused gear (for the enhance key); defaults to 0. */
  focusedGearIndex?: number
}

/** The result of routing a key: the next state, any rewards, and whether it changed. */
export interface DispatchResult {
  state: GameState
  rewards: Reward[]
  /** true iff the engine action actually mutated state (drives the juicy highlight). */
  changed: boolean
}

/**
 * A freshly-acquired row to pulse for one beat (light panel motion, R9): a
 * collection set (by set name) or a gear (by id). Reused by the view to tint the
 * matching row with the salient rarity for a single ~120ms beat.
 */
export interface PulseTarget {
  kind: 'collection' | 'gear'
  /** the set name (collection) or gear id (gear) to highlight. */
  key: string
}

/**
 * Derive the row to pulse from the salient reward of one action: a card → its set
 * row; a gear → its gear row; anything else → no pulse. PURE; the component drives
 * the one-beat highlight from this. Exported for headless testing of the wiring.
 */
export function pulseTargetFor(salient: Reward | null): PulseTarget | null {
  if (salient === null) return null
  if (salient.kind === 'card' && salient.card) {
    return { kind: 'collection', key: salient.card.set }
  }
  if (salient.kind === 'gear' && salient.gear) {
    return { kind: 'gear', key: salient.gear.id }
  }
  return null
}

/**
 * Map a key onto an engine action. PURE: takes the rng explicitly, never reads
 * the clock or filesystem; returns a NEW state (the caller persists it).
 *
 *  - 'p' → pull (PULL_COST seeds)        · 'P' → premium pull
 *  - 'e' → enhance the FOCUSED gear      · 'c' → craft (default cheapest missing)
 *  - 'b' → buy the next prestige rank    · 'r' → refresh (re-read only; no-op)
 *  - anything else → calm no-op
 *
 * `changed` compares cards/gear/currency/shards/buffs cheaply so a refusal
 * (broke / nothing to craft / unmapped key) reports changed=false — the loop
 * then skips the highlight and the (redundant) save.
 */
export function dispatchKey(
  state: GameState,
  key: string,
  _focus: Panel,
  rng: Rng,
  opts: DispatchOpts = {},
): DispatchResult {
  switch (key) {
    case 'p': {
      const { state: next, rewards } = enginePull(state, rng)
      return { state: next, rewards, changed: didChange(state, next) }
    }
    case 'P': {
      const { state: next, rewards } = pullPremium(state, rng)
      return { state: next, rewards, changed: didChange(state, next) }
    }
    case 'e': {
      return enhanceFocused(state, rng, opts.focusedGearIndex ?? 0)
    }
    case 'c': {
      const { state: next, rewards } = craftCard(state, undefined, rng)
      return { state: next, rewards, changed: didChange(state, next) }
    }
    case 'b': {
      const { state: next, rewards } = buyPrestige(state)
      return { state: next, rewards, changed: didChange(state, next) }
    }
    case 'r':
    default:
      // Refresh / unmapped: a calm no-op (the loop re-reads on every render).
      return { state, rewards: [], changed: false }
  }
}

/**
 * Enhance the gear at `index`. Prices the attempt with the engine's level-scaling
 * `enhanceCost` and refuses calmly when broke or the index is out of range (no
 * debit, no roll) — mirroring the CLI's enhance guardrails, no logic duplicated.
 */
function enhanceFocused(state: GameState, rng: Rng, index: number): DispatchResult {
  const gear = state.gear[index]
  if (gear === undefined) {
    return { state, rewards: [], changed: false }
  }

  const cost = enhanceCost(gear.level)
  if (state.player.currency < cost) {
    return {
      state,
      rewards: [
        {
          kind: 'currency',
          amount: state.player.currency,
          message: `not enough 🌰 · enhance costs ${cost}, have ${state.player.currency}`,
        },
      ],
      changed: false,
    }
  }

  const isProtected = state.protectedGear.includes(gear.id)
  const { gear: enhanced, result } = enhance(gear, rng, isProtected)

  const newGear = state.gear.map((g, i) => (i === index ? enhanced : g))
  const newProtected = isProtected
    ? state.protectedGear.filter((id) => id !== gear.id)
    : state.protectedGear

  const next: GameState = {
    ...state,
    gear: newGear,
    protectedGear: newProtected,
    player: { ...state.player, currency: state.player.currency - cost },
  }
  const rewards: Reward[] = [
    {
      kind: 'gear',
      gear: enhanced,
      rarity: enhanced.rarity,
      message: enhanceMessage(gear.level, enhanced.level, result),
    },
  ]
  return { state: next, rewards, changed: true }
}

/** A terse enhance result line — canonical loot grammar (TONE.md / render/enhance.ts). */
function enhanceMessage(from: number, to: number, result: string): string {
  switch (result) {
    case 'success':
      return `ENHANCE +${from}→+${to} · ✓ success`
    case 'downgrade':
      return `ENHANCE +${from}→+${to} · ↓ +${to}`
    case 'break':
      return `ENHANCE +${from} · ✗ SHATTERED (code safe)`
    default:
      return `ENHANCE +${from} · – broken`
  }
}

/** Cheap structural "did anything change?" check for the highlight + save gate. */
function didChange(a: GameState, b: GameState): boolean {
  return (
    a.cards.length !== b.cards.length ||
    a.gear.length !== b.gear.length ||
    a.player.currency !== b.player.currency ||
    (a.player.shards ?? 0) !== (b.player.shards ?? 0) ||
    a.buffs.length !== b.buffs.length
  )
}

// ---------------------------------------------------------------------------
// renderTuiFrame — a single STATIC frame string (pure; headless/CI)
// ---------------------------------------------------------------------------

/** Options for a static frame render. */
export interface FrameOpts {
  /** which panel has focus (marks it in the frame). Default: 'Collection'. */
  focus?: Panel
  /** the focused gear index (marks the gear row). Default: 0. */
  focusedGearIndex?: number
  /** a transient highlight line (a fresh drop) to show under the header. */
  flash?: string
  /** the active locale; defaults to 'en'. */
  locale?: Locale
  /**
   * Calm mode (ADR-0005): when true the loadout / one-away HUD is suppressed.
   * Defaults to false (loadout visible in normal TUI mode).
   */
  zen?: boolean
}

/**
 * Render a single static text frame of the TUI. PURE: derives the view-model and
 * formats it as text — no React, no I/O — so tests/CI can assert on it directly.
 * The live <App> renders the SAME view-model with Ink boxes.
 */
export function renderTuiFrame(state: GameState, opts: FrameOpts = {}): string {
  const m = tuiModel(state)
  const focus: Panel = opts.focus ?? 'Collection'
  const locale: Locale = opts.locale ?? 'en'
  const zen: boolean = opts.zen ?? false
  const lines: string[] = []

  // -- Header -----------------------------------------------------------------
  const h = m.header
  const bar = progressBar(h.xpFraction, 12)
  lines.push(`${t(locale, 'ui.header.title', { level: h.level })}   XP [${bar}] ${h.xp}/${h.xpForLevel}`)
  lines.push(
    [
      t(locale, 'ui.header.seeds', { seeds: h.seeds }),
      t(locale, 'ui.header.shards', { shards: h.shards }),
      t(locale, 'ui.header.prestige', { rank: h.prestigeRank, cost: h.nextPrestigeCost }),
    ].join(' · '),
  )
  if (opts.flash) lines.push(opts.flash)
  lines.push('')

  // -- Collection -------------------------------------------------------------
  lines.push(panelTitle(t(locale, 'ui.panel.collection'), focus === 'Collection'))
  for (const c of m.collection) {
    if (c.locked) {
      lines.push(`  ${t(locale, 'ui.collection.locked', { set: c.set, level: c.unlockLevel })}`)
    } else {
      const done = c.complete ? t(locale, 'ui.collection.done') : ''
      const foil = c.foiled > 0 ? t(locale, 'ui.collection.foil', { foiled: c.foiled, total: c.total }) : ''
      lines.push(`  ${t(locale, 'ui.collection.row', { set: c.set, owned: c.owned, total: c.total, done })}${foil}`)
    }
  }
  lines.push('')

  // -- Gear -------------------------------------------------------------------
  lines.push(panelTitle(t(locale, 'ui.panel.gear'), focus === 'Gear'))
  if (m.gear.length === 0) {
    lines.push(`  ${t(locale, 'ui.gear.none')}`)
  } else {
    const focusedIdx = opts.focusedGearIndex ?? 0
    m.gear.forEach((g, i) => {
      const cursor = focus === 'Gear' && i === focusedIdx ? '▶ ' : '  '
      const broken = g.broken ? t(locale, 'ui.gear.broken') : ''
      const prot = g.protectedNow ? t(locale, 'ui.gear.protected') : ''
      const eff = g.effect ? ` · ${g.effect}` : ''
      lines.push(`${cursor}${g.name} +${g.level}${broken}${prot}${eff}`)
    })
  }
  lines.push('')

  // -- Quests -----------------------------------------------------------------
  lines.push(panelTitle(t(locale, 'ui.panel.quests'), focus === 'Quests'))
  for (const q of m.quests) {
    const glyph = q.status === 'done' ? '✓' : q.status === 'active' ? '◆' : '·'
    // Re-translate by id (the VM carries the raw English def.title), matching the
    // dashboard/format renderers; fall back to the raw title for a custom QuestDef
    // with no catalog entry (t() returns the key itself on a miss).
    const key = `quest.${q.id}.title`
    const ttl = t(locale, key)
    lines.push(`  ${glyph} ${ttl !== key ? ttl : q.title}`)
  }
  lines.push('')

  // -- Economy / actions ------------------------------------------------------
  lines.push(panelTitle(t(locale, 'ui.panel.economy'), focus === 'Economy'))
  const e = m.economy
  lines.push(`  🌰 ${e.seeds} · 🔧 ${e.shards}`)
  // Reuse economyHint() — the SAME builder AppView consumes — so the two render
  // paths can't drift on a new action key (R2 refactor; byte-identical output).
  lines.push(`  ${economyHint(m, locale)}`)
  lines.push('')

  // -- Loadout panel (suppressed under zen per ADR-0014) ----------------------
  if (!zen) {
    lines.push(panelTitle(t(locale, 'ui.panel.loadout'), focus === 'Loadout'))
    const lo = m.loadout
    for (const slot of lo.slots) {
      if (!slot.filled) {
        lines.push(t(locale, 'ui.loadout.slot_empty', { n: slot.n }))
      } else {
        lines.push(t(locale, 'ui.loadout.slot_filled', { n: slot.n, label: slot.label, kind: slot.kind }))
      }
    }
    if (lo.active.length > 0) {
      lines.push(t(locale, 'ui.loadout.active_header'))
      for (const s of lo.active) {
        lines.push('✦ ' + t(locale, 'ui.loadout.active_row', { name: s.name, effect: synergyEffectLine(s.effect, locale) }))
      }
    }
    if (lo.chase.length > 0) {
      lines.push(t(locale, 'ui.loadout.chase_header'))
      for (const s of lo.chase) {
        lines.push('◇ ' + t(locale, 'ui.loadout.chase_row', { name: s.name, effect: synergyEffectLine(s.effect, locale) }))
      }
    }
    lines.push('')
  }

  // -- Achievements panel (unlocked-only per ADR-0015; suppressed under zen) --
  if (!zen) {
    lines.push(panelTitle(t(locale, 'ui.panel.achievements'), focus === 'Achievements'))
    const ach = m.achievements
    lines.push(`  ${t(locale, 'ui.tui.achievements_summary', { n: ach.unlockedCount, total: ach.total })}`)
    if (ach.unlocked.length === 0) {
      lines.push(`  ${t(locale, 'ui.achievements.none')}`)
    } else {
      for (const a of ach.unlocked) {
        lines.push(t(locale, 'ui.achievements.unlocked_row', { name: a.name, desc: a.desc }))
      }
    }
    lines.push('')
  }

  // -- Key legend -------------------------------------------------------------
  lines.push(t(locale, 'ui.tui.keys'))

  return lines.join('\n')
}

/** A ▌-prefixed panel title; the focused panel gets a ▶ cursor marker. */
function panelTitle(title: string, focused: boolean): string {
  return `${focused ? '▶' : '▌'} ${title}`
}

/** A unicode block progress bar of `len` cells filled to `fraction` (0..1). */
function progressBar(fraction: number, len: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * len)
  return '█'.repeat(filled) + '░'.repeat(len - filled)
}

// ---------------------------------------------------------------------------
// <App> — the live Ink component
// ---------------------------------------------------------------------------

/** Props for the live TUI app. */
export interface AppProps {
  /** the per-repo state dir (for load/save under the lock). */
  dir: string
  /** the initial state to render (the loop re-reads `dir` after each action). */
  initial: GameState
  /** a fixed rng seed for deterministic tests; otherwise time-seeded per action. */
  seed?: number
  /**
   * play the pre-result reveal animation (pack-opening / dice-roll frames) before
   * settling on the drop. Defaults to true on an interactive TTY; the loop entry
   * forces it false under reduced-motion (--no-anim), a non-TTY stdout, or tests
   * (so output stays instant + deterministic, mirroring the CLI's playReveal guard).
   */
  animate?: boolean
  /** the active locale for UI labels; defaults to 'en'. */
  locale?: Locale
  /**
   * Calm mode (ADR-0005 / ADR-0014 / ADR-0015): when true, the loadout and
   * achievements panels are suppressed (no synergy nag, no achievement FOMO).
   * Defaults to false.
   */
  zen?: boolean
}

/**
 * The navigable, live-updating TUI. Renders the view-model as Ink panels; arrow/
 * tab cycle focus; the action keys dispatch an engine action, PERSIST it under
 * withStateLock, then re-read so the panels reflect the fresh state. A mutating
 * action briefly flashes a highlight (juice). `q`/Ctrl-C exits.
 */
export function App(props: AppProps): React.ReactElement {
  const { dir, initial, seed } = props
  const animate = props.animate ?? true
  const locale: Locale = props.locale ?? 'en'
  const zen: boolean = props.zen ?? false
  const app = useApp()

  const [state, setState] = useState<GameState>(initial)
  const [focusIdx, setFocusIdx] = useState(0)
  const [focusedGearIndex, setFocusedGearIndex] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  // The rarity of the currently-flashed reward — colours the flash line (null = no tint).
  const [flashRarity, setFlashRarity] = useState<Rarity | null>(null)
  // The reveal animation steps (suspense frames … settled flash) + a cursor into them.
  const [revealStep, setRevealStep] = useState<{ steps: string[]; i: number } | null>(null)
  // The settled rarity to apply once the animation finishes stepping.
  const settledRarity = useRef<Rarity | null>(null)
  // Light panel motion (R9): the XP bar fills toward its new value over a few beats.
  // `xpAnim` overrides the header's static fill fraction while filling; null = settled.
  const [xpAnim, setXpAnim] = useState<{ fracs: number[]; i: number } | null>(null)
  // The freshly-acquired row to pulse for one beat (a collection set or a gear id).
  const [pulse, setPulse] = useState<PulseTarget | null>(null)

  const focus: Panel = PANELS[focusIdx]!

  // The action runner: dispatch (pure) → persist under the lock → re-read. Every
  // failure path (disk/permission) is caught so a calm error flash shows and the
  // TUI never crashes (firewall: a game action can never take down the surface).
  const runAction = useCallback(
    (key: string) => {
      let result: DispatchResult
      try {
        result = withStateLock(dir, () => {
          const fresh = loadState(dir)
          const rng = mulberry32(
            seed ?? hashStringToSeed(`tui:${key}:${fresh.eventCount}:${String(Date.now())}`),
          )
          const out = dispatchKey(fresh, key, focus, rng, { focusedGearIndex })
          if (out.changed) saveState(dir, out.state)
          return out
        })
      } catch {
        // Calm: a disk/permission failure never crashes the session. No state
        // change, no animation — just a terse error flash.
        setRevealStep(null)
        settledRarity.current = null
        setFlashRarity(null)
        setFlash("can't: save failed · your code is safe")
        return
      }

      // Light panel motion (R9): capture the XP fill BEFORE swapping state so the
      // bar can animate from the old fraction to the new one. A level change wraps
      // (fill to full, then refill the new level). Gated by `animate` (off in tests/
      // pipes) — when off, the bar just jumps via the model's static fraction.
      const before = tuiModel(state).header
      const after = tuiModel(result.state).header
      setState(result.state)

      if (animate && result.changed && (after.level !== before.level || after.xpFraction !== before.xpFraction)) {
        const fracs = xpBarSteps(before.xpFraction, after.xpFraction, {
          animate: true,
          wrapped: after.level !== before.level,
        })
        setXpAnim({ fracs, i: 0 })
      } else {
        setXpAnim(null)
      }

      // Juice: pick the HIGHEST-salience reward (level-up / set / prestige /
      // windfall > legendary > gear > card) and colour the flash by its rarity.
      const salient = pickSalientReward(result.rewards)
      settledRarity.current = salientRarity(salient)

      // Pulse the freshly-acquired collection/gear row for one beat (animate-gated).
      setPulse(animate && result.changed ? pulseTargetFor(salient) : null)

      // Build the reveal sequence: suspense frames (if animating) THEN the settled
      // flash. The SALIENT rarity scales the build so a rarer drop suspends longer
      // (rarity-scaled reveal, R9). A blocked action settles on a terse can't line.
      const steps = revealSteps(key, result, {
        animate,
        ...(settledRarity.current !== null ? { rarity: settledRarity.current } : {}),
      })
      if (steps.length === 0) {
        // A true no-op (refresh / unmapped) — nothing to show.
        setRevealStep(null)
        return
      }
      // Show the first step immediately, then the interval advances the rest.
      setRevealStep({ steps, i: 0 })
      setFlash(steps[0]!)
      // The rarity tint only applies to the SETTLED step; suspense frames are neutral.
      setFlashRarity(steps.length === 1 ? settledRarity.current : null)
    },
    [dir, seed, focus, focusedGearIndex, animate, state],
  )

  // Reveal stepper: advance through the suspense frames on a ~120ms beat, then
  // settle on the final flash (applying its rarity tint). Pure timing in the
  // impure shell — the frames/flash themselves come from the pure revealSteps.
  useEffect(() => {
    if (revealStep === null) return
    const { steps, i } = revealStep
    if (i >= steps.length - 1) {
      // Settled on the last step: apply the rarity tint now.
      setFlashRarity(settledRarity.current)
      return
    }
    const t = setTimeout(() => {
      const next = i + 1
      setRevealStep({ steps, i: next })
      setFlash(steps[next]!)
    }, 120)
    return () => clearTimeout(t)
  }, [revealStep])

  // Juice: the settled flash is transient — auto-clear it a short beat AFTER the
  // animation has finished stepping, so it doesn't persist until the next action.
  useEffect(() => {
    if (revealStep === null || flash === null) return
    if (revealStep.i < revealStep.steps.length - 1) return // still animating
    const t = setTimeout(() => {
      setFlash(null)
      setFlashRarity(null)
      setRevealStep(null)
    }, 1500)
    return () => clearTimeout(t)
  }, [revealStep, flash])

  // XP-bar fill stepper (R9 panel motion): advance the fill fraction on the same
  // ~120ms beat until it settles on the new value, then clear (the static header
  // fraction takes over). Pure timing; the fractions come from pure xpBarSteps.
  useEffect(() => {
    if (xpAnim === null) return
    if (xpAnim.i >= xpAnim.fracs.length - 1) {
      const t = setTimeout(() => setXpAnim(null), 120)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setXpAnim({ fracs: xpAnim.fracs, i: xpAnim.i + 1 }), 120)
    return () => clearTimeout(t)
  }, [xpAnim])

  // Row-pulse stepper (R9 panel motion): the freshly-acquired collection/gear row
  // glows for ONE ~120ms beat, then clears. A short, calm highlight (never a flash storm).
  useEffect(() => {
    if (pulse === null) return
    const t = setTimeout(() => setPulse(null), 120)
    return () => clearTimeout(t)
  }, [pulse])

  useInput((input, keyMeta) => {
    if (input === 'q' || (keyMeta.ctrl && input === 'c')) {
      app.exit()
      return
    }
    // Navigation: tab / right → next panel; left → previous panel.
    if (keyMeta.tab || keyMeta.rightArrow) {
      setFocusIdx((i) => (i + 1) % PANELS.length)
      return
    }
    if (keyMeta.leftArrow) {
      setFocusIdx((i) => (i - 1 + PANELS.length) % PANELS.length)
      return
    }
    // Within the Gear panel, up/down move the gear cursor.
    if (focus === 'Gear' && (keyMeta.upArrow || keyMeta.downArrow)) {
      const n = Math.max(1, state.gear.length)
      setFocusedGearIndex((i) =>
        keyMeta.downArrow ? (i + 1) % n : (i - 1 + n) % n,
      )
      return
    }
    // Action keys.
    if (['p', 'P', 'e', 'c', 'b', 'r'].includes(input)) {
      runAction(input)
    }
  })

  const model = tuiModel(state)
  // While the XP bar is filling, override the static header fraction with the
  // current animation step; otherwise show the settled fraction.
  const animatedXpFraction = xpAnim ? xpAnim.fracs[xpAnim.i]! : null
  return (
    <AppView
      model={model}
      focus={focus}
      focusedGearIndex={focusedGearIndex}
      flash={flash}
      flashRarity={flashRarity}
      animatedXpFraction={animatedXpFraction}
      pulse={pulse}
      locale={locale}
      zen={zen}
    />
  )
}

/** The pure presentational view — renders the view-model as Ink boxes. */
function AppView(props: {
  model: TuiModel
  focus: Panel
  focusedGearIndex: number
  flash: string | null
  flashRarity: Rarity | null
  /** the current XP-bar fill while animating, or null to use the static fraction. */
  animatedXpFraction: number | null
  /** the freshly-acquired row to pulse for one beat, or null. */
  pulse: PulseTarget | null
  /** the active locale for UI labels. */
  locale: Locale
  /** calm mode: suppresses the loadout and achievements panels. */
  zen?: boolean
}): React.ReactElement {
  const { model, focus, focusedGearIndex, flash, flashRarity, animatedXpFraction, pulse, locale } = props
  const zen = props.zen ?? false
  const h = model.header

  // Rarity-as-colour on the flash line: a legendary/shiny drop glows yellow+bold,
  // an epic magenta, etc. A non-drop flash (level-up / can't / error) stays yellow.
  const flashColor = flashRarity ? rarityColor(flashRarity) : { color: 'yellow', bold: true }

  // The bar fills toward its new value while animating; otherwise the settled fraction.
  const xpFraction = animatedXpFraction ?? h.xpFraction

  return (
    <Box flexDirection="column">
      <Text bold>
        {t(locale, 'ui.header.title', { level: h.level })}
        <Text color="green">{`   XP [${progressBar(xpFraction, 12)}] ${h.xp}/${h.xpForLevel}`}</Text>
      </Text>
      <Text>
        {[
          t(locale, 'ui.header.seeds', { seeds: h.seeds }),
          t(locale, 'ui.header.shards', { shards: h.shards }),
          t(locale, 'ui.header.prestige', { rank: h.prestigeRank, cost: h.nextPrestigeCost }),
        ].join(' · ')}
      </Text>
      {flash ? <Text color={flashColor.color} bold={flashColor.bold}>{flash}</Text> : null}

      <PanelBox title={t(locale, 'ui.panel.collection')} focused={focus === 'Collection'}>
        {model.collection.map((c) => {
          const tint = rarityColor(c.rarity)
          // One-beat pulse on the freshly-acquired set row: glow bold for the beat.
          const pulsing = pulse?.kind === 'collection' && pulse.key === c.set
          return (
            <Text
              key={c.set}
              color={c.locked ? 'gray' : tint.color}
              bold={pulsing || (!c.locked && tint.bold)}
            >
              {c.locked
                ? t(locale, 'ui.collection.locked', { set: c.set, level: c.unlockLevel })
                : `${pulsing ? '✦ ' : ''}${t(locale, 'ui.collection.row', { set: c.set, owned: c.owned, total: c.total, done: c.complete ? t(locale, 'ui.collection.done') : '' })}${c.foiled > 0 ? t(locale, 'ui.collection.foil', { foiled: c.foiled, total: c.total }) : ''}`}
            </Text>
          )
        })}
      </PanelBox>

      <PanelBox title={t(locale, 'ui.panel.gear')} focused={focus === 'Gear'}>
        {model.gear.length === 0 ? (
          <Text dimColor>{t(locale, 'ui.gear.none')}</Text>
        ) : (
          model.gear.map((g, i) => {
            const focused = focus === 'Gear' && i === focusedGearIndex
            const tint = rarityColor(g.rarity)
            // One-beat pulse on the freshly-enhanced/acquired gear row.
            const pulsing = pulse?.kind === 'gear' && pulse.key === g.id
            return (
              <Text key={g.id} color={focused ? 'cyan' : tint.color} bold={pulsing || (!focused && tint.bold)}>
                {`${focused ? '▶ ' : pulsing ? '✦ ' : '  '}${g.name} +${g.level}`}
                {g.broken ? t(locale, 'ui.gear.broken') : ''}
                {g.protectedNow ? t(locale, 'ui.gear.protected') : ''}
                {g.effect ? ` · ${g.effect}` : ''}
              </Text>
            )
          })
        )}
      </PanelBox>

      <PanelBox title={t(locale, 'ui.panel.quests')} focused={focus === 'Quests'}>
        {model.quests.map((q) => {
          // Re-translate by id (the VM carries the raw English def.title); fall back
          // to the raw title for a custom QuestDef with no catalog entry.
          const key = `quest.${q.id}.title`
          const ttl = t(locale, key)
          const glyph = q.status === 'done' ? '✓' : q.status === 'active' ? '◆' : '·'
          return <Text key={q.id}>{`${glyph} ${ttl !== key ? ttl : q.title}`}</Text>
        })}
      </PanelBox>

      <PanelBox title={t(locale, 'ui.panel.economy')} focused={focus === 'Economy'}>
        <Text>{`🌰 ${model.economy.seeds} · 🔧 ${model.economy.shards}`}</Text>
        <Text dimColor>{economyHint(model, locale)}</Text>
      </PanelBox>

      {!zen && (
        <PanelBox title={t(locale, 'ui.panel.loadout')} focused={focus === 'Loadout'}>
          {model.loadout.slots.map((slot) =>
            slot.filled ? (
              <Text key={slot.n}>{t(locale, 'ui.loadout.slot_filled', { n: slot.n, label: slot.label, kind: slot.kind })}</Text>
            ) : (
              <Text key={slot.n} dimColor>{t(locale, 'ui.loadout.slot_empty', { n: slot.n })}</Text>
            )
          )}
          {model.loadout.active.length > 0 && (
            <>
              <Text dimColor>{t(locale, 'ui.loadout.active_header')}</Text>
              {model.loadout.active.map((s) => (
                <Text key={s.id} color="green">{'✦ ' + t(locale, 'ui.loadout.active_row', { name: s.name, effect: synergyEffectLine(s.effect, locale) })}</Text>
              ))}
            </>
          )}
          {model.loadout.chase.length > 0 && (
            <>
              <Text dimColor>{t(locale, 'ui.loadout.chase_header')}</Text>
              {model.loadout.chase.map((s) => (
                <Text key={s.id} dimColor>{'◇ ' + t(locale, 'ui.loadout.chase_row', { name: s.name, effect: synergyEffectLine(s.effect, locale) })}</Text>
              ))}
            </>
          )}
        </PanelBox>
      )}

      {!zen && (
        <PanelBox title={t(locale, 'ui.panel.achievements')} focused={focus === 'Achievements'}>
          <Text dimColor>{t(locale, 'ui.tui.achievements_summary', { n: model.achievements.unlockedCount, total: model.achievements.total })}</Text>
          {model.achievements.unlocked.length === 0 ? (
            <Text dimColor>{t(locale, 'ui.achievements.none')}</Text>
          ) : (
            model.achievements.unlocked.map((a) => (
              <Text key={a.id}>{t(locale, 'ui.achievements.unlocked_row', { name: a.name, desc: a.desc })}</Text>
            ))
          )}
        </PanelBox>
      )}

      <Text dimColor>
        {t(locale, 'ui.tui.keys')}
      </Text>
    </Box>
  )
}

/** A titled, optionally-focused box wrapper. */
function PanelBox(props: {
  title: string
  focused: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.focused ? 'cyan' : 'gray'}>
      <Text bold color={props.focused ? 'cyan' : undefined}>{`${props.focused ? '▶' : '▌'} ${props.title}`}</Text>
      {props.children}
    </Box>
  )
}

/** The economy "can: …" hint line (mirrors the static frame). */
function economyHint(model: TuiModel, locale: Locale = 'en'): string {
  const e = model.economy
  const can: string[] = []
  if (e.canPull) can.push(t(locale, 'ui.can.pull', { cost: e.pullCost }))
  if (e.canPremium) can.push(t(locale, 'ui.can.premium', { cost: e.premiumCost }))
  if (e.canCraft) can.push(t(locale, 'ui.can.craft'))
  if (e.canPrestige) can.push(t(locale, 'ui.can.prestige', { cost: e.prestigeCost }))
  return can.length > 0 ? t(locale, 'ui.header.can', { actions: can.join(' · ') }) : t(locale, 'ui.tui.earn_hint')
}

// ---------------------------------------------------------------------------
// runTui — the interactive loop entry
// ---------------------------------------------------------------------------

/** Options for runTui. */
export interface RunTuiOpts {
  /** render ONE static frame and resolve it (for tests/CI), no interactive session. */
  once?: boolean
  /** fixed rng seed for deterministic action dispatch (passed to <App>). */
  seed?: number
  /**
   * disable the reveal animation — the --no-anim / reduced-motion escape. When
   * unset, animation auto-enables ONLY on an interactive TTY (off in pipes / CI /
   * tests). Mirrors the CLI's playReveal TTY guard so output stays deterministic.
   */
  noAnim?: boolean
  /** calm mode (--zen): suppress the loadout / achievements panels (ADR-0005/0014/0015). */
  zen?: boolean
}

/**
 * Decide whether the reveal animation should play: only on an interactive TTY and
 * only when the caller hasn't opted out (--no-anim / reduced-motion). A non-TTY
 * stdout (pipe / CI / test) is treated as no-animation so the reveal settles
 * instantly and deterministically — the same guard the CLI's playReveal uses.
 */
function shouldAnimate(opts: RunTuiOpts = {}): boolean {
  if (opts.noAnim === true) return false
  return process.stdout.isTTY === true
}

/**
 * Launch the interactive TUI for the repo state at `dir`.
 *
 *  - `opts.once` → load the persisted state, render ONE static frame string, and
 *    resolve it immediately (no Ink session, no raw-mode) — the CI/test path.
 *  - otherwise → mount the live Ink <App> and resolve when the user exits (q /
 *    Ctrl-C). Returns the last persisted state's frame so callers can log it.
 *
 * The reveal animation auto-enables only on an interactive TTY (off in pipes /
 * tests), respecting the --no-anim / reduced-motion escape via `opts.noAnim`.
 *
 * The Integrate agent wires `sq tui` to call this.
 */
export async function runTui(dir: string, opts: RunTuiOpts = {}): Promise<string> {
  const state = loadState(dir)
  const locale = resolveLocale()
  const zen = opts.zen ?? false

  if (opts.once) {
    return renderTuiFrame(state, { locale, zen })
  }

  const instance = inkRender(
    <App
      dir={dir}
      initial={state}
      animate={shouldAnimate(opts)}
      locale={locale}
      zen={zen}
      {...(opts.seed !== undefined ? { seed: opts.seed } : {})}
    />,
  )
  await instance.waitUntilExit()
  // On exit, return a final static frame of the latest persisted state.
  return renderTuiFrame(loadState(dir), { locale, zen })
}

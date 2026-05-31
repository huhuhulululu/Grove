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

import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text, useApp, useInput, render as inkRender } from 'ink'

import type { GameState } from '../core/state'
import type { Reward } from '../core/rewards'
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
}

/**
 * Render a single static text frame of the TUI. PURE: derives the view-model and
 * formats it as text — no React, no I/O — so tests/CI can assert on it directly.
 * The live <App> renders the SAME view-model with Ink boxes.
 */
export function renderTuiFrame(state: GameState, opts: FrameOpts = {}): string {
  const m = tuiModel(state)
  const focus: Panel = opts.focus ?? 'Collection'
  const lines: string[] = []

  // -- Header -----------------------------------------------------------------
  const h = m.header
  const bar = progressBar(h.xpFraction, 12)
  lines.push(`GROVE · Level ${h.level}   XP [${bar}] ${h.xp}/${h.xpForLevel}`)
  lines.push(
    `🌰 ${h.seeds} seeds · 🔧 ${h.shards} shards · ✦ Prestige ${h.prestigeRank} (next ${h.nextPrestigeCost} 🌰)`,
  )
  if (opts.flash) lines.push(opts.flash)
  lines.push('')

  // -- Collection -------------------------------------------------------------
  lines.push(panelTitle('COLLECTION', focus === 'Collection'))
  for (const c of m.collection) {
    if (c.locked) {
      lines.push(`  ${c.set}  🔒 L${c.unlockLevel}`)
    } else {
      const done = c.complete ? '  ✓' : ''
      lines.push(`  ${c.set}  ${c.owned}/${c.total}${done}`)
    }
  }
  lines.push('')

  // -- Gear -------------------------------------------------------------------
  lines.push(panelTitle('GEAR', focus === 'Gear'))
  if (m.gear.length === 0) {
    lines.push('  (no gear yet · merge a PR to drop some)')
  } else {
    const focusedIdx = opts.focusedGearIndex ?? 0
    m.gear.forEach((g, i) => {
      const cursor = focus === 'Gear' && i === focusedIdx ? '▶ ' : '  '
      const broken = g.broken ? '  BROKEN' : ''
      const prot = g.protectedNow ? '  PROTECTED' : ''
      const eff = g.effect ? ` · ${g.effect}` : ''
      lines.push(`${cursor}${g.name} +${g.level}${broken}${prot}${eff}`)
    })
  }
  lines.push('')

  // -- Quests -----------------------------------------------------------------
  lines.push(panelTitle('QUESTS', focus === 'Quests'))
  for (const q of m.quests) {
    const glyph = q.status === 'done' ? '✓' : q.status === 'active' ? '◆' : '·'
    lines.push(`  ${glyph} ${q.title}`)
  }
  lines.push('')

  // -- Economy / actions ------------------------------------------------------
  lines.push(panelTitle('ECONOMY', focus === 'Economy'))
  const e = m.economy
  const can: string[] = []
  if (e.canPull) can.push(`pull (${e.pullCost})`)
  if (e.canPremium) can.push(`premium (${e.premiumCost})`)
  if (e.canCraft) can.push('craft')
  if (e.canPrestige) can.push(`prestige (${e.prestigeCost})`)
  lines.push(`  🌰 ${e.seeds} · 🔧 ${e.shards}`)
  lines.push(`  can: ${can.length > 0 ? can.join(' · ') : 'earn more by shipping'}`)
  lines.push('')

  // -- Key legend -------------------------------------------------------------
  lines.push('keys: p pull · P premium · e enhance · c craft · b prestige · r refresh · tab move · q quit')

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
}

/**
 * The navigable, live-updating TUI. Renders the view-model as Ink panels; arrow/
 * tab cycle focus; the action keys dispatch an engine action, PERSIST it under
 * withStateLock, then re-read so the panels reflect the fresh state. A mutating
 * action briefly flashes a highlight (juice). `q`/Ctrl-C exits.
 */
export function App(props: AppProps): React.ReactElement {
  const { dir, initial, seed } = props
  const app = useApp()

  const [state, setState] = useState<GameState>(initial)
  const [focusIdx, setFocusIdx] = useState(0)
  const [focusedGearIndex, setFocusedGearIndex] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)

  const focus: Panel = PANELS[focusIdx]!

  // The action runner: dispatch (pure) → persist under the lock → re-read.
  const runAction = useCallback(
    (key: string) => {
      const result = withStateLock(dir, () => {
        const fresh = loadState(dir)
        const rng = mulberry32(
          seed ?? hashStringToSeed(`tui:${key}:${fresh.eventCount}:${String(Date.now())}`),
        )
        const out = dispatchKey(fresh, key, focus, rng, { focusedGearIndex })
        if (out.changed) saveState(dir, out.state)
        return out
      })
      setState(result.state)
      // Juice: flash the first card/gear drop line briefly on a real change.
      if (result.changed) {
        const drop = result.rewards.find((r) => r.kind === 'card' || r.kind === 'gear')
        setFlash(drop ? `✨ ${drop.message}` : null)
      }
    },
    [dir, seed, focus, focusedGearIndex],
  )

  // Juice: the flash highlight is transient — auto-clear it after a short beat so
  // it doesn't persist until the next action (matches the "briefly flashes" doc).
  useEffect(() => {
    if (flash === null) return
    const t = setTimeout(() => setFlash(null), 1500)
    return () => clearTimeout(t)
  }, [flash])

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
  return <AppView model={model} focus={focus} focusedGearIndex={focusedGearIndex} flash={flash} />
}

/** The pure presentational view — renders the view-model as Ink boxes. */
function AppView(props: {
  model: TuiModel
  focus: Panel
  focusedGearIndex: number
  flash: string | null
}): React.ReactElement {
  const { model, focus, focusedGearIndex, flash } = props
  const h = model.header

  return (
    <Box flexDirection="column">
      <Text bold>
        {`GROVE · Level ${h.level}`}
        <Text color="green">{`   XP [${progressBar(h.xpFraction, 12)}] ${h.xp}/${h.xpForLevel}`}</Text>
      </Text>
      <Text>
        {`🌰 ${h.seeds} seeds · 🔧 ${h.shards} shards · ✦ Prestige ${h.prestigeRank} (next ${h.nextPrestigeCost} 🌰)`}
      </Text>
      {flash ? <Text color="yellow" bold>{flash}</Text> : null}

      <PanelBox title="COLLECTION" focused={focus === 'Collection'}>
        {model.collection.map((c) => (
          <Text key={c.set}>
            {c.locked
              ? `${c.set}  🔒 L${c.unlockLevel}`
              : `${c.set}  ${c.owned}/${c.total}${c.complete ? '  ✓' : ''}`}
          </Text>
        ))}
      </PanelBox>

      <PanelBox title="GEAR" focused={focus === 'Gear'}>
        {model.gear.length === 0 ? (
          <Text dimColor>(no gear yet · merge a PR to drop some)</Text>
        ) : (
          model.gear.map((g, i) => (
            <Text key={g.id} color={focus === 'Gear' && i === focusedGearIndex ? 'cyan' : undefined}>
              {`${focus === 'Gear' && i === focusedGearIndex ? '▶ ' : '  '}${g.name} +${g.level}`}
              {g.broken ? '  BROKEN' : ''}
              {g.protectedNow ? '  PROTECTED' : ''}
              {g.effect ? ` · ${g.effect}` : ''}
            </Text>
          ))
        )}
      </PanelBox>

      <PanelBox title="QUESTS" focused={focus === 'Quests'}>
        {model.quests.map((q) => (
          <Text key={q.id}>
            {`${q.status === 'done' ? '✓' : q.status === 'active' ? '◆' : '·'} ${q.title}`}
          </Text>
        ))}
      </PanelBox>

      <PanelBox title="ECONOMY" focused={focus === 'Economy'}>
        <Text>{`🌰 ${model.economy.seeds} · 🔧 ${model.economy.shards}`}</Text>
        <Text dimColor>{economyHint(model)}</Text>
      </PanelBox>

      <Text dimColor>
        keys: p pull · P premium · e enhance · c craft · b prestige · r refresh · tab move · q quit
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
function economyHint(model: TuiModel): string {
  const e = model.economy
  const can: string[] = []
  if (e.canPull) can.push(`pull (${e.pullCost})`)
  if (e.canPremium) can.push(`premium (${e.premiumCost})`)
  if (e.canCraft) can.push('craft')
  if (e.canPrestige) can.push(`prestige (${e.prestigeCost})`)
  return `can: ${can.length > 0 ? can.join(' · ') : 'earn more by shipping'}`
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
}

/**
 * Launch the interactive TUI for the repo state at `dir`.
 *
 *  - `opts.once` → load the persisted state, render ONE static frame string, and
 *    resolve it immediately (no Ink session, no raw-mode) — the CI/test path.
 *  - otherwise → mount the live Ink <App> and resolve when the user exits (q /
 *    Ctrl-C). Returns the last persisted state's frame so callers can log it.
 *
 * The Integrate agent wires `sq tui` to call this.
 */
export async function runTui(dir: string, opts: RunTuiOpts = {}): Promise<string> {
  const state = loadState(dir)

  if (opts.once) {
    return renderTuiFrame(state)
  }

  const instance = inkRender(
    <App dir={dir} initial={state} {...(opts.seed !== undefined ? { seed: opts.seed } : {})} />,
  )
  await instance.waitUntilExit()
  // On exit, return a final static frame of the latest persisted state.
  return renderTuiFrame(loadState(dir))
}

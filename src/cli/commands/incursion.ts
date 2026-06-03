/**
 * commands/incursion.ts — `sq incursion` THE DUNGEON: a push-your-luck roguelike run.
 *
 *   sq incursion start [--seed S]  — pack your build, roll a seeded gauntlet
 *   sq incursion        (status)   — look at the run: floor, HP, bag, the next gamble
 *   sq incursion dive              — attempt the next floor (clear = loot; fail = -HP; 0 HP = DEATH)
 *   sq incursion escape            — walk out ALIVE and bank the whole run-bag (commit to real state)
 *
 * Impure shell over the PURE src/engine/incursion.ts. The ephemeral run lives in
 * `${dir}/run.json` (NOT in GameStateSchema). Your real collection is touched ONLY on
 * escape; death discards the bag and changes nothing. Stakes are cosmetic; a new run is
 * always free (ADR-0005). --zen prints terse confirmations, no ASCII flourish.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadState, saveState, withStateLock } from '../../store/store'
import { addCard } from '../../engine/collection'
import { hashStringToSeed } from '../../core/rng'
import {
  startRun,
  resolveFloor,
  clearChance,
  isCleared,
  RUN_HP,
  type RunState,
} from '../../engine/incursion'
import type { Locale } from '../../i18n/types'

function runPath(dir: string): string {
  return path.join(dir, 'run.json')
}

function readRun(dir: string): RunState | null {
  try {
    const raw = fs.readFileSync(runPath(dir), 'utf-8')
    return JSON.parse(raw) as RunState
  } catch {
    return null
  }
}

function writeRun(dir: string, run: RunState): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(runPath(dir), JSON.stringify(run), 'utf-8')
}

function clearRun(dir: string): void {
  try {
    fs.rmSync(runPath(dir), { force: true })
  } catch {
    /* best-effort */
  }
}

function hpPips(hp: number): string {
  return '🟩'.repeat(Math.max(0, hp)) + '⬛'.repeat(Math.max(0, RUN_HP - hp))
}

function bagLine(run: RunState): string {
  const b = run.bag
  if (b.cards.length === 0 && b.gear.length === 0 && b.seeds === 0) return 'empty'
  const parts: string[] = []
  if (b.cards.length) parts.push(`${b.cards.length} card${b.cards.length === 1 ? '' : 's'}`)
  if (b.gear.length) parts.push(`${b.gear.length} gear`)
  if (b.seeds) parts.push(`${b.seeds} 🌰`)
  return parts.join(' · ')
}

/** The scout + prompt for the floor you're standing in front of. */
function nextFloorPrompt(run: RunState): string {
  if (isCleared(run)) {
    return `  🏆 You cleared all ${run.floors.length} floors. Walk out: sq incursion escape  (bank ${bagLine(run)})`
  }
  const floor = run.floors[run.current]!
  const odds = Math.round(clearChance(run.power, floor.difficulty) * 100)
  const article = /^[aeiou]/i.test(floor.cardRarity) ? 'an' : 'a'
  const guards = `${floor.cardRarity} card${floor.gear ? ' + gear' : ''} + ${floor.seeds} 🌰`
  return [
    `  Floor ${run.current + 1}/${run.floors.length} · difficulty ${floor.difficulty.toFixed(2)} · guards ${article} ${guards}`,
    `  → sq incursion dive  (clear ${odds}%)   or   sq incursion escape  (bank ${bagLine(run)})`,
  ].join('\n')
}

function renderRun(run: RunState): string {
  return [
    `🌲 The Incursion · power ${run.power.toFixed(2)} · HP ${hpPips(run.hp)} · bag: ${bagLine(run)}`,
    nextFloorPrompt(run),
  ].join('\n')
}

export function handleIncursion(
  rest: string[],
  flags: Record<string, string>,
  dir: string,
  zen: boolean,
  _locale: Locale = 'en',
): number {
  const action = rest[0] ?? 'status'

  // ---- start --------------------------------------------------------------
  if (action === 'start') {
    if (readRun(dir) !== null) {
      console.log('  An incursion is already underway. Finish it: sq incursion (status) · dive · escape.')
      return 0
    }
    const seedFlag = flags['seed']
    const seed = seedFlag !== undefined ? hashStringToSeed(seedFlag) : (Date.now() >>> 0)
    const run = startRun(loadState(dir), seed)
    writeRun(dir, run)
    if (zen) {
      console.log(`✓ incursion started · ${run.floors.length} floors · HP ${run.hp}`)
      return 0
    }
    console.log(`🌲 You pack your build and dive into a seeded incursion. power ${run.power.toFixed(2)} · HP ${hpPips(run.hp)}`)
    console.log(`  ${run.floors.length} floors of escalating loot ahead. It's only yours if you walk out alive.`)
    console.log(nextFloorPrompt(run))
    return 0
  }

  // ---- status (default) ---------------------------------------------------
  if (action === 'status') {
    const run = readRun(dir)
    if (run === null) {
      console.log('  No active incursion. Start one: sq incursion start')
      return 0
    }
    console.log(zen ? `incursion · floor ${run.current + 1}/${run.floors.length} · HP ${run.hp} · bag ${bagLine(run)}` : renderRun(run))
    return 0
  }

  // ---- dive ---------------------------------------------------------------
  if (action === 'dive') {
    const run = readRun(dir)
    if (run === null) {
      console.log('  No active incursion. Start one: sq incursion start')
      return 0
    }
    if (isCleared(run)) {
      console.log('  Nothing left to dive. Walk out: sq incursion escape')
      return 0
    }
    const floor = run.floors[run.current]!
    const res = resolveFloor(run)

    if (res.dead) {
      clearRun(dir)
      if (zen) {
        console.log('✗ incursion lost · bag forfeit (real collection untouched)')
        return 0
      }
      console.log(`  ✗ Floor ${run.current + 1} overwhelmed you. The incursion took everything.`)
      console.log(`  The run-bag is forfeit (${bagLine(run)} lost) — but your real collection is untouched. A new run is free: sq incursion start`)
      return 0
    }

    writeRun(dir, res.run)
    if (zen) {
      console.log(res.cleared
        ? `✓ floor ${run.current + 1} cleared · bag ${bagLine(res.run)}`
        : `· floor ${run.current + 1} failed · HP ${res.run.hp}`)
      return 0
    }
    if (res.cleared) {
      const guard = `${floor.cardRarity} card${floor.gear ? ' + gear' : ''} + ${floor.seeds} 🌰`
      console.log(`  ⚔ Floor ${run.current + 1} cleared! Banked: ${guard}`)
    } else {
      console.log(`  ✗ Floor ${run.current + 1} repelled you. HP ${hpPips(res.run.hp)} (-1). You push on, bloodied.`)
    }
    console.log(`  HP ${hpPips(res.run.hp)} · bag: ${bagLine(res.run)}`)
    console.log(nextFloorPrompt(res.run))
    return 0
  }

  // ---- escape -------------------------------------------------------------
  if (action === 'escape') {
    const run = readRun(dir)
    if (run === null) {
      console.log('  No active incursion to escape. Start one: sq incursion start')
      return 0
    }
    const bag = run.bag
    withStateLock(dir, () => {
      let next = loadState(dir)
      for (const card of bag.cards) {
        const r = addCard(next.cards, next.completedSets, card)
        next = { ...next, cards: r.cards, completedSets: r.completedSets }
      }
      if (bag.gear.length > 0) next = { ...next, gear: [...next.gear, ...bag.gear] }
      if (bag.seeds > 0) next = { ...next, player: { ...next.player, currency: next.player.currency + bag.seeds } }
      saveState(dir, next)
    })
    clearRun(dir)
    if (zen) {
      console.log(`✓ escaped · banked ${bagLine(run)}`)
      return 0
    }
    console.log(`  🌲 You walk out of the incursion alive, arms full.`)
    console.log(`  Banked into your collection: ${bagLine(run)}.`)
    return 0
  }

  console.error('  Usage: sq incursion [start [--seed S] | status | dive | escape]')
  return 2
}

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
  escapeBag,
  runOutcomeRecord,
  RUN_HP,
  RUN_FLOORS,
  SHIELD_COST,
  EMPTY_KIT,
  type RunState,
  type RunKit,
  type RunRecord,
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

/**
 * The active run, or null. A `dead: true` tombstone counts as NO active run: it can never
 * be escaped (firewall — a forfeit bag must never reach real state), and we retry its
 * cleanup here so the next `start` is free. This closes the hole where a failed delete on
 * death could otherwise leave a dead run's bag bankable.
 */
function readActiveRun(dir: string): RunState | null {
  const run = readRun(dir)
  if (run === null) return null
  if (run.dead) {
    clearRun(dir)
    return null
  }
  return run
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

// ---- run history (a sibling ephemeral file — NEVER in GameState) ----------
const HISTORY_CAP = 20

function historyPath(dir: string): string {
  return path.join(dir, 'incursion-history.json')
}

function readHistory(dir: string): RunRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath(dir), 'utf-8'))
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : []
  } catch {
    return [] // missing or corrupt → an empty ledger, best-effort
  }
}

/** Prepend the newest record, cap the log, best-effort (history loss never affects a run). */
function appendHistory(dir: string, rec: RunRecord): void {
  try {
    const next = [rec, ...readHistory(dir)].slice(0, HISTORY_CAP)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(historyPath(dir), JSON.stringify(next), 'utf-8')
  } catch {
    /* best-effort */
  }
}

function renderRecord(r: RunRecord): string {
  if (r.outcome === 'escaped') {
    const b = r.banked
    const parts: string[] = []
    if (b && b.cards) parts.push(`${b.cards} card${b.cards === 1 ? '' : 's'}`)
    if (b && b.gear) parts.push(`${b.gear} gear`)
    if (b && b.seeds) parts.push(`${b.seeds} 🌰`)
    const banked = parts.length ? parts.join(' · ') : 'nothing'
    return `🌲 Escaped · ${r.floorsCleared}/${RUN_FLOORS} cleared · banked ${banked}`
  }
  // died — purely factual, no shame (no "you died", no death count, no "try again")
  return `✗ Fell on floor ${r.diedOn} · ${r.floorsCleared}/${RUN_FLOORS} cleared before the run ended`
}

function hpPips(hp: number): string {
  return '🟩'.repeat(Math.max(0, hp)) + '⬛'.repeat(Math.max(0, RUN_HP - hp))
}

/** A ` · 🛡 shield` tag when the run still holds a shield, else '' (legacy runs → ''). */
function kitTag(run: RunState): string {
  return (run.kit?.shield ?? 0) > 0 ? ' · 🛡 shield' : ''
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
  const kind = floor.kind ?? 'combat'
  const eliteTag = kind === 'elite' ? ' · ⚔ ELITE' : kind === 'treasure' ? ' · 💎 TREASURE' : ''
  return [
    `  Floor ${run.current + 1}/${run.floors.length}${eliteTag} · difficulty ${floor.difficulty.toFixed(2)} · guards ${article} ${guards}`,
    `  → sq incursion dive  (clear ${odds}%)   or   sq incursion escape  (bank ${bagLine(run)})`,
  ].join('\n')
}

function renderRun(run: RunState): string {
  return [
    `🌲 The Incursion · power ${run.power.toFixed(2)} · HP ${hpPips(run.hp)}${kitTag(run)} · bag: ${bagLine(run)}`,
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
    if (readActiveRun(dir) !== null) {
      console.log('  An incursion is already underway. Finish it: sq incursion (status) · dive · escape.')
      return 0
    }
    const seedFlag = flags['seed']
    const seed = seedFlag !== undefined ? hashStringToSeed(seedFlag) : (Date.now() >>> 0)

    // --kit: the only item is a single SHIELD. Parse intent, then settle payment below.
    const kitFlag = flags['kit']
    const wantsShield = kitFlag === 'shield'
    const unknownKit = kitFlag !== undefined && !wantsShield
    let kit: RunKit = EMPTY_KIT
    let kitNote: 'bought' | 'unaffordable' | 'unknown' | 'none' = unknownKit ? 'unknown' : 'none'

    // FIREWALL ORDERING: write the run (with the tentative kit) FIRST so a crash can never
    // debit seeds for a run that doesn't exist; then settle the seed cost under the state
    // lock, stripping the shield back off if the player can't actually afford it.
    if (wantsShield) kit = { shield: 1 }
    let run = startRun(loadState(dir), seed, undefined, kit)
    writeRun(dir, run)
    if (wantsShield) {
      let paid = false
      withStateLock(dir, () => {
        const cur = loadState(dir)
        if (cur.player.currency >= SHIELD_COST) {
          saveState(dir, { ...cur, player: { ...cur.player, currency: cur.player.currency - SHIELD_COST } })
          paid = true
        } else {
          run = { ...run, kit: EMPTY_KIT }
          writeRun(dir, run) // strip the unpaid shield off the already-written run
        }
      })
      kitNote = paid ? 'bought' : 'unaffordable'
    }

    if (zen) {
      console.log(`✓ incursion started · ${run.floors.length} floors · HP ${run.hp}${kitNote === 'bought' ? ' · kit: shield' : ''}`)
      return 0
    }
    console.log(`🌲 You pack your build and dive into a seeded incursion. power ${run.power.toFixed(2)} · HP ${hpPips(run.hp)}${kitTag(run)}`)
    console.log(`  ${run.floors.length} floors of escalating loot ahead. It's only yours if you walk out alive.`)
    if (kitNote === 'bought') {
      console.log(`  🛡 You strap on a shield (${SHIELD_COST} 🌰 spent) — it soaks one failed dive, at the moment of your choosing.`)
    } else if (kitNote === 'unaffordable') {
      console.log(`  (A shield costs ${SHIELD_COST} 🌰, more than you've banked — kits are bought with seeds you bank by ESCAPING runs, so clear a few floors first. Diving kit-less.)`)
    } else if (kitNote === 'unknown') {
      console.log(`  (Unknown kit "${kitFlag}". The only kit is: --kit shield. Diving kit-less.)`)
    }
    console.log(nextFloorPrompt(run))
    return 0
  }

  // ---- status (default) ---------------------------------------------------
  if (action === 'status') {
    const run = readActiveRun(dir)
    if (run === null) {
      console.log('  No active incursion. Start one: sq incursion start')
      return 0
    }
    if (zen) {
      console.log(isCleared(run)
        ? `incursion · cleared · HP ${run.hp} · bag ${bagLine(run)}`
        : `incursion · floor ${run.current + 1}/${run.floors.length} · HP ${run.hp} · bag ${bagLine(run)}`)
      return 0
    }
    console.log(renderRun(run))
    return 0
  }

  // ---- history ------------------------------------------------------------
  if (action === 'history') {
    const hist = readHistory(dir)
    if (hist.length === 0) {
      console.log(zen ? 'incursion history · empty' : '  No incursions yet. Start one: sq incursion start')
      return 0
    }
    if (zen) {
      console.log(`incursion history · ${hist.length} run${hist.length === 1 ? '' : 's'}`)
      return 0
    }
    console.log(`🌲 Incursion log · last ${hist.length} run${hist.length === 1 ? '' : 's'} (newest first):`)
    for (const r of hist) console.log(`  ${renderRecord(r)}`)
    return 0
  }

  // ---- dive ---------------------------------------------------------------
  if (action === 'dive') {
    const run = readActiveRun(dir)
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
      // Record the fallen war story ONCE, here in the dive branch (the tombstone-cleanup
      // path in readActiveRun has no DiveResult and must never record). PRE-resolve `run`
      // so diedOn is the floor being dived; the forfeit bag is recorded as banked:null.
      appendHistory(dir, runOutcomeRecord(run, 'died'))
      // Tombstone BEFORE deleting: if the delete fails, `dead: true` still bars escape
      // from ever banking this forfeit bag (firewall). readActiveRun retries the cleanup.
      writeRun(dir, { ...res.run, dead: true })
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
        : res.shielded
          ? `· floor ${run.current + 1} held (shield) · HP ${res.run.hp}`
          : `· floor ${run.current + 1} failed · HP ${res.run.hp}`)
      return 0
    }
    if (res.cleared) {
      const guard = `${floor.cardRarity} card${floor.gear ? ' + gear' : ''} + ${floor.seeds} 🌰`
      const kind = floor.kind ?? 'combat'
      const label = kind === 'elite' ? 'ELITE ' : kind === 'treasure' ? 'TREASURE ' : ''
      console.log(`  ⚔ ${label}Floor ${run.current + 1} cleared! Banked: ${guard}`)
    } else if (res.shielded) {
      console.log(`  🛡 Floor ${run.current + 1} would have repelled you — the shield held. HP unchanged, one shield spent.`)
    } else {
      console.log(`  ✗ Floor ${run.current + 1} repelled you. HP ${hpPips(res.run.hp)} (-1). You push on, bloodied.`)
    }
    console.log(`  HP ${hpPips(res.run.hp)}${kitTag(res.run)} · bag: ${bagLine(res.run)}`)
    console.log(nextFloorPrompt(res.run))
    return 0
  }

  // ---- escape -------------------------------------------------------------
  if (action === 'escape') {
    const run = readActiveRun(dir)
    if (run === null) {
      console.log('  No active incursion to escape. Start one: sq incursion start')
      return 0
    }
    const bag = escapeBag(run)
    const empty = bag.cards.length === 0 && bag.gear.length === 0 && bag.seeds === 0
    // Only touch real state when there's something to bank — an empty escape is a no-op
    // on the collection (no needless locked write, and no dishonest "arms full" line).
    if (!empty) {
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
    }
    // Record the war story — but skip an instant empty escape (start→escape with no dive),
    // so the ledger holds real runs, not no-op noise.
    if (run.current > 0 || !empty) appendHistory(dir, runOutcomeRecord(run, 'escaped'))
    clearRun(dir)
    if (zen) {
      console.log(empty ? '✓ escaped · empty-handed' : `✓ escaped · banked ${bagLine(run)}`)
      return 0
    }
    if (empty) {
      console.log(`  🌲 You slip out empty-handed. Nothing banked — but nothing lost, and a new run is free: sq incursion start`)
      return 0
    }
    console.log(`  🌲 You walk out of the incursion alive, arms full.`)
    console.log(`  Banked into your collection: ${bagLine(run)}.`)
    return 0
  }

  console.error('  Usage: sq incursion [start [--seed S] [--kit shield] | status | dive | escape | history]')
  return 2
}

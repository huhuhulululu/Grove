/**
 * Grove demo — a runnable, deterministic play-by-play.
 *
 * Seeds a mulberry32 RNG, scripts a believable coding session as a stream of
 * GroveEvents, feeds them through the pure `reduce` engine while accumulating
 * state, and prints a readable account of the loot, XP, and collection growth.
 *
 * Run:  npx tsx src/demo.ts
 * It is pure of game logic — the only side effect here is console output.
 */

import { initialState } from './core/state'
import type { GameState } from './core/state'
import type { GroveEvent } from './core/events'
import type { Reward } from './core/rewards'
import { mulberry32 } from './core/rng'
import { reduce } from './engine/reduce'

// ---------------------------------------------------------------------------
// A tiny scripted session (~12 events). Mix of code wins + habit chores + rest.
// ---------------------------------------------------------------------------

const TS = '2026-05-30T12:00:00.000Z'

function e(
  type: GroveEvent['type'],
  opts: { magnitude?: number; success?: boolean } = {},
): GroveEvent {
  return {
    source: 'demo',
    sessionId: 'demo-session',
    type,
    magnitude: opts.magnitude ?? 1,
    success: opts.success ?? true,
    ts: TS,
    meta: {},
  }
}

const SCRIPT: Array<{ event: GroveEvent; story: string }> = [
  { event: e('session_start'), story: 'You sit down, coffee in hand.' },
  { event: e('commit', { magnitude: 1 }), story: 'First small commit of the day.' },
  { event: e('test_result', { magnitude: 2 }), story: 'Ran the suite — all green!' },
  { event: e('test_result', { magnitude: 2 }), story: 'Added a case — still green.' },
  { event: e('build_result', { magnitude: 3 }), story: 'Production build succeeds.' },
  { event: e('test_result', { success: false, magnitude: 8 }), story: 'A flaky test went red (no worries — no penalty).' },
  { event: e('lint_clean', { magnitude: 1 }), story: 'Lint comes back clean.' },
  { event: e('plan_written', { magnitude: 4 }), story: 'Wrote a plan for the next feature.' },
  { event: e('doc_updated', { magnitude: 5 }), story: 'Updated the README and ARCHITECTURE doc.' },
  { event: e('checkpoint'), story: 'Took a real break. Stretched.' },
  { event: e('commit', { magnitude: 2 }), story: 'Wired up the feature.' },
  { event: e('pr_merged', { magnitude: 6 }), story: 'Opened a PR — and it MERGED!' },
  { event: e('review_confirmed', { magnitude: 3 }), story: 'A teammate confirmed your review.' },
  { event: e('session_end'), story: 'Wrapping up. Good day.' },
]

// ---------------------------------------------------------------------------
// Pretty printers
// ---------------------------------------------------------------------------

const ICON: Record<string, string> = {
  xp: '✨',
  card: '🃏',
  levelup: '🆙',
  buff: '🌿',
  gear: '🛡️',
  currency: '🌰',
}

function rewardLine(r: Reward): string {
  return `      ${ICON[r.kind] ?? '•'} [${r.kind}] ${r.message}`
}

function bar(label: string): string {
  return `\n${'─'.repeat(64)}\n${label}\n${'─'.repeat(64)}`
}

// ---------------------------------------------------------------------------
// Run it
// ---------------------------------------------------------------------------

function main(): void {
  const rng = mulberry32(12345)
  let state: GameState = initialState()

  console.log(bar('🌳  GROVE — a deterministic play-by-play (seed 12345)'))

  let step = 0
  for (const { event, story } of SCRIPT) {
    step++
    const out = reduce(state, event, rng)
    state = out.state

    const tag = event.success === false ? ' (failed)' : ''
    console.log(`\n${String(step).padStart(2, ' ')}. ${event.type}${tag}  ·  mag ${event.magnitude}`)
    console.log(`    “${story}”`)

    if (out.rewards.length === 0) {
      const calm = event.success === false
        ? '      … no drop — and nothing lost. The grove never punishes.'
        : '      … a quiet moment (no reward for this signal).'
      console.log(calm)
    } else {
      for (const r of out.rewards) console.log(rewardLine(r))
    }
  }

  // Final summary -----------------------------------------------------------
  console.log(bar('🏁  FINAL SUMMARY'))
  const byRarity = state.cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.rarity] = (acc[c.rarity] ?? 0) + 1
    return acc
  }, {})

  console.log(`  Level .............. ${state.player.level}`)
  console.log(`  XP (into level) .... ${state.player.xp}`)
  console.log(`  Cards collected .... ${state.cards.length}`)
  console.log(`  Card breakdown ..... ${
    Object.entries(byRarity)
      .map(([r, n]) => `${r}×${n}`)
      .join(', ') || '(none)'
  }`)
  console.log(`  Completed sets ..... ${state.completedSets.length ? state.completedSets.join(', ') : '(none yet)'}`)
  console.log(`  Active buffs ....... ${state.buffs.length ? state.buffs.map((b) => b.label).join(', ') : '(none)'}`)
  console.log(`  Pity (since leg.) .. ${state.pity.sinceLegendary}`)
  console.log('\n  Same seed → same run, every time. Have a good one. 🌱\n')
}

main()

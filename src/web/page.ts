/**
 * page.ts — the single self-contained HTML dashboard page for the local web view.
 *
 * PURE: no I/O, no filesystem, no wall-clock. `renderPage(state)` returns one
 * complete HTML document (inline CSS + inline JS, no external assets) so it can be
 * served by a bare node:http handler with zero build step.
 *
 * The page is a RENDERER over the pure engine's GameState — it re-derives the same
 * level/xp/energy/collection/gear/quests/economy facts the terminal dashboard
 * shows, then live-updates by subscribing to the server's `/events` SSE stream.
 *
 * Tone (docs/TONE.md / ADR-0009): terse, dev-grounded, emoji OK, never shaming.
 */

import type { GameState } from '../core/state'
import { CARD_SETS, cardIdsInSet, setUnlockLevel } from '../core/cards'
import { QUESTS } from '../core/quests'
import { xpForLevel } from '../engine/xp'
import { gearEffectText } from '../engine/gear'
import {
  prestigeRank,
  prestigeCost,
  PULL_COST,
  PREMIUM_PULL_COST,
} from '../engine/reduce'

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Escape the five HTML-significant characters so dynamic state can't inject markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A 0..100 width clamp for inline bar widths. */
function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

// ---------------------------------------------------------------------------
// Section builders — each returns an HTML fragment string from the state.
// ---------------------------------------------------------------------------

function headerSection(state: GameState): string {
  const { level, xp, currency } = state.player
  const shards = state.player.shards ?? 0
  const needed = xpForLevel(level)
  const xpPct = pct(needed > 0 ? (xp / needed) * 100 : 0)
  const rank = prestigeRank(state)
  return `
  <header class="hero">
    <h1>🌳 Grove</h1>
    <div class="level">Level ${level}</div>
    <div class="bar xp"><div class="fill" style="width:${xpPct}%"></div></div>
    <div class="xpnums">${xp}/${needed} XP</div>
    <div class="wallet">
      <span>🌰 ${currency} seeds</span>
      <span>🔧 ${shards} shards</span>
      <span>✦ Prestige ${rank}</span>
    </div>
  </header>`
}

function energySection(state: GameState): string {
  const { energy } = state
  if (!energy.known) {
    return section('⚡ Energy', `<div class="muted">Wellspring · unmetered</div>`)
  }
  const rows: string[] = []
  if (energy.vigor !== undefined) {
    const v = pct(energy.vigor)
    rows.push(energyRow('⚡', 'Vigor', v))
  }
  if (energy.sap !== undefined) {
    const s = pct(energy.sap)
    rows.push(energyRow('🌿', 'Weekly', s))
  }
  const low =
    (energy.vigor !== undefined && energy.vigor < 20) ||
    (energy.sap !== undefined && energy.sap < 20)
  const cue = low ? `<div class="muted">good stopping point</div>` : ''
  return section('⚡ Energy', rows.join('') + cue)
}

function energyRow(icon: string, label: string, value: number): string {
  return `
    <div class="erow">
      <span class="elabel">${icon} ${esc(label)}</span>
      <span class="bar"><span class="fill" style="width:${value}%"></span></span>
      <span class="epct">${value}%</span>
    </div>`
}

function collectionSection(state: GameState): string {
  const ownedIds = new Set(state.cards.map((c) => c.id))
  const level = Math.max(1, state.player.level)
  const rows = Object.keys(CARD_SETS).map((setName) => {
    const unlock = setUnlockLevel(setName)
    if (unlock > level) {
      return `<li class="locked">${esc(setName)} <span class="tag">🔒 L${unlock}</span></li>`
    }
    const allIds = cardIdsInSet(setName)
    const owned = allIds.filter((id) => ownedIds.has(id)).length
    const total = allIds.length
    const done = total > 0 && owned === total ? ' <span class="tag done">✓</span>' : ''
    return `<li>${esc(setName)} <span class="count">${owned}/${total}</span>${done}</li>`
  })
  return section('🃏 Collection', `<ul class="list">${rows.join('')}</ul>`)
}

function gearSection(state: GameState): string {
  if (state.gear.length === 0) {
    return section('⚔️ Gear', `<div class="muted">(no gear yet · merge a PR to drop some)</div>`)
  }
  const protectedSet = new Set(state.protectedGear)
  const rows = state.gear.map((g) => {
    const effect = gearEffectText(g)
    const effectStr = effect ? ` <span class="effect">· ${esc(effect)}</span>` : ''
    const broken = g.broken ? ` <span class="tag broken">BROKEN</span>` : ''
    const prot = protectedSet.has(g.id) ? ` <span class="tag">PROTECTED</span>` : ''
    return `<li>${esc(g.name)} <span class="lvl">+${g.level}</span>${broken}${prot}${effectStr}</li>`
  })
  return section('⚔️ Gear', `<ul class="list">${rows.join('')}</ul>`)
}

function questsSection(state: GameState): string {
  const rows = QUESTS.map((def) => {
    const progress = state.quests.find((q) => q.id === def.id)
    let glyph = '·'
    let cls = 'todo'
    if (progress?.status === 'done') {
      glyph = '✓'
      cls = 'done'
    } else if (progress?.status === 'active') {
      glyph = '◆'
      cls = 'active'
    }
    return `<li class="${cls}"><span class="glyph">${glyph}</span> ${esc(def.title)}</li>`
  })
  return section('🎯 Quests', `<ul class="list">${rows.join('')}</ul>`)
}

function economySection(state: GameState): string {
  const seeds = state.player.currency
  const rank = prestigeRank(state)
  const nextPrestige = prestigeCost(rank)
  const can: string[] = []
  if (seeds >= PULL_COST) can.push(`pull (${PULL_COST})`)
  if (seeds >= PREMIUM_PULL_COST) can.push(`premium (${PREMIUM_PULL_COST})`)
  if (seeds >= nextPrestige) can.push(`prestige (${nextPrestige})`)
  const cta = can.length > 0 ? `can: ${esc(can.join(' · '))}` : 'keep shipping for seeds'
  const body = `
    <div class="econrow"><span>🌰 ${seeds} seeds</span></div>
    <div class="econrow"><span>pull ${PULL_COST} · premium ${PREMIUM_PULL_COST} · prestige ${nextPrestige}</span></div>
    <div class="cta">${cta}</div>`
  return section('💰 Economy', body)
}

/** Wrap a titled card section. */
function section(title: string, body: string): string {
  return `
  <section class="card">
    <h2>${title}</h2>
    ${body}
  </section>`
}

// ---------------------------------------------------------------------------
// Inline CSS + the live-update client script
// ---------------------------------------------------------------------------

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.5rem;
    font: 15px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0e1116; color: #e6edf3;
  }
  .wrap { max-width: 920px; margin: 0 auto; }
  .hero { text-align: center; margin-bottom: 1.5rem; }
  .hero h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
  .level { font-size: 1.1rem; color: #7ee787; margin-bottom: .5rem; }
  .xpnums { font-size: .85rem; color: #8b949e; margin-top: .25rem; }
  .wallet { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-top: .6rem; color: #c9d1d9; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1rem; }
  .card h2 { margin: 0 0 .6rem; font-size: 1rem; color: #58a6ff; }
  .list { list-style: none; margin: 0; padding: 0; }
  .list li { padding: .2rem 0; border-bottom: 1px solid #21262d; display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
  .list li:last-child { border-bottom: 0; }
  .muted { color: #8b949e; }
  .count, .lvl { color: #d29922; }
  .tag { font-size: .72rem; padding: .05rem .35rem; border-radius: 4px; background: #21262d; color: #8b949e; }
  .tag.done { background: #1f6feb33; color: #7ee787; }
  .tag.broken { background: #f8514933; color: #ff7b72; }
  .effect { color: #8b949e; font-size: .85rem; }
  .locked { opacity: .6; }
  .glyph { width: 1rem; display: inline-block; text-align: center; }
  li.done .glyph { color: #7ee787; }
  li.active .glyph { color: #58a6ff; }
  .bar { display: inline-block; height: 10px; flex: 1; min-width: 80px; background: #21262d; border-radius: 5px; overflow: hidden; }
  .bar.xp { display: block; margin: .5rem auto; max-width: 420px; }
  .bar .fill { display: block; height: 100%; background: linear-gradient(90deg,#238636,#2ea043); }
  .erow { display: flex; align-items: center; gap: .5rem; padding: .25rem 0; }
  .elabel { width: 5.5rem; }
  .epct { width: 3rem; text-align: right; color: #8b949e; }
  .econrow { padding: .15rem 0; }
  .cta { margin-top: .4rem; color: #7ee787; }
  footer { text-align: center; color: #484f58; font-size: .8rem; margin-top: 1.5rem; }
`

// The client subscribes to /events; on each snapshot it re-fetches the rendered
// fragment by reloading just the body grid. We keep it tiny: the SSE payload is
// the full state JSON, but the simplest robust live update is to refetch the page
// HTML and swap the dynamic grid. To stay dependency-free and pure on the server,
// the client just reloads the document on a debounced change signal.
const SCRIPT = `
  (function () {
    if (typeof EventSource === 'undefined') return;
    var es = new EventSource('/events');
    var first = true;
    var timer = null;
    es.onmessage = function () {
      // The very first message is the initial snapshot (page already reflects it).
      if (first) { first = false; return; }
      // Debounce rapid file-change bursts, then reload to show the fresh render.
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { location.reload(); }, 150);
    };
    es.onerror = function () { /* browser auto-reconnects */ };
  })();
`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the complete, self-contained HTML dashboard for `state`.
 *
 * PURE: no I/O. The returned document inlines all CSS/JS (no external assets) and
 * subscribes to `/events` for live reloads.
 */
export function renderPage(state: GameState): string {
  const body = [
    headerSection(state),
    `<div class="grid">`,
    energySection(state),
    collectionSection(state),
    gearSection(state),
    questsSection(state),
    economySection(state),
    `</div>`,
  ].join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grove · Level ${state.player.level}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    ${body}
    <footer>live · local-first · read-only</footer>
  </div>
  <script>${SCRIPT}</script>
</body>
</html>`
}

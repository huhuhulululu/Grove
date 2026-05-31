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
  FOIL_COST_BY_RARITY,
  SPARK_THRESHOLD,
  pityProgress,
  sparkProgress,
  missingCardIdsForPlayer,
  realizedLegendaryShinyRate,
} from '../engine/reduce'
import { SOFT_PITY, HARD_PITY } from '../engine/gacha'
import type { Locale } from '../i18n/types'
import { t } from '../i18n/t'

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

function headerSection(state: GameState, _locale: Locale): string {
  const { level, xp, currency } = state.player
  const shards = state.player.shards ?? 0
  const needed = xpForLevel(level)
  const xpPct = pct(needed > 0 ? (xp / needed) * 100 : 0)
  const rank = prestigeRank(state)
  // data-bind ids let the live SSE client patch these facts in place (R8: no full
  // location.reload). The server-rendered values are the initial paint.
  return `
  <header class="hero">
    <h1>🌳 Grove</h1>
    <div class="level">Level <span data-bind="level">${level}</span></div>
    <div class="bar xp"><div class="fill" data-bind-style="xpPct" style="width:${xpPct}%"></div></div>
    <div class="xpnums"><span data-bind="xp">${xp}</span>/<span data-bind="xpNeeded">${needed}</span> XP</div>
    <div class="wallet">
      <span>🌰 <span data-bind="seeds">${currency}</span> seeds</span>
      <span>🔧 <span data-bind="shards">${shards}</span> shards</span>
      <span>✦ Prestige <span data-bind="prestige">${rank}</span></span>
    </div>
  </header>`
}

function energySection(state: GameState, locale: Locale): string {
  const { energy } = state
  if (!energy.known) {
    return section(t(locale, 'ui.web.energy'), `<div class="muted">${esc(t(locale, 'ui.energy.wellspring'))}</div>`)
  }
  const rows: string[] = []
  if (energy.vigor !== undefined) {
    const v = pct(energy.vigor)
    rows.push(energyRow('⚡', t(locale, 'ui.energy.vigor'), 'vigor', v))
  }
  if (energy.sap !== undefined) {
    const s = pct(energy.sap)
    rows.push(energyRow('🌿', t(locale, 'ui.energy.weekly'), 'sap', s))
  }
  const low =
    (energy.vigor !== undefined && energy.vigor < 20) ||
    (energy.sap !== undefined && energy.sap < 20)
  const cue = low ? `<div class="muted">${esc(t(locale, 'ui.energy.stopping_point').trim())}</div>` : ''
  return section(t(locale, 'ui.web.energy'), rows.join('') + cue)
}

function energyRow(icon: string, label: string, bindKey: 'vigor' | 'sap', value: number): string {
  return `
    <div class="erow">
      <span class="elabel">${icon} ${esc(label)}</span>
      <span class="bar"><span class="fill" data-bind-style="${bindKey}" style="width:${value}%"></span></span>
      <span class="epct"><span data-bind="${bindKey}Pct">${value}</span>%</span>
    </div>`
}

function collectionSection(state: GameState, locale: Locale): string {
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
  return section(t(locale, 'ui.web.collection'), `<ul class="list">${rows.join('')}</ul>`)
}

function gearSection(state: GameState, locale: Locale): string {
  if (state.gear.length === 0) {
    return section(t(locale, 'ui.web.gear'), `<div class="muted">${esc(t(locale, 'ui.gear.none'))}</div>`)
  }
  const protectedSet = new Set(state.protectedGear)
  const rows = state.gear.map((g) => {
    const effect = gearEffectText(g)
    const effectStr = effect ? ` <span class="effect">· ${esc(effect)}</span>` : ''
    const broken = g.broken ? ` <span class="tag broken">BROKEN</span>` : ''
    const prot = protectedSet.has(g.id) ? ` <span class="tag">PROTECTED</span>` : ''
    return `<li>${esc(g.name)} <span class="lvl">+${g.level}</span>${broken}${prot}${effectStr}</li>`
  })
  return section(t(locale, 'ui.web.gear'), `<ul class="list">${rows.join('')}</ul>`)
}

function questsSection(state: GameState, locale: Locale): string {
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
    const title = t(locale, `quest.${def.id}.title`)
    return `<li class="${cls}"><span class="glyph">${glyph}</span> ${esc(title)}</li>`
  })
  return section(t(locale, 'ui.web.quests'), `<ul class="list">${rows.join('')}</ul>`)
}

function economySection(state: GameState, locale: Locale): string {
  const seeds = state.player.currency
  const rank = prestigeRank(state)
  const nextPrestige = prestigeCost(rank)
  const can: string[] = []
  if (seeds >= PULL_COST) can.push(t(locale, 'ui.can.pull', { cost: PULL_COST }))
  if (seeds >= PREMIUM_PULL_COST) can.push(t(locale, 'ui.can.premium', { cost: PREMIUM_PULL_COST }))
  if (seeds >= nextPrestige) can.push(t(locale, 'ui.can.prestige', { cost: nextPrestige }))
  const cta =
    can.length > 0
      ? esc(t(locale, 'ui.header.can', { actions: can.join(' · ') }))
      : 'keep shipping for seeds'
  const body = `
    <div class="econrow"><span>🌰 ${seeds} seeds</span></div>
    <div class="econrow"><span>pull ${PULL_COST} · premium ${PREMIUM_PULL_COST} · prestige ${nextPrestige}</span></div>
    <div class="cta">${cta}</div>`
  return section(t(locale, 'ui.web.economy'), body)
}

/**
 * ODDS section (R8) — the honesty/odds at the decision point (ADR-0002): pity
 * progress toward the hard guarantee, the PUBLISHED realized legendary+shiny rate,
 * spark progress for the targeted premium guarantee, how many cards are left, and
 * the foil shard-sink option. So a web viewer sees WHY a pull/save matters too.
 */
function oddsSection(state: GameState, locale: Locale): string {
  const pity = pityProgress(state)
  const spark = sparkProgress(state)
  const missing = missingCardIdsForPlayer(state).length
  const realizedPer100 = (realizedLegendaryShinyRate() * 100).toFixed(1)

  const pityStatusSuffix = pity.softActive
    ? pity.hardNext
      ? t(locale, 'ui.odds.pity_hard_next')
      : t(locale, 'ui.odds.pity_soft_on')
    : t(locale, 'ui.odds.pity_to_hard', { n: pity.pullsToHard })
  const pityLine = t(locale, 'ui.odds.pity', {
    since: pity.sinceLegendary,
    hard: pity.hardPity,
    status: pityStatusSuffix,
  })
  const rateLine = t(locale, 'ui.odds.rate', { per100: realizedPer100 })
  const sparkLine = spark.guaranteedNext
    ? t(locale, 'ui.odds.spark_armed', { spark: spark.spark, threshold: spark.threshold })
    : t(locale, 'ui.odds.spark', { spark: spark.spark, threshold: spark.threshold })
  const leftStr =
    missing > 0
      ? t(locale, 'ui.odds.cards_left', { n: missing })
      : t(locale, 'ui.odds.complete')
  const foilLine = t(locale, 'ui.odds.foil', {
    min: FOIL_COST_BY_RARITY.common,
    max: FOIL_COST_BY_RARITY.shiny,
  })

  const body = `
    <div class="econrow"><span data-bind="pity">${esc(pityLine)}</span></div>
    <div class="econrow">${esc(rateLine)}</div>
    <div class="econrow"><span data-bind="spark">${esc(sparkLine)}</span></div>
    <div class="econrow"><span data-bind="cardsLeft">${esc(leftStr)}</span></div>
    <div class="muted">${esc(foilLine)}</div>`
  return section(t(locale, 'ui.web.odds'), body)
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

/**
 * The live-update client (R8 — granular DOM patch, NOT a full location.reload).
 *
 * Each SSE message carries the full state JSON; the client PARSES it and patches
 * the `data-bind` facts in place (level / xp / seeds / shards / prestige / pity /
 * spark / energy). This kills the jarring whole-page reload churn — the page stays
 * scrolled and focused while the numbers update live. It re-derives the few
 * computed facts with the SAME published constants the server uses (ADR-0002):
 * the xpForLevel formula and the SOFT/HARD pity + SPARK thresholds are inlined
 * (interpolated below from the engine constants) so there is no drift. Fields that
 * need the card catalogue (cards-left) change only on a pull and are left to the
 * next natural reconnect; everything a viewer watches second-to-second is patched.
 */
/**
 * Escape a string for safe embedding as a JS string literal (single-quoted).
 * We only need to escape backslash, single-quote, and newline for our use-case.
 */
function jsStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
}

function buildScript(locale: Locale): string {
  // Pre-translate the locale-dependent pity/spark status strings so the live SSE
  // client can patch them without knowing about the catalog.
  const txtHardNext = jsStr(t(locale, 'ui.odds.pity_hard_next'))
  const txtSoftOn = jsStr(t(locale, 'ui.odds.pity_soft_on'))
  // ui.odds.pity_to_hard uses {n} placeholder — we keep a template and replace in JS.
  // Simplest: extract the prefix/suffix around {n} by splitting on it.
  const pityToHardTemplate = t(locale, 'ui.odds.pity_to_hard', { n: '__N__' })
  const pityToHardParts = pityToHardTemplate.split('__N__')
  const txtToHardPre = jsStr(pityToHardParts[0] ?? '')
  const txtToHardSuf = jsStr(pityToHardParts[1] ?? '')
  // spark armed suffix: extract from the full spark_armed template by comparing to spark template
  // We pass the spark template with placeholders replaced for a fixed value, then strip the number parts.
  // Simplest: use the suffix that's present in spark_armed but not spark.
  const sparkArmedFull = t(locale, 'ui.odds.spark_armed', { spark: '__S__', threshold: '__T__' })
  const sparkBase = t(locale, 'ui.odds.spark', { spark: '__S__', threshold: '__T__' })
  // The armed suffix is whatever comes after the base in sparkArmedFull.
  const txtSparkArmedSuffix = jsStr(sparkArmedFull.replace(sparkBase, ''))

  return `
  (function () {
    if (typeof EventSource === 'undefined') return;
    var SOFT = ${SOFT_PITY}, HARD = ${HARD_PITY}, SPARK = ${SPARK_THRESHOLD};
    var TXT_HARD_NEXT = '${txtHardNext}';
    var TXT_SOFT_ON = '${txtSoftOn}';
    var TXT_TO_HARD_PRE = '${txtToHardPre}';
    var TXT_TO_HARD_SUF = '${txtToHardSuf}';
    var TXT_SPARK_ARMED_SUFFIX = '${txtSparkArmedSuffix}';
    function xpForLevel(level){ return Math.min(2000, Math.round(50 * Math.pow(Math.max(1, level), 1.5))); }
    function setText(name, value){
      var el = document.querySelector('[data-bind="' + name + '"]');
      if (el) el.textContent = value;
    }
    function setWidth(name, value){
      var el = document.querySelector('[data-bind-style="' + name + '"]');
      if (el) el.style.width = value + '%';
    }
    function pct(n){ return Math.max(0, Math.min(100, Math.round(n))); }
    function patch(s){
      try {
        var p = s.player || {};
        var level = p.level || 1, xp = p.xp || 0;
        var needed = xpForLevel(level);
        setText('level', level);
        setText('xp', xp);
        setText('xpNeeded', needed);
        setWidth('xpPct', pct(needed > 0 ? (xp / needed) * 100 : 0));
        setText('seeds', p.currency || 0);
        setText('shards', p.shards || 0);
        // prestige rank = count of prestige:mark buffs (exact rank ids).
        var buffs = s.buffs || [];
        var rank = 0, re = /^prestige:mark(:\\d+)?$/;
        for (var i = 0; i < buffs.length; i++){ if (re.test(buffs[i].id)) rank++; }
        setText('prestige', rank);
        // pity
        var since = (s.pity && s.pity.sinceLegendary) || 0;
        var pityStatus = since >= SOFT
          ? (since + 1 >= HARD ? TXT_HARD_NEXT : TXT_SOFT_ON)
          : (TXT_TO_HARD_PRE + Math.max(0, HARD - since) + TXT_TO_HARD_SUF);
        setText('pity', since + '/' + HARD + ' ' + pityStatus);
        // spark
        var spark = s.spark || 0;
        var armed = spark >= SPARK ? TXT_SPARK_ARMED_SUFFIX : '';
        setText('spark', spark + '/' + SPARK + armed);
        // energy
        var en = s.energy || {};
        if (en.known && typeof en.vigor === 'number'){
          setText('vigorPct', pct(en.vigor));
          setWidth('vigor', pct(en.vigor));
        }
        if (en.known && typeof en.sap === 'number'){
          setText('sapPct', pct(en.sap));
          setWidth('sap', pct(en.sap));
        }
      } catch (e) { /* a malformed snapshot is ignored; the next one will patch */ }
    }
    var es = new EventSource('/events');
    var timer = null;
    es.onmessage = function (ev) {
      // Debounce rapid file-change bursts, then apply the latest JSON to the DOM.
      if (timer) clearTimeout(timer);
      var data = ev.data;
      timer = setTimeout(function () {
        var s;
        try { s = JSON.parse(data); } catch (e) { return; }
        patch(s);
      }, 120);
    };
    es.onerror = function () { /* browser auto-reconnects */ };
  })();
`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the complete, self-contained HTML dashboard for `state`.
 *
 * PURE: no I/O. The returned document inlines all CSS/JS (no external assets) and
 * subscribes to `/events`, patching the live facts into the DOM in place (R8 — no
 * full page reload).
 */
export function renderPage(state: GameState, locale: Locale = 'en'): string {
  const body = [
    headerSection(state, locale),
    `<div class="grid">`,
    energySection(state, locale),
    oddsSection(state, locale),
    collectionSection(state, locale),
    gearSection(state, locale),
    questsSection(state, locale),
    economySection(state, locale),
    `</div>`,
  ].join('\n')

  return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grove · Level ${state.player.level}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    ${body}
    <footer>${esc(t(locale, 'ui.web.footer'))}</footer>
  </div>
  <script>${buildScript(locale)}</script>
</body>
</html>`
}

/**
 * English catalog — the SOURCE OF TRUTH. Every key here must also exist in every
 * other locale (enforced by i18n.test.ts catalog-parity). EN templates must
 * reproduce the exact legacy strings so existing tests + copy-lint stay green when
 * the engine switches to keyed messages.
 *
 * Keys are namespaced:
 *   reward.*       — engine loot lines (xp/levelup/card/gear/currency/buff/quest flavour)
 *   ui.*           — render/web/tui chrome (panel labels, hints, badges)
 *   quest.<id>.*   — the 8 Pillar-B quest titles + descriptions (id from src/core/quests.ts)
 *   cli.*          — calm CLI confirmations + hints
 *
 * BYTE-IDENTICAL RULE: each `en` value below equals the current English string the
 * engine/renderer emits, with `{placeholders}` where the code interpolates. The
 * wiring agents key the engine to THESE keys next; the contract test asserts the
 * round-trip. Do NOT edit an `en` value without changing the corresponding code.
 */
import type { Catalog } from '../types'

export const en: Catalog = {
  // -------------------------------------------------------------------------
  // reward.* — engine loot lines (src/engine/{reduce,quests}.ts)
  // -------------------------------------------------------------------------

  // xp / levelup (reduce.grantXp)
  'reward.xp': '+{amount} XP · {flavour}',
  'reward.xp_crit': '+{amount} XP · {flavour} 💥 CRIT ×{critMult}',
  'reward.levelup': 'Level {level}',
  'reward.levelup_seeds': '+{seeds} 🌰 · level up ×{levelUps}',

  // XP_FLAVOUR sub-strings composed into reward.xp / reward.xp_crit (reduce.ts)
  'reward.flavour.commit': 'commit',
  'reward.flavour.test_result': 'tests green',
  'reward.flavour.build_result': 'build green',
  'reward.flavour.lint_clean': 'lint clean',
  'reward.flavour.review_confirmed': 'review done',
  'reward.flavour.pr_merged': 'PR merged',
  'reward.flavour.doc_updated': 'docs updated',
  'reward.flavour.spec_written': 'spec written',
  'reward.flavour.plan_written': 'plan set',
  // grantXp/grantCurrency fallbacks when no flavour is mapped.
  'reward.flavour.xp': 'xp',
  'reward.flavour.work': 'work',

  // set unlock / set complete / set-bonus legendary (reduce + quests)
  'reward.set_unlocked': '🔓 {set} set unlocked · L{lvl}',
  'reward.set_complete': '✦ set {set} complete · +{pct}% 🌰 (permanent)',
  'reward.legendary': '✦ {name} · legendary',

  // currency grants / spends / refusals (reduce + collection)
  'reward.currency_seeds': '+{amount} 🌰 seeds · {flavour}',
  'reward.dupe': '+{seeds} 🌰 · +{shards} shards · dupe',
  'reward.windfall': '✨ windfall · +{amount} 🌰',
  'reward.milestone_chest': '🎁 milestone chest · +{seeds} 🌰 (work tracked)',
  'reward.doc_streak': '🔥 Doc Streak ×{streak} · +{seeds} 🌰',
  'reward.shards_to_seeds': '+{seeds} 🌰 · {convert} shards → seeds',
  'reward.no_shards_convert': 'no shards to convert — have {have}',

  // pull (reduce.pull / pullPremium): spend, card line, refusal
  'reward.pull_spend': '-{cost} 🌰 · pull',
  'reward.premium_spend': '-{cost} 🌰 · premium pull',
  'reward.card': '{mark}{name} · {rarity}',
  'reward.card_premium': '✦ premium · {mark}{name} · {rarity}',
  'reward.lucky_drop': '✨ lucky drop · {mark}{name} · {rarity}',
  'reward.not_enough_pull': 'not enough 🌰 · need {cost}, have {have}',
  'reward.not_enough_premium': 'not enough 🌰 · premium needs {cost}, have {have}',

  // spark (reduce.pullPremium guarantee)
  'reward.spark_guarantee': '✦ SPARK guarantee · {mark}{name} · {rarity}',
  'reward.spark_foil': '✦ FOIL finish · {name} arrives foiled (spark)',

  // craft (reduce.craftCard): spend, card line, refusals
  'reward.craft_spend': '-{cost} shards · craft',
  'reward.crafted': '🛠 crafted · {mark}{name} · {rarity}',
  'reward.craft_locked': '🔒 {cardId} is in a locked set — can\'t craft yet',
  'reward.craft_unavailable': 'can\'t craft {cardId} — already owned or not craftable',
  'reward.craft_need_shards': 'not enough shards — craft needs {cost}, have {have}',
  'reward.craft_complete': 'nothing left to craft — collection complete',

  // gear drop (reduce.grantGear)
  'reward.gear': '{name} +{level}',

  // foil (reduce.foilCard): spend, shimmer line, refusals, capstone
  'reward.foil_spend': '-{cost} shards · foil {rarity}',
  'reward.foil_shimmer': '✦ FOIL · {name} now shimmers (cosmetic)',
  'reward.foil_not_owned': 'can\'t foil {cardId} — you don\'t own it',
  'reward.foil_already': '{cardId} is already foiled',
  'reward.foil_nothing_owned': 'nothing to foil — no cards owned yet',
  'reward.foil_all_foiled': 'nothing left to foil — all owned cards are foiled',
  'reward.foil_need_shards': 'not enough shards — foil {name} needs {cost}, have {have}',
  'reward.foiled_capstone': '✦✦ {set} set fully foiled · capstone unlocked (cosmetic)',

  // prestige (reduce.buyPrestige): spend, earned, refusal
  'reward.prestige_spend': '-{cost} 🌰 · prestige {rank}',
  'reward.prestige_earned': '✦ Prestige {rank} earned (permanent cosmetic)',
  'reward.not_enough_prestige': 'not enough 🌰 — prestige {rank} costs {cost}, have {have}',

  // quest flavour lines (engine/quests.ts) — buffs + first-time unlocks
  'reward.quest.grimoire_aura': 'CLAUDE.md written · permanent aura',
  'reward.quest.precast_armed': 'spec first · x2 armed',
  'reward.quest.precast_unlocked': 'Spec First unlocked',
  'reward.quest.living_map_buff': 'docs synced · Fresh Architecture',
  'reward.quest.living_map_unlocked': 'Sync the Docs unlocked',
  'reward.quest.test_warden_first': 'test added',
  'reward.quest.review_buff': 'review done · Fresh Eyes',
  'reward.quest.review_unlocked': 'Close the Review unlocked',
  'reward.quest.clean_build_aura': 'lint clean · +seeds aura (permanent)',
  'reward.quest.merge_buff': 'PR merged · Momentum',
  'reward.quest.merge_unlocked': 'Merge the PR unlocked',

  // engine buff labels (the `label` carried on a Buff, surfaced by renderers)
  'reward.buff.refreshed': 'Refreshed',
  'reward.buff.second_wind': 'Second Wind',
  'reward.buff.set': '{set} set',
  'reward.buff.foiled_set': '{set} fully foiled',
  'reward.buff.prestige': 'Prestige {rank}',
  'reward.buff.grimoire_aura': 'Grimoire Aura',
  'reward.buff.precast': 'Pre-cast x2',
  'reward.buff.fresh_architecture': 'Fresh Architecture',
  'reward.buff.test_streak': 'Test Streak',
  'reward.buff.fresh_eyes': 'Fresh Eyes',
  'reward.buff.clean_build': 'Clean Build',
  'reward.buff.momentum': 'Momentum',

  // -------------------------------------------------------------------------
  // quest.<id>.* — the 8 Pillar-B quests (src/core/quests.ts QUESTS)
  // -------------------------------------------------------------------------
  'quest.grimoire.title': 'Write the CLAUDE.md',
  'quest.grimoire.desc': 'Add a lean CLAUDE.md / AGENTS.md · permanent repo aura.',
  'quest.precast-spec.title': 'Spec First',
  'quest.precast-spec.desc': 'Write acceptance criteria before coding · arms an XP x2.',
  'quest.living-map.title': 'Sync the Docs',
  'quest.living-map.desc': 'Keep architecture docs in sync with the code · Fresh Architecture buff.',
  'quest.test-warden.title': 'Add Tests',
  'quest.test-warden.desc': 'Add a test (edge/error paths and tests-first count extra) · guaranteed loot.',
  'quest.review-loop.title': 'Close the Review',
  'quest.review-loop.desc': 'Land a confirmed review · Fresh Eyes buff.',
  'quest.clean-build.title': 'Keep It Clean',
  'quest.clean-build.desc': 'Ship a lint-clean build · permanent +seeds aura.',
  'quest.merge-master.title': 'Merge the PR',
  'quest.merge-master.desc': 'Merge a pull request · guaranteed loot + gear.',
  'quest.doc-streak.title': 'Doc Streak',
  'quest.doc-streak.desc': 'Keep docs fresh, week over week · a tiered, renewable streak.',

  // -------------------------------------------------------------------------
  // ui.* — render / web / tui chrome (dashboard.ts, format.ts, page.ts)
  // -------------------------------------------------------------------------

  // dashboard + web panel titles
  'ui.panel.energy': 'ENERGY',
  'ui.panel.work': 'WORK',
  'ui.panel.odds': 'ODDS',
  'ui.panel.collection': 'COLLECTION',
  'ui.panel.gear': 'GEAR',
  'ui.panel.quests': 'QUESTS',
  'ui.panel.buffs': 'BUFFS',

  // web section headings (page.ts — include their leading emoji)
  'ui.web.energy': '⚡ Energy',
  'ui.web.collection': '🃏 Collection',
  'ui.web.gear': '⚔️ Gear',
  'ui.web.quests': '🎯 Quests',
  'ui.web.economy': '💰 Economy',
  'ui.web.odds': '🎲 Odds',
  'ui.web.footer': 'live · local-first · read-only',

  // energy / work / wellspring chrome (dashboard + page)
  'ui.energy.wellspring': 'Wellspring · unmetered',
  'ui.energy.vigor': 'Vigor',
  'ui.energy.weekly': 'Weekly',
  'ui.energy.resets_in': '  resets in {eta}',
  'ui.energy.stopping_point': '  good stopping point',
  'ui.work.next_chest': '🎁 next chest ',
  'ui.eta.soon': 'soon',

  // header / wallet (dashboard renderHeader + page headerSection)
  'ui.header.title': 'GROVE  Level {level}',
  'ui.header.seeds': '🌰 {seeds} seeds',
  'ui.header.shards': '🔧 {shards} shards',
  'ui.header.shards_craftable': '🔧 {shards} shards · craftable: {name} (sq craft)',
  'ui.header.prestige': '✦ Prestige {rank} · next {cost} 🌰',
  'ui.header.next_set': 'next set: {set} @ L{level}',
  'ui.header.can': 'can: {actions}',
  'ui.can.pull': 'pull ({cost})',
  'ui.can.premium': 'premium ({cost})',
  'ui.can.prestige': 'prestige (next {cost})',

  // odds panel (dashboard renderOdds)
  'ui.odds.pity': '🎯 pity {since}/{hard} {status}',
  'ui.odds.pity_hard_next': '· hard NEXT',
  'ui.odds.pity_soft_on': '· soft on',
  'ui.odds.pity_to_hard': '· {n} to hard',
  'ui.odds.rate': 'legendary+shiny ~{per100} per 100 pulls',
  'ui.odds.spark_armed': '✦ spark {spark}/{threshold} · guarantee ARMED',
  'ui.odds.spark': '✦ spark {spark}/{threshold}',
  'ui.odds.cards_left': '{n} cards left to collect',
  'ui.odds.complete': 'collection complete',
  'ui.odds.foil': '✨ foil owned card · {min}-{max} shards by rarity (sq foil)',

  // collection / gear rows (dashboard)
  'ui.collection.locked': '{set}  🔒 L{level}',
  'ui.collection.row': '{set}  {owned}/{total}{done}',
  'ui.collection.done': '  ✓',
  'ui.gear.none': '(no gear yet · merge a PR to drop some)',
  'ui.gear.row': '{name} +{level}{broken}{protected}{effect}',
  'ui.gear.broken': '  BROKEN',
  'ui.gear.protected': '  PROTECTED',
  'ui.buffs.none': 'none',
  'ui.buffs.prestige_rollup': '✦ Prestige ×{rank}',

  // gear effect labels (engine/gear.gearEffectText — surfaced by renderers)
  'ui.gear.effect.seeds': '+{n}% commit seeds',
  'ui.gear.effect.xp': '+{n}% XP',
  'ui.gear.effect.crit': '+{n}pp crit',

  // enhance reveal (render/enhance.ts)
  'ui.enhance.odds_transition': '{name} +{level} → +{next}',
  'ui.enhance.odds': 'success {success}%  downgrade {downgrade}%  break {break}%',
  'ui.enhance.success': 'ENHANCE +{before}→+{after}\n✓ success',
  'ui.enhance.downgrade': 'ENHANCE +{before}→+{after}\n↓ +{after}',
  'ui.enhance.break': 'ENHANCE +{before}→+{after}\n✗ SHATTERED (code safe)',
  'ui.enhance.stay': '– broken',

  // status block (render/format.formatStatus + formatQuests/formatRecap)
  'ui.status.title': '  GROVE STATUS',
  'ui.status.level': '  Level .............. {level}',
  'ui.status.xp': '  XP (into level) .... {xp}',
  'ui.status.currency': '  Currency ........... {currency}',
  'ui.status.shards': '  Shards ............. {shards}',
  'ui.status.prestige': '  Prestige rank ...... {rank}',
  'ui.status.cards': '  Cards collected .... {cards}',
  'ui.status.breakdown': '  Card breakdown ..... {breakdown}',
  'ui.status.sets': '  Completed sets ..... {sets}',
  'ui.status.buffs': '  Active buffs ....... {buffs}',
  'ui.status.pity': '  Pity (since leg.) .. {pity}',
  'ui.status.prestige_badge': '✦ Prestige ×{rank}',
  'ui.status.none': '(none)',
  'ui.status.none_yet': '(none yet)',
  'ui.quests.title': '  QUEST BOARD',
  'ui.quests.active_buffs': '  Active Buffs:',
  'ui.quests.none': '    (none)',
  'ui.recap.title': '  RECAP · {window}',
  'ui.recap.total': '  Total events ....... {total}',
  'ui.recap.by_type': '  By type:',
  'ui.recap.no_events': '    (no events)',
  'ui.recap.level': '  Level .............. {level}',
  'ui.recap.cards': '  Cards collected .... {cards}',
  'ui.recap.sets': '  Completed sets ..... {sets}',
  'ui.recap.highlights': '  Highlights:',
  'ui.recap.no_highlights': '  (no highlights)',

  // share card (render/share.ts)
  'ui.share.line1': 'Grove · Lv{level}',
  'ui.share.cards': '📦 {owned}/{total} cards ({pct}%)',
  'ui.share.prestige': '✦ Prestige ×{rank}',
  'ui.share.flex.shiny': '✦ shiny drop',
  'ui.share.flex.legendary': '✦ legendary drop',
  'ui.share.flex.epic': '🃏 epic drop',
  'ui.share.flex.prestige': '✦ Prestige ×{rank}',
  'ui.share.flex.complete': '🏆 collection complete',
  'ui.share.flex.collected': '📦 {pct}% collected',
  'ui.share.flex.grinder': '⚡ Lv{level} grinder',
  'ui.share.flex.groove': '🌿 Lv{level} in the groove',

  // tui / web wallet labels (seeded keys kept)
  'ui.seeds': '{n} seeds',
  'ui.shards': '{n} shards',

  // -------------------------------------------------------------------------
  // cli.* — calm confirmations + hints (src/cli/commands/*.ts)
  // -------------------------------------------------------------------------
  'cli.broke_hint': 'earn more 🌰 by shipping · commits, green tests, merges, docs.',
  'cli.commit_recorded': 'commit recorded · {n} signal(s)',

  // calm-mode confirmations (calmConfirm — the quiet `✓` line)
  'cli.confirm': '  ✓ {message}',
  'cli.confirm.pull_done': 'pull done',
  'cli.confirm.premium_pull_done': 'premium pull done',
  'cli.confirm.pull_skipped': 'pull skipped · not enough 🌰 (need {cost})',
  'cli.confirm.enhance_recorded': 'enhance {name} · attempt recorded',
  'cli.confirm.repaired': 'repaired {name} +{level}',
  'cli.confirm.protected': 'protected {name} +{level} (one enhance)',
  'cli.confirm.crafted': 'crafted',
  'cli.confirm.craft_skipped': 'craft skipped',
  'cli.confirm.foiled': 'foiled',
  'cli.confirm.foil_skipped': 'foil skipped',
  'cli.confirm.prestige_earned': 'prestige earned',
  'cli.confirm.prestige_skipped': 'prestige skipped',

  // gear-action hints / refusals (economy.ts)
  'cli.gear.none_pull': '(no gear yet · merge a PR to drop some: sq event pr_merged)',
  'cli.gear.none_repair': '(no gear yet · nothing to repair)',
  'cli.gear.none_protect': '(no gear yet · nothing to protect)',
  'cli.gear.not_broken': '  {name} +{level} isn\'t broken · nothing to repair.',
  'cli.gear.already_protected': '  {name} +{level} is already protected.',
  'cli.gear.repaired': '  🔧 REPAIRED · {name} +{level} · -{cost} 🌰',
  'cli.gear.protected': '  🛡 PROTECTED · {name} +{level} · -{cost} 🌰 (one enhance)',
  'cli.broke_enhance': '  not enough 🌰 · enhance costs {cost}, have {have}.',
  'cli.broke_repair': '  not enough 🌰 · repair costs {cost}, have {have}.',
  'cli.broke_protect': '  not enough 🌰 · protect costs {cost}, have {have}.',

  // suggest-commit / checkpoint (hooks.ts)
  'cli.suggest.nothing_staged': '  nothing staged · `git add` first, then `sq suggest-commit`.',
  'cli.suggest.header': '  📋 Suggested commit (copy it):',
  'cli.checkpoint.saved': '  📍 Checkpoint saved · {branch}',
  'cli.checkpoint.restore': '  Restore: git stash apply {ref}',
  'cli.checkpoint.nothing': '  📍 Checkpoint · nothing to snapshot · {branch}',

  // crit / low-energy contextual offers (shared.ts)
  'cli.offer.crit': '  💥 CRIT · free draft: sq suggest-commit',
  'cli.offer.low_energy': '  ⚡ low · good stopping point: sq checkpoint',

  // ntfy opt-in (share.ts)
  'cli.ntfy.off': '  🔕 ntfy push is OFF · run `sq ntfy <topic>` to opt in.',
  'cli.ntfy.on': '  🔔 ntfy push ON · topic: {topic}',
  'cli.ntfy.disable_hint': '  Run `sq ntfy off` to disable.',
  'cli.ntfy.disabled': '  🔕 ntfy push disabled.',
  'cli.ntfy.save_failed': '  could not save the ntfy topic · check your GROVE_HOME permissions.',
  'cli.ntfy.subscribe': '  Install the ntfy app and subscribe to that topic to get big-moment alerts.',
  'cli.ntfy.big_moments': '  Big moments only (level-ups, legendaries, chests). Run `sq ntfy off` anytime.',
}

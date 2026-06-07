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
  'reward.shards_to_seeds_bulk': '+{seeds} 🌰 · {convert} shards → seeds · bulk rate',
  'reward.no_shards_convert': 'no shards to convert · have {have}',

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
  'reward.craft_locked': '🔒 {cardId} is in a locked set · can\'t craft yet',
  'reward.craft_unavailable': 'can\'t craft {cardId} · already owned or not craftable',
  'reward.craft_need_shards': 'not enough shards · craft needs {cost}, have {have}',
  'reward.craft_complete': 'nothing left to craft · collection complete',

  // gear drop (reduce.grantGear)
  'reward.gear': '{name} +{level}',

  // foil (reduce.foilCard): spend, shimmer line, refusals, capstone
  'reward.foil_spend': '-{cost} shards · foil {rarity}',
  'reward.foil_shimmer': '✦ FOIL · {name} now shimmers (cosmetic)',
  'reward.foil_not_owned': 'can\'t foil {cardId} · you don\'t own it',
  'reward.foil_already': '{cardId} is already foiled',
  'reward.foil_nothing_owned': 'nothing to foil · no cards owned yet',
  'reward.foil_all_foiled': 'nothing left to foil · all owned cards are foiled',
  'reward.foil_need_shards': 'not enough shards · foil {name} needs {cost}, have {have}',
  'reward.foiled_capstone': '✦✦ {set} set fully foiled · capstone unlocked (cosmetic)',

  // achievement (reduce.grantAchievements): a retroactive, cosmetic recognition
  'reward.achievement': '🏆 {name} · {desc}',
  'reward.mastered': "🌳 You've got the groove · mastery reached (cosmetic)",
  'reward.comeback': '🌿 comeback · tests green again',
  'reward.first_light': '🌅 first light · build green for the first time',
  'reward.commons': '🌱 commons · contribution merged (thanks)',

  // prestige (reduce.buyPrestige): spend, earned, refusal
  'reward.prestige_spend': '-{cost} 🌰 · prestige {rank}',
  'reward.prestige_earned': '✦ Prestige {rank} earned (permanent cosmetic)',
  'reward.not_enough_prestige': 'not enough 🌰 · prestige {rank} costs {cost}, have {have}',

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
  'reward.quest.plan_ahead_buff': 'plan set · ready to build',
  'reward.quest.plan_ahead_unlocked': 'Plan Ahead unlocked',
  'reward.quest.adr_recorded': 'decisions.md kept · ADR recorded',

  // engine buff labels (the `label` carried on a Buff, surfaced by renderers)
  'reward.buff.refreshed': 'Refreshed',
  'reward.buff.second_wind': 'Second Wind',
  'reward.buff.set': '{set} set',
  'reward.buff.set_bonus': '{set} set bonus',
  'reward.buff.fully_foiled': '{set} fully foiled',
  'reward.buff.foiled_set': '{set} fully foiled',
  'reward.buff.prestige': 'Prestige {rank}',
  'reward.buff.prestige_rank': 'Prestige {rank}',
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
  'quest.plan-ahead.title': 'Plan Ahead',
  'quest.plan-ahead.desc': 'Write a plan before you build · marks the chore done.',
  'quest.adr-kept.title': 'Decisions Recorded',
  'quest.adr-kept.desc': 'Keep docs/decisions.md · record why the code is shaped this way.',

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
  'ui.panel.incursion': 'INCURSION',
  'ui.incursion.dashboard_line': 'floor {floor}/{floors} · HP {hp} · run open',
  'ui.incursion.dashboard_cleared': '{floors} floors reached · HP {hp} · escape to bank',
  'ui.panel.economy': 'ECONOMY',
  'ui.panel.loadout': 'LOADOUT',
  'ui.panel.achievements': 'ACHIEVEMENTS',

  // web section headings (page.ts — include their leading emoji)
  'ui.web.energy': '⚡ Energy',
  'ui.web.collection': '🃏 Collection',
  'ui.web.gear': '⚔️ Gear',
  'ui.web.quests': '🎯 Quests',
  'ui.web.economy': '💰 Economy',
  'ui.web.odds': '🎲 Odds',
  'ui.web.footer': 'live · local-first · read-only',

  // web header labels (page.ts headerSection)
  'ui.web.level': 'Level',
  'ui.web.xp_label': 'XP',
  'ui.web.seeds_label': 'seeds',
  'ui.web.shards_label': 'shards',
  'ui.web.prestige_label': '✦ Prestige',

  // web economy panel (page.ts economySection)
  'ui.web.econ_cta_idle': 'keep shipping for seeds',
  'ui.web.econ_seeds': '🌰 {seeds} seeds',
  'ui.web.econ_costs': 'pull {pull} · premium {premium} · prestige {prestige}',

  // energy / work / wellspring chrome (dashboard + page)
  'ui.energy.wellspring': 'Wellspring · unmetered',
  'ui.energy.vigor': 'Vigor',
  'ui.energy.weekly': 'Weekly',
  'ui.energy.resets_in': '  resets in {eta}',
  'ui.energy.stopping_point': '  good stopping point',
  'ui.statusline.level': '🌲 L{level}',
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
  'ui.can.craft': 'craft',
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
  'ui.collection.foil': ' ✨{foiled}/{total}',
  'ui.quest.streak': ' 🔥{streak} · next +{seeds} 🌰 at {at}',
  'ui.quest.streak_max': ' 🔥{streak} · top tier',
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
  'ui.synergy.effect.xp': '+{n}% XP',
  'ui.synergy.effect.seeds': '+{n}% seeds',
  'ui.synergy.effect.crit': '+{n}pp crit',

  // enhance reveal (render/enhance.ts)
  'ui.enhance.odds_transition': '{name} +{level} → +{next}',
  'ui.enhance.odds': 'success {success}%  downgrade {downgrade}%  break {break}%',
  'ui.enhance.success': 'ENHANCE +{before}→+{after}\n✓ success',
  'ui.enhance.downgrade': 'ENHANCE +{before}→+{after}\n↓ +{after}',
  'ui.enhance.break': 'ENHANCE +{before}→+{after}\n✗ SHATTERED (code safe)',
  'ui.enhance.stay': '– broken',
  'ui.enhance.effect_capped': '  ⚑ effect maxed at +{cap} · higher levels are flair only',

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
  'ui.recap.week': '  📈 7d  {spark}',
  'ui.recap.window.week': 'this week',

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
  'ui.share.sets': '🎖 sets {ids}',
  'ui.share.sets_more': '🎖 sets {ids} +{more} more',

  // tui / web wallet labels (seeded keys kept)
  'ui.seeds': '{n} seeds',
  'ui.shards': '{n} shards',

  // tui-only chrome (key hints + earn hint + achievements summary)
  'ui.tui.keys': 'keys: p pull · P premium · e enhance · c craft · b prestige · r refresh · tab move · q quit',
  'ui.tui.earn_hint': 'earn more by shipping',
  'ui.tui.achievements_summary': '{n}/{total} unlocked',

  // loadout panel (render/loadout.ts · src/cli/commands/loadout.ts)
  // ZEN: these are never shown in calm mode. Empty loadout is first-class neutral.
  'ui.loadout.title': 'LOADOUT',
  'ui.loadout.dash_slots': 'slots {filled}/{cap}',
  'ui.loadout.slot_empty': '  [{n}] empty',
  'ui.loadout.slot_filled': '  [{n}] {kind} · {label}',
  'ui.loadout.active_header': '  active:',
  'ui.loadout.active_row': '    {name} · {effect}',
  'ui.loadout.chase_header': '  one away:',
  'ui.loadout.chase_row': '    {name} · {effect}',

  // cli.* — loadout subcommand messages
  'cli.loadout.zen_view': '{n}/3 slots filled',
  'cli.loadout.equipped': 'equipped {label}',
  'cli.loadout.equipped_verbose': '  equipped {label} ({kind})',
  'cli.loadout.already_equipped': '  {id} already equipped',
  'cli.loadout.at_cap': '  loadout full (3 slots) · unequip first: sq loadout unequip <N>',
  'cli.loadout.unequipped': 'unequipped {label}',
  'cli.loadout.slot_empty_err': '  slot {n} is empty · nothing to unequip',

  // -------------------------------------------------------------------------
  // cli.* — calm confirmations + hints (src/cli/commands/*.ts)
  // -------------------------------------------------------------------------
  'cli.broke_hint': 'earn more 🌰 by shipping · commits, green tests, merges, docs.',
  'cli.commit_recorded': 'commit recorded · {n} signal(s)',
  'cli.merge_recorded': 'merge recorded · PR drop',
  'cli.export.wrote': '  ✓ exported · {path}',
  'cli.import.usage': '  usage: sq import <file> · reads a sq export JSON and replaces local state (backed up first).',
  'cli.import.bad_file': '  could not read that file as JSON · nothing was changed.',
  'cli.import.invalid': '  that file is not a valid Grove export · nothing was changed.',
  'cli.import.done': '  ✓ imported · {path} · your previous state was backed up.',
  'cli.init.merge_hook': '  🌳 Grove post-merge hook installed · auto-detects a real PR merge (not a fast-forward pull).',

  // calm-mode confirmations (calmConfirm — the quiet `✓` line)
  'cli.confirm': '  ✓ {message}',
  'cli.confirm.event_recorded': '{type} recorded',
  'cli.confirm.event_recorded_noreward': '{type} recorded (no reward)',
  'cli.confirm.status_zen': 'Level {level} · {seeds} 🌰 · {cards} cards',
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
  'cli.gear.enhance_broken': '  {name} +{level} is broken · repair it first.',
  'cli.gear.already_protected': '  {name} +{level} is already protected.',
  'cli.gear.repaired': '  🔧 REPAIRED · {name} +{level} · -{cost} 🌰',
  'cli.gear.protected': '  🛡 PROTECTED · {name} +{level} · -{cost} 🌰 (one enhance)',
  'cli.broke_enhance': '  not enough 🌰 · enhance costs {cost}, have {have}.',
  'cli.broke_repair': '  not enough 🌰 · repair costs {cost}, have {have}.',
  'cli.broke_protect': '  not enough 🌰 · protect costs {cost}, have {have}.',

  // sq scan summary (view.ts handleScan)
  'cli.scan.zen_summary': 'scan complete · {n} signal(s){detail}',
  'cli.scan.summary': 'Scan complete · {n} signal(s) detected{detail}, {rewards} reward(s).',
  'cli.scan.nothing_new': '  (nothing new)',
  'cli.scan.note': '  note: {note}',

  // sq serve startup banner (view.ts handleServe)
  'cli.serve.banner_url': '  🌳 Grove web dashboard · {url}',
  'cli.serve.banner_hint': '  Read-only view of your state · live-updates as you ship · Ctrl-C to stop.',

  // non-zen ingest output (view.ts handleEvent / handleScan)
  'cli.ingest.no_drop': '  (no drop)',

  // suggest-commit / checkpoint (hooks.ts)
  'cli.suggest.nothing_staged': '  nothing staged · `git add` first, then `sq suggest-commit`.',
  'cli.suggest.header': '  📋 Suggested commit (copy it):',
  'cli.checkpoint.saved': '  📍 Checkpoint saved · {branch}',
  'cli.checkpoint.restore': '  Restore: git stash apply {ref}',
  'cli.checkpoint.nothing': '  📍 Checkpoint · nothing to snapshot · {branch}',
  'cli.init.wrap_hint_npm': '  Tip: `sq wrap -- npm test` turns green tests into loot.',
  'cli.init.wrap_hint_generic': '  Tip: `sq wrap -- <your test cmd>` turns green tests into loot.',
  'cli.try.intro': '🌳 grove · demo (scratch · your real state is untouched)',
  'cli.try.cta': 'Like it? Run `sq init` to start earning on real commits.',
  'cli.try.zen_done': 'demo done · run `sq init` to start for real',
  'cli.help.cmd.try': '  try (alias: demo)\n      Taste the loot loop in a throwaway scratch dir · runs a few canned outcomes\n      through the engine. Your real state + repo are NEVER touched (ADR-0005).',
  'cli.promise.title': "Grove's promise · the firewall",
  'cli.promise.no_modify': 'Never modifies your code, commits, docs, or git history.',
  'cli.promise.no_autorun': 'Never auto-runs your tests; it reads outcomes you already produce.',
  'cli.promise.chain_safe': 'Chains git hooks, statusline, and settings; never clobbers them.',
  'cli.promise.cosmetic': 'Rewards are cosmetic only; they confer zero power over real work.',
  'cli.promise.calm': 'Calm by default · no shame, no nag, no streaks to lose.',
  'cli.checkpoints.header': '  📍 Checkpoints · last {count}',
  'cli.checkpoints.entry': '  {ago} · {branch} · {message} · {shape}',
  'cli.checkpoints.recall': '    recall: git stash apply {ref}',
  'cli.checkpoints.clean': 'clean',
  'cli.checkpoints.empty': '  📍 No checkpoints yet · run `sq checkpoint` to snapshot working state.',
  'cli.time.just_now': 'just now',
  'cli.time.min_ago': '{n}m ago',
  'cli.time.hr_ago': '{n}h ago',
  'cli.time.day_ago': '{n}d ago',

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

  // -------------------------------------------------------------------------
  // cli.help.* — the sq help / USAGE block (src/cli/sq.ts buildUsageText)
  //
  // BYTE-IDENTICAL rule: en values must reproduce the English help exactly when
  // assembled by buildUsageText.  Cost numbers are carried as {placeholders} so
  // the live-engine constant thread-through (P2 anti-drift) still works.
  // -------------------------------------------------------------------------
  'cli.help.usage': 'Usage: sq [--home <DIR>] [--zen] <subcommand> [flags]',
  'cli.help.global_flags': 'Global flags:',
  'cli.help.flag.zen': '  --zen   Calm mode (or env GROVE_ZEN=1). The engine still records state, but\n          output is plain & terse · NO loot/crit/serendipity/milestone lines,\n          no contextual offers, no drop reveals. Just a quiet confirmation.',
  'cli.help.subcommands': 'Subcommands:',
  'cli.help.cmd.event': '  event <type> [--magnitude N] [--success true|false] [--source S] [--session ID]\n      Ingest a Grove event. <type> must be one of:\n          {eventTypes}',
  'cli.help.cmd.wrap': '  wrap [--as <type>] [--home DIR] -- <cmd...>\n      Run a command you run anyway (tests / build / lint), stream its output\n      transparently, and ingest a REAL outcome from its EXIT CODE (ADR-0003):\n      a green command grants the reward; a FAILING one grants NOTHING (firewall).\n      sq exits with the wrapped command\'s exact exit code (transparent passthrough),\n      so it drops in front of any command in a script or CI.\n      --as  Force the event type (test_result | build_result | lint_clean).\n            Otherwise inferred from the command (test/build/lint), default test_result.\n      e.g.  sq wrap -- npm test      sq wrap --as build_result -- make',
  'cli.help.cmd.status': '  status\n      Show current Grove game state.',
  'cli.help.cmd.recap': '  recap [--since session|week|all] [--csv]\n      Show a recap of events and progress.\n      --since session  (default) · events since the last session_start\n      --since week     · events since this week (UTC) began\n      --since all      · all events\n      --csv            · export the event timeline as CSV to stdout (pipe: > file.csv)',
  'cli.help.cmd.scan': '  scan [path] [--home DIR]\n      Scan a repo directory for Pillar-B signals (grimoire, tests, docs, specs, decisions).\n      Defaults to process.cwd() if no path given. Ingests detected events and\n      prints rewards; prints a summary of what was detected.',
  'cli.help.cmd.quests': '  quests [--home DIR]\n      Show the Pillar-B quest board with status glyphs and active buffs.\n      ✓ done  ◆ active  · not yet started',
  'cli.help.cmd.pull': '  pull [--premium] [--spark <cardId>] [--seed N] [--home DIR]\n      Spend {pullCost} 🌰 seeds for one gacha pull (the core decision · you choose WHEN).\n      --premium  Spend {premiumCost} 🌰 for a PREMIUM pull (better odds; the escalating sink).\n      --spark    (with --premium) Choose a missing card to build a GUARANTEE toward ·\n                 after enough premium misses the next premium pull is guaranteed to be it.\n      Earn seeds by shipping outcomes (commits, green tests, merges, docs).\n      Refuses calmly when you can\'t afford it. Cosmetic only (ADR-0005).',
  'cli.help.cmd.craft': '  craft [cardId] [--home DIR]\n      Spend {shardsCraft} shards to craft ONE chosen missing card (the dup-tail SINK · every\n      duplicate pull banks rarity-scaled shards). With no id, crafts the first\n      missing card in your unlocked sets. Refuses calmly when short on shards or\n      nothing is left to craft. Cosmetic only (ADR-0005).',
  'cli.help.cmd.foil': '  foil [cardId] [--home DIR]\n      Spend {foilMin} to {foilMax} shards (scaled by the card\'s rarity) to cosmetically\n      FOIL an OWNED card (a renewable polish · a completed collection still has a\n      target). With no id, foils the first\n      not-yet-foiled owned card. Refuses calmly when short on shards or nothing\n      is left to foil. Cosmetic only, confers ZERO power (ADR-0005).',
  'cli.help.cmd.convert': '  convert [n] [--home DIR]\n      Trade banked shards back into 🌰 seeds at {shardToSeed} 🌰 per shard for the first {convertFullTier} shards,\n      then half-rate beyond (so crafting stays the better deal). Once craftable-\n      complete, surplus shards still have a horizon. With no count, converts ALL\n      banked shards; with [n], exactly min(n, banked). Refuses calmly at zero shards.\n      Cosmetic only (ADR-0005).',
  'cli.help.cmd.prestige': '  prestige [--home DIR]\n      Spend {prestigeCost} 🌰 seeds to buy the next ENDGAME prestige rank · a permanent\n      cosmetic flair at an escalating, recurring cost (the late-game seed sink: a\n      finished collection always has a target). Refuses calmly when broke.\n      Cosmetic-only, confers ZERO power (ADR-0005).',
  'cli.help.cmd.enhance': '  enhance <ref> [--seed N] [--home DIR]\n      Spend seeds to attempt to enhance a piece of cosmetic gear (risk + reward).\n      Cost SCALES with the gear\'s level ({enhanceBase} at +0, +{enhancePer} per level), so chasing a\n      high +N is a deepening sink. <ref> can be a gear id, a 1-based index, or \'first\'.\n      If the gear is PROTECTED (sq protect), a would-be break softens to a downgrade.\n      Refuses calmly when you can\'t afford it. Cosmetic only · real code is NEVER affected (ADR-0005).',
  'cli.help.cmd.repair': '  repair <ref> [--home DIR]\n      Spend seeds to un-break a cosmetic gear (its level is preserved). Cost SCALES\n      with the gear\'s level ({repairBase} at +0, +{repairPer} per level) · a broken +12 costs far more\n      than a +1. <ref> can be a gear id, a 1-based index, or \'first\'.\n      Refuses calmly when you can\'t afford it. Cosmetic only (ADR-0005).',
  'cli.help.cmd.protect': '  protect <ref> [--home DIR]\n      Spend {protectCost} 🌰 seeds to arm a ONE-SHOT protection: the next enhance turns a\n      would-be break into a downgrade instead. <ref> = gear id, index, or \'first\'.\n      Refuses calmly when broke. Cosmetic risk-management only (ADR-0005).',
  'cli.help.cmd.dashboard': '  dashboard [--no-clear] [--home DIR]\n      Display the full in-place Grove dashboard (levels, gear, collection, quests).\n      --no-clear  Skip the terminal clear (useful for tests / piped output).',
  'cli.help.cmd.tui': '  tui [--once] [--home DIR]\n      Launch the navigable, live-updating Grove dashboard (Ink TUI): arrow/tab to\n      move focus, p pull · P premium · e enhance · c craft · b prestige · q quit.\n      Every action runs the same engine and persists under the lock. Cosmetic only.\n      --once  Render ONE static frame and exit (for tests / CI / piped output).',
  'cli.help.cmd.serve': '  serve [--port N] [--host H] [--home DIR]\n      Start a local, READ-ONLY web dashboard over your Grove state and print its\n      URL; runs until Ctrl-C, live-updating an open page as state changes. Binds\n      to 127.0.0.1 by default; --host 0.0.0.0 exposes it on your LAN (opt-in, loud).\n      --port  TCP port (default: an ephemeral free port).',
  'cli.help.cmd.statusline_ingest': '  statusline-ingest [--home DIR]\n      Read the Claude Code statusline JSON from STDIN, parse it, and ingest a\n      quota_update event to keep the energy system current.\n      Prints NOTHING to stdout (designed to run inside the statusline pipe).\n      Always returns 0 · never disrupts the HUD.',
  'cli.statusline.segment_offer': '  Want Grove on your statusline too? It is opt-in (Grove never edits this for you).\n  Set statusLine.command to: {chain}',
  'cli.help.cmd.statusline_segment': '  statusline-segment [--home DIR]\n      Print ONE compact Grove line (level · xp · energy) for your statusline.\n      Read-only · composable: chain it after your own command. Calm by default.\n      --zen prints an even terser form. Never disrupts the HUD (always exits 0).',
  'cli.help.cmd.statusline_install': '  statusline install [--settings PATH]\n      Install Grove\'s chain-safe statusline wrapper.\n      Backs up the original statusLine.command and chains Grove onto it.\n      The original statusline is ALWAYS preserved (never clobbered).\n      --settings  Path to Claude Code\'s settings.json (default: ~/.claude/settings.json).',
  'cli.help.cmd.statusline_uninstall': '  statusline uninstall [--settings PATH]\n      Remove Grove\'s statusline wrapper, restoring the original command.\n      --settings  Path to Claude Code\'s settings.json (default: ~/.claude/settings.json).',
  'cli.help.cmd.init': '  init [--repo DIR]\n      Install Grove\'s post-commit git hook in a repo (chains; never clobbers).\n      Defaults to process.cwd() if --repo is omitted.\n      Grove failures NEVER block commits · the hook is fail-open by design.',
  'cli.help.cmd.uninstall': '  uninstall [--repo DIR]\n      Remove Grove\'s contribution from the post-commit hook. Other hooks intact.\n      Defaults to process.cwd() if --repo is omitted.',
  'cli.help.cmd.commit_hook': '  commit-hook [--repo DIR] [--home DIR]\n      Called automatically by the installed post-commit hook on every commit.\n      Scans the repo for Pillar-B signals and ingests events.',
  'cli.help.cmd.merge_hook': '  merge-hook [--repo DIR] [--home DIR]\n      Called automatically by the installed post-merge hook. Emits a pr_merged\n      outcome ONLY on a real merge commit (a fast-forward pull never over-rewards).',
  'cli.help.cmd.export': '  export [file] [--home DIR]\n      Write your current Grove state as a portable, versioned JSON envelope to a\n      file (atomic) or stdout. Read-only · cosmetic stats only.',
  'cli.help.cmd.import': '  import <file> [--home DIR]\n      Read a sq export JSON and SAFELY replace local state. Your current state is\n      backed up first; a bad file is refused without changing anything.',
  'cli.commons.row': '#{number} · {title} · {labels}',
  'cli.commons.empty': 'no claimable commons tasks right now · check back later',
  'cli.commons.brief': 'task #{number}: {title}\n  Your AI drafts the patch · YOU review and open the PR (ADR-0013).\n  Grove never writes code or runs it · GitHub Actions runs CI.',
  'cli.commons.open_hint': 'fork, then open the PR under YOUR identity:\n  gh pr create --repo {repo} --title "fix #{number}"',
  'cli.commons.usage': 'Usage: sq commons list | draft <N> | open <N>',
  'learn.conventional-commits.why': 'Consistent commit messages make history searchable and automate changelog generation.',
  'learn.test-first.why': 'A failing test written first pins the intended behavior before the code can drift from it.',
  'learn.spec-first.why': 'Acceptance criteria written before coding turn a vague task into a pass/fail target.',
  'learn.plan-first.why': 'A short plan before building surfaces dependencies and dead ends while they are still cheap to change.',
  'learn.sync-docs.why': 'Docs kept in step with the code stay trustworthy; stale docs quietly mislead the next reader.',
  'learn.keep-adrs.why': 'Recording a decision and its reason lets future-you reverse it on purpose, not by accident.',
  'learn.small-changes.why': 'A small focused change is easier to review, to revert, and to reason about than a sprawling one.',
  'learn.write-grimoire.why': 'A lean CLAUDE.md / AGENTS.md tells any AI tool your project\'s rules once, instead of every session.',
  'cli.learn.header': 'Practices you can learn the why behind (opt-in · run `sq learn <practice>`):',
  'cli.learn.row': '  {name} · {why}',
  'cli.learn.unknown': 'unknown practice "{practice}" · run `sq learn` for the list',
  'cli.quests.learn_tip': '  · tip: `sq learn <practice>` for the why behind any of these (opt-in).',
  'cli.help.cmd.learn': '  learn [practice]\n      Print a terse one-line WHY a practice matters (opt-in · never auto-shown).\n      With no argument, lists every practice with its one-liner. Read-only ·\n      ingests nothing, rewards nothing (ADR-0005).',
  'cli.help.cmd.commons': '  commons [list | draft <N> | open <N>] [--repo OWNER/REPO]\n      Opt-in: list claimable commons tasks (GitHub issues labelled commons),\n      help your AI draft a patch you review, then YOU open the PR (ADR-0013).\n      Grove never writes code, never runs it, never opens the PR · read-only.',
  'cli.help.cmd.suggest_commit': '  suggest-commit [--repo DIR]\n      Read-only: print a suggested commit message from staged diff. No AI ·\n      type inferred from file paths (test/docs/chore/feat). Copy the output.\n      If nothing is staged, prints a hint to run git add first.',
  'cli.help.cmd.checkpoint': '  checkpoint [-m MSG] [--repo DIR] [--home DIR]\n      📍 Safety-net: snapshot working state via git stash create (read-only ·\n      never modifies tree/index), record to grove state, ingest a checkpoint\n      event for the rest-buff reward. Prints how to restore with git stash apply.',
  'cli.help.cmd.checkpoints': '  checkpoints [--limit N] [--home DIR]\n      Read-only: list the last N safety-net snapshots (default 10) from sq checkpoint.\n      Shows branch, message, change shape, and a copyable git stash apply command.\n      Never runs git or mutates state (ADR-0005).',
  'cli.help.cmd.share': '  share [--badge] [--home DIR]\n      Print a terse, copy-pasteable share card (level + collection %). Opt-in &\n      privacy-minimal · only cosmetic stats, NEVER code/cwd/cost (ADR-0011).\n      --badge  Print a markdown shields.io badge for your README instead.',
  'cli.help.cmd.ntfy': '  ntfy <topic> | off [--home DIR]\n      Opt-in mobile push (ntfy.sh). Default OFF · no push unless you set a topic.\n      <topic>  Set the topic; install the ntfy.sh app and subscribe to it.\n      off      Disable push. Big moments only (level-ups, legendaries, chests);\n      the message carries cosmetic events only · NEVER code/cwd/cost (ADR-0011).',
  'cli.help.cmd.help': '  help\n      Show this help message.',
  'cli.help.cmd.loadout': '  loadout [equip <ref> | unequip <N>] [--home DIR]\n      View or edit your 3-slot loadout (cosmetic build · ADR-0014).\n      Active synergies between equipped members boost XP / seeds / crit.\n      Empty loadout is first-class neutral · cosmetic only (ADR-0005).\n      equip <ref>   Equip a card/gear/buff. Format: kind/id[/tag]\n                    e.g.  sq loadout equip card/tools.hammer/tools\n                          sq loadout equip gear/gear.commit-hammer.42/Commit Hammer\n                          sq loadout equip buff/precast-spec\n      unequip <N>   Unequip slot N (1-based). e.g. sq loadout unequip 2',
  'cli.help.cmd.incursion': '  incursion [start [--seed S] [--kit shield] | status | dive | escape | history] [--home DIR]\n      THE DUNGEON: a push-your-luck roguelike run. Pack your build, dive a seeded\n      gauntlet, bank fatter loot each floor · but only if you ESCAPE alive. Dive too\n      deep and DIE: the run-bag is forfeit. Your real collection is touched only on\n      escape; a dead run costs nothing real, and a new run is always free (ADR-0005).\n      start   Roll a 5-floor run, snapshotting your loadout + gear power.\n      dive    Attempt the next floor (clear = loot · fail = -HP · 0 HP = death).\n      escape  Walk out alive and bank the whole run-bag into your collection.\n      history Past runs (war stories): floors cleared, and what you banked or where you fell.',
  'cli.help.cmd.achievements': '  achievements [--all] [--home DIR]\n      Show unlocked achievements (retroactive recognitions of cumulative progress).\n      Default: unlocked only. --all also shows locked ones. --zen prints a count only.\n      Cosmetic only · never expires (ADR-0015).',
  'cli.help.cmd.promise': "  promise\n      Print Grove's hard ethics guarantees: never modifies code/commits/docs/git,\n      never auto-runs tests, chains hooks/statusline/settings, rewards cosmetic-only,\n      calm by default. Read-only (ADR-0005).",

  // -------------------------------------------------------------------------
  // ui.achievements.* — achievements panel (src/render/achievements.ts)
  // -------------------------------------------------------------------------
  'ui.achievements.title': 'ACHIEVEMENTS',
  'ui.achievements.mastered': "  🌳 You've got the groove. The grove is yours; play on, or rest easy.",
  'ui.achievements.none': '  (none yet)',
  'ui.achievements.unlocked_row': '  🏆 {name} · {desc}',
  'ui.achievements.locked_header': '  locked:',
  'ui.achievements.locked_row': '  · {name} · {desc}',

  // cli.achievements.* — achievements subcommand messages
  'cli.achievements.zen_count': '{n}/{total} achievements unlocked',

  // -------------------------------------------------------------------------
  // guide.* — the web "How to play" tutorial (src/web/page.ts guideSection)
  // -------------------------------------------------------------------------
  'guide.title': 'How to play',
  'guide.intro': 'A calm game over your AI-coding · ship real work → loot, good habits → quests. Cosmetic only; your code is never touched.',
  'guide.loop.h': 'The loop',
  'guide.loop.b': 'Ship (commit · green tests · merged PR) → earn 🌰 seeds → spend on pulls & gear → collect cards, level up.',
  'guide.earn.h': 'Earn',
  'guide.earn.b': 'Commits, green tests (sq wrap), merges, docs, a written CLAUDE.md (quests).',
  'guide.panels.h': 'Reading the board',
  'guide.panels.b': 'XP · seeds/shards · ODDS (pity & spark) · collection · gear · quests · buffs · energy.',
  'guide.commands.h': 'Commands',
  'guide.commands.b': 'sq init · sq dashboard · sq pull · sq enhance · this live page.',
  'guide.ethos': 'Cosmetic by design · never harms your code · calm, no grind.',
}

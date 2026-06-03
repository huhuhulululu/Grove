/**
 * contract.test.ts — the i18n CONTRACT the wiring agents build on.
 *
 * Two guarantees:
 *  1) BYTE-IDENTICAL ROUND-TRIP — for a representative set of engine `reward.*`
 *     keys, `msg(key, args).message` reproduces the EXACT legacy English string
 *     the pure engine currently emits (the existing engine tests assert these
 *     literals). The right-hand literals below are COPIED verbatim from
 *     src/engine/{reduce,quests}.ts + src/core/quests.ts — if a wiring agent keys
 *     the engine to a key whose `en` value drifted from the legacy string, this
 *     test fails loudly. English output stays unchanged after keying.
 *  2) CATALOG PARITY (stronger than i18n.test.ts's spot-check) — every en key
 *     exists in zh-CN and ja, with no extra keys and no empty templates. This is
 *     the safety net that keeps a translation from silently dropping a string.
 *
 * NOTE: USAGE_TEXT (src/cli/sq.ts) is intentionally NOT keyed in this pass — the
 * cost-drift guard asserts on it in English; see notes returned by the keystone.
 */
import { describe, it, expect } from 'vitest'
import { msg, t } from './t'
import { en } from './catalog/en'
import { zhCN } from './catalog/zh-CN'
import { ja } from './catalog/ja'
import { ko } from './catalog/ko'
import { LOCALES } from './types'

// ---------------------------------------------------------------------------
// 1) Byte-identical round-trip: msg(key,args).message === legacy English string
// ---------------------------------------------------------------------------

describe('contract — engine reward.* keys reproduce the legacy English byte-for-byte', () => {
  // [key, args, EXACT legacy English string]. Literals copied from the engine source.
  const cases: ReadonlyArray<[string, Record<string, string | number> | undefined, string]> = [
    // reduce.grantXp — xp + crit + levelup + level-up seeds
    ['reward.xp', { amount: 17, flavour: 'tests green' }, '+17 XP · tests green'],
    ['reward.xp_crit', { amount: 90, flavour: 'commit', critMult: 3 }, '+90 XP · commit 💥 CRIT ×3'],
    ['reward.levelup', { level: 6 }, 'Level 6'],
    ['reward.levelup_seeds', { seeds: 30, levelUps: 2 }, '+30 🌰 · level up ×2'],

    // reduce — set unlock / set complete / set-bonus legendary
    ['reward.set_unlocked', { set: 'tools', lvl: 3 }, '🔓 tools set unlocked · L3'],
    ['reward.set_complete', { set: 'forest', pct: 10 }, '✦ set forest complete · +10% 🌰 (permanent)'],
    ['reward.legendary', { name: 'Oak' }, '✦ Oak · legendary'],

    // reduce/collection — currency grants, dupe, windfall, milestone, doc streak, convert
    ['reward.currency_seeds', { amount: 5, flavour: 'tests green' }, '+5 🌰 seeds · tests green'],
    ['reward.dupe', { seeds: 10, shards: 4 }, '+10 🌰 · +4 shards · dupe'],
    ['reward.windfall', { amount: 25 }, '✨ windfall · +25 🌰'],
    ['reward.milestone_chest', { seeds: 6 }, '🎁 milestone chest · +6 🌰 (work tracked)'],
    ['reward.doc_streak', { streak: 3, seeds: 10 }, '🔥 Doc Streak ×3 · +10 🌰'],
    ['reward.shards_to_seeds', { seeds: 12, convert: 6 }, '+12 🌰 · 6 shards → seeds'],

    // reduce.pull / pullPremium — spend, card lines, refusals
    ['reward.pull_spend', { cost: 45 }, '-45 🌰 · pull'],
    ['reward.premium_spend', { cost: 225 }, '-225 🌰 · premium pull'],
    ['reward.card', { mark: '', name: 'Sapling', rarity: 'common' }, 'Sapling · common'],
    ['reward.card', { mark: '✦ ', name: 'Oak', rarity: 'legendary' }, '✦ Oak · legendary'],
    ['reward.card_premium', { mark: '', name: 'Vine', rarity: 'rare' }, '✦ premium · Vine · rare'],
    ['reward.lucky_drop', { mark: '✦ ', name: 'Oak', rarity: 'legendary' }, '✨ lucky drop · ✦ Oak · legendary'],
    ['reward.not_enough_pull', { cost: 45, have: 10 }, 'not enough 🌰 · need 45, have 10'],
    ['reward.not_enough_premium', { cost: 225, have: 10 }, 'not enough 🌰 · premium needs 225, have 10'],

    // reduce — spark guarantee + foil finish
    ['reward.spark_guarantee', { mark: '✦ ', name: 'Oak', rarity: 'legendary' }, '✦ SPARK guarantee · ✦ Oak · legendary'],
    ['reward.spark_foil', { name: 'Oak' }, '✦ FOIL finish · Oak arrives foiled (spark)'],

    // reduce.craftCard — spend, crafted, refusals
    ['reward.craft_spend', { cost: 60 }, '-60 shards · craft'],
    ['reward.crafted', { mark: '', name: 'Vine', rarity: 'rare' }, '🛠 crafted · Vine · rare'],
    ['reward.craft_locked', { cardId: 'relics.crown' }, '🔒 relics.crown is in a locked set · can\'t craft yet'],
    ['reward.craft_unavailable', { cardId: 'tools.hammer' }, 'can\'t craft tools.hammer · already owned or not craftable'],
    ['reward.craft_need_shards', { cost: 60, have: 10 }, 'not enough shards · craft needs 60, have 10'],
    ['reward.craft_complete', undefined, 'nothing left to craft · collection complete'],

    // reduce.grantGear
    ['reward.gear', { name: 'Refactor Blade', level: 0 }, 'Refactor Blade +0'],

    // reduce.foilCard — spend, shimmer, refusals, capstone
    ['reward.foil_spend', { cost: 12, rarity: 'rare' }, '-12 shards · foil rare'],
    ['reward.foil_shimmer', { name: 'Oak' }, '✦ FOIL · Oak now shimmers (cosmetic)'],
    ['reward.foil_not_owned', { cardId: 'tools.hammer' }, 'can\'t foil tools.hammer · you don\'t own it'],
    ['reward.foil_already', { cardId: 'tools.hammer' }, 'tools.hammer is already foiled'],
    ['reward.foil_nothing_owned', undefined, 'nothing to foil · no cards owned yet'],
    ['reward.foil_all_foiled', undefined, 'nothing left to foil · all owned cards are foiled'],
    ['reward.foil_need_shards', { name: 'Oak', cost: 12, have: 4 }, 'not enough shards · foil Oak needs 12, have 4'],
    ['reward.foiled_capstone', { set: 'tools' }, '✦✦ tools set fully foiled · capstone unlocked (cosmetic)'],

    // reduce.buyPrestige — spend, earned, refusal
    ['reward.prestige_spend', { cost: 500, rank: 1 }, '-500 🌰 · prestige 1'],
    ['reward.prestige_earned', { rank: 1 }, '✦ Prestige 1 earned (permanent cosmetic)'],
    ['reward.not_enough_prestige', { rank: 1, cost: 500, have: 10 }, 'not enough 🌰 · prestige 1 costs 500, have 10'],

    // engine/quests.ts — quest flavour lines + first-time unlocks
    ['reward.quest.grimoire_aura', undefined, 'CLAUDE.md written · permanent aura'],
    ['reward.quest.precast_armed', undefined, 'spec first · x2 armed'],
    ['reward.quest.precast_unlocked', undefined, 'Spec First unlocked'],
    ['reward.quest.living_map_buff', undefined, 'docs synced · Fresh Architecture'],
    ['reward.quest.living_map_unlocked', undefined, 'Sync the Docs unlocked'],
    ['reward.quest.test_warden_first', undefined, 'test added'],
    ['reward.quest.review_buff', undefined, 'review done · Fresh Eyes'],
    ['reward.quest.review_unlocked', undefined, 'Close the Review unlocked'],
    ['reward.quest.clean_build_aura', undefined, 'lint clean · +seeds aura (permanent)'],
    ['reward.quest.merge_buff', undefined, 'PR merged · Momentum'],
    ['reward.quest.merge_unlocked', undefined, 'Merge the PR unlocked'],
    ['reward.quest.plan_ahead_buff', undefined, 'plan set · ready to build'],
    ['reward.quest.plan_ahead_unlocked', undefined, 'Plan Ahead unlocked'],
    ['reward.quest.adr_recorded', undefined, 'decisions.md kept · ADR recorded'],

    // XP_FLAVOUR sub-strings (composed into reward.xp by the engine)
    ['reward.flavour.commit', undefined, 'commit'],
    ['reward.flavour.test_result', undefined, 'tests green'],
    ['reward.flavour.build_result', undefined, 'build green'],
    ['reward.flavour.lint_clean', undefined, 'lint clean'],
    ['reward.flavour.review_confirmed', undefined, 'review done'],
    ['reward.flavour.pr_merged', undefined, 'PR merged'],
    ['reward.flavour.doc_updated', undefined, 'docs updated'],
    ['reward.flavour.spec_written', undefined, 'spec written'],
    ['reward.flavour.plan_written', undefined, 'plan set'],

    // core/quests.ts — the 8 quest titles + descriptions (each has a STABLE id)
    ['quest.grimoire.title', undefined, 'Write the CLAUDE.md'],
    ['quest.grimoire.desc', undefined, 'Add a lean CLAUDE.md / AGENTS.md · permanent repo aura.'],
    ['quest.precast-spec.title', undefined, 'Spec First'],
    ['quest.precast-spec.desc', undefined, 'Write acceptance criteria before coding · arms an XP x2.'],
    ['quest.living-map.title', undefined, 'Sync the Docs'],
    ['quest.living-map.desc', undefined, 'Keep architecture docs in sync with the code · Fresh Architecture buff.'],
    ['quest.test-warden.title', undefined, 'Add Tests'],
    ['quest.test-warden.desc', undefined, 'Add a test (edge/error paths and tests-first count extra) · guaranteed loot.'],
    ['quest.review-loop.title', undefined, 'Close the Review'],
    ['quest.review-loop.desc', undefined, 'Land a confirmed review · Fresh Eyes buff.'],
    ['quest.clean-build.title', undefined, 'Keep It Clean'],
    ['quest.clean-build.desc', undefined, 'Ship a lint-clean build · permanent +seeds aura.'],
    ['quest.merge-master.title', undefined, 'Merge the PR'],
    ['quest.merge-master.desc', undefined, 'Merge a pull request · guaranteed loot + gear.'],
    ['quest.doc-streak.title', undefined, 'Doc Streak'],
    ['quest.doc-streak.desc', undefined, 'Keep docs fresh, week over week · a tiered, renewable streak.'],
    ['quest.plan-ahead.title', undefined, 'Plan Ahead'],
    ['quest.plan-ahead.desc', undefined, 'Write a plan before you build · marks the chore done.'],
    ['quest.adr-kept.title', undefined, 'Decisions Recorded'],
    ['quest.adr-kept.desc', undefined, 'Keep docs/decisions.md · record why the code is shaped this way.'],
  ]

  for (const [key, args, expected] of cases) {
    it(`${key} → byte-identical English`, () => {
      const m = msg(key, args)
      expect(m.message).toBe(expected)
      expect(m.msgKey).toBe(key)
      // The keyed message must also be re-derivable straight from the en catalog.
      expect(t('en', key, args)).toBe(expected)
    })
  }

  it('every asserted key actually exists in the en catalog (no fallback-to-raw)', () => {
    for (const [key] of cases) {
      expect(key in en, `en catalog missing ${key}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 2) Full catalog parity — every en key present in zh-CN + ja, none empty
// ---------------------------------------------------------------------------

describe('contract — full catalog parity (en ⊆⊇ zh-CN, ja, ko; non-empty)', () => {
  const enKeys = Object.keys(en).sort()
  const others: ReadonlyArray<[string, Record<string, string>]> = [
    ['zh-CN', zhCN],
    ['ja', ja],
    ['ko', ko],
  ]

  it('declares exactly en, zh-CN, ja, ko', () => {
    expect([...LOCALES].sort()).toEqual(['en', 'ja', 'ko', 'zh-CN'])
  })

  it('the en catalog is non-trivial (the full surface was keyed)', () => {
    // Guards against an accidental truncation back to the tiny seed catalog.
    expect(enKeys.length).toBeGreaterThan(120)
  })

  for (const [name, cat] of others) {
    it(`${name} covers every en key (no MISSING)`, () => {
      const missing = enKeys.filter((k) => !(k in cat))
      expect(missing, `${name} missing: ${missing.join(', ')}`).toEqual([])
    })
    it(`${name} adds no EXTRA key not in en`, () => {
      const extra = Object.keys(cat).filter((k) => !(k in en))
      expect(extra, `${name} extra: ${extra.join(', ')}`).toEqual([])
    })
    it(`${name} leaves no template empty`, () => {
      const empty = Object.entries(cat).filter(([, v]) => v.trim() === '').map(([k]) => k)
      expect(empty, `${name} empty: ${empty.join(', ')}`).toEqual([])
    })
  }

  it('en itself has no empty template', () => {
    const empty = Object.entries(en).filter(([, v]) => v.trim() === '').map(([k]) => k)
    expect(empty, `en empty: ${empty.join(', ')}`).toEqual([])
  })

  it('every locale preserves a key\'s {placeholders} (no dropped interpolation)', () => {
    const placeholders = (s: string): string[] =>
      (s.match(/\{(\w+)\}/g) ?? []).sort()
    for (const key of enKeys) {
      const want = placeholders(en[key]!)
      for (const [name, cat] of others) {
        const got = placeholders(cat[key]!)
        expect(got, `${name} ${key} placeholders drifted`).toEqual(want)
      }
    }
  })
})

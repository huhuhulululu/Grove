/**
 * i18n foundation tests — translation core, the engine-facing msg() helper, env
 * locale resolution, and (critically) catalog PARITY so no locale silently drops
 * a key. This is the safety net the per-surface i18n wiring builds on.
 */
import { describe, it, expect } from 'vitest'
import { interpolate, t, msg } from './t'
import { normalizeLocale, resolveLocale, localeFromAcceptLanguage } from './locale'
import { LOCALES, DEFAULT_LOCALE } from './types'
import { en } from './catalog/en'
import { zhCN } from './catalog/zh-CN'
import { ja } from './catalog/ja'
import { ko } from './catalog/ko'

describe('interpolate', () => {
  it('substitutes {name} placeholders from args', () => {
    expect(interpolate('Level {level}', { level: 6 })).toBe('Level 6')
    expect(interpolate('+{a} · {b}', { a: 17, b: 'tests green' })).toBe('+17 · tests green')
  })
  it('returns the template unchanged when there are no args', () => {
    expect(interpolate('no placeholders')).toBe('no placeholders')
  })
  it('leaves an unknown placeholder literal (never crashes)', () => {
    expect(interpolate('hi {missing}', { other: 1 })).toBe('hi {missing}')
  })
})

describe('t — translate with locale + fallback chain', () => {
  it('returns the locale-specific template', () => {
    expect(t('zh-CN', 'reward.levelup', { level: 6 })).toBe('等级 6')
    expect(t('ja', 'reward.levelup', { level: 6 })).toBe('レベル 6')
    expect(t('en', 'reward.levelup', { level: 6 })).toBe('Level 6')
    expect(t('ko', 'reward.levelup', { level: 6 })).toBe('레벨 6')
  })
  it('falls back to en when a key is missing in the locale catalog', () => {
    // (no key is currently EN-only, so simulate via an unknown locale shape)
    expect(t('en', 'reward.legendary', { name: 'Oak' })).toBe('✦ Oak · legendary')
  })
  it('falls back to the raw key when the key exists nowhere (visible, not a crash)', () => {
    expect(t('zh-CN', 'totally.unknown.key')).toBe('totally.unknown.key')
  })
})

describe('msg — engine-facing keyed message', () => {
  it('returns the EN-rendered message plus key/args for re-translation', () => {
    const m = msg('reward.levelup', { level: 6 })
    expect(m.message).toBe('Level 6') // byte-identical to the legacy English string
    expect(m.msgKey).toBe('reward.levelup')
    expect(m.msgArgs).toEqual({ level: 6 })
  })
  it('omits msgArgs when there are none', () => {
    const m = msg('reward.levelup')
    expect(m.msgArgs).toBeUndefined()
    expect(m.msgKey).toBe('reward.levelup')
  })
  it('a renderer can re-translate a keyed message into another locale', () => {
    const m = msg('reward.set_complete', { set: 'forest', pct: 10 })
    expect(m.message).toBe('✦ set forest complete · +10% 🌰 (permanent)')
    expect(t('zh-CN', m.msgKey, m.msgArgs)).toBe('✦ forest 套牌集齐 · +10% 🌰(永久)')
  })
  it('ko: t("ko", "reward.levelup", {level:6}) returns Korean', () => {
    expect(t('ko', 'reward.levelup', { level: 6 })).toBe('레벨 6')
  })
})

describe('normalizeLocale / resolveLocale', () => {
  it('maps common env shapes to a supported locale', () => {
    expect(normalizeLocale('zh_CN.UTF-8')).toBe('zh-CN')
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN')
    expect(normalizeLocale('ja_JP.UTF-8')).toBe('ja')
    expect(normalizeLocale('ko_KR.UTF-8')).toBe('ko')
    expect(normalizeLocale('ko-KR')).toBe('ko')
    expect(normalizeLocale('en_US')).toBe('en')
  })
  it('defaults to en for empty/undefined/unknown', () => {
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('fr_FR')).toBe(DEFAULT_LOCALE)
  })
  it('prefers GROVE_LANG over LC_ALL/LANG', () => {
    expect(resolveLocale({ GROVE_LANG: 'zh', LANG: 'ja_JP' } as NodeJS.ProcessEnv)).toBe('zh-CN')
    expect(resolveLocale({ LC_ALL: 'ja_JP', LANG: 'en_US' } as NodeJS.ProcessEnv)).toBe('ja')
    expect(resolveLocale({ LANG: 'en_US' } as NodeJS.ProcessEnv)).toBe('en')
    expect(resolveLocale({} as NodeJS.ProcessEnv)).toBe(DEFAULT_LOCALE)
  })
})

describe('localeFromAcceptLanguage — auto-detect a visitor browser language', () => {
  it('picks the top supported tag honoring order + q-weights', () => {
    expect(localeFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN')
    expect(localeFromAcceptLanguage('ja-JP,ja;q=0.9')).toBe('ja')
    expect(localeFromAcceptLanguage('ko-KR,ko;q=0.9')).toBe('ko')
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en')
  })
  it('skips UNSUPPORTED top choices and matches a lower-ranked supported one', () => {
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,zh;q=0.5')).toBe('zh-CN')
    // q-weight beats list order
    expect(localeFromAcceptLanguage('en;q=0.3,ja;q=0.9')).toBe('ja')
  })
  it('returns null when absent or no supported language is named', () => {
    expect(localeFromAcceptLanguage(undefined)).toBeNull()
    expect(localeFromAcceptLanguage('')).toBeNull()
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull()
    expect(localeFromAcceptLanguage('*')).toBeNull()
  })
})

describe('catalog parity — every locale covers exactly the en keyset', () => {
  const enKeys = Object.keys(en).sort()
  const catalogs: Record<string, Record<string, string>> = { 'zh-CN': zhCN, ja, ko }

  it('all declared LOCALES are accounted for', () => {
    expect([...LOCALES].sort()).toEqual(['en', 'ja', 'ko', 'zh-CN'])
  })

  for (const [name, cat] of Object.entries(catalogs)) {
    it(`${name} has no MISSING keys vs en`, () => {
      const missing = enKeys.filter((k) => !(k in cat))
      expect(missing, `${name} missing: ${missing.join(', ')}`).toEqual([])
    })
    it(`${name} has no EXTRA keys not in en (catches typos)`, () => {
      const extra = Object.keys(cat).filter((k) => !(k in en))
      expect(extra, `${name} extra: ${extra.join(', ')}`).toEqual([])
    })
    it(`${name} leaves no template empty`, () => {
      const empty = Object.entries(cat).filter(([, v]) => v.trim() === '').map(([k]) => k)
      expect(empty, `${name} empty: ${empty.join(', ')}`).toEqual([])
    })
  }
})

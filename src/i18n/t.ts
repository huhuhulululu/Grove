/**
 * t.ts — the pure translation core. `t(locale, key, args)` and the engine-facing
 * `msg(key, args)` helper. No I/O, no clock, no RNG — safe for the pure engine to
 * import (ADR-0005). Catalogs are static data.
 */
import type { Locale, MsgArgs } from './types'
import { DEFAULT_LOCALE } from './types'
import { en } from './catalog/en'
import { zhCN } from './catalog/zh-CN'
import { ja } from './catalog/ja'
import { ko } from './catalog/ko'

const CATALOGS: Record<Locale, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
  ja,
  ko,
}

/** Replace `{name}` placeholders with args; unknown placeholders are left literal. */
export function interpolate(template: string, args?: MsgArgs): string {
  if (args === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in args ? String(args[name]) : whole,
  )
}

/**
 * Translate `key` into `locale`, interpolating `args`. Fallback chain:
 * locale → DEFAULT_LOCALE (en) → the raw key (so a missing key is visible, never
 * a crash). Pure.
 */
export function t(locale: Locale, key: string, args?: MsgArgs): string {
  const cat = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]
  const template = cat[key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key
  return interpolate(template, args)
}

/** A keyed message: the EN-rendered string (back-compat) plus the key/args so a
 *  renderer can re-translate into the player's locale. */
export interface Msg {
  message: string
  msgKey: string
  msgArgs?: MsgArgs
}

/**
 * Build a keyed reward message. Returns the English `message` (so existing tests
 * + copy-lint + any locale-unaware caller keep working byte-for-byte) plus the
 * `msgKey`/`msgArgs` needed to re-render in another locale. Spread into a Reward.
 */
export function msg(key: string, args?: MsgArgs): Msg {
  return {
    message: t(DEFAULT_LOCALE, key, args),
    msgKey: key,
    ...(args !== undefined ? { msgArgs: args } : {}),
  }
}

/**
 * i18n core types. The catalogs are PURE data (plain maps), so the pure engine
 * may import a catalog + `t()` without breaking its no-I/O purity (ADR-0005):
 * translation is a total function of (locale, key, args), never touches the
 * filesystem, clock, or RNG.
 */

/** Supported locales. `en` is the fallback/source of truth. */
export const LOCALES = ['en', 'zh-CN', 'ja', 'ko'] as const
export type Locale = (typeof LOCALES)[number]

/** The fallback locale every key is guaranteed to exist in. */
export const DEFAULT_LOCALE: Locale = 'en'

/** A message catalog: key → template. Templates use `{name}` placeholders. */
export type Catalog = Record<string, string>

/** Interpolation args for a template (numbers stringified). */
export type MsgArgs = Record<string, string | number>

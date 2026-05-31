/**
 * locale.ts — IMPURE locale resolution from the environment. NEVER imported by
 * the pure engine (it reads process.env); the CLI/renderers call it and thread
 * the resolved Locale down. `normalizeLocale` is pure + injectable for testing.
 */
import { DEFAULT_LOCALE, type Locale } from './types'

/** Map a raw locale string (env value, BCP-47-ish) to a supported Locale. Pure. */
export function normalizeLocale(raw: string | undefined): Locale {
  if (raw === undefined) return DEFAULT_LOCALE
  const s = raw.trim().toLowerCase()
  if (s === '') return DEFAULT_LOCALE
  if (s.startsWith('zh')) return 'zh-CN' // zh, zh_CN, zh-Hans, zh-CN.UTF-8 …
  if (s.startsWith('ja')) return 'ja' // ja, ja_JP, ja-JP.UTF-8 …
  if (s.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}

/**
 * Resolve the active locale. Priority: explicit `GROVE_LANG`, then the standard
 * `LC_ALL` / `LANG`, then the default. `env` is injectable for tests.
 */
export function resolveLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return normalizeLocale(env['GROVE_LANG'] ?? env['LC_ALL'] ?? env['LANG'])
}

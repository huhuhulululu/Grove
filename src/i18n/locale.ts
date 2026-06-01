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
  if (s.startsWith('ko')) return 'ko' // ko, ko_KR, ko-KR.UTF-8 …
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

/**
 * Pick the best SUPPORTED locale from an HTTP `Accept-Language` header, honoring
 * the q-weights and order (e.g. "zh-CN,zh;q=0.9,en;q=0.8" → zh-CN). Returns null
 * when the header is absent or names no supported language (so the web server can
 * fall back to English). Pure — unlike normalizeLocale it SKIPS unsupported tags
 * rather than collapsing them to the default, so a visitor whose top choice is
 * unsupported still matches a lower-ranked supported one. Used by the web server
 * to auto-detect a visitor's browser language (a `?lang=` query still overrides).
 */
export function localeFromAcceptLanguage(header: string | undefined): Locale | null {
  if (header === undefined || header.trim() === '') return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      let q = 1
      for (const p of params) {
        const m = /^\s*q=([0-9.]+)\s*$/.exec(p)
        if (m) q = Number.parseFloat(m[1] as string)
      }
      return { tag: (tag ?? '').trim().toLowerCase(), q }
    })
    .filter((x) => x.tag !== '' && x.tag !== '*' && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    if (tag.startsWith('zh')) return 'zh-CN'
    if (tag.startsWith('ja')) return 'ja'
    if (tag.startsWith('ko')) return 'ko'
    if (tag.startsWith('en')) return 'en'
  }
  return null
}

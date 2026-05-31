/**
 * English catalog — the SOURCE OF TRUTH. Every key here must also exist in every
 * other locale (enforced by i18n.test.ts catalog-parity). EN templates must
 * reproduce the exact legacy strings so existing tests + copy-lint stay green when
 * the engine switches to keyed messages.
 *
 * Keys are namespaced: `reward.*` (engine loot lines), `cli.*` (CLI hints/confirms),
 * `ui.*` (dashboard / web / tui chrome), `quest.*`, etc.
 */
import type { Catalog } from '../types'

export const en: Catalog = {
  // reward.* — engine loot lines (locale-independent at source; rendered here)
  'reward.levelup': 'Level {level}',
  'reward.levelup_seeds': '+{seeds} 🌰 · level up ×{levelUps}',
  'reward.set_unlocked': '🔓 {set} set unlocked · L{lvl}',
  'reward.set_complete': '✦ set {set} complete · +{pct}% 🌰 (permanent)',
  'reward.legendary': '✦ {name} · legendary',

  // cli.* — hints & calm confirmations
  'cli.broke_hint': 'earn more 🌰 by shipping · commits, green tests, merges, docs.',
  'cli.commit_recorded': 'commit recorded · {n} signal(s)',

  // ui.* — dashboard / web chrome
  'ui.seeds': '{n} seeds',
  'ui.shards': '{n} shards',
}

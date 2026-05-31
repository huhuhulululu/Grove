/**
 * 日本語カタログ. Keys mirror en.ts exactly (catalog-parity test enforces it).
 * Terse, no em-dash (use ·), per docs/TONE.md.
 */
import type { Catalog } from '../types'

export const ja: Catalog = {
  'reward.levelup': 'レベル {level}',
  'reward.levelup_seeds': '+{seeds} 🌰 · レベルアップ ×{levelUps}',
  'reward.set_unlocked': '🔓 {set} セット解放 · L{lvl}',
  'reward.set_complete': '✦ {set} セット完成 · +{pct}% 🌰(永続)',
  'reward.legendary': '✦ {name} · レジェンダリー',

  'cli.broke_hint': '出荷して 🌰 を稼ごう · コミット、テスト緑、マージ、ドキュメント。',
  'cli.commit_recorded': 'コミットを記録 · {n} シグナル',

  'ui.seeds': '{n} シード',
  'ui.shards': '{n} シャード',
}

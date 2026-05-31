/**
 * 简体中文目录. Keys mirror en.ts exactly (catalog-parity test enforces it).
 * Tone follows docs/TONE.md: terse, no em-dash (use ·), no cloying filler.
 */
import type { Catalog } from '../types'

export const zhCN: Catalog = {
  'reward.levelup': '等级 {level}',
  'reward.levelup_seeds': '+{seeds} 🌰 · 升级 ×{levelUps}',
  'reward.set_unlocked': '🔓 解锁 {set} 套牌 · L{lvl}',
  'reward.set_complete': '✦ {set} 套牌集齐 · +{pct}% 🌰(永久)',
  'reward.legendary': '✦ {name} · 传说',

  'cli.broke_hint': '多交付来赚 🌰 · 提交、测试转绿、合并 PR、写文档。',
  'cli.commit_recorded': '已记录提交 · {n} 个信号',

  'ui.seeds': '{n} 种子',
  'ui.shards': '{n} 碎片',
}

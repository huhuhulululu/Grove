<div align="center">

# 🌳 Grove

**ローカルファースト · ツール非依存の、AI コーディング向けゲームレイヤー。**

コーディングセッションの見えない成果(テスト緑、マージされた PR、クリーンなビルド、書かれた `CLAUDE.md`)
をルート · XP · コレクションに変える。後回しにしがちな習慣をクエストに変える。全て装飾、全て穏やか、全てあなたのもの。

[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![i18n](https://img.shields.io/badge/i18n-en·zh--CN·ja·ko-blue.svg)
![engine: pure](https://img.shields.io/badge/engine-pure%20(ethics%20firewall)-8a2be2.svg)
![rewards: cosmetic-only](https://img.shields.io/badge/rewards-cosmetic--only-brightgreen.svg)
![local-first](https://img.shields.io/badge/local--first-no%20server-success.svg)

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md)

</div>

---

Grove は実用的な生産性ツールキットの上に乗る楽しい仕組みだ。すべての報酬は安全でオプトインのワークフロー改善にマッピングされている
（下書きされたコミットメッセージ、非破壊チェックポイント、更新されたコードマップ）。あなたのコード · コミット · ドキュメント · git 履歴は、
いかなるゲーム結果によっても **絶対に** 変更・損失・ペナルティを受けない。エンジンは純粋関数であり、報酬は *設計上* 装飾のみだ
（[`docs/decisions.md`](docs/decisions.md)、ADR-0005 参照）。

```text
$ git commit -m "docs: write CLAUDE.md"
  🌳 grove
  🌿 CLAUDE.md 作成 · 永続オーラ
  🃏 Compiler · uncommon            ← 習慣シグナルが初めて検出されたときカードがドロップする
  🌅 はじめての光 · ビルド初の成功
```

どのみちあなたがやった仕事だ。Grove はただそれに気づく。

## なぜ Grove か

2 本の柱、1 つの正規化イベントストリーム:

- 🍃 **疲労を和らげる** · 見えない成果（テスト緑、マージ、ビルド）がルート · XP · コレクションになる。
- 🛠️ **良い習慣を促す** · 後回しにしがちな習慣（`CLAUDE.md` を書く、仕様を書く、ドキュメントを同期する）がクエスト · バフになる。

シグナルは薄いアダプター層で収集され、**純粋な**エンジンで処理される。だから Grove はどの AI コーディングワークフローでも動く
Claude Code、Cursor、Aider、Codex / Copilot / Gemini CLI、あるいは素の端末 + git でも。ツールごとにアダプター 1 つ、結合ゼロ。

## 60 秒クイックスタート

```sh
# 1. インストール（パッケージ: grovekit · グローバルバイナリ: sq）
npm i -g grovekit            # またはインストール不要で使う: npx -p grovekit sq <cmd>

# 2. すでに使っているリポジトリに Grove を組み込む（既存フックにチェーン、上書きしない）
cd my-project
sq init                      # フェイルオープンな post-commit フック + スターター報酬。コミットを絶対ブロックしない

# 3. いつも通りコミット · Grove がコミット内の良い習慣シグナルをスコアリングする（テストは自動実行しない）
git commit -m "docs: write CLAUDE.md"

# 4. 全体をインプレースパネルで確認（スクロールログではない）
sq dashboard                 # XP · シード · ギア · クエスト · バフ · エナジー

# 5. ループ: 成果を出荷すると 🌰 シードが貯まる。いつ使うかはあなたが決める
sq pull                      # 🌰 45 シードを消費してガチャ 1 回（シード不足なら穏やかに拒否）

# 6. 習慣の意味が気になったら聞ける。オプトイン、催促なし
sq learn test-first          # 一行で答える: なぜ先に失敗するテストを書くと意図した挙動が固定されるか
```

> グローバルインストールしたくない場合は `npx -p grovekit sq <cmd>` で全コマンドが使える。

## コアループ

```text
   実際の成果を出荷する             使うタイミングはあなたが選ぶ         穏やかな到達
  ────────────────────  ──▶  ──────────────────────────  ──▶  ────────────────────
   テスト緑 · マージ           sq pull / craft / foil          🌳 板についた（熟達）
   クリーンビルド · 仕様        enhance · repair · protect         温かい一行、
        │  🌰 シード獲得              │  装飾アップグレード             トレッドミルなし
        ▼                           ▼  （コードに絶対触れない）
```

Grove は**成果を報酬にする。活動量は関係ない** · LOC · コミット数 · 時間のグラインドはない。テストが赤でもペナルティなし。
巻き返し（赤 → 再び緑）には温かい一行が届く。クエストをスキップするのは常に OK: 静かなグリフだけで、「まだやってない…」は来ない。

## ハイライト

| | |
|---|---|
| 🎴 **コレクション** | 7 カードセット · 39 枚 · 天井 + 指定保証 `--spark` 付きのガチャ抽選。欠けているカードをクラフト (craft)、所持カードを装飾的にフォイル (foil)（更新可能なシャード消費先、クラフト完全達成後も逓減）。 |
| ⚔️ **ギア & ロードアウト** | リスク/リターンの `enhance` / `repair` / `protect` ループ、3 スロットのロードアウト (loadout)、装備カード/ギア/バフ間の 8 つの装飾シナジー（ADR-0014）。 |
| 🏆 **実績** | 13 の導出可能な**アチーブメント**（事後認定、FOMO なし）、エンドゲームのトレッドミルを終わらせる一度きりの**熟達 (mastery)** 到達、**巻き返し (comeback)**（止まっていたスイートがついに緑）、**はじめての光 (first light)**（初のビルド成功）。 |
| 📜 **良い習慣** | 習慣クエストボード（`CLAUDE.md` を書く、仕様、計画、ドキュメント同期、`docs/decisions.md` に**決定を記録**）と `sq learn` · 初心者にも熟練者にもオプトインの一行「なぜ」解説。 |
| 🔋 **燃え尽き防止エナジー** | Claude Code の 5h/7d クォータが**活力 (Vigor) / 週次 (Weekly)** エナジーになり、*残り*として表示（「消費済み」ではない）。非計量プランには「ウェルスプリング (Wellspring)」と表示し、架空の不足感を作らない。全リポジトリ横断でアカウントグローバル。 |
| 🖥️ **サーフェス** | インプレースの `sq dashboard`、ナビゲーション可能な Ink **TUI** (`sq tui`)、読み取り専用 web/SSE ダッシュボード (`sq serve`)、リキャップ (`sq recap --since week`)。 |
| 🌍 **穏やかさ & 多言語** | 全ての演出を静かな ✓ に絞る `--zen` モード、en / zh-CN / ja / ko の完全**i18n**。 |
| 🤝 **コモンズ** | `sq commons`（オプトイン）: ラベル付きのコミュニティタスクを申請、あなたの AI がパッチを下書き · あなたがレビューして PR を作成。マージされた PR は本物の成果だ。Grove はコードを書かず実行もしない（ADR-0013）。 |

## コマンド（全一覧は `sq help`）

| コマンド | 内容 |
|---|---|
| `sq init` / `sq uninstall` | チェーンセーフな post-commit フックをインストール / 削除 |
| `sq wrap -- <cmd>` | いつも実行するコマンドをラップ。成功なら報酬、失敗なら何もなし（ADR-0003） |
| `sq scan [path]` | リポジトリの習慣シグナル（グリモア / テスト / ドキュメント / 仕様 / 決定）をスキャンして報酬 |
| `sq dashboard` · `sq tui` · `sq serve` | ボード: インプレースパネル · ナビゲーション可能 TUI · 読み取り専用 web/SSE |
| `sq quests` · `sq achievements [--all]` | 習慣ボード · 事後認定アチーブメント |
| `sq learn [practice]` | 良い習慣の一行「なぜ」解説（オプトイン、自動表示しない） |
| `sq pull [--premium] [--spark <id>]` | 🌰 シードを消費してガチャ 1 回 · タイミングはあなたが選ぶ |
| `sq craft <id>` · `sq foil [id]` · `sq convert [n]` | シャード消費先: 欠けているカードをクラフト、所持カードをフォイル、余剰シャードをシードに変換 |
| `sq enhance <ref>` · `sq repair <ref>` · `sq protect <ref>` | ギアのリスク/リターンループ（装飾のみ） |
| `sq suggest-commit` | 読み取り専用: ステージ差分からコミットメッセージを下書き（コミットしない） |
| `sq checkpoint` | 非破壊 `git stash create` スナップショット + 休息バフ |
| `sq statusline install` / `uninstall` | Grove を Claude Code ステータスラインにチェーン（エナジーメーター） |
| `sq export [file]` · `sq import <file>` | データはあなたのもの: 移植可能 · バージョン付き状態（インポートは先にバックアップ、不正ファイルは拒否） |
| `sq share [--badge]` · `sq ntfy <topic>` | オプトイン · プライバシー最小限: シェアカード / README バッジ · 大事な瞬間にモバイルプッシュ（デフォルト **オフ**） |
| `sq status` · `sq recap [--since session\|week\|all]` | プレーンテキスト状態 · 穏やかな振り返り |

## 倫理ファイアウォール

これは設計で強制された約束であり、善意だけに頼るものではない:

> エンジンは**純粋関数**だ: `events → cosmetic game-state`。ファイルシステムも、クロックも、ネットワークも、
> 注入されたシード以外の乱数も持たない。だから実際の作業には*触れることができない*。

- **報酬は装飾のみ、決して能力ではない** · ゲーム結果が実際の機能を与えることはない。カードはカードだ。
- **テストを自動実行しない** · シグナルはすでにあなたがやっていること由来（ADR-0003）。
- **git フックやステータスラインを上書きしない** · Grove はチェーンし、完全に復元可能（ADR-0004）。
- **成果が対象、活動量ではない** · LOC · コミット数 · 時間 · 失うと困る連続記録なし。寛大で、恥なし、穏やかモード。
- **ローカルファースト & プライベート** · 状態はあなたのディスクに。`share` / `ntfy` はデフォルトオフで、コード · cwd · コストは絶対送信せず装飾的統計のみ（ADR-0011）。

## ポジショニング

Grove は検証済み成果のゲーミフィケーション · AI コーディング · AI クォータエナジー · ルート/ギア/ガチャ (gacha) · ローカルファーストプライバシー · 倫理ファイアウォールを、ツール非依存の 1 つの CLI に**融合した**初のツールだ。

| | Grove | claude-quest | code-tamagotchi | Habitica | Gamekins |
|---|---|---|---|---|---|
| 成果ゲート報酬（検証済み） | ✅ 終了コード + git diff | partial | ❌ 活動量 | 手動 | ✅ CI のみ |
| ルート / ギア / ガチャ | ✅ | ❌ | ❌ | 汎用 | ❌ |
| AI ツール非依存 | ✅ 全ツール | ❌ CC のみ | ❌ CC のみ | 汎用 | ❌ JVM |
| AI クォータ → ゲームエナジー | ✅ 活力/週次 | ❌ | ❌ | ❌ | ❌ |
| 倫理ファイアウォール（純粋エンジン） | ✅ 設計による | 不明 | ❌ ペナルティあり | 装飾的 | partial |
| ローカルファースト、サーバーなし | ✅ | ❌ クラウド | partial | ❌ | ❌ |
| 穏やか / zen モード | ✅ | ❌ | ❌ | ❌ | ❌ |

各要素はどこかに存在するが、このプロダクトは Grove にしかない。詳細分析: [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md)。

## 実装済み vs ロードマップ（正直な状況）

**実装済み:** 純粋エンジン（XP、ガチャ、ギア、コレクション、クエスト、エナジー、クリティカル、シナジー）、前方互換マイグレーション付き永続化、チェーンセーフ git フック、`sq scan` / `sq wrap`、シードエコノミーと全シンク（`pull` / `craft` / `foil` / `convert` / `enhance` / `repair` / `protect`）、ダッシュボード / TUI / web-SSE サーフェス、アチーブメント / 熟達 / 巻き返し / はじめての光、習慣クエストボード + `sq learn`、アカウントグローバルエナジー、`--zen`、オプトインの `share` / `ntfy`、`export` / `import`、`commons` P0 クライアント、en/zh-CN/ja/ko の i18n。

**ロードマップ（未実装）:** フレンドストリーク / 協力プレイ、そしてオプトインのリーグ制**グローバルリーダーボード** · これはローカル状態が偽造可能であるため、ダークパターンにならずに出荷するには**サーバー検証済み成果バックエンド**が必要で、引き続き保留（ADR-0011）。

## ソースからビルド

```sh
npm install
npm run build            # src/cli/sq.ts → dist/cli/sq.js にバンドル（ESM、実行可能バイナリ）
node dist/cli/sq.js help
npm test                 # vitest（TDD、カバレッジ目標 80%+）
npm run typecheck        # tsc --noEmit
```

## ドキュメント

- [`CLAUDE.md`](CLAUDE.md) · 制約 + レイアウトインデックス
- [`docs/decisions.md`](docs/decisions.md) · アーキテクチャ決定記録（ファイアウォール、ツール非依存アダプター、フックチェーン…）
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · モジュール、pure/impure の境界、イベントスキーマ
- [`docs/GOALS.md`](docs/GOALS.md) · 目標と非目標
- [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) · 現在の状況とマイルストーン

## ライセンス

[MIT](LICENSE).

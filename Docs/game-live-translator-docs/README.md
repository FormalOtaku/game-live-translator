# 配信者向けゲームリアルタイム英訳システム 設計ドキュメント

作成日: 2026-05-27  
想定プロジェクト名: **Game Live Translator** / **Retro Game Live Translator**  
配布方針: **オープンソース + ドネーション + 有償サポート**  
主要出力先: **OBS Studio Browser Source**

---

## 1. 一文で説明

**日本語のみのゲーム画面をOCRで読み取り，英語字幕としてOBSに重ねて表示する，配信者向けのリアルタイム翻訳オーバーレイ．**

英語向けには次の表現が使いやすい．

> Real-time Japanese-to-English game translation overlay for OBS Studio.  
> Designed for retro games, Japanese-only games, visual novels, JRPGs, and streamers who want to share Japanese games with international audiences.

---

## 2. 方針

このプロジェクトは，単なるOCR翻訳ツールではなく，**配信で使える完成度**を重視する．  
公開時点で最低限クリアしたい価値は，次の通り．

- OBSに簡単に載せられる．
- 字幕が見やすい．
- 低遅延で邪魔にならない．
- ゲームを改造しない．
- ゲーム本文や翻訳済みスクリプトを配布しない．
- APIキーや翻訳履歴を安全に扱う．
- 配信者がゲームごとに設定を保存できる．
- 日本語→英語を第一対象にしつつ，後から多言語化できる．

---

## 3. ドキュメント構成

| ファイル | 内容 |
|---|---|
| `01_purpose_and_positioning.md` | 目的，対象ユーザー，プロダクトの立ち位置 |
| `02_product_requirements.md` | 完成度高めの初回公開に必要な機能要件 |
| `03_technical_stack_architecture.md` | 推奨技術スタック，アーキテクチャ，実装方針 |
| `04_distribution_and_monetization.md` | 配布方法，OSS運営，ドネーション，収益化 |
| `05_legal_policy_safety.md` | 権利面，プライバシー，ライセンス，安全設計 |
| `06_release_plan_quality_gate.md` | リリース計画，品質基準，テスト観点 |
| `07_references.md` | 参考リンク |

---

## 4. 初回リリースの推奨スコープ

「MVPを雑に出す」のではなく，**Windows + OBS + 日本語→英語 + レトロゲーム/ADV/JRPG向け**に絞って完成度を上げる．

### 初回公開で対応するもの

- Windows 10/11
- OBS Studio Browser Source
- 日本語OCR
- 日本語→英語翻訳
- 画面範囲指定
- 字幕テーマ編集
- ゲーム別プロファイル保存
- 翻訳APIキーのユーザー管理
- プライバシー優先のローカル処理
- GitHub Releasesでのインストーラ配布
- GitHub Sponsors / Ko-fi 等への支援導線

### 初回公開で無理にやらないもの

- ゲーム別の全文翻訳データ配布
- ROMやゲームファイルの解析
- ゲームへのコード注入
- 全プラットフォーム完全対応
- すべてのOCRエンジン対応
- 完全オフライン翻訳
- 公式ローカライズ品質の保証

---

## 5. 重要な設計思想

> ゲームを改造しない．  
> ゲームデータを抜き出さない．  
> 画面上に表示された文字だけを一時的に読み取り，OBS用字幕として表示する．

この思想をREADME，公式サイト，アプリ内の初回セットアップ画面に明記する．

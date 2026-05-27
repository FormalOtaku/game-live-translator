# 04. 配布・収益化・OSS運営

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## 1. 基本方針

このプロジェクトは，**コア機能をオープンソースで公開し，支援と有償サポートで継続する**方針が合っている．

理由は次の通り．

- 配信者向けツールは無料で試せることが普及に直結する．
- OSSにすることで，翻訳プロバイダ，OCRエンジン，OBS連携の改善をコミュニティから受けやすい．
- コア機能を閉じるより，テーマ，導入支援，カスタム対応で収益化した方が信頼を得やすい．
- 「昔の日本語ゲームを海外視聴者と楽しむ」という文化的な目的と，ドネーション型の相性がよい．

---

## 2. 配布方法

### 2.1 GitHub

GitHubを中心にする．

- ソースコード公開
- Issues / Discussions
- Pull Requests
- GitHub Releases
- GitHub Sponsors
- Wikiまたはdocs
- CI/CD

### 2.2 公式サイト

GitHubだけだと一般配信者には難しく見えるため，簡単な公式サイトを作る．

必要なページ:

- Top
- Download
- OBS Setup Guide
- Screenshots / Demo Video
- Privacy Policy
- Support / Donate
- FAQ
- Troubleshooting

### 2.3 配布ファイル

初回公開時は，以下を用意する．

| 配布物 | 用途 |
|---|---|
| Windows Installer `.exe` | 一般ユーザー向け |
| Portable `.zip` | インストールしたくないユーザー向け |
| Source code `.zip` | OSSとしての配布 |
| SHA256 checksums | 改ざん確認 |
| Release notes | 変更点・既知の問題 |

### 2.4 バージョニング

SemVerを採用する．

```text
v0.9.0-beta
v1.0.0
v1.1.0
v1.1.1
```

- `v0.x`: public beta
- `v1.0`: 初回安定版
- `v1.x`: 後方互換ありの機能追加
- `v2.x`: 大きな設計変更

---

## 3. ライセンス方針

### 推奨

- Code: **Apache-2.0**
- Documentation: **CC BY 4.0**
- Logo / Branding: 独自ライセンスまたはAll Rights Reserved
- Sample assets: 自作または明確に再配布可能なものだけ

Apache-2.0を推奨する理由:

- OSSとして使いやすい．
- 商用利用も妨げにくい．
- 特許許諾の条項があり，企業利用時にも説明しやすい．
- ドネーション型プロジェクトと相性がよい．

MITでもよいが，長期的に外部貢献や企業利用を想定するならApache-2.0が無難である．

---

## 4. 収益化の全体設計

### 基本原則

- コア機能は無料で使える．
- APIキーはユーザー持ち込みにする．
- 開発継続のための支援導線を明確にする．
- 有償化する場合は，コア機能ではなく「支援・利便性・サポート」に課金する．

### 収益源

| 収益源 | 優先度 | 内容 |
|---|---:|---|
| GitHub Sponsors | 高 | OSS開発支援の中心 |
| Ko-fi | 高 | 配信者や海外ユーザーの単発支援に向く |
| Open Collective | 中 | チーム化・透明会計が必要になったら導入 |
| Patreon | 中 | 継続支援コミュニティを作る場合に有効 |
| BOOTH / OFUSE / FANBOX | 中 | 日本国内向け支援導線として検討 |
| 有償セットアップ支援 | 高 | 配信者，VTuber，イベント運営向け |
| カスタム字幕テーマ制作 | 中 | ブランド配信，VTuber向け |
| 法人向け導入支援 | 中 | イベント，展示，ゲーム紹介配信向け |

---

## 5. GitHub Sponsors設計

### GitHub上の表示文案

```md
## Support this project

Game Live Translator is free and open source.
If this tool helps you stream Japanese games to international audiences, please consider supporting development.
Your sponsorship helps maintain OCR presets, translation provider integrations, OBS compatibility, and documentation.
```

### 支援 tier 案

| Tier | 金額例 | 内容 |
|---|---:|---|
| Supporter | $3/month | READMEに名前掲載，開発継続支援 |
| Streamer Supporter | $8/month | 支援者一覧掲載，設定例の先行共有 |
| Power User | $25/month | 優先的な要望確認，テーマβ版共有 |
| Studio Sponsor | $100/month | README/公式サイトにロゴ掲載，導入相談 |

注意: 支援者にだけコア機能を提供する設計にしない．OSSとしての信頼が下がるためである．

---

## 6. Ko-fi向け文案

```md
## Buy me a coffee

If Game Live Translator helped your stream, you can support development with a one-time donation.
Donations help cover testing, documentation, OCR model evaluation, and long-term maintenance.
```

日本語版:

```md
## 開発を支援する

Game Live Translatorは無料で使えるオープンソースツールです．
もし配信や制作活動に役立った場合は，開発継続のために支援していただけると助かります．
いただいた支援は，OCR精度改善，OBS対応，ドキュメント整備，テスト環境の維持に使います．
```

---

## 7. 有償サポート設計

### 7.1 個人配信者向け

- OBS導入サポート
- 字幕テーマ作成
- ゲーム別OCRプロファイル作成
- 配信画面レイアウト相談

### 7.2 VTuber / 事務所向け

- ブランドに合わせた字幕テーマ
- 配信用プリセット作成
- 複数PC配信環境での導入支援
- トラブルシューティング

### 7.3 イベント・法人向け

- 展示会・イベント配信用セットアップ
- 複数言語字幕
- 専用ビルド
- 導入マニュアル作成
- サポート契約

---

## 8. 無料のままにするべき機能

以下はコア価値なので無料OSSとして提供する．

- 画面範囲指定
- 日本語OCR
- 翻訳プロバイダ接続
- OBS Browser Source出力
- 基本字幕テーマ
- ゲーム別プロファイル
- 翻訳キャッシュ
- プライバシー設定

---

## 9. 有償にしても自然なもの

以下は有償でも受け入れられやすい．

- カスタムテーマ制作
- 導入代行
- 個別トラブル対応
- 配信用レイアウト設計
- 企業・イベント向けセットアップ
- 支援者向け先行βビルド
- 支援者名・ロゴ掲載

---

## 10. 避けるべき収益化

以下は避ける．

- コア機能を急に有料化する．
- APIキーをこちらのサーバーに集約して従量課金する．
- ゲーム別の翻訳済みスクリプトを販売する．
- 特定ゲームの翻訳データを同梱した有料版を出す．
- 無断でゲーム画像や本文を宣伝素材に大量利用する．

---

## 11. READMEに置く支援導線

READMEの上部に置きすぎると宣伝臭くなるため，下記の位置がよい．

1. プロジェクト説明
2. スクリーンショット / デモ
3. インストール
4. OBSセットアップ
5. Support this project
6. 注意事項
7. Contributing

### バッジ例

```md
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa)](YOUR_SPONSORS_URL)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-ff5f5f)](YOUR_KOFI_URL)
```

---

## 12. リリース時のSNS文案

### 英語

```text
I’m building Game Live Translator, an open-source real-time Japanese-to-English translation overlay for OBS Studio.

It captures Japanese text from game screens, translates it, and displays stream-friendly English subtitles.
Designed for retro games, visual novels, JRPGs, and Japanese-only games.
```

### 日本語

```text
日本語ゲーム画面をOCRで読み取り，英語字幕としてOBSに重ねるOSSツールを作っています．
レトロゲーム，ADV，JRPG，日本語のみのゲームを海外視聴者と一緒に楽しめるようにするのが目的です．
```

---

## 13. 成長戦略

### Phase 1: 技術デモ

- 自作のゲーム風画面でデモする．
- OBSに字幕が乗る様子を動画化する．
- READMEとGitHubを整備する．

### Phase 2: Public Beta

- 配信者数名に試してもらう．
- OBS設定で詰まる箇所を修正する．
- OCRプリセットを増やす．
- 支援リンクを設置する．

### Phase 3: v1.0

- Windows installerを安定化する．
- トラブルシューティングを整備する．
- OBS WebSocketによる自動セットアップを追加する．
- デモ動画と公式サイトを公開する．

### Phase 4: Community

- OCRプリセット共有
- 字幕テーマ共有
- 翻訳プロバイダ追加
- 多言語対応
- 支援者・貢献者ページ

---

## 14. 収益化KPI

初期は大きな売上より，以下を見る．

- GitHub Star数
- Download数
- Discord/GitHub Discussions参加者数
- 実際の配信使用例
- 支援者数
- 支援の継続率
- Issue対応速度
- OBSセットアップ成功率

---

## 15. 最初に作るべき公開資産

- GitHub README
- 30〜60秒の短いデモ動画
- OBSセットアップ手順ページ
- プライバシー説明ページ
- 支援ページ
- トラブルシューティング
- 権利・免責の説明

初回公開時点で「すぐ使えそう」と思われることが重要である．

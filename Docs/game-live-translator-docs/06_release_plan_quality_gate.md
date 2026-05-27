# 06. リリース計画と品質基準

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## 1. 方針

このプロジェクトは，「とりあえず動くMVP」を公開するのではなく，**配信者が実際にOBSに組み込める完成度**で公開する．  
ただし，公開範囲は絞る．

初回安定版 `v1.0` の主対象:

- Windows 10/11
- OBS Studio
- 日本語→英語
- 画面範囲指定OCR
- 字幕オーバーレイ
- ゲーム別プロファイル
- ユーザーAPIキー方式

---

## 2. リリース段階

## Phase 0: Internal Prototype

目的: 技術検証．公開しない．

完了条件:

- 画面範囲をキャプチャできる．
- OCRで日本語を取得できる．
- 翻訳APIに送信できる．
- OBS Browser Sourceに字幕を出せる．

この段階ではUIが雑でもよい．

---

## Phase 1: Private Alpha

目的: 配信者が使う流れを確認する．限定公開．

完了条件:

- GUIからROI指定できる．
- APIキー設定ができる．
- OBSセットアップ手順がある．
- 3種類以上の字幕テーマがある．
- ゲーム別プロファイルを保存できる．
- 2〜3人のテスターが実際にOBSに載せられる．

---

## Phase 2: Public Beta

目的: OSSとして公開し，フィードバックを集める．

完了条件:

- GitHub READMEが整っている．
- Windows InstallerとPortable ZIPがある．
- OBSセットアップガイドがある．
- トラブルシューティングがある．
- プライバシー説明がある．
- GitHub Sponsors / Ko-fi等の支援リンクがある．
- 既知の問題を明記している．

---

## Phase 3: v1.0 Stable

目的: 一般配信者におすすめできる初回安定版．

完了条件:

- OBS Browser Source連携が安定している．
- OCR・翻訳・字幕更新が長時間動作する．
- UIが初回ユーザーにも分かりやすい．
- 主要エラーに対する対処方法が表示される．
- APIキーやOCRログの扱いが安全である．
- サンプル素材とドキュメントの権利が整理されている．

---

## 3. v1.0 品質ゲート

## 3.1 機能ゲート

- [ ] Windows 10/11で起動する．
- [ ] 初回セットアップウィザードが動く．
- [ ] OBS用URLをコピーできる．
- [ ] OBS Browser Sourceで字幕表示できる．
- [ ] ROIをマウスで指定できる．
- [ ] OCRプレビューが表示される．
- [ ] 翻訳APIテストができる．
- [ ] 字幕テーマを変更できる．
- [ ] ゲーム別プロファイルを保存できる．
- [ ] アプリ再起動後に設定が復元される．
- [ ] エラー時に原因が表示される．

## 3.2 パフォーマンスゲート

- [ ] 通常テキストで字幕表示まで1.5〜2.0秒以内を目指す．
- [ ] OCR処理中にUIが固まらない．
- [ ] 30分連続動作でクラッシュしない．
- [ ] 同一テキストを無限に翻訳しない．
- [ ] 翻訳API失敗時にリトライと待機ができる．

## 3.3 OBSゲート

- [ ] 1280x720で表示崩れがない．
- [ ] 1920x1080で表示崩れがない．
- [ ] 2560x1440で表示崩れがない．
- [ ] 背景透過が機能する．
- [ ] フォントサイズ変更が反映される．
- [ ] OBS再起動後もURLが使える．

## 3.4 セキュリティ・プライバシーゲート

- [ ] APIキーがログに出ない．
- [ ] APIキーが設定エクスポートに含まれない．
- [ ] デフォルトでOCR画像を保存しない．
- [ ] デフォルトで翻訳全文ログを保存しない．
- [ ] ローカルサーバーが `127.0.0.1` に限定されている．
- [ ] HTMLエスケープが行われる．

## 3.5 ドキュメントゲート

- [ ] READMEがある．
- [ ] インストール手順がある．
- [ ] OBSセットアップ手順がある．
- [ ] APIキー設定手順がある．
- [ ] FAQがある．
- [ ] トラブルシューティングがある．
- [ ] 注意事項・免責がある．
- [ ] 支援リンクがある．

---

## 4. テストマトリクス

### OS

| OS | v1.0対象 | 備考 |
|---|---:|---|
| Windows 10 | 必須 | 主要対象 |
| Windows 11 | 必須 | 主要対象 |
| macOS | 任意 | beta扱いでよい |
| Ubuntu Linux | 任意 | 開発者向け手順でもよい |

### OBS

| OBSバージョン | 対応 |
|---|---|
| OBS 28+ | 推奨 |
| OBS 30+ | 優先テスト |
| 古いOBS | 手動設定のみ．積極対応しない |

### 画面解像度

| 解像度 | 対応 |
|---|---|
| 1280x720 | 必須 |
| 1920x1080 | 必須 |
| 2560x1440 | 必須 |
| 3840x2160 | 可能なら対応 |

### テキストスタイル

| スタイル | テスト |
|---|---|
| 白文字 + 黒縁 | 必須 |
| 黒文字 + 明背景 | 必須 |
| ピクセルフォント | 必須 |
| 半透明テキストボックス | 必須 |
| 長文ADVテキスト | 必須 |
| 縦書き | v1.0では任意 |

---

## 5. ベンチマーク項目

### OCR

- OCR処理時間
- OCR信頼度
- 誤認識率
- 空文字率
- 重複検出率

### 翻訳

- API応答時間
- キャッシュヒット率
- 失敗率
- Glossary適用率

### Overlay

- 字幕更新遅延
- 表示崩れ
- WebSocket再接続成功率

---

## 6. Issueラベル案

```text
bug
ocr
translation
obs
overlay
ui
installer
privacy
security
documentation
good first issue
help wanted
question
enhancement
provider:deepl
provider:openai
provider:google
platform:windows
platform:macos
platform:linux
```

---

## 7. 初回公開前チェックリスト

- [ ] リポジトリ名を決める．
- [ ] ライセンスを追加する．
- [ ] READMEを書く．
- [ ] スクリーンショットを用意する．
- [ ] 自作デモ動画を作る．
- [ ] Windowsビルドを作る．
- [ ] OBSセットアップガイドを書く．
- [ ] APIキー設定ガイドを書く．
- [ ] プライバシーポリシーを書く．
- [ ] 免責文を書く．
- [ ] 支援リンクを作る．
- [ ] GitHub Discussionsを開く．
- [ ] Issueテンプレートを作る．
- [ ] Security policyを作る．
- [ ] Release notesを書く．

---

## 8. 公開時のリリースノート雛形

```md
# Game Live Translator v1.0.0

First stable release of Game Live Translator, an open-source real-time Japanese-to-English translation overlay for OBS Studio.

## Highlights

- Screen region capture for game text
- Japanese OCR pipeline with preprocessing presets
- Translation provider adapters
- OBS Browser Source overlay
- Custom subtitle themes
- Game-specific profiles
- Translation cache and duplicate suppression
- Privacy-first default settings

## Supported environment

- Windows 10/11
- OBS Studio 28+
- Japanese → English

## Notes

Game Live Translator does not modify games, extract game assets, or distribute game scripts.
Cloud translation providers may receive OCR-recognized text depending on your settings.
```

---

## 9. v1.1以降の候補

- OBS WebSocketによる自動セットアップ
- 縦書きOCR強化
- ローカル翻訳モデル
- 多言語対応
- 字幕ログのSRT/VTT出力
- テーママーケット/共有機能
- macOS/Linux正式対応
- OCRプリセット共有
- Discord/YouTube/Twitch連携

---

## 10. 判断基準

公開前に迷ったら，次の基準で判断する．

> その機能は，配信者がOBSで実際に使う体験を良くするか．  
> その機能は，権利・プライバシー・安全性を悪化させないか．  
> その機能は，初回リリースの完成度を上げるか，ただスコープを広げるだけか．

この基準に合わない機能は，v1.0から外してよい．

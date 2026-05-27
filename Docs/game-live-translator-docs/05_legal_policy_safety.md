# 05. 権利・プライバシー・安全設計

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## 1. 基本方針

このツールは，**ゲームを改造せず，画面に表示された文字だけを一時的にOCR・翻訳し，OBS用字幕として表示する補助ツール**として設計する．

この方針を，README，公式サイト，初回起動画面，プライバシーポリシーに明記する．

---

## 2. 権利リスクを下げる設計

### やる

- 画面上の文字をリアルタイムに読み取る．
- 翻訳結果を配信者のOBS画面に字幕として表示する．
- 設定ファイルにはROIやテーマだけを保存する．
- ゲームごとのプロファイル共有では，ゲーム本文や翻訳文を含めない．

### やらない

- ゲーム本文をまとめて保存・配布しない．
- 翻訳済みゲームスクリプトを配布しない．
- ROM，ISO，ゲームファイルを解析しない．
- ゲームにパッチを当てない．
- メモリ読み取りやコード注入をしない．
- DRM回避をしない．
- 公式翻訳のように見せない．

---

## 3. README用免責文案

```md
## Disclaimer

Game Live Translator does not modify games, extract game assets, or distribute game scripts.
It only reads text that is visible on the user's screen and displays temporary translated subtitles for streaming overlays.

This project is not affiliated with or endorsed by any game publisher, platform, or localization company.
Users are responsible for complying with the streaming guidelines and terms of the games they play.
```

日本語版:

```md
## 注意事項

Game Live Translatorは，ゲーム本体の改造，ゲームデータの抽出，翻訳済みスクリプトの配布を行いません．
ユーザーの画面上に表示された文字を一時的に読み取り，配信用字幕として表示する補助ツールです．

本プロジェクトは，特定のゲーム会社，配信プラットフォーム，ローカライズ会社と提携するものではありません．
ユーザーは，各ゲームの配信ガイドラインや利用規約を確認した上で使用してください．
```

---

## 4. プライバシー設計

### デフォルト設定

- OCR画像を保存しない．
- OCR全文ログを保存しない．
- 翻訳全文ログを保存しない．
- APIキーを平文保存しない．
- ローカルサーバーは `127.0.0.1` のみにバインドする．

### ユーザーに説明すること

クラウド翻訳APIを使う場合，OCRされたテキストは翻訳プロバイダに送信される．  
初回設定で以下のように説明する．

```text
Cloud translation providers require sending recognized text to their API.
If you do not want game text to be sent to external services, disable cloud translation or use a local translation backend when available.
```

日本語:

```text
クラウド翻訳を使用する場合，OCRで認識されたテキストが翻訳APIに送信されます．
外部サービスへテキストを送信したくない場合は，クラウド翻訳を無効にするか，将来対応予定のローカル翻訳バックエンドを使用してください．
```

---

## 5. ログポリシー

### 通常ログ

通常ログに含めてよいもの:

- エラー種別
- 処理時間
- OCRエンジン名
- 翻訳プロバイダ名
- アプリバージョン
- OSバージョン

通常ログに含めないもの:

- APIキー
- OCR画像
- OCR全文
- 翻訳全文
- ゲームのスクリーンショット

### デバッグログ

デバッグモードでは，ユーザーの明示的な許可がある場合のみ，OCR画像やOCR全文を保存できる．  
ただし，保存先，保存期間，削除方法をUIで分かるようにする．

---

## 6. APIキー管理

- APIキーはOSの安全なストレージに保存する．
- SQLiteやJSON設定ファイルに平文保存しない．
- ログに出力しない．
- エラー画面に表示しない．
- 設定エクスポートに含めない．

---

## 7. セキュリティ

### ローカルサーバー

- 原則 `127.0.0.1` のみで待ち受ける．
- LAN公開モードは初回公開では不要．
- CORSは必要最小限にする．
- OBSオーバーレイ用URLに外部からアクセスできないようにする．

### WebSocket

- OBSオーバーレイ用WebSocketはローカル用途に限定する．
- 任意のHTML/JSを注入できないようにする．
- 字幕テキストはHTMLエスケープする．

---

## 8. ライセンス

### 推奨ライセンス

- 本体コード: Apache-2.0
- ドキュメント: CC BY 4.0
- ロゴ・名称: All Rights Reservedまたは別途明記

### 依存ライブラリ

依存ライブラリのライセンスを確認し，`THIRD_PARTY_NOTICES.md`を作成する．  
初回公開前に，以下を確認する．

- OCRエンジン
- OpenCV
- Electron
- Pythonパッケージ
- フロントエンドパッケージ
- フォント
- アイコン
- サンプル画像

---

## 9. サンプル素材の扱い

READMEや公式サイトで使う画像は，以下に限定する．

- 自作のゲーム風モック画面
- 自作フォントまたは再配布可能なフォント
- 権利者から許諾を得た素材
- 明確なライセンスがある素材

特定ゲームの画面を大量に掲載しない．特に，ゲーム本文が読める状態で大量に掲載することは避ける．

---

## 10. コミュニティ共有プリセットのルール

ゲーム別プロファイル共有を行う場合，含めてよいものと含めてはいけないものを明確にする．

### 含めてよい

- ROI座標
- OCR前処理プリセット
- 字幕テーマ
- 翻訳プロバイダ設定名
- ユーザーが作成したGlossaryのうち，一般的な固有名詞設定

### 含めない

- ゲーム本文
- 翻訳済み全文
- スクリプト抽出データ
- ゲーム画像
- APIキー

---

## 11. 外部からの指摘対応

権利者や第三者から問い合わせが来た場合に備え，連絡先と対応ポリシーを用意する．

READMEに以下を置く．

```md
## Contact

For security reports, copyright concerns, or takedown requests, please contact:
YOUR_EMAIL
```

対応時の方針:

- まず対象Issue/ファイル/素材を確認する．
- 明らかに問題がある素材は一時的に取り下げる．
- ゲーム本文や画像が含まれていないか確認する．
- プロジェクトの設計方針を説明する．

---

## 12. 翻訳品質の免責

AI翻訳・機械翻訳の結果は誤る可能性がある．  
そのため，以下を明記する．

```md
Machine translation may be inaccurate, incomplete, or inappropriate depending on OCR quality, context, and provider behavior.
Please review translations before using them in sensitive contexts.
```

日本語:

```md
機械翻訳の結果は，OCR精度，文脈，翻訳プロバイダの挙動によって誤る可能性があります．
重要な場面やセンシティブな内容では，翻訳結果を確認した上で使用してください．
```

---

## 13. まとめ

安全な設計の中心は，次の3点である．

1. **ゲーム本体に触らない．**
2. **ゲーム本文や翻訳済みスクリプトを配布しない．**
3. **OCR・翻訳・表示はユーザーの環境で一時的に行う．**

この3点をプロダクトの根幹に置くことで，配信者にもOSSコミュニティにも説明しやすいツールになる．

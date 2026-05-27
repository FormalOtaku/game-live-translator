# 03. 技術スタックとアーキテクチャ

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## 1. 推奨アーキテクチャ概要

初回公開では，**Windows + OBS Studio + 日本語→英語**を主対象にする．  
アプリ本体は配信者が使いやすいGUIを提供し，OCR・翻訳・字幕配信はローカルバックエンドで処理する．

```text
Game Window / Screen Region
        ↓
Screen Capture
        ↓
Image Preprocessing
        ↓
Japanese OCR
        ↓
Text Deduplication / Cleanup
        ↓
Translation Provider Adapter
        ↓
Subtitle Formatter
        ↓
Local Overlay Server
        ↓
OBS Browser Source
```

---

## 2. 技術スタックの推奨

| 領域 | 推奨 | 理由 |
|---|---|---|
| Desktop GUI | Electron + React + TypeScript | Windows配信者向けに配布しやすく，画面キャプチャ・自動更新・インストーラ周りが作りやすい |
| Frontend build | Vite | React/TypeScriptの開発体験が良い |
| Local backend | Python 3.11 + FastAPI | OCR，OpenCV，翻訳API連携を実装しやすい |
| API通信 | WebSocket + REST | 状態取得はREST，字幕更新やプレビューはWebSocket/SSE |
| Screen capture | mss / dxcam | mssはクロスプラットフォーム，dxcamはWindowsで高速化しやすい |
| Image processing | OpenCV | 拡大，二値化，輪郭処理，ノイズ除去に強い |
| OCR default | PaddleOCR | 多言語OCRに強く，日本語にも対応しやすい |
| OCR fallback | Tesseract / EasyOCR | 軽量・代替エンジンとして選択可能にする |
| Translation | DeepL / OpenAI / Google Cloud Translation adapter | 翻訳品質，文脈翻訳，汎用APIを切り替え可能にする |
| Data storage | SQLite | ゲーム別プロファイル，翻訳キャッシュ，設定保存に十分 |
| Secure secret storage | OS keychain / keyring | APIキーを平文DBに保存しない |
| Overlay | HTML/CSS/JS served from localhost | OBS Browser Sourceとの相性がよい |
| Packaging | electron-builder + PyInstaller sidecar | Windows installer/Portable ZIPを作りやすい |
| CI/CD | GitHub Actions | テスト，ビルド，リリース自動化 |

---

## 3. Electronを初回採用する理由

Tauriは軽量で魅力的だが，初回公開では**配信者向けの完成度**を優先する．  
Electronを推奨する理由は次の通り．

- Windowsユーザー向け配布の知見が多い．
- React/TypeScriptでUIを作りやすい．
- 自動更新，インストーラ，ログ，設定UIを組み込みやすい．
- Python OCRバックエンドをsidecarとして同梱しやすい．
- OBSや配信者向けツールのUIと相性が良い．

将来的にアプリサイズや起動速度を強く改善したくなった場合，Tauri版を検討する．ただし，最初からTauriに寄せすぎると，画面キャプチャ，Python OCR同梱，Windows配布の実装工数が上がりやすい．

---

## 4. コンポーネント設計

```text
apps/desktop-electron
  ├─ React UI
  ├─ settings wizard
  ├─ OCR region editor
  ├─ overlay theme editor
  ├─ OBS setup assistant
  └─ sidecar process manager

apps/backend-python
  ├─ FastAPI server
  ├─ capture service
  ├─ preprocessing service
  ├─ OCR adapters
  ├─ translation adapters
  ├─ subtitle state manager
  ├─ overlay server
  ├─ profile manager
  └─ diagnostics/logging

packages/overlay
  ├─ overlay.html
  ├─ overlay.css
  ├─ overlay-client.ts
  └─ themes/

configs/
  ├─ default_profiles/
  ├─ ocr_presets/
  └─ overlay_themes/
```

---

## 5. ローカルサーバー設計

### エンドポイント案

| Method | Path | 用途 |
|---|---|---|
| GET | `/health` | バックエンド起動確認 |
| GET | `/overlay` | OBS Browser Source用HTML |
| GET | `/api/status` | 現在状態取得 |
| POST | `/api/capture/start` | キャプチャ開始 |
| POST | `/api/capture/stop` | キャプチャ停止 |
| POST | `/api/ocr/test` | 現在ROIでOCRテスト |
| POST | `/api/translate/test` | 翻訳APIテスト |
| GET | `/api/profiles` | プロファイル一覧 |
| POST | `/api/profiles` | プロファイル保存 |
| GET | `/ws/app` | GUI向け状態更新 |
| GET | `/ws/overlay` | OBSオーバーレイ向け字幕更新 |

### ローカルホスト限定

サーバーは原則 `127.0.0.1` にバインドする．外部公開しない．

```text
http://127.0.0.1:39600/overlay
```

---

## 6. OCRパイプライン

### 基本フロー

```text
ROI capture
  → resize 2x/3x
  → contrast normalization
  → denoise
  → threshold / edge enhancement
  → OCR engine
  → text cleanup
  → duplicate suppression
  → translation queue
```

### OCR前処理プリセット

| プリセット | 用途 |
|---|---|
| `default_dialogue` | 一般的な会話ウィンドウ |
| `pixel_font_dark_bg` | レトロゲームの白文字 + 暗背景 |
| `pixel_font_light_bg` | 黒文字 + 明背景 |
| `high_contrast` | 文字が細い場合 |
| `adv_textbox` | ADV/ノベルゲームの長文欄 |
| `menu_text` | メニューや選択肢 |

### 重複抑制

翻訳APIの無駄打ちを避けるため，次の処理を入れる．

- OCR結果の正規化．空白，改行，記号ゆれを整理．
- 直近テキストとの類似度比較．
- 同一テキストは翻訳キャッシュを返す．
- OCR信頼度が低い場合は翻訳キューに入れない．
- 短すぎるノイズ文字列を破棄する．

---

## 7. 翻訳パイプライン

### 基本フロー

```text
cleaned Japanese text
  → glossary replacement / protected terms
  → translation provider adapter
  → subtitle-friendly formatting
  → translation memory cache
  → overlay update
```

### Provider adapter

翻訳プロバイダは差し替え可能にする．

```python
class TranslationProvider:
    name: str

    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        glossary: dict[str, str],
        style: str,
    ) -> TranslationResult:
        ...
```

### 初回対応候補

| Provider | 位置づけ |
|---|---|
| DeepL | 低遅延・自然な翻訳の標準候補 |
| OpenAI | 文脈を含む自然な字幕整形，固有名詞補正に強い候補 |
| Google Cloud Translation | 汎用的で多言語拡張しやすい候補 |
| Local model | 将来対応．完全ローカル・プライバシー重視向け |

### APIキー管理

- ユーザー自身のAPIキーを使う．
- APIキーはOSの安全なストレージに保存する．
- ログにAPIキーを出さない．
- 設定エクスポートにAPIキーを含めない．

---

## 8. OBSオーバーレイ設計

### 基本方式

OBSにはBrowser Sourceとして次のURLを追加してもらう．

```text
http://127.0.0.1:39600/overlay
```

オーバーレイはHTML/CSS/JSで実装し，WebSocketまたはSSEで字幕を受け取る．背景は透明にする．

### 表示項目

- 翻訳文
- 任意で原文
- 任意でOCR信頼度
- 任意でプロバイダ名
- 任意でデバッグ状態

配信画面では原則，翻訳文だけを表示する．デバッグ情報はOBSには出さない．

### 字幕テーマ設定

- font family
- font size
- font weight
- text color
- stroke color
- stroke width
- shadow
- background box
- line height
- max width
- fade in/out
- display duration
- placement

### テーマ例

| テーマ | 用途 |
|---|---|
| `classic_subtitle` | 映画字幕風．白文字 + 黒縁 |
| `stream_box` | 半透明背景ボックス付き |
| `minimal` | 小さめの控えめ字幕 |
| `retro_pixel` | レトロゲーム風 |
| `bilingual` | 日本語原文 + 英語訳 |

---

## 9. OBS WebSocket連携

初回公開では，手動でBrowser Sourceを追加できれば十分である．  
ただし完成度を上げるなら，OBS WebSocketを使って以下を自動化できると強い．

- OBS接続確認．
- 現在のシーン一覧取得．
- Browser Sourceの自動作成．
- オーバーレイURLの自動設定．
- テスト字幕の表示．

この機能は「OBS自動セットアップ」として任意機能にする．手動設定でも使える状態を必ず残す．

---

## 10. データ設計

### SQLiteテーブル案

```sql
profiles(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game_title TEXT,
  created_at TEXT,
  updated_at TEXT
)

profile_settings(
  profile_id TEXT PRIMARY KEY,
  capture_source TEXT,
  roi_json TEXT,
  ocr_preset TEXT,
  translation_provider TEXT,
  target_lang TEXT,
  overlay_theme_id TEXT
)

glossary_terms(
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  source_term TEXT NOT NULL,
  target_term TEXT NOT NULL,
  note TEXT
)

translation_cache(
  id TEXT PRIMARY KEY,
  source_hash TEXT UNIQUE,
  source_text TEXT,
  translated_text TEXT,
  provider TEXT,
  created_at TEXT
)

overlay_themes(
  id TEXT PRIMARY KEY,
  name TEXT,
  css_json TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

### 保存しないもの

デフォルトでは，以下は保存しない．

- キャプチャ画像
- OCR対象スクリーンショット
- 配信中の全文ログ
- APIキー

---

## 11. ロギング

### 通常ログに含めてよいもの

- アプリバージョン
- OS情報
- OCRエンジン名
- 翻訳プロバイダ名
- エラー種別
- 処理時間
- ポート番号

### 通常ログに含めないもの

- APIキー
- ゲーム画面画像
- OCR全文
- 翻訳全文
- ユーザーの個人情報

デバッグモードではOCR全文や画像保存を許可してもよいが，明示的な警告を表示する．

---

## 12. パッケージング

### Windows

- `.exe` installer
- Portable `.zip`
- Python backendをsidecarとして同梱
- OCRモデルは初回起動時にダウンロード，またはfull bundle版を別配布
- GitHub ReleasesにSHA256を掲載

### macOS

- 初回はexperimentalでもよい．
- 署名・notarizationを行わない場合は，導入時の警告をドキュメント化する．

### Linux

- AppImageまたはFlatpakを検討する．
- Wayland環境の画面キャプチャ制約に注意する．
- 初回リリースではWindowsを優先し，Linuxは開発者向け手順でもよい．

---

## 13. リポジトリ構成案

```text
game-live-translator/
  README.md
  LICENSE
  CODE_OF_CONDUCT.md
  CONTRIBUTING.md
  SECURITY.md
  docs/
    getting-started.md
    obs-setup.md
    privacy.md
    translation-providers.md
    troubleshooting.md
  apps/
    desktop/
    backend/
  packages/
    overlay/
    shared-types/
  test-assets/
    synthetic-screens/
    ocr-fixtures/
  scripts/
    build-windows.ps1
    package-python.py
  .github/
    workflows/
      ci.yml
      release.yml
```

---

## 14. 開発品質

### Python

- `ruff`
- `mypy`
- `pytest`
- `pytest-asyncio`
- `pydantic`
- `pre-commit`

### TypeScript

- `eslint`
- `prettier`
- `vitest`
- `playwright`

### CI

- Pull request時にlint/testを実行する．
- mainへのmerge後にnightly buildを作る．
- tag作成時にrelease buildを作る．

---

## 15. 将来拡張

- 多言語翻訳．英語以外への出力．
- ローカル翻訳モデル．
- 音声読み上げ．
- 字幕ログをSRT/VTTで保存．
- OBSチャット連携．
- 視聴者が翻訳を補正できる共同翻訳モード．
- OCRプリセットのコミュニティ共有．
- Steam Deck / Linux配信環境対応．

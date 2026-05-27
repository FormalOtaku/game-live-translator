<!-- FILE: README.md -->

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


<!-- FILE: 01_purpose_and_positioning.md -->

# 01. 目的とポジショニング

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## 1. 目的

このプロジェクトの目的は，**日本語のみのゲームを海外視聴者と一緒に楽しめるようにすること**である．

近年のゲームは多言語対応が進み，日本語→英語の字幕やUIが標準搭載されていることが多い．一方で，古いゲーム，国内向けゲーム，同人ゲーム，ADV，JRPG，レトロゲームには，日本語しか表示されないものが多い．その結果，日本語を読めない視聴者は，配信上でストーリー，会話，選択肢，チュートリアルを理解しづらい．

このツールは，ゲーム画面上の日本語テキストをリアルタイムに読み取り，英語字幕としてOBSに重ねることで，配信者と海外視聴者の間の言語的な壁を下げる．

---

## 2. プロダクトの一文説明

### 日本語

> 日本語ゲーム画面をOCRで読み取り，英語字幕としてOBSに重ねる，配信者向けリアルタイム翻訳オーバーレイ．

### 英語

> A real-time Japanese-to-English game translation overlay for OBS Studio.

### 長めの英語説明

> Game Live Translator captures Japanese text from game screens, translates it into English, and displays it as an OBS-friendly subtitle overlay. It is designed for retro games, Japanese-only games, visual novels, JRPGs, and streamers who want to share Japanese games with international audiences.

---

## 3. 解決する課題

### 3.1 視聴者側の課題

- 日本語が読めないと，ストーリーや会話についていけない．
- JRPGやADVでは，画面上の文章が理解できないと配信体験が大きく落ちる．
- 配信者が毎回口頭で翻訳するとテンポが悪くなる．

### 3.2 配信者側の課題

- レトロゲームや日本語のみのゲームを海外向けに配信しづらい．
- 手動翻訳字幕を作るには手間がかかりすぎる．
- 既存の翻訳ツールは配信画面に自然に載せることを前提としていない．
- OCR，翻訳，OBS表示を個別に組み合わせるのは設定が複雑である．

### 3.3 開発者・OSS側の課題

- 便利な配信補助ツールはあるが，ゲーム翻訳に特化したOSSは限られる．
- ゲームデータを配布せず，画面上の文字だけを扱う安全な設計が必要である．
- APIキー，プライバシー，著作権リスクを明確にしたプロダクト設計が必要である．

---

## 4. 対象ユーザー

### Primary target

- 日本語ゲームを英語圏視聴者に向けて配信する配信者
- レトロゲーム配信者
- JRPG，ADV，ノベルゲーム配信者
- 日本のインディーゲームや同人ゲームを紹介する配信者
- 日本語は読めるが，視聴者向けに英語字幕を出したい配信者

### Secondary target

- 海外の日本ゲームファン
- VTuber，実況者，ゲーム翻訳コミュニティ
- 日本語学習者向け配信者
- ゲーム保存・アーカイブ文化に関心がある人

---

## 5. 立ち位置

このツールは，次のどれでもあるが，中心は**配信オーバーレイ**である．

| 分類 | 本プロジェクトとの関係 |
|---|---|
| OCRツール | 画面文字認識の部品として使う |
| 翻訳ツール | 翻訳エンジンを統合する |
| OBSオーバーレイ | 最重要の出力先 |
| ゲーム翻訳パッチ | 目指さない |
| ゲーム改造ツール | 目指さない |
| 字幕制作ツール | 一部近いが，リアルタイム配信が主目的 |

---

## 6. やること・やらないこと

### やること

- 画面に表示された日本語をOCRする．
- 翻訳結果を英語字幕として表示する．
- OBS Browser Sourceで読み込めるローカルオーバーレイを提供する．
- 字幕デザインを配信画面に合わせて調整できるようにする．
- ゲーム別にOCR範囲，翻訳設定，字幕テーマを保存する．
- ユーザーが自分のAPIキーを設定して使えるようにする．
- ログや翻訳履歴はプライバシー優先で扱う．

### やらないこと

- ゲーム本文の全文翻訳データを配布しない．
- 特定ゲームの翻訳済みスクリプトを同梱しない．
- ROM，ゲームファイル，実行ファイルを解析しない．
- ゲームプロセスへコード注入しない．
- DRM回避や改造パッチ配布を行わない．
- 公式翻訳であるかのように見せない．

---

## 7. プロダクト原則

### 原則1: OBS-first

配信者が実際に使う導線を優先する．最初の主要出力先はOBS Browser Sourceとする．

### 原則2: No game modification

ゲーム本体を改造しない．ゲーム画面に表示されたピクセルだけを読み取る．

### 原則3: Privacy-first

OCR結果や翻訳履歴は原則保存しない．保存する場合は明示的な設定とする．クラウド翻訳を使う場合は，どのテキストが外部APIに送信されるかをユーザーに説明する．

### 原則4: Stream-ready UX

精度だけでなく，字幕の見やすさ，遅延，安定性，復旧しやすさを重視する．

### 原則5: Open coreではなく，core open source

コア機能はオープンソースとして公開する．収益化は支援，有償サポート，カスタムテーマ，セットアップ支援，法人向け導入支援を中心にする．

---

## 8. 成功条件

初回公開時点で，以下を満たせると「完成度の高いリリース」として見せやすい．

- OBSに5分以内で字幕を載せられる．
- 配信者がゲームごとにOCR範囲を保存できる．
- テキストが変わったときだけ翻訳され，無駄な翻訳API消費が少ない．
- 字幕のフォント，サイズ，縁取り，背景，表示位置を調整できる．
- 翻訳結果の重複表示やちらつきが少ない．
- 異常時に「OCR失敗」「APIキー未設定」「OBS接続未設定」などの原因が分かる．
- READMEに使い方，注意点，支援リンクが整っている．
- デモ動画で価値が一目で伝わる．

---

## 9. コアメッセージ

### 日本語向け

> 昔の日本語ゲームを，海外視聴者と一緒に楽しめるようにする．

### 英語向け

> Make Japanese-only games streamable for international audiences.

### README冒頭案

```md
# Game Live Translator

Game Live Translator is an open-source real-time translation overlay for OBS Studio.
It captures Japanese text from a game screen, translates it into English, and displays the result as stream-friendly subtitles.

It is designed for retro games, Japanese-only games, visual novels, JRPGs, and streamers who want to share Japanese games with international audiences.
```


<!-- FILE: 02_product_requirements.md -->

# 02. プロダクト要件

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## 1. 初回公開の考え方

このプロジェクトは，雑なMVPではなく，**初回公開時点で配信者が実用できる品質**を狙う．  
そのため，機能を広げすぎるのではなく，以下に集中する．

- Windows + OBS Studioを主対象にする．
- 日本語→英語に集中する．
- ゲーム画面の一部領域を安定してOCRする．
- OBS Browser Sourceで字幕を自然に表示する．
- ゲーム別設定を保存できるようにする．
- APIキー，履歴，ログの扱いを明確にする．

---

## 2. 想定ユーザーフロー

### 初回セットアップ

1. アプリを起動する．
2. 翻訳プロバイダを選ぶ．例: DeepL，OpenAI，Google Cloud Translation．
3. APIキーを入力する．
4. OBS用オーバーレイURLを確認する．
5. OBSのBrowser SourceにURLを追加する．
6. ゲーム画面のOCR範囲を指定する．
7. 字幕テーマを選ぶ．
8. テストOCR・テスト翻訳を実行する．
9. 配信で使用する．

### 通常使用

1. ゲーム別プロファイルを選ぶ．
2. OBSを起動する．
3. 翻訳をONにする．
4. 必要に応じてOCR範囲を微調整する．
5. 配信中は字幕が自動更新される．

---

## 3. 機能要件

## 3.1 画面キャプチャ・OCR範囲指定

### 必須

- 画面またはウィンドウからキャプチャできる．
- OCR対象範囲をマウスで指定できる．
- 指定範囲をゲーム別プロファイルとして保存できる．
- 現在のOCR対象領域をプレビューできる．
- OCR前処理のON/OFFを切り替えられる．

### 望ましい

- 複数ROIを設定できる．例: 会話欄，選択肢欄，メニュー欄．
- ROIごとに優先度を設定できる．
- 文字ウィンドウの位置がある程度変わっても追従できる．
- 低解像度ゲーム向けに2倍/3倍拡大してOCRできる．

---

## 3.2 OCR

### 必須

- 日本語横書きテキストを認識できる．
- OCR結果の信頼度を確認できる．
- 同じ文章の重複認識を抑制できる．
- 空文字，ノイズ，UIアイコンをある程度除外できる．

### 望ましい

- 縦書きテキストの実験的対応．
- ピクセルフォント向けの前処理プリセット．
- 白文字/黒縁，黒文字/白背景，半透明ウィンドウなどのプリセット．
- OCR結果を手動で修正して再翻訳できる．

---

## 3.3 翻訳

### 必須

- 日本語→英語翻訳に対応する．
- 翻訳プロバイダを切り替えられる．
- ユーザー自身のAPIキーを使う．
- 同一テキストの翻訳をキャッシュし，API使用量を減らす．
- 翻訳失敗時に原因を表示する．例: APIキー不正，通信失敗，レート制限．

### 望ましい

- 用語集/Glossaryを設定できる．
- キャラクター名，固有名詞，ゲーム用語を固定訳にできる．
- 翻訳スタイルを選べる．例: natural，literal，subtitle-friendly，stream-friendly．
- 長文を字幕向けに短く整形できる．
- 翻訳履歴を直近のみ保存するモードと，保存しないモードを選べる．

---

## 3.4 OBSオーバーレイ

### 必須

- `http://127.0.0.1:<port>/overlay` のようなローカルURLを提供する．
- OBS Browser Sourceで字幕を表示できる．
- 背景透過に対応する．
- 字幕のフォント，サイズ，色，縁取り，影，背景色を設定できる．
- 字幕の表示位置と最大幅を調整できる．
- 直近1行/2行/3行表示を選べる．

### 望ましい

- OBS WebSocket経由でBrowser Sourceを自動追加できる．
- シーン切り替え時にも安定して表示できる．
- テーマプリセットを配布できる．
- CSSをユーザーがカスタムできる．
- 配信画面上の字幕セーフエリアを確認できる．

---

## 3.5 ゲーム別プロファイル

### 必須

- ゲーム名を付けて設定を保存できる．
- ROI，OCRプリセット，翻訳プロバイダ，字幕テーマを保存できる．
- プロファイルをインポート/エクスポートできる．

### 望ましい

- コミュニティが設定プリセットを共有できる．
- ただし，ゲーム本文や翻訳済み文章はプリセットに含めない．
- プリセットはROI位置，OCR前処理，テーマのみを含む．

---

## 3.6 UI/UX

### 必須画面

- Home / Status
- Capture Setup
- OCR Preview
- Translation Settings
- Overlay Theme Editor
- OBS Setup Guide
- Profiles
- Logs / Diagnostics
- Privacy Settings
- Support / Donation

### 重要なUX

- 初回セットアップで迷わない．
- OBS用URLをワンクリックでコピーできる．
- テスト字幕をワンクリックで表示できる．
- 配信中に大きな設定変更をしなくて済む．
- エラー時に原因と対処が分かる．

---

## 4. 非機能要件

## 4.1 遅延

目標値:

- 通常の1〜3行テキストで，画面表示から字幕表示まで1.5〜2.0秒以内を目指す．
- 翻訳APIの応答が遅い場合でもUIが固まらない．
- OCRは毎フレームではなく，1〜4Hz程度で十分．テキスト変化検出を優先する．

## 4.2 安定性

- OCRエンジンが失敗してもアプリ全体は落ちない．
- 翻訳APIが失敗しても最後の字幕表示を維持できる．
- ローカルサーバーのポート競合を検出できる．
- OBS Browser Sourceが再接続しても字幕状態を復元できる．

## 4.3 プライバシー

- OCR結果と翻訳履歴はデフォルトで永続保存しない．
- デバッグ用スクリーンショット保存は明示的なON設定にする．
- APIキーは平文ファイルに保存しない．
- 外部翻訳APIへ送信されるテキストについて初回設定時に説明する．

## 4.4 配布品質

- WindowsインストーラとPortable ZIPを提供する．
- 初回起動時のセットアップウィザードを用意する．
- アプリ内からバージョンとログを確認できる．
- GitHub Releasesに変更履歴，既知の問題，署名/ハッシュを載せる．

---

## 5. 受け入れテスト

初回公開前に，以下のテストを通す．

### OBS接続

- OBS Browser SourceにURLを追加すると字幕が表示される．
- OBSを再起動してもURLが有効である．
- 透明背景で表示できる．
- 1280x720，1920x1080，2560x1440で表示崩れがない．

### OCR

- 白文字 + 黒縁のゲーム字幕を読める．
- 黒文字 + 明るい背景のメニュー文字を読める．
- ピクセルフォントの日本語をある程度読める．
- 同じ文章を何度も翻訳しない．
- OCR失敗時に空字幕を連発しない．

### 翻訳

- APIキー未設定時に分かりやすいエラーが出る．
- 通信失敗時にUIが固まらない．
- 翻訳キャッシュが効く．
- Glossaryが設定されている場合，固有名詞が安定する．

### プロファイル

- ゲーム別にROIと字幕テーマを保存できる．
- アプリ再起動後も設定が復元される．
- プロファイルのエクスポート/インポートができる．

### プライバシー

- デフォルトではOCR画像と全文ログが保存されない．
- デバッグ保存をONにした場合だけ画像が保存される．
- APIキーがログに出力されない．

---

## 6. 初回公開で強く見せるデモ

### デモ動画の構成

1. 日本語ゲーム風の画面を表示する．
2. OCR範囲を指定する．
3. OBS Browser SourceにオーバーレイURLを追加する．
4. 日本語テキストが英語字幕として出る．
5. 字幕テーマを変更する．
6. ゲーム別プロファイルを保存する．
7. ドネーションリンクとOSSであることを案内する．

### 注意

公開デモでは，権利上問題のない自作画面，許諾済み素材，またはサンプル用モック画面を使う．特定ゲームのスクリーンショットをREADMEに大量掲載しない．


<!-- FILE: 03_technical_stack_architecture.md -->

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


<!-- FILE: 04_distribution_and_monetization.md -->

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


<!-- FILE: 05_legal_policy_safety.md -->

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


<!-- FILE: 06_release_plan_quality_gate.md -->

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


<!-- FILE: 07_references.md -->

# 07. 参考リンク

作成日: 2026-05-27  
対象: 配信者向けゲームリアルタイム英訳システム

---

## OBS

- OBS Studio Browser Source  
  https://obsproject.com/kb/browser-source

- OBS Remote Control Guide / WebSocket  
  https://obsproject.com/kb/remote-control-guide

- obs-websocket repository  
  https://github.com/obsproject/obs-websocket

- OBS Studio repository  
  https://github.com/obsproject/obs-studio

---

## OSS / Licensing / Funding

- GitHub Sponsors  
  https://github.com/open-source/sponsors

- GitHub Sponsors documentation  
  https://docs.github.com/en/sponsors

- GitHub: Licensing a repository  
  https://docs.github.com/articles/licensing-a-repository

- Choose a License  
  https://choosealicense.com/

- Open Collective Fiscal Hosting  
  https://opencollective.com/fiscal-hosting

- Ko-fi  
  https://ko-fi.com/

- Patreon Pricing  
  https://www.patreon.com/pricing

---

## OCR

- PaddleOCR  
  https://github.com/PaddlePaddle/PaddleOCR

- PaddleOCR Documentation  
  https://paddlepaddle.github.io/PaddleOCR/main/en/index.html

- EasyOCR  
  https://github.com/JaidedAI/EasyOCR

- EasyOCR supported languages  
  https://www.jaided.ai/easyocr/

- Tesseract tessdata  
  https://github.com/tesseract-ocr/tessdata

- Tesseract Data Files  
  https://tesseract-ocr.github.io/tessdoc/Data-Files.html

---

## Translation APIs

- DeepL Translate Text API  
  https://developers.deepl.com/api-reference/translate

- OpenAI API text generation  
  https://developers.openai.com/api/docs/guides/text

- OpenAI API quickstart  
  https://developers.openai.com/api/docs/quickstart

- Google Cloud Translation  
  https://cloud.google.com/translate

- Google Cloud Translation documentation  
  https://docs.cloud.google.com/translate/docs

---

## Desktop / Backend Stack

- Electron documentation  
  https://electronjs.org/docs/latest

- Tauri 2.0  
  https://v2.tauri.app/

- FastAPI  
  https://fastapi.tiangolo.com/

- Vite  
  https://vite.dev/guide/

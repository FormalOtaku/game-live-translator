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

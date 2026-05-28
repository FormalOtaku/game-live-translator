# CODEX_RUNBOOK_JA

この文書は、Codex セッションで Game_Live_Translator を実装するための運用ランブックです。

## 1. Operator Session
- `Operator Session`
  - 実装 session の外側にある read-only companion
  - repo state と live 状態を解釈し、次に打つべきコマンド列を返す
  - コード実装、`maestro checkpoint mark ...`、`maestro session handoff ...` は自動実行しない
  - terminal では `maestro operator start ...` で preview、実起動は `maestro operator launch ...`

## 2. Session Roles
- `Spec Session`
  - 仕様化、仮説整理、親タスク分解、current slice 確定まで
- `Execution Session`
  - 1 session = 1 slice
  - 実装、`npm test`、module review、docs同期、commit まで
- `Supervisor Session`
  - 実装は行わず、checkpoint 判定、runbook 解釈、次 session 指示の生成に限定

## 3. 1スライスの標準ループ
1. `team_patch`
2. `git apply --check`
3. `git apply`
4. `npm test`
5. 失敗時: `fix_patch` -> apply -> 再テスト
6. `team_review`（module diff）
7. P1/P2=0 を確認
8. `TASKS.md` / `STATE.md` / 必要なら `DECISIONS.md` 更新

## 4. 親タスク運用
- 親タスク開始時:
  - 3-6 子スライスへ分解（`T-xxx-001` 形式）
  - `doing` は1件のみ
- 親タスク完了時:
  - full diff review
  - 対象親タスクに smoke command がある場合は実行する（例: T-006 `npm run smoke:server`, T-007 `npm run smoke:config`, T-008 `npm run smoke:capture-ocr`, T-009 `npm run smoke:translation`）
  - cleanup スライス確認
  - `PARENT_TASK_CHECKLIST_JA.md` に沿って人手検証を依頼

## 5. Session Flow 更新
- session 開始前:
  - `maestro progress --json` で `session_flow.recommended_next_session_role` を確認
  - terminal では `maestro session start ...` で prompt preview を確認し、対話型起動は `maestro session launch ...` を使う
  - repo 状態の解釈や stale 判定が必要なら `maestro operator start ...` / `maestro operator launch ...` を companion として使う
- session 終了時:
  - `maestro session handoff --role <spec|execution|supervisor> ...` を更新
- checkpoint 人手確認後:
  - `maestro checkpoint mark ok` / `maestro checkpoint mark more-evidence` / `maestro checkpoint mark mismatch`
- transcript は保存しない
  - handoff は `STATE.md` / `.maestro/project.json` の `session_flow` に短く残す
- Discord 通知を複数 repo で分ける場合:
  - `MAESTRO_DISCORD_NOTIFY_CHANNEL_MAP=<abs_repo_path>=<channel_id>,...` を使う
  - command 実行対象は `active_repo` のまま、push notification だけが repo ごとの channel に振り分けられる

## 6. 失敗時の優先対処
- `needs_decomposition`:
  - 実装を止めて分解セッションへ戻る
- `wip_limit_violation`:
  - `Reopen Slice Task` で `doing` を1件に正規化
- `partial=true` が継続:
  - full diff 再試行
  - 連続 timeout は方針に従い例外記録し次チェックポイントで再試行

## 7. VS Code ボタン対応
- `Start Recommended Session`: `session_flow` に基づく推奨 role を起動
- `Start Spec Session`: 仕様化/分解セッション
- `Start Execution Session`: 会話型の 1スライス実装セッション
- `Start Supervisor Session`: checkpoint / next-step 整理セッション
- `Mark Checkpoint More Evidence`: 追加 review / fuller-context 確認待ちを記録
- `Run Active Slice Auto`: full-auto 実行（会話型ではない）
- `Progress`: 状態同期と推奨値確認

## 8. 最終出力の最小セット
- 変更ファイル一覧
- テスト結果（pass/fail）
- smoke 結果（対象親タスクに smoke command がある場合）
- 未解決 P1/P2/P3
- 次アクション（あれば）

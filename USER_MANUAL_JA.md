# USER_MANUAL_JA

この文書は、Game_Live_Translator で Maestro を使って開発を進めるための利用者向けマニュアルです。

## 1. 基本フロー（VS Code）
1. `Initialize`（初回のみ）
2. `Set Project Mode`（`research` / `product` / `personal`）
3. `Kickoff`
4. `Spec Workshop` または `Start Spec Chat (Codex)` で仕様を固める
5. `Decompose Active Task in Codex`（3-6 子スライスに分解）
6. `Run Active Task in Codex`（1スライス実行）
7. `Continue Active Task Loop`（次スライスへ継続）
8. `Progress` で進捗同期
9. 親タスク完了時は `親タスク確認チェックリスト` を実施

## 2. NightRun
- 開始: `NightRun Start`
- 状態: `NightRun Status`
- ログ: `NightRun Logs`
- 停止: `NightRun Stop`
- 再開: `NightRun Resume`
- 報告: `NightRun Report`

## 3. 重要ルール
- `doing` は常に1件だけ（WIP制限）
- 親タスクは必ず 3-6 子スライスへ分解
- 1スライス完了条件:
  - 実装完了
  - テスト成功
  - P1/P2 = 0
  - `TASKS.md` / `STATE.md` 同期

## 4. よくある詰まり
- `Run Active Task in Codex` が押せない/失敗する:
  - `Progress` を実行
  - `Decompose Active Task in Codex` を実行
  - `Doctor` を実行
- `Active Slice` が 100% なのに開発が終わらない:
  - 親タスク全体が完了したか `TASKS.md` で確認
  - 未完了なら `Activate Next Parent Task` を実行
  - 完了済みなら UI Loop または cleanup スライスへ進む

## 5. CLI 対応表
- `Progress` -> `maestro progress --path "/home/murasaki01/Projects/Game_Live_Translator"`
- `Doctor` -> `maestro doctor --repo "/home/murasaki01/Projects/Game_Live_Translator" --fix --install-deps`
- `NightRun Status` -> `maestro night-run status --path "/home/murasaki01/Projects/Game_Live_Translator"`
- `NightRun Logs` -> `maestro night-run logs --path "/home/murasaki01/Projects/Game_Live_Translator" --follow --lines 120`

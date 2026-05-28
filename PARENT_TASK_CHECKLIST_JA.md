# PARENT_TASK_CHECKLIST_JA

このチェックリストは、Game_Live_Translator の「親タスク（`T-xxx`）」完了時に人手検証を行うためのものです。

## 使い方
1. 親タスク配下の子スライスがすべて `done` になった時点で実行する。
2. 各項目を確認し、結果を `DECISIONS.md` または `TASKS.md` に記録する。
3. 問題があれば子スライスを再追加し、`todo` または `doing` に戻して修正する。

## A. 仕様適合チェック（必須）
- [ ] `PRODUCT_SPEC.md` の対象機能要件を満たしている
- [ ] `API_SPEC.md` の入出力/エラー契約と実装が一致している
- [ ] `UI_SPEC.md` の対象画面・状態遷移と実装が一致している（UI対象時）

## B. 実行検証チェック（必須）
- [ ] `npm test` が pass
- [ ] `npm run build` が pass（定義されている場合）
- [ ] `npm run lint` が pass（定義されている場合）
- [ ] 対象親タスクに smoke command がある場合は pass（T-006: `npm run smoke:server`, T-007: `npm run smoke:config`, T-008: `npm run smoke:capture-ocr`, T-009: `npm run smoke:translation`）
- [ ] 自動化できない主要ユースケースを手動で実行し、期待どおりに動作した

## C. 回帰/運用チェック（必須）
- [ ] 既存機能の回帰がない（最低1つ以上の既存フローを再確認）
- [ ] `TASKS.md` / `STATE.md` が最新状態に同期されている
- [ ] 未解決 `P1/P2=0` を確認済み
- [ ] `P3` 残件は理由付きで backlog に記録済み

## D. UI/UXチェック（必要時）
- [ ] 主要導線が迷わず操作できる
- [ ] 文言/ラベルが用途に一致している
- [ ] モバイル/デスクトップで崩れがない（対象時）

## E. 判定
- [ ] 親タスクを `done` のまま次の親タスクへ進める
- [ ] 追加修正が必要（新規子スライスを作成して再開）

## 記録テンプレート
```
Parent Task: T-xxx
Validation Date: YYYY-MM-DD
Reviewer: <name>
Result: pass | needs-fix
Notes:
- expected:
- actual:
- follow-up:
```

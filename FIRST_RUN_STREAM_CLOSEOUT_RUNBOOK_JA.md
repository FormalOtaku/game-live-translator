# FIRST_RUN_STREAM_CLOSEOUT_RUNBOOK_JA

この文書は T-012「初回配信ストリーム evidence」親タスクの closeout 手順です。対象は Windows 10/11 + OBS Browser Source + Japanese-to-English v1 core の合成 first-run stream evidence です。

## スコープ
- `127.0.0.1` localhost contracts only.
- ゲーム本体の改変、ファイル解析、コード注入、スクリプト配布は行わない。
- 実 DeepL credential、OBS Studio、Windows capture API、PaddleOCR、ブラウザ automation、外部 network はこの closeout smoke の前提にしない。
- API キー、OCR/source text、translated text、スクリーンショット、screenshot paths、stack traces、raw logs、cache keys、debug payloads は stdout/stderr、diagnostics、profile export、SQLite に出さない。
- 実機の Windows 10/11 + OBS visual confirmation は人手 gate として別途記録する。合成 smoke の PASS は OBS 実画面検証の代替ではない。

## 自動 closeout commands
以下を repo root で実行する。

1. `npm run smoke:first-run-stream`
   - 合成 Japanese fixture が localhost API、`/overlay`、`/ws/app`、`/ws/overlay` へ届くことを検証する。
2. `npm run smoke:backend-recovery`
   - backend restart、preferred-port fallback、retryable `PORT_UNAVAILABLE`、overlay replay recovery を検証する。
3. `npm run smoke:overlay-layout`
   - built-in themes と 1-3 line subtitles が 1280x720 / 1920x1080 / 2560x1440 の safe area に収まる renderer contract を検証する。
4. `npm run smoke:first-run-closeout`
   - 上の3つの smoke を実行し、生 stdout/stderr を出さずに hash/count/exit/schema evidence だけを集約する。
5. `npm test`
   - 全 unit/contract/smoke regression を通す。
6. `npm run build`
   - syntax/build gate を通す。
7. `npm run lint`
   - lint gate を通す。

`npm run smoke:first-run-closeout` の stdout は JSON のみとする。closeout command は各 child smoke の exported `runSmoke()` contract を in-process で順に実行し、canonical summary を privacy scan したうえで byte count と SHA-256 hash に集約する。child smoke CLI の raw stdout/stderr privacy は各 child smoke の既存 child-process tests で守る。

## PASS 判定
自動 closeout は以下をすべて満たすと PASS。

- `npm run smoke:first-run-closeout` exits 0.
- `totals.smokeCommands == 3`, `totals.passed == 3`, `totals.failed == 0`.
- `manualGate.reasonCode == "WINDOWS_OBS_VISUAL_GATE"`.
- `privacy.rawTextPayloadsAbsent == true`.
- `privacy.providerSecretsAbsent == true`.
- `privacy.screenshotPathsAbsent == true`.
- `privacy.stackTracesAbsent == true`.
- `privacy.rawLogsAbsent == true`.
- `privacy.cacheKeyValuesAbsent == true`.
- `privacy.diagnosticDebugPayloadsAbsent == true`.
- `runbook.requiredChecks == runbook.passedChecks`.

## 手動 gate
この runbook は合成 core evidence の closeout であり、実 OBS 画面の見た目を自動で証明しない。Windows 10/11 + OBS Browser Source 実機確認が必要な milestone では、次を `PARENT_TASK_CHECKLIST_JA.md` の template に記録する。

- OBS Browser Source に backend reported overlay URL `http://127.0.0.1:<port>/overlay` を設定できる。
- Browser Source width/height 1280x720、1920x1080、2560x1440 で subtitle が見切れない。
- background remains transparent.
- backend restart 後に同じ overlay URL または fallback URL を案内できる。
- API key、OCR/source text、translated text、screenshots、logs、stack traces は画面・ログ・diagnostics に出ない。

## 失敗時
1. `npm run smoke:first-run-closeout` の `smokeCommands[].id` と `exitCode` を確認する。
2. 失敗した child command を単体で実行する。
3. 修正後、`npm run smoke:first-run-closeout`、`npm test`、`npm run build`、`npm run lint` を再実行する。
4. Claude sidecar review evidence は parent closeout として full-diff scope で取り直す。

## Evidence 記録
slice closeout では以下を `STATE.md` / Maestro checkpoint に残す。

- `npm run smoke:first-run-closeout` の PASS.
- `npm test` / `npm run build` / `npm run lint` の PASS.
- Claude sidecar full-diff review: unresolved `P1/P2=0`.
- 実機 Windows 10/11 + OBS gate が未実施の場合は `manualGate.reasonCode` をそのまま残し、合成 evidence と実機 evidence を混同しない。

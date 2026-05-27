# SERVER_SMOKE_RUNBOOK_JA

このランブックは、T-006 localhost API / OBS overlay server core の親タスク closeout 用 smoke 手順です。

## 目的
- `127.0.0.1` のみで server core が起動することを確認する。
- `/health`, `/api/status`, `/overlay`, `/ws/app`, `/ws/overlay` の主要 contract を実通信で確認する。
- OBS Browser Source 相当の WebSocket reconnect/replay と、Electron Home/Status 相当の AppStatus stream を同時に確認する。
- API key、OCR/source text、debug payload が HTTP/WS/CLI output に出ないことを確認する。

## 実行コマンド
```bash
npm run smoke:server
```

成功時は JSON が標準出力へ出ます。

```json
{
  "ok": true,
  "command": "npm run smoke:server",
  "bindAddress": "127.0.0.1",
  "port": 39600,
  "overlayUrl": "http://127.0.0.1:39600/overlay",
  "checks": [
    "server binds 127.0.0.1 on an ephemeral port"
  ]
}
```

`port` は空き port を使うため環境ごとに変わります。

## 確認内容
- `GET /health`
  - `ok: true`
  - `bindAddress: "127.0.0.1"`
  - `port` が実際に選ばれた local port と一致する
- `GET /api/status`
  - `overlayUrl` が `http://127.0.0.1:<port>/overlay`
  - `lastSubtitle.sourceText` を含まない
  - provider key 形式の文字列を含まない
- `GET /overlay`
  - `no-store`, CSP, `nosniff` headers を返す
  - remote script/link asset を含まない
  - subtitle は escaped text として埋め込まれる
  - source text / provider key を含まない
- `GET /ws/app` と `GET /ws/overlay`
  - non-upgrade access は retryable `WS_REJECTED` JSON を返す
- `WS /ws/app`
  - 接続直後に sanitized `AppStatus` snapshot を返す
  - overlay client count と latest subtitle change を broadcast する
- `WS /ws/overlay`
  - 接続直後に latest sanitized subtitle を replay する
  - `OverlayState.publishFrame()` と `OverlayState.clearFrame()` を broadcast する

## Regression
- `test/server-smoke.test.js` が `scripts/smoke-local-api.js` を child process として実行する。
- そのため `npm test` は smoke command の破損も検出する。
- `npm run build` / `npm run lint` は `scripts/` も syntax check 対象にする。

## Parent Closeout Evidence
T-006 を完了扱いにする前に、最低限以下を記録する。

```text
npm test
npm run build
npm run lint
npm run smoke:server
Docker/devcontainer equivalent npm test
Docker/devcontainer equivalent npm run build
Docker/devcontainer equivalent npm run lint
Docker/devcontainer equivalent npm run smoke:server
Claude sidecar full-diff review: unresolved P1/P2=0
```

## Troubleshooting
- `EADDRINUSE`: smoke は ephemeral port を使うため通常は自動回避される。継続する場合は別 process が大量に localhost port を消費していないか確認する。
- `WS_REJECTED`: smoke 内の raw WebSocket helper（`scripts/smoke-local-api.js` の `connectWebSocketClient()`）が valid upgrade headers を送っているか確認する。通常の HTTP GET が 426 を返すのは期待どおり。
- timeout: local firewall、Node process の残留、または WebSocket broadcast regression を疑う。`npm test -- test/server-smoke.test.js` で単体再現する。

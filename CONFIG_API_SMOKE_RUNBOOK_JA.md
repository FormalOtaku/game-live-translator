# CONFIG_API_SMOKE_RUNBOOK_JA

このランブックは、T-007 persisted profile configuration API core の親タスク closeout 用 smoke 手順です。

## 目的
- `127.0.0.1` のみで localhost API harness が起動することを確認する。
- Profiles、active profile、profile export、themes、glossary、privacy settings、provider key write/delete の主要 route を実 HTTP で確認する。
- Provider key は write/delete-only で、readback endpoint がないことを確認する。
- API key、raw OCR/source text、debug payload が API response や CLI output に出ないことを確認する。

## 実行コマンド
```bash
npm run smoke:config
```

成功時は JSON が標準出力へ出ます。

```json
{
  "ok": true,
  "command": "npm run smoke:config",
  "bindAddress": "127.0.0.1",
  "port": 39600,
  "checks": [
    "server binds 127.0.0.1 on an ephemeral port"
  ]
}
```

`port` は空き port を使うため環境ごとに変わります。

## 確認内容
- `GET /health`
  - `bindAddress: "127.0.0.1"`
  - 選ばれた local port を返す
- Profile routes
  - `GET/POST /api/profiles`
  - `GET/PUT/DELETE /api/profiles/{id}`
  - `PUT /api/profiles/active`
  - `GET /api/profiles/{id}/export`
  - active profile delete は `CANNOT_DELETE_ACTIVE_PROFILE` で 409
  - export response に provider key / raw source text / debug payload を含まない
- Theme routes
  - `GET/POST /api/themes`
  - `GET/PUT/DELETE /api/themes/{id}`
  - built-in theme update は conflict として扱う
- Glossary routes
  - `GET /api/profiles/{id}/glossary/export`
  - `POST /api/profiles/{id}/glossary/import`
  - import success は `{ terms, rejected: [] }`
- Privacy settings
  - `GET /api/settings/privacy`
  - `PUT /api/settings/privacy`
  - unsupported method は `Allow: GET, PUT`
- Provider keys
  - `PUT /api/keys/{provider}` は `{ ok: true }` のみ返す
  - `DELETE /api/keys/{provider}` は `{ ok: true }` のみ返す
  - `GET /api/keys/{provider}` は 405 で、key readback endpoint はない
  - unknown provider は `PROVIDER_UNKNOWN`
  - response と stdout に入力 apiKey を含まない

## Regression
- `test/config-api-smoke.test.js` が `scripts/smoke-config-api.js` を child process として実行する。
- そのため `npm test` は config smoke command の破損も検出する。
- `npm run build` / `npm run lint` は `scripts/` も syntax check 対象にする。

## Parent Closeout Evidence
T-007 を完了扱いにする前に、最低限以下を記録する。

```text
npm test
npm run build
npm run lint
npm run smoke:server
npm run smoke:config
Docker/devcontainer equivalent npm test
Docker/devcontainer equivalent npm run build
Docker/devcontainer equivalent npm run lint
Docker/devcontainer equivalent npm run smoke:server
Docker/devcontainer equivalent npm run smoke:config
Claude sidecar full-diff review: unresolved P1/P2=0
```

## Troubleshooting
- `EADDRINUSE`: smoke は ephemeral port を使うため通常は自動回避される。継続する場合は別 process が大量に localhost port を消費していないか確認する。
- `DB_UNAVAILABLE`: smoke harness の injected `profileRepository` が route に必要な method を実装しているか確認する。
- `KEYCHAIN_UNAVAILABLE`: smoke harness の injected provider key store が `writeSecret` / `deleteSecret` adapter を持っているか確認する。
- timeout: local firewall、Node process の残留、または route handler regression を疑う。`node --test test/config-api-smoke.test.js` で単体再現する。

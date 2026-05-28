# TRANSLATION_API_SMOKE_RUNBOOK_JA

このランブックは T-009 translation test API core の parent closeout smoke を再現するための手順です。

## 目的
- `POST /api/translate/test`
- `GET /api/status`
- `/ws/app`
- `GET /health`

上記を実 HTTP/WebSocket 経由で確認し、First-Run、Translation Settings、Home/Status が依存する translation test contract と privacy invariant が同時に成立していることを証明します。

## 実行
```bash
npm run smoke:translation
```

Docker/devcontainer 相当で確認する場合:

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace game-live-translator-dev npm run smoke:translation
```

## 期待される結果
- exit code は `0`
- stdout は JSON
- `ok` は `true`
- `command` は `npm run smoke:translation`
- `bindAddress` は `127.0.0.1`
- `port` は選択された ephemeral local port
- `checks` は以下を含む
  - localhost ephemeral port bind
  - `/health` selected port check
  - `/api/translate/test` の `OPTIONS`、wrong method、malformed request が translation status を変えないこと
  - missing profile が provider を呼ばず redacted `PROFILE_NOT_FOUND` status を出すこと
  - translate success が glossary/cache-prepared input を provider seam に渡し、`running` -> `ok` を `/ws/app` と `/api/status` に出すこと
  - provider failure が retryable `PROVIDER_RATE_LIMITED` として返り、`running` -> `error` を `/ws/app` と `/api/status` に出すこと

## Privacy 確認
smoke は injected profile/provider 内に provider-key shaped string、raw source sentinel、translated output sentinel、glossary replacement sentinel、translation cache key を保持します。stdout/stderr、`/api/status`、`/ws/app` status frame、error envelope にはそれらが出てはいけません。

禁止される出力例:
- `sk-...` 形式の provider key
- raw source/test text sentinel
- translated output sentinel
- glossary replacement sentinel
- `v1:<provider>:en:<hash>:<hash>` 形式の cache key
- stack trace
- raw provider exception text

`/api/translate/test` の成功レスポンスだけは、ユーザーが明示的に実行した manual translation test の結果として `sourceText` と `translatedText` を返します。この smoke はその成功レスポンスを stdout に含めず、status/error surfaces への漏れだけを検証します。

## 制限
この smoke は dependency-free contract smoke です。DeepL credential、実ネットワーク、OBS、Windows capture API、PaddleOCR は使いません。実 Windows/Electron/FastAPI/DeepL adapter が入った時点で、別途 product-level smoke を追加します。

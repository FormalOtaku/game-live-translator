# DIAGNOSTICS_API_SMOKE_RUNBOOK_JA

このランブックは T-010 diagnostics bundle API core の parent closeout smoke を再現するための手順です。

## 目的
- `GET /health`
- `GET /api/diagnostics/bundle`
- `OPTIONS /api/diagnostics/bundle`
- wrong-method `/api/diagnostics/bundle`

上記を実 HTTP 経由で確認し、Logs/Diagnostics の copy diagnostic bundle が provider なしでも成立し、provider ログがある場合も privacy invariant を保った bundle だけを返すことを証明します。

## 実行
```bash
npm run smoke:diagnostics
```

Docker/devcontainer 相当で確認する場合:

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace game-live-translator-dev npm run smoke:diagnostics
```

## 期待される結果
- exit code は `0`
- stdout は JSON
- `ok` は `true`
- `command` は `npm run smoke:diagnostics`
- `bindAddress` は `127.0.0.1`
- `port` は provider-backed route を検証した ephemeral local port
- `checks` は以下を含む
  - localhost ephemeral port bind
  - `/health` selected port check
  - provider なしの minimal `DiagnosticBundle`
  - `OPTIONS` と wrong method が diagnostics provider を呼ばないこと
  - provider metadata normalization と redacted log bundle validation
  - provider throw / invalid shape が redacted `DIAGNOSTICS_FAILED` になること

## Privacy 確認
smoke は injected diagnostics provider 内に provider-key shaped string、raw OCR/source sentinel、translated output sentinel、screenshot/image path sentinel、stack sentinel、provider response sentinel を保持します。stdout/stderr と API error envelope にはそれらが出てはいけません。

禁止される出力例:
- `sk-...` 形式の provider key
- raw OCR/source sentinel
- translated output sentinel
- screenshot path / image path
- stack trace または stack file name
- raw provider exception text
- raw provider response body

成功した `GET /api/diagnostics/bundle` response には redacted log lines が含まれますが、この smoke は bundle 本文を stdout に含めず、JSON evidence の `checks` だけを出します。

## 制限
この smoke は dependency-free contract smoke です。実 log file、Windows/Electron/FastAPI log collector、OBS、PaddleOCR、DeepL credential、ネットワークは使いません。実 Windows/Electron/FastAPI collector が入った時点で、別途 product-level smoke を追加します。

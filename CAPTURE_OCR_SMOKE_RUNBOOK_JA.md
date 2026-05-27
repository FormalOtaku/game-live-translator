# CAPTURE_OCR_SMOKE_RUNBOOK_JA

このランブックは T-008 capture/OCR API core の closeout smoke を再現するための手順です。

## 目的
- `GET /api/capture/sources`
- `POST /api/ocr/test`
- `POST /api/capture/start`
- `POST /api/capture/stop`
- `GET /api/status`

上記を実 HTTP 経由で確認し、Capture Setup、OCR Preview、Home/Status が依存する API contract と privacy invariant が同時に成立していることを証明します。

## 実行
```bash
npm run smoke:capture-ocr
```

Docker/devcontainer 相当で確認する場合:

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace game-live-translator-dev npm run smoke:capture-ocr
```

## 期待される結果
- exit code は `0`
- stdout は JSON
- `ok` は `true`
- `command` は `npm run smoke:capture-ocr`
- `bindAddress` は `127.0.0.1`
- `checks` は以下を含む
  - localhost ephemeral port bind
  - `/health` selected port check
  - capture source enumeration success and `CAPTURE_ENUM_FAILED`
  - manual OCR success, `ROI_MISSING`, and `OCR_ENGINE_ERROR`
  - capture start status and `CAPTURE_ALREADY_RUNNING`
  - capture stop status and `CAPTURE_NOT_RUNNING`

## Privacy 確認
smoke は injected adapter 内に provider-key shaped string、raw source sentinel、screenshot path sentinel を保持します。stdout/stderr と API error envelope にはそれらが出てはいけません。

禁止される出力例:
- `sk-...` 形式の provider key
- raw OCR/source sentinel
- screenshot path
- stack trace
- raw provider/controller exception text

## 制限
この smoke は dependency-free contract smoke です。OBS、Windows desktop capture API、PaddleOCR、DeepL credential は使いません。実 Windows capture/PaddleOCR adapter が入った時点で、別途 product-level smoke を追加します。

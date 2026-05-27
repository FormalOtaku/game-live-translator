# TASKS

> Generated from `.maestro/tasks.json`. Edit with `maestro task ...`; do not hand-edit this file.

## Status Legend
- `todo`: not started
- `doing`: in progress
- `blocked`: blocked
- `done`: complete

## Backlog
| ID | Title | Status | Owner | Notes |
|---|---|---|---|---|
| (none) |  |  |  |  |

## Done
| ID | Title | Date | Evidence |
|---|---|---|---|
| T-001 | Bootstrap project workflow |  | GitHub SSH remote verified; Claude sidecar review imported clean with unresolved P1/P2=0; npm test/build/lint passed |
| T-002 | Align PRODUCT/UI/API specs with kickoff scope |  | PRODUCT/UI/API specs aligned; Claude sidecar re-review clean with unresolved P1/P2=0 and must_fix=0; npm test/build/lint passed |
| T-003 | Add/maintain regression tests first |  | Added foundational contract helpers and 23 regression tests; Claude sidecar review clean with unresolved P1/P2=0 and must_fix=0; npm test/build/lint passed |
| T-004 | Stabilize build/test in devcontainer |  | Replaced placeholder build/lint with cross-platform scripts/check-syntax.js and added test:contracts; local and devcontainer npm test/build/lint pass; Claude sidecar review clean with unresolved P1/P2=0 and must_fix=0 |
| T-005 | Implement deterministic core runtime pipeline |  | Parent complete: deterministic OCR normalization/filtering, duplicate suppression, glossary/cache keys, provider adapters, subtitle/overlay state, and OCR-to-overlay integration landed; local and devcontainer npm test/build/lint pass; full-diff Claude sidecar re-review clean with unresolved P1/P2=0 |
| T-005-001 | OCR normalization filtering duplicate suppression |  | Added OCR normalization/filtering and hash-only duplicate suppression core with 12 focused tests; local and devcontainer npm test/build/lint pass; Claude sidecar re-review clean with findings=0, must_fix=0, unresolved P1/P2=0 |
| T-005-002 | Glossary application and translation cache keys |  | Added deterministic glossary application and privacy-safe translation cache key core with 10 focused tests; local and devcontainer npm test/build/lint pass; Claude sidecar re-review clean with findings=0, must_fix=0, unresolved P1/P2=0 |
| T-005-003 | Translation provider adapters and provider error mapping |  | Added deterministic echo and injected DeepL provider adapters with controlled provider error mapping and 19 focused tests; local and devcontainer npm test/build/lint pass; Claude sidecar re-review clean with findings=0, must_fix=0, unresolved P1/P2=0 |
| T-005-004 | Subtitle frame and overlay state primitives |  | Added deterministic subtitle frame and in-memory overlay state primitives with escapedText, privacy-safe sourceText omission, expiry/reconnect snapshots, and 12 focused tests; local and devcontainer npm test/build/lint pass; Claude sidecar re-review clean with findings=0, must_fix=0, unresolved P1/P2=0 |
| T-005-005 | Deterministic OCR-to-overlay integration fixture |  | Added runOcrToOverlayPipeline with two-phase duplicate recording, glossary/cache preparation, provider validation, subtitle frame creation, overlay publication, retry-after-provider-failure behavior, and 10 focused tests; local and devcontainer npm test/build/lint pass; Claude module re-review clean with unresolved P1/P2=0 |

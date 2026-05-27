# CHANGELOG_DECISIONS

## Rule
- Record one entry per major change.
- Each entry must include impact scope: DB/API/UI.
- Each entry must state regression test strategy before merge.

## Entries
### CHG-20260527-001
- Date: 2026-05-27
- Summary: Aligned the authoritative PRODUCT/UI/API specs with the kickoff documents for Game Live Translator v1 core.
- Reason: The initial spec files were placeholders. Implementation needs a concrete production-grade v1 scope before code slices start.
- Impact scope (DB/API/UI):
  - DB: SQLite becomes the v1 persistence layer for profiles, settings, glossary, translation cache, overlay themes, and app metadata. API keys must remain outside the DB.
  - API: Introduces a localhost-only FastAPI contract for health, status, capture, OCR test, translation test, profiles, themes, privacy settings, key write/delete, diagnostics, and WebSocket streams.
  - UI: Defines the first-run wizard and primary desktop screens with loading, empty, error, success, and recovery states.
- Risk: Large upfront spec surface can drift if implementation slices are not kept small.
- Regression tests added first: This is a spec-only slice. The next test slice must add contract tests that lock privacy defaults, profile export redaction, localhost-only bind, and overlay escaping before feature implementation expands.
- Migration needed: No runtime migration yet. Future implementation must start at `schema_version=1` and update MIGRATION_PLAN.md for breaking schema changes.
- Rollback plan: Revert this spec-alignment commit and restore placeholder specs if the scope is rejected before implementation begins.

### CHG-20260527-002
- Date: 2026-05-27
- Summary: Introduced the deterministic OCR text normalization, confidence/noise filtering, and in-memory duplicate suppression core for T-005-001.
- Reason: Capture -> OCR -> translation needs one deterministic pre-translation gate so the local API, live runtime, and overlay reject the same empty, low-confidence, noisy, or duplicate candidates.
- Impact scope (DB/API/UI):
  - DB: No schema change. Duplicate suppression is in-memory only and must not touch SQLite or any persisted store.
  - API: `OcrResult.rejectionReason` is now a controlled vocabulary: `EMPTY_TEXT`, `CONFIDENCE_TOO_LOW`, `NOISE_TEXT`, `DUPLICATE_TEXT`.
  - UI: First-run setup, OCR Preview, and Home/Status can map these reason codes to user-facing recovery copy without inventing incompatible local codes.
- Risk: Future tuning of normalization, noise detection, or TTL can change accept/reject rates. Any tuning must update `API_SPEC.md` and focused regression tests together.
- Regression tests added first: `test/ocr-text.test.js` covers normalization, low-confidence rejection, empty/noise rejection, accepted Japanese text, duplicate suppression within TTL, TTL expiry, and the no-raw-text suppressor snapshot invariant.
- Migration needed: None.
- Rollback plan: Revert the new core module, tests, and spec/decision entries; no runtime data migration is required.

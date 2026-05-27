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

### CHG-20260527-003
- Date: 2026-05-27
- Summary: Added deterministic glossary application and privacy-safe translation cache key generation for T-005-002.
- Reason: The translation pipeline needs stable glossary substitution and cache keys before provider adapters land, so repeated translations can be reused without embedding raw game text in keys or diagnostics.
- Impact scope (DB/API/UI):
  - DB: No schema change in this slice. Future SQLite translation cache rows should use the generated key and may store provider output according to privacy settings.
  - API: Translation cache key composition is now specified as `v1:<provider>:<targetLang>:<glossaryRevision>:<sourceTextHash>`, and glossary revision is derived from canonical source/target pairs.
  - UI: Glossary preview can reuse the same single-pass longest-match application semantics that runtime translation will use.
- Risk: Literal glossary replacement may not cover inflected or context-sensitive Japanese terms. This is acceptable for v1 core proper-noun stabilization and can be expanded later behind new tests.
- Regression tests added first: `test/translation-cache.test.js` covers longest-term glossary application, deterministic code-unit tie breakers, non-cascading replacements, invalid glossary input, order-independent glossary revisions, privacy-safe cache key shape, target/provider validation, and cache-key changes when glossary targets, source text, or provider change.
- Migration needed: None.
- Rollback plan: Revert the new core module, tests, and spec/decision entries; no persisted data is introduced.

### CHG-20260527-004
- Date: 2026-05-27
- Summary: Added the deterministic v1 translation provider adapters (`echo`, `deepl`) and the controlled provider error code map for T-005-003.
- Reason: The capture -> OCR -> glossary -> translation pipeline needs a stable provider surface before the FastAPI sidecar and runtime translation loop wire up. Provider failures must categorize cleanly into the `ApiError` codes published in `API_SPEC.md` and must not leak DeepL keys into logs or diagnostics.
- Impact scope (DB/API/UI):
  - DB: No schema change. Provider adapters do not persist anything; cache hit/miss attribution stays in the future cache layer.
  - API: Confirms `/api/translate/test` provider failure codes (`PROVIDER_KEY_MISSING`, `PROVIDER_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`, `PROVIDER_NETWORK_ERROR`, `PROVIDER_RESPONSE_INVALID`, `PROVIDER_UNKNOWN`) and adds `TARGET_LANG_INVALID` as a pre-call validation code. Adds the documented adapter interface and dependency-injection contract for `fetchClient`/`apiKeyResolver`.
  - UI: First-run wizard, OCR Preview "Translate test" button, and Home/Status error toasts can map these provider codes to recovery copy with explicit retryable hints (`PROVIDER_RATE_LIMITED`, `PROVIDER_NETWORK_ERROR`).
- Risk: DeepL HTTP semantics may drift over time; status-code-to-error-code mapping is centralized so a future change only requires editing `src/core/translation-providers.js` and the focused tests. Echo provider intentionally returns the normalized source text; it is for tests and offline runs only and must not be exposed as a production-default provider.
- Regression tests added first: `test/translation-providers.test.js` covers 19 cases for the provider error code enum, the retryable subset, echo determinism, target-language gating, DeepL adapter construction validation, success path with injected fetch, endpoint override handling, and every documented failure-to-code mapping including API-key-leak prevention in error payloads and request URLs.
- Migration needed: None.
- Rollback plan: Revert the new core module, tests, and spec/decision entries; remove `assertTargetLang`/`assertProvider` helpers from `src/contracts/validation.js`. No persisted data or runtime surface is introduced.

### CHG-20260527-005
- Date: 2026-05-27
- Summary: Added deterministic subtitle frame construction and in-memory overlay state primitives for T-005-004.
- Reason: The OBS Browser Source WebSocket needs a reconnect-safe latest-frame contract before the end-to-end OCR-to-overlay fixture lands. The frame contract also needs to lock overlay escaping and source-text privacy defaults.
- Impact scope (DB/API/UI):
  - DB: No schema change. Subtitle frames and overlay state are in-memory only and must not persist OCR/source/translation text by default.
  - API: `SubtitleFrame` now includes `escapedText`, explicit frame validation, default `displayMs=7000`, optional debug-only `sourceText`, and an `OverlayState` snapshot contract for overlay client counts and latest-frame replay.
  - UI: Overlay rendering and Home/Status can consume escaped frame text, overlay client counts, and latest-frame snapshots without inventing local state semantics.
- Risk: Future overlay renderer code could mistakenly render `translatedText` instead of `escapedText`. This is mitigated by focused tests now and must be reinforced in T-005-005 overlay integration tests.
- Regression tests added first: `test/subtitle-state.test.js` covers frame shape, deterministic ids/timestamps, source-text omission by default, explicit debug source text, malicious HTML escaping, validation failures, latest-frame replay, expiry, clear behavior, and overlay client counters.
- Migration needed: None.
- Rollback plan: Revert the new core module, tests, and spec/decision entries; no persisted data is introduced.

### CHG-20260528-006
- Date: 2026-05-28
- Summary: Added the deterministic OCR-to-overlay runtime pipeline fixture for T-005-005.
- Reason: The v1 core needs one verified path from accepted OCR text through glossary/cache-key preparation, provider translation, subtitle frame creation, and overlay state publication before API/UI slices wire it to capture and OBS.
- Impact scope (DB/API/UI):
  - DB: No schema change. The pipeline is in-memory only and must not persist OCR/source text, translated text, glossary attribution, subtitle frames, or overlay snapshots by default.
  - API: Adds the `runOcrToOverlayPipeline` core contract, including OCR rejection semantics, privacy-safe cache key propagation, provider failure propagation, and source-text omission from overlay snapshots.
  - UI: Home/Status and overlay views can consume one canonical runtime snapshot for OCR status, translation status, cache key, overlay clients, and escaped subtitle text.
- Risk: The in-process result intentionally contains normalized OCR/debug attribution for immediate UI workflows; future diagnostics and persistence slices must continue to redact or omit these fields by default.
- Regression tests added first: `test/runtime-pipeline.test.js` covers successful OCR -> glossary/cache -> provider -> subtitle -> overlay publication, OCR rejection without provider/publish side effects, duplicate suppression, malicious subtitle escaping, source-text omission from overlay replay, provider failure no-publish behavior, and provider mismatch validation.
- Migration needed: None.
- Rollback plan: Revert the runtime pipeline module, tests, and spec/decision entries; no persisted data is introduced.

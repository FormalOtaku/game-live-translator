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

### CHG-20260528-007
- Date: 2026-05-28
- Summary: Started T-006 with a localhost HTTP server contract core for `/health` and `/api/status`.
- Reason: The completed runtime pipeline needs a real localhost-only API surface before OBS overlay HTML, WebSocket replay, and Electron status screens can be wired safely.
- Impact scope (DB/API/UI):
  - DB: No schema change. The server core is in-memory and reads only sanitized runtime state.
  - API: Adds the `createLocalApiServer` contract, `127.0.0.1` bind enforcement before listen, sequential local port fallback, canonical `ApiError` responses, no-wildcard CORS, `/health`, and privacy-safe `/api/status`.
  - UI: Home/Status must trust the backend-reported `overlayUrl`, bound port, overlay client count, and sanitized latest subtitle instead of constructing host/port state itself.
- Risk: This Node implementation is a contract harness for the current core repo while the product target remains a Python FastAPI sidecar. The wire contract must remain stable if the implementation is wrapped or ported.
- Regression tests added first: `test/local-api-server.test.js` covers non-localhost bind rejection, selected port reporting, sequential fallback and exhaustion on port conflict, sanitized and empty status snapshots, canonical 404/405/500 errors, and CORS not using a wildcard.
- Migration needed: None.
- Rollback plan: Revert the server core, focused tests, and T-006 spec/decision entries; no persisted data is introduced.

### CHG-20260528-008
- Date: 2026-05-28
- Summary: Added the OBS overlay HTML renderer and `/overlay` safety fixtures for T-006-002.
- Reason: OBS users need a real Browser Source URL that renders stream subtitles safely before WebSocket broadcast wiring lands.
- Impact scope (DB/API/UI):
  - DB: No schema change. Overlay HTML rendering is stateless and reads only sanitized in-memory subtitle state.
  - API: `GET /overlay` returns a transparent, self-contained, no-store HTML document with no remote assets; it restores `/api/status` and prepares for `/ws/overlay` reconnect.
  - UI: OBS Setup Guide and Home/Status can point users at a functional local overlay shell that renders `SubtitleFrame.escapedText` only.
- Risk: T-006-002 locks the browser shell but the server WebSocket endpoint still lands in T-006-003, so live updates beyond the initial status restore are not complete until the next slice.
- Regression tests added first: `test/overlay-renderer.test.js` and `/overlay` server tests cover transparent layout, no remote assets, no raw/debug text leakage, malicious subtitle rendering as text, line-count/theme fallbacks, no-store headers, and browser-side use of `escapedText`.
- Migration needed: None.
- Rollback plan: Revert the overlay renderer, server `/overlay` route, tests, and spec/decision entries; no persisted data is introduced.

### CHG-20260528-009
- Date: 2026-05-28
- Summary: Added the dependency-free `/ws/overlay` WebSocket replay and broadcast contract for T-006-003.
- Reason: The overlay shell needs a real local stream for reconnect-safe subtitles and Home/Status needs accurate overlay client counters before broader app status streaming is added.
- Impact scope (DB/API/UI):
  - DB: No schema change. WebSocket clients, latest subtitle replay, and broadcast fan-out remain in-memory runtime state only.
  - API: `WS UPGRADE /ws/overlay` accepts valid local WebSocket clients, replays the latest non-expired sanitized subtitle frame, broadcasts `OverlayState.publishFrame()` and `clearFrame()` events, handles ping/close, and rejects non-upgrade HTTP access with `WS_REJECTED`.
  - UI: OBS Browser Source can now receive live subtitle updates after the initial `/api/status` restore; Home/Status can rely on backend overlay client counts.
- Risk: The WebSocket implementation is intentionally minimal and dependency-free, so protocol coverage is limited to the v1 Browser Source needs: text frames, ping/pong, close, origin gating, masking validation, and bounded payload size. Future binary or fragmented-client use must be added deliberately with tests.
- Regression tests added first: focused local server and raw-socket WebSocket tests cover handshake rejection, origin rejection, replay on connect, live broadcast, clear events, client counters, ping responses, control-frame size rejection, and source-text omission.
- Migration needed: None.
- Rollback plan: Revert the overlay WebSocket helper, server upgrade wiring, tests, and spec/decision entries; no persisted data is introduced.

### CHG-20260528-010
- Date: 2026-05-28
- Summary: Added the dependency-free `/ws/app` app status stream and provider-error-to-runtime-status mapping helpers for T-006-004.
- Reason: Home/Status needs a real local stream of sanitized `AppStatus` snapshots reflecting runtime status and overlay state changes, and the API/UI layers need a deterministic way to map provider `ContractError` codes to `RuntimeStatus.state/code/message/retryable` and `ApiError.retryable` without parsing message text.
- Impact scope (DB/API/UI):
  - DB: No schema change. `/ws/app` clients, snapshot fan-out, and runtime-status state remain in-memory runtime state only.
  - API: `WS UPGRADE /ws/app` accepts valid local WebSocket clients on a separate path from `/ws/overlay`, applies the same configured/same-port localhost Origin policy and bounded client-frame rules, sends a sanitized `AppStatus` snapshot on connect, and broadcasts a fresh sanitized snapshot when runtime status or overlay state changes. Non-upgrade `GET /ws/app` returns the canonical retryable `WS_REJECTED` `ApiError`. `createLocalApiServer` now exposes `appWsPath` configuration and a `publishStatus()` method for runtime-status republish. `src/core/translation-providers.js` exports `providerErrorToRuntimeStatus` and `providerErrorRetryable`; `src/server/local-api-server.js` exports `buildApiErrorFromContractError` for canonical `ApiError` envelopes.
  - UI: Home/Status can subscribe to `/ws/app` for push-driven status updates instead of polling, and trust `RuntimeStatus.retryable`/`code` from `/ws/app` for retry copy without parsing message text. `lastSubtitle`, capture/OCR/translation status, and overlay client count are guaranteed to be the same sanitized shapes already served by `GET /api/status`.
- Risk: `/ws/app` and `/ws/overlay` now share a single upgrade dispatcher in `createLocalApiServer`. Future endpoints must register through the same dispatcher rather than attaching their own `upgrade` listeners to avoid the cross-handler "write after end" pattern that motivated this refactor.
- Regression tests added first: focused local server tests cover `/ws/app` non-upgrade `WS_REJECTED`, on-connect snapshot redaction (no `sourceText`/provider key/raw OCR leakage), runtime-status republish broadcast, publish/clear overlay state broadcast, multi-client fan-out, overlay client-count broadcast on overlay connect/disconnect, origin rejection with 403 `WS_REJECTED`, text/control ping handling, oversized text/control frame rejection, retryable/non-retryable `providerErrorToRuntimeStatus` mapping with redacted messages, `/api/status` runtime-status source failure fallback, and `buildApiErrorFromContractError` retryability without message parsing.
- Migration needed: None.
- Rollback plan: Revert the `/ws/app` endpoint, runtime error mapping helpers, focused tests, and spec/decision entries; no persisted data is introduced.

### CHG-20260528-011
- Date: 2026-05-28
- Summary: Added the T-006 parent-closeout smoke command and server smoke runbook.
- Reason: The localhost API/OBS overlay server core needs one repeatable end-to-end operational check that exercises the actual HTTP and WebSocket wire contract before the parent task is closed.
- Impact scope (DB/API/UI):
  - DB: No schema change. The smoke command uses only in-memory `OverlayState` and ephemeral server state.
  - API: Adds `npm run smoke:server`, which validates `/health`, `/api/status`, `/overlay`, `/ws/app`, `/ws/overlay`, retryable `WS_REJECTED` envelopes, AppStatus broadcasts, overlay replay/broadcast, and privacy redaction.
  - UI: Provides the evidence path for Home/Status and OBS Setup Guide assumptions before those UI surfaces consume the local API.
- Risk: The smoke command is a synthetic harness, not a substitute for future Windows + OBS manual release validation. It deliberately validates the current Node contract harness while the production target remains Electron plus Python FastAPI sidecar.
- Regression tests added first: `test/server-smoke.test.js` runs `scripts/smoke-local-api.js` as a child process and asserts pass JSON, selected localhost overlay URL, expected check list, and no source text/provider key leakage in stdout.
- Migration needed: None.
- Rollback plan: Revert the smoke script, package script, runbook, regression test, and spec/decision entries; no persisted data is introduced.

### CHG-20260528-012
- Date: 2026-05-28
- Summary: Added the production-grade profile/settings contract validation boundary for T-007-001 before persistence/API implementation.
- Reason: T-007 introduces SQLite-backed profiles, themes, glossary, privacy settings, and OS-secure-storage-backed provider keys. The previous validators covered only individual scalars and the forbidden-export-field scan. Without one executable request validator the persistence layer and the future FastAPI sidecar would re-implement v1 invariants and drift apart on privacy rules.
- Impact scope (DB/API/UI):
  - DB: No schema change in this slice. `DEFAULT_PRIVACY_SETTINGS` is documented as the privacy-first seed that the future first-run/migration step must write; the validator stops widened settings from being persisted unless the matching retention/limit field is a positive integer.
  - API: Adds `validateProfileCreateRequest`, `validateProfileUpdateRequest`, `validateProfileExport`, `validatePrivacySettings`, and `validateProviderKeyWriteRequest` (plus `assert*` wrappers). All emit `ContractError` envelopes with `code: "VALIDATION_ERROR"` and `details.fieldErrors`. Adds the v1 controlled OCR preset vocabulary (`ALLOWED_OCR_PRESETS`), controlled capture-source kinds, and `PROFILE_EXPORT_SCHEMA_VERSION`/`PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY` constants. Re-confirms `PUT /api/keys/{provider}` keeps a frozen write-only `{ ok: true }` response shape, rejects path/body provider mismatches with `PROVIDER_PATH_MISMATCH`, and never echoes the supplied key. Profile create/update requests reject unknown writable fields with `UNKNOWN_PROFILE_FIELD`, so callers cannot smuggle `apiKey`, OCR text history, or screenshot fields into profiles.
  - UI: First-run wizard, Profiles screen, Privacy Settings screen, and OBS Setup Guide can map the canonical `VALIDATION_ERROR.fieldErrors` shape onto inline form errors without inventing local error codes.
- Risk: The validators intentionally stay dependency-free and Node-built-in-test friendly. Any future controlled vocabulary expansion (more OCR presets, more providers, more built-in themes) must update `src/contracts/validation.js`, the focused tests, `API_SPEC.md`, and `MIGRATION_PLAN.md` together so the persistence layer and the FastAPI port do not drift.
- Regression tests added first: `test/contracts.test.js` adds focused cases covering valid `ProfileCreateRequest`, missing-required-field rejection per field, controlled-vocabulary rejection (`captureHz`, `targetLang`, `translationProvider`, `ocrPreset`), whitespace-only name rejection, ROI/capture-source/glossary validation, partial `ProfileUpdateRequest` acceptance, unknown-field rejection on create/update including undefined values, non-object payload rejection, `ProfileExport` happy path, schema/policy/exportedAt/profile-shape failures, top-level and nested forbidden-field rejection for every `FORBIDDEN_PROFILE_EXPORT_FIELDS` entry, duplicate error suppression for forbidden profile fields, recursive forbidden-field scan cycle safety, `Profile.id/createdAt/updatedAt` requirement, `PrivacySettings` defaults and type/limit/directory/positive-budget rejection, write-only `ProviderKey` response staying frozen `{ ok: true }`, empty/whitespace/non-string apiKey rejection, `PROVIDER_UNKNOWN` from both path-bound and body-bound providers, path/body `PROVIDER_PATH_MISMATCH` without key echo, and the v1 OCR preset vocabulary lock.
- Migration needed: None. SQLite schema/migration steps land in the next T-007 child slice that adds persistence.
- Rollback plan: Revert the new validators, focused tests, and spec/decision entries; the runtime pipeline and localhost server core remain unchanged because they do not yet consume these request validators.

### CHG-20260528-013
- Date: 2026-05-28
- Summary: Added the dependency-free SQLite schema version 1 configuration repository boundary for T-007-002.
- Reason: Profile/configuration API slices need one durable schema and repository contract before CRUD routes, theme/glossary endpoints, privacy settings, and OS-secure-storage key writes are wired. Node 20 in this repo does not provide `node:sqlite`, so the slice locks SQL and adapter boundaries without adding a driver dependency.
- Impact scope (DB/API/UI):
  - DB: Introduces schema version 1 SQL for `app_meta`, `profiles`, `profile_settings`, `glossary_terms`, `overlay_themes`, `privacy_settings`, and metadata-only `translation_cache`. Seeds `app_meta.schema_version = "1"`, `DEFAULT_PRIVACY_SETTINGS`, and built-in overlay themes. Provider keys, raw OCR/source text, translated text, screenshots/images, and log payloads remain outside SQLite.
  - API: Adds `createSqliteConfigRepository({ database, clock?, idFactory? })` as the persistence boundary that future profile/configuration route handlers must call after request parsing. `createProfile` and `savePrivacySettings` call the T-007-001 validators before any SQL write; provider key persistence is intentionally absent from this repository.
  - UI: First-run wizard, Profiles, Overlay Theme Editor, Glossary, and Privacy Settings screens gain a stable storage contract for future route slices without exposing key readback or raw game text persistence.
- Risk: This is an adapter-level boundary, not a live SQLite driver integration. The future Python FastAPI sidecar must preserve the same schema, seed behavior, validation-before-write ordering, and privacy exclusions when it owns the real database connection.
- Regression tests added first: `test/sqlite-config-store.test.js` covers schema/table/version statements, forbidden storage identifier checks, initialization seeds and schema-version mismatch handling, validator-before-write behavior for invalid profiles/privacy settings, required-only and full profile writes, duplicate glossary-id rejection, frozen return shape, default/updated privacy persistence, built-in theme seeds, invalid clock handling, and absence of provider-key repository methods.
- Migration needed: This is the initial schema boundary. Future schema changes must add forward-only migration steps from `schema_version=1` and keep profile export compatibility in sync.
- Rollback plan: Revert the storage module, focused tests, and spec/decision entries. No live user database migration is needed until the concrete SQLite driver/sidecar is wired.

### CHG-20260528-014
- Date: 2026-05-28
- Summary: Added profile CRUD, active profile selection, and safe profile export API contracts for T-007-003.
- Reason: Profiles must be durable and controllable before the UI can build first-run, Profiles, Capture Setup, and OBS setup flows. The repository already created profiles, but lacked read/update/delete, active selection, and HTTP route behavior.
- Impact scope (DB/API/UI):
  - DB: Reuses schema version 1. Adds repository behavior for profile reads, updates, deletes, `app_meta.active_profile_id`, and export construction; no schema bump and no provider-key/raw OCR/translation/image/log persistence.
  - API: Adds dependency-injected profile routes to the localhost server harness for list/create/get/update/delete/activate/export. Route errors use canonical `ApiError`, preserve validation details, map not-found to 404, active-profile delete conflicts to 409, and return `DB_UNAVAILABLE` when no repository is installed.
  - UI: Profiles and first-run flows can rely on stable active-profile and export contracts, including inline validation errors and a deterministic conflict when a user tries to delete the active profile.
- Risk: This remains a contract harness over an injected SQLite-like adapter, not the final Python/FastAPI driver. Future sidecar integration must preserve the same SQL-visible behavior and HTTP response shapes.
- Regression tests added first: focused repository tests cover list/get/update/delete/active/export behavior, validator-before-write ordering, glossary rewrite transactions, active delete conflict, missing profiles, frozen return shapes, and forbidden export exclusions. Local API tests cover all new profile routes, request parsing, status/error mapping, CORS methods, and secret redaction in error envelopes.
- Migration needed: None. Existing schema version 1 tables and export schema version 1 are unchanged.
- Rollback plan: Revert the profile CRUD repository/API implementation, focused tests, and spec/decision entries. No persisted schema migration is required.

### CHG-20260528-015
- Date: 2026-05-28
- Summary: Added overlay theme CRUD and glossary import/export API contracts for T-007-004.
- Reason: The Profiles, Glossary, and Overlay Theme Editor flows need durable theme and glossary endpoints before first-run/UI integration can be reliable. Built-in theme immutability and glossary import safety must live below the UI so the future FastAPI sidecar preserves the same behavior.
- Impact scope (DB/API/UI):
  - DB: Reuses schema version 1 `overlay_themes`, `glossary_terms`, and `profile_settings.glossary_revision`. No schema bump, no key storage movement, and no raw OCR/translation/image/log persistence.
  - API: Adds validators for `OverlayThemeCreateRequest`, `OverlayThemeUpdateRequest`, and `GlossaryImportRequest`; adds repository methods and localhost routes for theme list/create/get/update/delete plus profile glossary export/import. Built-in theme updates/deletes and in-use deletes surface conflict errors; glossary import is all-or-nothing.
  - UI: Overlay Theme Editor can duplicate built-ins into custom themes, edit/delete only safe custom themes, and show deterministic in-use/built-in conflicts. Glossary UI can export current terms and import JSON/CSV with canonical row-level error details.
- Risk: CSV support is dependency-free and intentionally headered/all-or-nothing. Future lenient import behavior must be added as a new explicit contract instead of silently changing this default.
- Regression tests added first: focused contract, repository, and local API tests cover theme validation, built-in guards, theme-in-use checks, glossary JSON/CSV parsing, duplicate rejection before writes, frozen return shapes, route status/error mapping, and redaction.
- Migration needed: None. Existing schema version 1 and profile export schema version 1 are unchanged.
- Rollback plan: Revert the theme/glossary validators, repository/API methods, focused tests, and spec/decision entries. No persisted schema migration is required.

### CHG-20260528-016
- Date: 2026-05-28
- Summary: Added privacy settings read/update and write-only provider key API contracts for T-007-005.
- Reason: First-run, Privacy Settings, and Translation Settings need durable privacy controls and provider key save/delete routes without weakening the no-plaintext-key invariant.
- Impact scope (DB/API/UI):
  - DB: Reuses schema version 1 `privacy_settings`. Adds no SQLite provider-key storage, no cache persistence change, and no profile export schema bump.
  - API: Adds `getPrivacySettings`, `/api/settings/privacy` GET/PUT, `createProviderKeyStore({ adapter })`, and `/api/keys/{provider}` PUT/DELETE. Provider key success responses remain `{ ok: true }`, and key store adapter failures map to redacted `KEYCHAIN_UNAVAILABLE`.
  - UI: Privacy Settings and provider-key entry/delete flows can rely on canonical validation errors, stable read/update privacy responses, and write-only key semantics.
- Risk: The concrete Windows secure-storage integration remains an adapter implementation task; this slice locks the contract and regression harness without native dependencies.
- Regression tests added first: storage tests cover privacy row read/fallback and validation-before-write; provider-key-store tests cover write/delete, provider validation, key redaction, adapter failure mapping, and absence of read/list methods; local API tests cover privacy/key routes, method errors, DB/keychain unavailable, and no key echo.
- Migration needed: None. Provider keys remain outside SQLite, profile exports, diagnostics, and logs.
- Rollback plan: Disable `/api/settings/privacy` and `/api/keys/{provider}` routes while preserving existing profile/theme/glossary APIs; no SQLite data migration rollback is required.

### CHG-20260528-017
- Date: 2026-05-28
- Summary: Added the T-007 configuration API smoke command and parent-closeout runbook.
- Reason: The profile/configuration API parent needs one reproducible live-HTTP smoke that proves the combined route surface works with injected persistence and secure-store boundaries, rather than relying only on focused unit tests.
- Impact scope (DB/API/UI):
  - DB: No schema change. The smoke uses injected config dependencies and keeps the SQLite schema version 1 contract unchanged.
  - API: Adds `npm run smoke:config`, `scripts/smoke-config-api.js`, and `test/config-api-smoke.test.js`. The smoke covers profiles, active profile, safe export, themes, glossary import/export, privacy settings, provider key write/delete-only semantics, method guards, canonical errors, and redaction/no-readback invariants.
  - UI: First-run, Profiles, Glossary, Overlay Theme Editor, Privacy Settings, and Translation Settings flows gain parent-closeout evidence that their backing local routes are available as one coherent API.
- Risk: This remains a dependency-free contract smoke over injected adapters, not a Windows keychain or concrete SQLite driver smoke. Real-adapter smoke should be added when those adapters land.
- Regression tests added first: `test/config-api-smoke.test.js` executes the smoke script as a child process and asserts the JSON evidence shape plus no provider key/source sentinel in stdout.
- Migration needed: None.
- Rollback plan: Remove `npm run smoke:config`, the smoke script, runbook, focused smoke test, and spec/decision entries. Existing profile/theme/glossary/privacy/key API behavior remains covered by unit tests.

### CHG-20260528-018
- Date: 2026-05-28
- Summary: Started T-008 with capture/OCR API contract validation for source enumeration, capture start, manual OCR test, and OCR result response shapes.
- Reason: First-run, Capture Setup, OCR Preview, and Home/Status need stable request/response contracts before the capture source enumerator and OCR engine adapter are wired into the localhost API.
- Impact scope (DB/API/UI):
  - DB: No schema change. The slice is a pure validator/docs/test boundary and introduces no SQLite rows, no key storage movement, no cache persistence, and no profile export schema bump.
  - API: Adds validators and assert wrappers for `CaptureSourcesResponse`, `CaptureStartRequest`, `OcrTestRequest`, and `OcrResult`, including controlled OCR rejection reasons from `src/core/ocr-text.js` and entry-level unknown-field rejection for `CaptureSource`.
  - UI: Capture Setup and OCR Preview can map one canonical field-error shape for missing profile id, invalid ROI, invalid source entries, OCR engine result failures, and controlled rejection reasons without parsing raw OCR text.
- Risk: Concrete Windows monitor/window enumeration and PaddleOCR integration still land in later T-008 slices. These validators intentionally reject unknown fields now so later adapters cannot leak screenshots, provider keys, raw OCR text, or debug payloads by accident.
- Regression tests added first: `test/contracts.test.js` covers valid monitor/window source responses, capture-source unknown-field rejection, capture start request shape, OCR test request ROI overrides, accepted/rejected OCR results, malformed OCR results, controlled rejection reason vocabulary, and no secret/raw OCR sentinel leakage from validation errors.
- Migration needed: None.
- Rollback plan: Revert the capture/OCR validators, focused tests, and spec/decision entries. Existing profile/config/server contracts remain unchanged.

### CHG-20260528-019
- Date: 2026-05-28
- Summary: Wired the capture source enumeration endpoint for T-008-002.
- Reason: Capture Setup and First-Run need a stable live HTTP route for monitor/window choices before capture start, ROI preview, and OCR test endpoints are wired. The repo still avoids native desktop dependencies in core slices, so concrete Windows enumeration remains behind an injected adapter.
- Impact scope (DB/API/UI):
  - DB: No schema change. The route is process-local and does not persist source lists, window titles, screenshots, OCR text, provider keys, logs, or diagnostics.
  - API: Adds `GET /api/capture/sources` to `createLocalApiServer` using `captureSourceProvider.enumerateCaptureSources()`. Responses are validated with `assertCaptureSourcesResponse`; missing provider methods, provider failures, and invalid provider output map to privacy-safe `CAPTURE_ENUM_FAILED`; unsupported methods return `METHOD_NOT_ALLOWED`.
  - UI: First-Run and Capture Setup can fetch a validated list of monitor/window entries and handle one canonical failure code without parsing raw provider exceptions.
- Risk: This is the HTTP contract and adapter seam only. The future Electron/Windows provider must preserve the same response shape, no-leak errors, and no-persistence behavior when it calls actual desktop capture APIs.
- Regression tests added first: `test/local-api-server.test.js` covers successful async enumeration, 405 method guard, missing-provider failure, thrown provider failure redaction, and invalid provider output redaction.
- Migration needed: None.
- Rollback plan: Remove the capture route, injected provider handling, focused tests, and spec entries. Existing status/config/profile routes remain unchanged.

### CHG-20260528-020
- Date: 2026-05-28
- Summary: Wired the manual OCR test endpoint for T-008-003.
- Reason: Capture Setup and OCR Preview need a live route that exercises one OCR pass against the selected profile/ROI before continuous capture start is available. The core contract must stay dependency-free while the future Electron/Windows/PaddleOCR adapter owns real screenshot capture and recognition.
- Impact scope (DB/API/UI):
  - DB: No schema change. The route reads profile configuration through the existing repository boundary and does not persist OCR text, screenshots, captured images, source-list cache, provider keys, logs, or diagnostics.
  - API: Adds `POST /api/ocr/test` to `createLocalApiServer` using `profileRepository.getProfile(profileId)` and `ocrTestProvider.runOcrTest({ profile, roi })`. Requests are validated with `assertOcrTestRequest`; ROI falls back from request override to saved profile ROI; missing ROI returns `ROI_MISSING`; engine failures and invalid engine output map to privacy-safe `OCR_ENGINE_ERROR`; responses are validated with `assertOcrResult`.
  - UI: First-Run, Capture Setup, and OCR Preview can run a one-shot OCR check, show controlled rejection reasons/confidence, and handle missing ROI or engine failure without parsing raw provider exceptions.
- Risk: This is the HTTP contract and OCR adapter seam only. The future concrete OCR provider must preserve the same request/result shape, no-persistence defaults, and redacted error behavior when it performs real capture/crop/OCR.
- Regression tests added first: `test/local-api-server.test.js` covers successful ROI override and profile ROI fallback, method/request validation, profile not found, ROI missing, missing provider, thrown/non-Error provider failures, invalid provider output redaction, result sanitization, and CORS inheritance.
- Migration needed: None.
- Rollback plan: Remove the OCR test route, injected provider handling, focused tests, and spec entries. Existing capture source and profile/config routes remain unchanged.

### CHG-20260528-021
- Date: 2026-05-28
- Summary: Wired capture start/stop runtime status for T-008-004.
- Reason: Home/Status, First-Run, and Capture Setup need a stable route surface for starting and stopping the capture loop before concrete Windows desktop capture is integrated. The core contract must prove profile/source validation, status updates, and no-leak behavior without native dependencies.
- Impact scope (DB/API/UI):
  - DB: No schema change. The routes read profile configuration through the existing repository boundary and keep capture session state in memory only.
  - API: Adds `POST /api/capture/start` and `POST /api/capture/stop` to `createLocalApiServer` using `profileRepository.getProfile(profileId)` and `captureController.startCapture/stopCapture`. Start validates `CaptureStartRequest`, requires a valid saved `captureSource`, serializes concurrent start/stop requests, maps already-running start to `CAPTURE_ALREADY_RUNNING`, maps missing source to `CAPTURE_SOURCE_MISSING`, maps missing/generic controller failures to privacy-safe `CAPTURE_FAILED`, preserves retryable `CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE`, and updates/broadcasts sanitized capture `RuntimeStatus`.
  - UI: Home/Status and Capture Setup can show running/idle/error capture state and retryable source-disappeared failures from `/api/status` or `/ws/app` without parsing raw controller exceptions.
- Risk: This is the HTTP contract and runtime-status seam only. The future concrete capture controller must preserve the same request/result shape, in-memory defaults, redacted errors, and status publication when it performs real Windows monitor/window capture.
- Regression tests added first: `test/local-api-server.test.js` covers start/stop success, `/api/status` and `/ws/app` updates, fixed success envelopes, request validation before calls, repository/source/controller failure mapping and redaction, stop-not-running, concurrent start/stop serialization, stop failure recovery/resync behavior, method guards, and CORS preflight behavior.
- Migration needed: None.
- Rollback plan: Remove the capture start/stop routes, injected controller handling, focused tests, and spec entries. Existing source enumeration, OCR test, profile/config, and status routes remain unchanged.

### CHG-20260528-022
- Date: 2026-05-28
- Summary: Added the T-008 capture/OCR API smoke command and parent-closeout runbook.
- Reason: The capture/OCR API parent needs one reproducible live-HTTP smoke that proves the combined route surface works with injected capture and OCR adapters, rather than relying only on focused unit tests.
- Impact scope (DB/API/UI):
  - DB: No schema change. The smoke uses injected adapters and keeps capture session/status in memory only.
  - API: Adds `npm run smoke:capture-ocr`, `scripts/smoke-capture-ocr-api.js`, and `test/capture-ocr-api-smoke.test.js`. The smoke covers source enumeration, manual OCR success/failure, capture start/stop status, duplicate/idle conflicts, canonical errors, and redaction/no-persistence invariants.
  - UI: First-Run, Capture Setup, OCR Preview, and Home/Status gain parent-closeout evidence that their backing local capture/OCR routes are available as one coherent API.
- Risk: This remains a dependency-free contract smoke over injected adapters, not a Windows desktop-capture or PaddleOCR smoke. Real-adapter smoke should be added when those adapters land.
- Regression tests added first: `test/capture-ocr-api-smoke.test.js` executes the smoke script as a child process and asserts the JSON evidence shape plus no provider key/source/screenshot sentinel in stdout.
- Migration needed: None.
- Rollback plan: Remove `npm run smoke:capture-ocr`, the smoke script, runbook, focused smoke test, and spec/decision entries. Existing capture/OCR route behavior remains covered by unit tests.

### CHG-20260528-023
- Date: 2026-05-28
- Summary: Started T-009 with translation test API contract validation.
- Reason: First-Run and Translation Settings need a stable `/api/translate/test` request/result contract before provider-backed route wiring lands.
- Impact scope (DB/API/UI):
  - DB: No schema change. The slice is a pure validator/docs/test boundary and introduces no translation cache rows, key storage movement, OCR/translation text persistence, or profile export schema bump.
  - API: Adds validators and assert wrappers for `TranslateTestRequest` and `TranslationResult`, including provider vocabulary, non-negative duration, cache-hit typing, unknown-field rejection, and value-free field errors.
  - UI: First-Run and Translation Settings can map one canonical field-error shape for missing profile id, empty test text, malformed provider output, invalid provider ids, and timing/cache shape failures without parsing provider exception text.
- Risk: `/api/translate/test` is not wired in this slice. T-009-002 must use these validators at the route boundary and preserve provider-key redaction.
- Regression tests added first: `test/contracts.test.js` covers valid request/result shapes, unknown-field rejection, invalid provider/duration/cache fields, and no secret/raw text leakage from validation errors.
- Migration needed: None.
- Rollback plan: Revert the translation test validators, focused tests, and spec/decision entries. Existing capture/OCR/config/server contracts remain unchanged.

### CHG-20260528-024
- Date: 2026-05-28
- Summary: Wired T-009-002 `POST /api/translate/test` endpoint through an injected translation provider seam with privacy-safe error mapping.
- Reason: First-Run and Translation Settings need a live `/api/translate/test` route that runs the configured provider against user-supplied test text while preserving the T-009-001 validation boundary and canonical ApiError shapes.
- Impact scope (DB/API/UI):
  - DB: No schema change. The route is stateless and does not persist supplied text, translated text, glossary entries, cache entries, provider keys, or diagnostics.
  - API: Adds `translateTestProvider.runTranslateTest({ profile, input })` to `createLocalApiServer`, wires `POST /api/translate/test`, applies `assertTranslateTestRequest`/`assertTranslationResult` at the boundary, requires provider output to match the loaded profile's `translationProvider`, derives `input` through `prepareTranslationInput`, maps recognized provider `ContractError` codes to canonical privacy-safe `ApiError` codes with `retryable` driven by `providerErrorRetryable`, preserves `PROFILE_NOT_FOUND`/`DB_UNAVAILABLE`, and matches `/api/ocr/test` method/CORS behavior.
  - UI: First-Run and Translation Settings can render translation test results plus actionable retryable/non-retryable provider errors without parsing provider exception text.
- Risk: Runtime translation-status broadcast is intentionally out of scope; T-009-003 must add `/api/status` and `/ws/app` updates without changing this route's response shape. Concrete provider adapters must continue to throw `ContractError` with the documented vocabulary so the mapping stays exhaustive.
- Regression tests added first: `test/local-api-server.test.js` adds focused tests for happy-path translation, request validation, profile-lookup error propagation, provider failure mapping (key-missing, rate-limited, network), redaction, invalid provider output, missing provider, method/CORS behavior, and serialization to canonical `TranslationResult` fields.
- Migration needed: None.
- Rollback plan: Revert the `/api/translate/test` route, `translateTestProvider` option, status mapping additions, focused tests, and spec/decision entries. The T-009-001 validation boundary remains intact.

### CHG-20260528-025
- Date: 2026-05-28
- Summary: Wired T-009-003 translation runtime status broadcast into `createLocalApiServer` so `/api/translate/test` activity is reflected by `GET /api/status` and `/ws/app` without changing the route response shape.
- Reason: Home/Status, First-Run, and Translation Settings need a live signal for `running`, `ok`, and `error` translate-test transitions, and T-009-002 explicitly deferred the runtime status broadcast while locking the `TranslationResult` response shape and `ApiError` mapping.
- Impact scope (DB/API/UI):
  - DB: No schema change. The translation runtime status is in-memory only; no supplied text, translated text, glossary entries, cache entries, provider keys, or diagnostics are persisted.
  - API: Adds an in-memory `translationRuntimeStatus` override inside `createLocalApiServer` alongside the existing capture override, merges it through `buildAppStatus`, and publishes via the existing `appStatusWebSocket`. Valid translate-test attempts publish `running` (`code: "TRANSLATE_TEST_RUNNING"`) before provider work, `ok` (`code: "TRANSLATE_TEST_OK"`) on success, and `error` on provider/input/result/profile failures. Provider-vocabulary errors (provider invocation, input-prep `PROVIDER_UNKNOWN`/`TARGET_LANG_INVALID`, missing-provider) use `providerErrorToRuntimeStatus`; profile/DB/validation/provider-response failures use a redacted fallback whose `retryable` is derived from `providerErrorRetryable`/`RETRYABLE_API_ERROR_CODES`. The `/api/translate/test` response shape and HTTP status mapping are unchanged.
  - UI: Status surfaces can render live translation transitions without polling `/api/translate/test` and without parsing provider exception text.
- Risk: Existing clients that already trusted the `translation` field of `AppStatus` now observe `TRANSLATE_TEST_RUNNING`/`TRANSLATE_TEST_OK` codes during test runs. Concrete provider adapters must continue to throw `ContractError` with the documented provider vocabulary so the broadcast classification stays exhaustive. The parent-closeout smoke for `/api/translate/test` remains T-009-004.
- Regression tests added first: `test/local-api-server.test.js` adds focused tests for `/api/status` and `/ws/app` running→ok broadcast on success, `/api/status` and `/ws/app` running→error broadcast on provider failure with redacted code/message, and a no-status-change assertion for malformed body, `OPTIONS` preflight, and disallowed HTTP method on `/api/translate/test`.
- Migration needed: None.
- Rollback plan: Revert the translation runtime status override, `runManualTranslateTest` publish/error paths, focused tests, and spec/decision entries. The T-009-002 route response shape, validators, and provider error mapping remain intact.

### CHG-20260528-026
- Date: 2026-05-28
- Summary: Added the T-009 translation API smoke command and parent-closeout runbook.
- Reason: The translation test API parent needs one reproducible live HTTP/WebSocket smoke that proves `/api/translate/test`, provider input preparation, `/api/status`, `/ws/app`, and privacy invariants work together with injected adapters.
- Impact scope (DB/API/UI):
  - DB: No schema change. The smoke uses injected profile/provider dependencies, an ephemeral localhost port, and in-memory runtime status only.
  - API: Adds `npm run smoke:translation`, `scripts/smoke-translation-api.js`, `test/translation-api-smoke.test.js`, and `TRANSLATION_API_SMOKE_RUNBOOK_JA.md`. The smoke covers preflight/method/malformed no-mutation behavior, translation success, glossary/cache-prepared input, provider failure retryability, status broadcasts, and redaction/no-persistence invariants.
  - UI: First-Run, Translation Settings, and Home/Status gain parent-closeout evidence that their backing translation test route and status stream are available as one coherent API.
- Risk: This remains a dependency-free contract smoke over injected adapters, not a real DeepL or Windows/Electron/FastAPI smoke. Real-adapter smoke should be added when those adapters land.
- Regression tests added first: `test/translation-api-smoke.test.js` executes the smoke script as a child process and asserts the JSON evidence shape plus no provider key/source/translated/glossary/cache sentinel in stdout.
- Migration needed: None.
- Rollback plan: Remove `npm run smoke:translation`, the smoke script, runbook, focused smoke test, and spec/decision entries. Existing translation route behavior remains covered by unit tests.

### CHG-20260528-027
- Date: 2026-05-28
- Summary: Started T-010 with diagnostics bundle contract validation and redaction fixtures.
- Reason: Logs/Diagnostics needs a copyable redacted bundle, and the product privacy acceptance requires diagnostics to exclude provider keys, OCR/source text, translated text, screenshots/images, stack traces, and raw debug/provider payloads by default.
- Impact scope (DB/API/UI):
  - DB: No schema change. This slice introduces no durable log store, screenshot/image read path, plaintext key access, profile export schema change, or cache persistence.
  - API: Adds executable diagnostics bundle construction/redaction helpers and `validateDiagnosticBundle`/`assertDiagnosticBundle`. String and structured log inputs are redacted before output and normalized to the canonical `DiagnosticBundle` shape.
  - UI: Logs/Diagnostics can rely on a fixed bundle shape and redaction summary before the HTTP route is wired.
- Risk: This is the contract/redaction boundary only. T-010-002 must call it from `GET /api/diagnostics/bundle`, and concrete log sources must avoid feeding full game text by default even though this contract redacts defensive sentinel fields.
- Regression tests added first: `test/contracts.test.js` covers string/structured diagnostics redaction, fixed redaction summary, bundle construction, validator acceptance, malformed bundle rejection, and value-free validation errors.
- Migration needed: None.
- Rollback plan: Remove the diagnostics bundle helpers, validators, focused tests, and spec/decision entries. Existing status/config/capture/translation routes remain unchanged.

### CHG-20260528-028
- Date: 2026-05-28
- Summary: Wired T-010-002 `GET /api/diagnostics/bundle` through the localhost API with an optional diagnostics provider seam.
- Reason: Logs/Diagnostics needs a live copy-bundle endpoint before the UI and concrete Electron/FastAPI log collection adapters land, while preserving the T-010-001 redaction and validation boundary.
- Impact scope (DB/API/UI):
  - DB: No schema change. Bundle generation is on-demand and in-memory; this slice adds no durable log store, screenshot/image reads, key storage movement, cache persistence, or profile export schema change.
  - API: Adds `diagnosticsProvider.collectDiagnostics()` to `createLocalApiServer` and wires `GET /api/diagnostics/bundle`. The route accepts provider log arrays or `{ logLines, appVersion?, backendVersion?, os?, activeProfileId? }`, applies safe defaults, calls `buildDiagnosticBundle`, validates with `assertDiagnosticBundle`, and maps provider/shape failures to privacy-safe `DIAGNOSTICS_FAILED`.
  - UI: Logs/Diagnostics gains a stable HTTP route for copyable redacted bundles; clean runtimes with no provider return an empty-log bundle rather than a setup-blocking error.
- Risk: This is still dependency-free route wiring over injected diagnostics sources. T-010-003 must add a repeatable live smoke/runbook, and concrete runtime log collectors must avoid collecting full game text by default even though the bundle route redacts known sensitive fields.
- Regression tests added first: `test/local-api-server.test.js` covers no-provider minimal bundle, provider metadata/log redaction, method/CORS behavior, provider failure redaction, invalid provider shape mapping, and bundle validator enforcement.
- Migration needed: None.
- Rollback plan: Remove the diagnostics route, injected provider handling, focused tests, and spec/decision entries. Existing status/config/capture/translation routes remain unchanged.

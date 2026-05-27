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

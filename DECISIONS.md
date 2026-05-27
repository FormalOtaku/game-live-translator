# DECISIONS

## Record Rule
- Keep one entry per decision.
- Include context, options, chosen option, and follow-up.

## Template
### DEC-000
- Date:
- Context:
- Options:
- Decision:
- Consequences:
- Follow-up:

## Entries
### DEC-001
- Date: 2026-05-27
- Context: Kickoff docs define Game Live Translator as a streamer-facing OBS overlay for Japanese-to-English game screen translation. The initial product/API/UI specs were placeholders and could not safely guide implementation.
- Options: keep placeholder specs and implement opportunistically; copy the full temporary docs wholesale; distill the kickoff docs into authoritative repo specs and use those as implementation contracts.
- Decision: Distill the kickoff docs into `PRODUCT_SPEC.md`, `UI_SPEC.md`, and `API_SPEC.md` as the authoritative v1 core contracts before implementation.
- Consequences: Implementation slices must satisfy the narrowed Windows + OBS + Japanese-to-English scope, privacy invariants, localhost-only API, and no-game-modification boundaries. Future scope changes require decision and migration notes.
- Follow-up: T-003 should add regression tests for the highest-risk contracts before feature code expands: localhost-only bind, secret redaction, safe profile export, and overlay escaping.

### DEC-002
- Date: 2026-05-27
- Context: T-005-001 adds duplicate suppression for high-frequency OCR candidates. The suppressor needs a stable identity for each candidate, but raw OCR text may contain game dialogue and must not become an accidental diagnostic or persistence surface.
- Options: store normalized OCR text directly; store truncated text previews; store only SHA-256 hashes of normalized OCR text with timestamps.
- Decision: Store only SHA-256 hashes of normalized OCR text plus `firstSeenAt` timestamps in `DuplicateSuppressor`.
- Consequences: Duplicate detection remains deterministic while suppressor snapshots and entries are safe to inspect in tests or diagnostics without revealing game text. Debugging exact duplicate content requires re-running OCR with explicit user-visible debug settings rather than weakening the default privacy posture.
- Follow-up: When live capture and `/api/ocr/test` are wired up, they must route candidates through `processOcrCandidate` and avoid persisting the suppressor state.

### DEC-003
- Date: 2026-05-27
- Context: T-005-002 introduces glossary substitution and translation cache keying. Cache keys must distinguish provider, target language, source text, and glossary revision, but keys can leak game text if built from raw strings.
- Options: include normalized source text directly in the key; include glossary-applied text in the key; include only SHA-256 hashes and controlled identifiers.
- Decision: Translation cache keys use only controlled identifiers and hashes: `v1:<provider>:<targetLang>:<glossaryRevision>:<sourceTextHash>`. `sourceTextHash` is SHA-256 over normalized source text, and `glossaryRevision` is SHA-256 over canonical source/target glossary pairs sorted by deterministic JavaScript UTF-16 code unit order.
- Consequences: Cache lookup remains deterministic across process restarts and host locales once SQLite cache storage exists, while logs and diagnostics can include cache keys without exposing raw OCR text or glossary replacements. Glossary term ids and notes are intentionally excluded from the revision because they do not affect translated text.
- Follow-up: T-005-003 provider adapters and later persistence slices must treat this key as the only translation-cache identity and must not add plaintext source text to cache keys.

### DEC-004
- Date: 2026-05-27
- Context: T-005-003 introduces translation provider adapters. The DeepL adapter needs network access and a real API key in production, but unit tests, CI, and devcontainer runs must not require secrets or upstream availability. Provider failure surfaces must also map cleanly onto the documented `ApiError` codes without leaking provider responses or API keys.
- Options: have adapters import a global `fetch` and key store directly and stub them via global mocks; build a thin HTTP client wrapper that adapters reach for; require callers to inject a `fetch`-like client and an `apiKeyResolver` into each adapter factory.
- Decision: Provider adapters in `src/core/translation-providers.js` accept injected `fetchClient` and `apiKeyResolver` factories, plus an optional `clock` for deterministic `durationMs`. The DeepL adapter performs no network call until `apiKeyResolver` returns a non-empty string. Provider failures map to a fixed `ContractError` code set: `PROVIDER_KEY_MISSING`, `PROVIDER_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`, `PROVIDER_NETWORK_ERROR`, `PROVIDER_RESPONSE_INVALID`, `PROVIDER_UNKNOWN`, plus `TARGET_LANG_INVALID` raised before any provider call. Only `PROVIDER_RATE_LIMITED` and `PROVIDER_NETWORK_ERROR` are retryable.
- Consequences: Adapter tests run offline, deterministically, and without secrets, and the same adapter interface plugs into the future FastAPI `/api/translate/test` and runtime translation pipeline. Error mapping is centralized so the API layer can render `ApiError.retryable` without inspecting provider response text. The injected key resolver keeps DeepL keys in OS secure storage and prevents the adapter from logging or returning the key under any failure mode.
- Follow-up: When the FastAPI surface lands, wire `apiKeyResolver` to OS secure storage and pass the runtime `fetch` implementation; ensure callers never log full adapter errors without `redactSecrets`. Translation cache integration must populate `cacheHit` only at the cache layer, not inside adapters.

### DEC-005
- Date: 2026-05-27
- Context: T-005-004 introduces subtitle frames and overlay state for OBS Browser Source. Overlay text must render safely as text, not HTML, while the runtime still needs a reconnect-safe latest frame for `/ws/overlay`.
- Options: let the overlay escape at render time only; store both raw translated text and pre-escaped overlay text in the frame; store only escaped text and drop the raw translation.
- Decision: Subtitle frames keep the normalized `translatedText` for runtime contracts and also include `escapedText` generated by the shared HTML escaping helper. The overlay DOM must render `escapedText`, and source text is omitted unless debug code explicitly opts in with `includeSourceText`.
- Consequences: WebSocket reconnect can replay a complete, frozen frame without relying on browser-side escaping behavior, while app/status code still has access to normalized translated text. Frames remain in-memory runtime state in this slice and must not be written to SQLite, logs, diagnostics, or profile exports by default.
- Follow-up: T-005-005 should route the OCR -> glossary -> provider pipeline into `createSubtitleFrame` and `OverlayState.publishFrame`, and overlay rendering tests must assert that malicious subtitle payloads appear as escaped text.

### DEC-006
- Date: 2026-05-28
- Context: T-005-005 connects OCR filtering, glossary/cache keying, provider adapters, subtitle frame creation, and overlay state publication. The runtime needs enough in-process detail for Home/Status and debug UI, while default privacy rules still prohibit persisted or replayed source text.
- Options: return only the final subtitle frame; return a full in-process pipeline result and rely on downstream persistence/logging filters; return a split result with in-process OCR/translation metadata plus a privacy-sanitized overlay snapshot.
- Decision: `runOcrToOverlayPipeline` returns a full frozen in-process result for immediate runtime/UI use, including OCR evaluation, translation preparation, cache key, provider result, subtitle frame, and overlay snapshot. The overlay snapshot remains privacy-sanitized by `OverlayState.publishFrame`, and persistence/log/diagnostic surfaces must continue to omit raw/source text by default.
- Consequences: Tests can verify the complete deterministic path without network, secrets, persistence, or OBS. UI code gets one canonical status source instead of re-deriving OCR and translation states. The pipeline result must be treated as volatile runtime state, not as a durable diagnostic payload.
- Follow-up: API/WebSocket slices should expose only the sanitized subset appropriate for each endpoint, and diagnostics must include `cacheKey`/status codes rather than raw OCR or translated text unless an explicit debug export policy is added.

### DEC-007
- Date: 2026-05-28
- Context: T-006 needs to expose the completed runtime pipeline through a localhost API, but the current repository is a Node core harness while the product target is an Electron app with a Python FastAPI sidecar.
- Options: add a Python FastAPI sidecar immediately; build only pure contract helpers and defer all serving behavior; add a dependency-free Node localhost server core that exercises the same wire contract and can later be wrapped or ported.
- Decision: Implement a dependency-free Node localhost server core for T-006 as the executable contract harness. It must enforce `127.0.0.1` before listen, report the selected local port, emit canonical `ApiError` envelopes, avoid wildcard CORS, and expose only privacy-safe status payloads.
- Consequences: The project gains deterministic API/overlay server tests without adding framework dependencies or secrets, while preserving the documented FastAPI production target. Any later Python sidecar must keep the same `/health`, `/api/status`, bind, CORS, and error semantics.
- Follow-up: T-006-002/T-006-003 should add the actual OBS overlay HTML and WebSocket replay/broadcast behavior on top of this local server boundary.

### DEC-008
- Date: 2026-05-28
- Context: T-006-002 adds the OBS Browser Source HTML shell. The overlay must show subtitles clearly while treating all runtime text as untrusted and preserving the privacy rule that raw OCR/source text is not exposed by default.
- Options: render raw translated text with `textContent`; render pre-escaped `escapedText` with `innerHTML`; render only sanitized `escapedText` and fall back to `textContent` if a future payload contains raw angle brackets.
- Decision: The overlay shell renders only sanitized `SubtitleFrame.escapedText`. Server-side initial rendering sanitizes frames before insertion. Browser runtime ignores `sourceText` and `translatedText`, and uses a bracket guard so malformed future payloads with raw `<` or `>` are displayed with `textContent` instead of becoming DOM nodes.
- Consequences: Malicious payloads render as broadcast text instead of executable HTML, while existing pre-escaped subtitle frames still display readable characters. The HTML is self-contained with transparent background and no remote assets, keeping OBS setup simple and privacy-safe.
- Follow-up: T-006-003 must feed `/ws/overlay` with the same sanitized frame contract and keep reconnect/replay behavior aligned with this renderer.

### DEC-009
- Date: 2026-05-28
- Context: T-006-003 needs live OBS subtitle delivery, reconnect replay, and overlay client counters while the repository is still a dependency-free Node contract harness.
- Options: add a third-party WebSocket dependency; wait for the future Python FastAPI sidecar; implement the small RFC 6455 subset needed for OBS Browser Source clients inside the local server core.
- Decision: Implement a narrow dependency-free `/ws/overlay` helper that handles valid version 13 upgrades, configured/local origin gating, masked client text frames, ping/pong, close, latest-frame replay, `OverlayState.publishFrame()` broadcast, and `clearFrame()` broadcast.
- Consequences: The v1 contract becomes executable and testable without adding package surface area. Protocol support is intentionally limited to the OBS/browser behavior needed by this product; binary, fragmented, compressed, oversized-control-frame, or remote WebSocket modes are out of scope until a later documented slice.
- Follow-up: T-006-004 should add the app-facing status stream semantics without mixing UI status events into the overlay subtitle stream.

### DEC-010
- Date: 2026-05-28
- Context: T-006-004 needs an app-facing status stream that Home/Status can subscribe to without polling `/api/status`, and the UI/API layers need to map provider `ContractError` codes onto `RuntimeStatus.state/code/message/retryable` and `ApiError.retryable` without parsing message text. The repository is still a dependency-free Node contract harness, and the existing overlay WebSocket helper already covers OBS subtitle delivery.
- Options: (a) reuse `/ws/overlay` for both subtitle frames and `AppStatus` snapshots; (b) add a parallel framework dependency (e.g. `ws`) just for `/ws/app`; (c) keep dependency-free and add a separate `/ws/app` endpoint sharing the existing RFC 6455 client-frame plumbing, plus a `providerErrorToRuntimeStatus` helper that maps codes deterministically.
- Decision: Add a separate `/ws/app` endpoint via a shared `createWebSocketClientHub` primitive in `src/server/overlay-websocket.js` and route both `/ws/overlay` and `/ws/app` through a single upgrade dispatcher in `createLocalApiServer`. `/ws/app` sends a sanitized `AppStatus` snapshot on connect, broadcasts on `OverlayState` subscribe events, and re-broadcasts when callers invoke `publishStatus()` after updating runtime status. Provider error mapping lives in `src/core/translation-providers.js` (`providerErrorToRuntimeStatus`, `providerErrorRetryable`) so the API layer can derive `RuntimeStatus` and `ApiError.retryable` purely from `error.code`.
- Consequences: The overlay subtitle stream and the app status stream remain semantically separate so neither leaks payloads into the other; both share the same bounded client-frame rules, masked-text handling, ping/pong, origin policy, and `WS_REJECTED` semantics. The single upgrade dispatcher prevents the "two listeners both rejecting the other's path" race that earlier multi-endpoint attaches produced. Runtime error mapping is centralized so future provider codes only need to extend `PROVIDER_ERROR_CODES` and `RETRYABLE_PROVIDER_ERROR_CODES`.
- Follow-up: When the FastAPI sidecar lands, port `/ws/app` and `/ws/overlay` together to keep their bind/origin/redaction semantics aligned, and reuse `providerErrorToRuntimeStatus` (or a Python equivalent) so retryability is identical across both implementations.

### DEC-011
- Date: 2026-05-28
- Context: T-006 closeout needs stronger evidence than unit-level endpoint tests alone. The parent task combines localhost bind, HTTP status, OBS overlay HTML, overlay WebSocket replay/broadcast, app status WebSocket broadcasts, and privacy invariants.
- Options: rely on `npm test` only; keep a manual checklist only; add a dependency-free smoke command that starts the server and talks to it over real HTTP/WebSocket sockets.
- Decision: Add `npm run smoke:server` and protect it with `test/server-smoke.test.js`. The smoke starts `createLocalApiServer` on an ephemeral `127.0.0.1` port, verifies the live HTTP/WS contract, and prints concise JSON evidence without raw source text, provider-key shaped strings, screenshots, or remote hosts.
- Consequences: Parent closeout can be reproduced locally and in the devcontainer/Docker workflow without OBS or provider credentials. Future FastAPI ports must keep the same observable smoke behavior or update the smoke/runbook and specs in the same slice.
- Follow-up: When the Electron UI and Python sidecar replace the Node contract harness, either port this smoke to the sidecar entrypoint or keep it as the contract fixture and add a second product-level Windows/OBS smoke.

### DEC-012
- Date: 2026-05-28
- Context: T-007-001 starts the persistence/API slice for profiles, themes, glossary, privacy settings, and provider keys. The previous slices only had partial scalar validators (`captureHz`, `targetLang`, provider, ROI, OCR confidence floor, forbidden export fields). Before SQLite tables, HTTP routes, and OS secure storage are wired, the request envelopes (`ProfileCreateRequest`, `ProfileUpdateRequest`, `ProfileExport`, `PrivacySettings`, and `ProviderKey` write requests) need one executable contract so privacy and shape rules cannot drift between the API layer and the persistence layer.
- Options: (a) inline the request validation inside each future HTTP handler/persistence call site; (b) introduce a third-party schema library (e.g. `zod`, `ajv`) to bring runtime validation and TypeScript-style schema declarations; (c) extend the existing dependency-free `src/contracts/validation.js` / `security.js` modules with focused request validators that all emit the canonical `VALIDATION_ERROR` envelope and reuse the existing forbidden-field/redaction helpers.
- Decision: Extend `src/contracts/validation.js` with `validateProfileCreateRequest`, `validateProfileUpdateRequest`, `validateProfileExport`, `validatePrivacySettings`, and `validateProviderKeyWriteRequest` (plus `assert*` wrappers), and add `DEFAULT_PRIVACY_SETTINGS` to `src/contracts/security.js`. All validators stay dependency-free, share a single `PROFILE_FIELD_VALIDATORS` map between create and update flows so the two surfaces cannot drift, route every shape and privacy violation through `ContractError` with `code: "VALIDATION_ERROR"` and `details.fieldErrors`, and reuse `findForbiddenExportFields` so profile export/import cannot leak API keys, OCR text history, translated text history, screenshots, or log payloads.
- Consequences: The future SQLite persistence slice and FastAPI sidecar both consume one canonical request validator instead of re-implementing field rules; the v1 invariants (`captureHz in 0..4`, `targetLang === 'en'`, `provider in {deepl, echo}`, finite positive ROI, controlled OCR presets, controlled built-in theme ids, privacy-first defaults, write-only provider key responses) are now executable. The validators stay Node built-in test friendly and do not add npm dependencies. Unknown writable fields on `ProfileCreateRequest` and `ProfileUpdateRequest` are rejected explicitly with `UNKNOWN_PROFILE_FIELD` so callers cannot smuggle `apiKey`, OCR text history, or screenshot fields into profile mutations. Provider key body/path mismatches are rejected before secure-storage writes, and forbidden-field scanning is safe for JSON payloads plus cyclic in-process objects.
- Follow-up: T-007 persistence and HTTP handler slices must call these validators before touching SQLite, OS secure storage, or the runtime pipeline, and must keep `apiKeyWriteResponse()` as the only `PUT /api/keys/{provider}` response. Any future controlled vocabulary (additional OCR presets, additional providers, additional built-in theme ids, additional privacy fields) must be added in one place here and reflected in `API_SPEC.md` and `MIGRATION_PLAN.md` in the same slice.

### DEC-013
- Date: 2026-05-28
- Context: T-007-002 needs to introduce SQLite persistence boundaries, but the current Node 20 runtime does not provide `node:sqlite` and the repo intentionally remains dependency-free for these core contract slices. The product target still expects the concrete SQLite connection to live behind the future Python FastAPI sidecar.
- Options: add an npm SQLite dependency now; jump directly to a Python FastAPI storage implementation; define dependency-free SQL/schema statements and a repository adapter contract that receives a SQLite-like `exec/run` object.
- Decision: Define schema version 1 and the configuration repository as a dependency-free adapter boundary in `src/storage/sqlite-config-store.js`. The module exposes SQL statements, built-in seed rows, and repository methods that accept an injected database adapter, call T-007-001 validators before writes, and keep provider keys plus raw OCR/translation/image/log payloads outside SQLite.
- Consequences: Tests can lock the DB contract without native addons, network, or a Python runtime, while the future FastAPI sidecar gets an exact schema/parameter contract to preserve. Translation cache storage starts as metadata-only because default privacy forbids durable raw source or translated text payloads.
- Follow-up: T-007-003 through T-007-005 must route profile CRUD/export, theme/glossary, privacy settings, and provider-key API handlers through this boundary or its Python-equivalent port. When a concrete SQLite driver is introduced, add integration smoke coverage without changing schema version 1 semantics.

### DEC-014
- Date: 2026-05-28
- Context: T-007-003 must make profiles usable through both the SQLite repository boundary and the localhost API contract without introducing the production SQLite driver or weakening privacy rules. The previous slice could create profiles but had no read/update/delete, active profile persistence, or export route.
- Options: keep CRUD only in the future Python sidecar; add HTTP-only in-memory stubs; extend the dependency-free repository boundary and local API harness now with the final route/error/export contracts.
- Decision: Extend `createSqliteConfigRepository` with profile read/update/delete, active profile metadata, and `ProfileExport` construction while keeping provider keys and game text out of SQLite. Wire `createLocalApiServer(..., { profileRepository })` to the same repository contract for `GET/POST /api/profiles`, `GET/PUT/DELETE /api/profiles/{id}`, `PUT /api/profiles/active`, and `GET /api/profiles/{id}/export`.
- Consequences: The Electron UI and future FastAPI port get one executable contract for profile management. `VALIDATION_ERROR.details.fieldErrors` remains visible to forms, `PROFILE_NOT_FOUND` maps to 404, deleting the active profile maps to 409, and export responses are revalidated before return so forbidden fields cannot leak through route code.
- Follow-up: T-007-004/T-007-005 should continue using this repository style for themes/glossary/privacy/provider-key routes, and the first concrete SQLite driver integration must cover `get/all/run/exec` adapter behavior without changing schema version 1.

### DEC-015
- Date: 2026-05-28
- Context: T-007-004 adds the configuration surfaces that the Overlay Theme Editor and Glossary screen depend on. Built-in themes must remain templates, custom themes must not break existing profiles, and glossary import must not partially corrupt a working profile.
- Options: allow partial glossary imports with rejected row reporting; make import all-or-nothing; defer CSV and only accept JSON; make built-in theme update/delete checks UI-only.
- Decision: Implement theme CRUD and glossary import/export in the shared dependency-free repository/API contract. Built-in themes are read-only at the repository boundary, custom theme deletion checks `profile_settings` before deleting, and glossary import supports JSON plus headered CSV but is all-or-nothing: any parse, validation, duplicate-id, or duplicate-normalized-source error aborts before writes and returns canonical error details.
- Consequences: The future Electron UI can safely offer duplicate/edit/delete flows without relying on client-only guards. Glossary import is less permissive than a partial-import workflow, but it preserves streamer setups by preventing invalid rows from overwriting the current glossary. The API keeps `rejected: []` on success for forward compatibility with a future explicitly-lenient import mode.
- Follow-up: If user testing shows partial CSV import is important, add a new explicit `mode: "lenient"` contract and tests instead of changing the v1 all-or-nothing default.

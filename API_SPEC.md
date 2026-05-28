# API_SPEC

## API Scope
- Service boundary: localhost-only API served by the Python FastAPI sidecar and consumed by the Electron renderer plus OBS Browser Source overlay.
- Bind address: `127.0.0.1` only. v1 must not expose a LAN or `0.0.0.0` mode.
- Default port: `39600`; if unavailable, the backend may try sequential local ports and must report the selected port to the UI.
- Data owners:
  - Profiles, themes, glossary, translation cache, app metadata: SQLite in user app data.
  - Provider API keys: OS secure storage only.
  - Runtime subtitle state: in-memory state manager.
  - Captured images and full OCR/translation text: not persisted by default.

## Quality Bar
- Target: stable v1 contract for selected flows, not a temporary MVP API.
- Compatibility: breaking changes require a recorded decision and migration/transition plan.
- Operability: validation, errors, retryability, and timing fields are explicit.
- Privacy: no endpoint returns provider API keys or unredacted secret values.

## Authentication and Authorization
- Auth method: none for v1 because the service binds only to localhost and is not a multi-user service.
- Local origin restriction: CORS allows only the Electron renderer origin and the localhost overlay origin.
- Token/session lifetime: not applicable for v1.
- Role model: not applicable for v1.
- Security invariant: endpoint handlers must not assume remote network trust; localhost-only bind is still enforced and tested.

## Canonical Models
```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type HealthResponse = {
  ok: boolean;
  version: string;
  port: number;
  bindAddress: "127.0.0.1";
};

type AppStatus = {
  backend: "starting" | "ready" | "degraded" | "error";
  activeProfileId: string | null;
  overlayUrl: string;
  capture: RuntimeStatus;
  ocr: RuntimeStatus;
  translation: RuntimeStatus;
  overlayClients: number;
  lastSubtitle?: SubtitleFrame;
};

type RuntimeStatus = {
  state: "idle" | "running" | "ok" | "warning" | "error";
  message?: string;
  code?: string;
  retryable?: boolean;
  updatedAt: string;
};

type RoiRect = { x: number; y: number; width: number; height: number };

type Profile = {
  id: string;
  name: string;
  gameTitle?: string;
  captureSource?: CaptureSource;
  roi?: RoiRect;
  ocrPreset: string;
  ocrConfidenceFloor: number;
  captureHz: number;
  translationProvider: string;
  targetLang: string;
  overlayThemeId: string;
  glossary: GlossaryTerm[];
  createdAt: string;
  updatedAt: string;
};

type CaptureSource = {
  kind: "monitor" | "window";
  id: string;
  label: string;
  bounds?: RoiRect;
};

type GlossaryTerm = {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  note?: string;
};

type OcrRejectionReason =
  | "EMPTY_TEXT"
  | "CONFIDENCE_TOO_LOW"
  | "NOISE_TEXT"
  | "DUPLICATE_TEXT";

type OcrResult = {
  text: string;
  normalizedText: string;
  confidence: number;
  durationMs: number;
  accepted: boolean;
  rejectionReason?: OcrRejectionReason;
};

type TranslationResult = {
  sourceText: string;
  translatedText: string;
  provider: string;
  durationMs: number;
  cacheHit: boolean;
};

type TranslationCacheKey =
  `v1:${string}:${"en"}:${string}:${string}`;

type SubtitleFrame = {
  id: string;
  profileId: string;
  sourceText?: string;
  translatedText: string;
  escapedText: string;
  provider: string;
  confidence?: number;
  createdAt: string;
  displayMs: number;
  themeId: string;
};

type ProfileCreateRequest = Omit<Profile, "id" | "createdAt" | "updatedAt">;
type ProfileUpdateRequest = Partial<ProfileCreateRequest>;

type ProfileExport = {
  schemaVersion: 1;
  profile: Profile;
  exportedAt: string;
  forbiddenFieldsPolicy: "reject_api_keys_ocr_text_translation_text_images_logs";
};

type OverlayTheme = {
  id: string;
  name: string;
  builtIn: boolean;
  cssJson: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
};

type OverlayThemeCreateRequest = {
  name: string;
  baseThemeId?: string;
  cssJson?: Record<string, string | number | boolean>;
};

type OverlayThemeUpdateRequest = {
  name?: string;
  cssJson?: Record<string, string | number | boolean>;
};

type PrivacySettings = {
  saveRecentOcrText: boolean;
  recentOcrLimit: number;
  saveRecentTranslations: boolean;
  recentTranslationLimit: number;
  saveDebugScreenshots: boolean;
  debugScreenshotDirectory?: string;
  debugRetentionDays: number;
};

type DiagnosticBundle = {
  generatedAt: string;
  appVersion: string;
  backendVersion: string;
  os: string;
  activeProfileId: string | null;
  redactedLogs: string[];
  redactionSummary: {
    apiKeysRemoved: true;
    ocrTextIncluded: false;
    translatedTextIncluded: false;
    imagesIncluded: false;
  };
};
```

### Diagnostic Bundle Contract
- T-010-001 adds the executable diagnostics contract used by the future
  `GET /api/diagnostics/bundle` route. `buildDiagnosticBundle` accepts
  operational log entries from injected sources, normalizes them to
  `redactedLogs: string[]`, and returns only the `DiagnosticBundle` fields
  above.
- Diagnostic log inputs may be strings or structured objects. Structured logs
  are recursively redacted before JSON serialization; fields that can contain
  provider keys, tokens, OCR/source text, translated text, screenshots/images,
  debug payloads, or stack traces are replaced with `[REDACTED]`.
- String log inputs are passed through the same secret redactor plus serialized
  key/value redaction for sensitive field names such as `apiKey`, `sourceText`,
  `normalizedText`, `ocrText`, `translatedText`, `screenshotPath`, `imagePath`,
  `stack`, `trace`, and provider response/debug text fields.
- `validateDiagnosticBundle` and `assertDiagnosticBundle` enforce that bundles
  contain only the documented top-level fields, `redactedLogs` is an array of
  strings, and `redactionSummary` is exactly `{ apiKeysRemoved: true,
  ocrTextIncluded: false, translatedTextIncluded: false, imagesIncluded:
  false }`.
- Bundle generation is in-memory and on-demand. T-010-001 introduces no durable
  log store, no screenshot/image reads, no plaintext key access, and no SQLite
  schema changes. The route slice must call this contract before returning a
  diagnostics response.
- T-010-002 wires `GET /api/diagnostics/bundle` through this contract in
  `createLocalApiServer`. The route may use an injected
  `diagnosticsProvider.collectDiagnostics()` source that returns string or
  structured log entries, plus optional metadata, but it must call
  `buildDiagnosticBundle` and `assertDiagnosticBundle` before writing JSON.
  When no provider is installed, the route returns a valid minimal bundle with
  empty `redactedLogs` so Logs/Diagnostics remains usable in a clean runtime.
  Provider throws or invalid provider output collapse to the privacy-safe
  `DIAGNOSTICS_FAILED` `ApiError`.

## REST Endpoints
| Method | Path | Purpose | Request | Response | Error Codes |
|---|---|---|---|---|---|
| GET | `/health` | Backend health check | - | `HealthResponse` | `BACKEND_NOT_READY` |
| GET | `/overlay` | OBS Browser Source HTML | - | HTML | `OVERLAY_UNAVAILABLE` |
| GET | `/api/status` | Runtime status for UI | - | `AppStatus` | `BACKEND_NOT_READY` |
| GET | `/api/capture/sources` | Enumerate monitors/windows | - | `{ sources: CaptureSource[] }` | `CAPTURE_ENUM_FAILED` |
| POST | `/api/capture/start` | Start capture loop | `{ profileId: string }` | `{ ok: true }` | `PROFILE_NOT_FOUND`, `DB_UNAVAILABLE`, `CAPTURE_ALREADY_RUNNING`, `CAPTURE_SOURCE_MISSING`, `CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE`, `CAPTURE_FAILED` |
| POST | `/api/capture/stop` | Stop capture loop | - | `{ ok: true }` | `CAPTURE_NOT_RUNNING`, `CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE`, `CAPTURE_FAILED` |
| POST | `/api/ocr/test` | Run one OCR pass with active profile or supplied ROI | `{ profileId: string, roi?: RoiRect }` | `OcrResult` | `PROFILE_NOT_FOUND`, `ROI_MISSING`, `OCR_ENGINE_ERROR` |
| POST | `/api/translate/test` | Test provider with supplied text | `{ profileId: string, text: string }` | `TranslationResult` | `PROVIDER_KEY_MISSING`, `PROVIDER_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`, `PROVIDER_NETWORK_ERROR`, `PROVIDER_RESPONSE_INVALID`, `PROVIDER_UNKNOWN`, `TARGET_LANG_INVALID` |
| GET | `/api/profiles` | List profiles | - | `{ profiles: Profile[] }` | `DB_UNAVAILABLE` |
| POST | `/api/profiles` | Create profile | `ProfileCreateRequest` | `Profile` | `VALIDATION_ERROR`, `DB_WRITE_FAILED` |
| GET | `/api/profiles/{id}` | Get profile | - | `Profile` | `PROFILE_NOT_FOUND` |
| PUT | `/api/profiles/{id}` | Update profile | `ProfileUpdateRequest` | `Profile` | `PROFILE_NOT_FOUND`, `VALIDATION_ERROR` |
| DELETE | `/api/profiles/{id}` | Delete profile | - | `{ ok: true }` | `PROFILE_NOT_FOUND`, `CANNOT_DELETE_ACTIVE_PROFILE` |
| PUT | `/api/profiles/active` | Set active profile | `{ profileId: string }` | `{ ok: true }` | `PROFILE_NOT_FOUND` |
| POST | `/api/profiles/import` | Import profile JSON | `ProfileExport` | `Profile` | `IMPORT_SCHEMA_INVALID`, `IMPORT_CONTAINS_FORBIDDEN_FIELD` |
| GET | `/api/profiles/{id}/export` | Export profile JSON | - | `ProfileExport` | `PROFILE_NOT_FOUND` |
| GET | `/api/profiles/{id}/glossary/export` | Export glossary only | - | `{ terms: GlossaryTerm[], format: "json" }` | `PROFILE_NOT_FOUND` |
| POST | `/api/profiles/{id}/glossary/import` | Import glossary JSON/CSV | `{ format: "json" | "csv", content: string }` | `{ terms: GlossaryTerm[], rejected: object[] }` | `PROFILE_NOT_FOUND`, `GLOSSARY_IMPORT_INVALID`, `VALIDATION_ERROR` |
| GET | `/api/themes` | List themes | - | `{ themes: OverlayTheme[] }` | `DB_UNAVAILABLE` |
| POST | `/api/themes` | Create custom theme or duplicate built-in | `OverlayThemeCreateRequest` | `OverlayTheme` | `THEME_NOT_FOUND`, `VALIDATION_ERROR` |
| PUT | `/api/themes/{id}` | Update theme | `OverlayThemeUpdateRequest` | `OverlayTheme` | `THEME_NOT_FOUND`, `CANNOT_UPDATE_BUILT_IN_THEME`, `VALIDATION_ERROR` |
| DELETE | `/api/themes/{id}` | Delete custom theme | - | `{ ok: true }` | `THEME_NOT_FOUND`, `CANNOT_DELETE_BUILT_IN_THEME`, `THEME_IN_USE` |
| GET | `/api/settings/privacy` | Read privacy settings | - | `PrivacySettings` | `DB_UNAVAILABLE` |
| PUT | `/api/settings/privacy` | Update privacy settings | `PrivacySettings` | `PrivacySettings` | `VALIDATION_ERROR`, `DB_WRITE_FAILED` |
| PUT | `/api/keys/{provider}` | Save provider API key | `{ apiKey: string }` | `{ ok: true }` | `KEYCHAIN_UNAVAILABLE`, `PROVIDER_UNKNOWN`, `VALIDATION_ERROR` |
| DELETE | `/api/keys/{provider}` | Remove provider API key | - | `{ ok: true }` | `KEYCHAIN_UNAVAILABLE`, `PROVIDER_UNKNOWN` |
| GET | `/api/diagnostics/bundle` | Build redacted diagnostics | - | `DiagnosticBundle` | `DIAGNOSTICS_FAILED` |

## Localhost HTTP Server Core
- T-006 introduces a dependency-free localhost server core in `src/server/local-api-server.js` as the executable wire-contract harness for the v1 local API. The production sidecar may wrap or port this contract to Python FastAPI, but endpoint shapes, bind restrictions, error envelopes, and privacy rules must remain compatible.
- `createLocalApiServer({ bindAddress, preferredPort, maxPortAttempts, version, appVersion, backendVersion, osName, overlayState, runtimeStatus, activeProfileId, allowedOrigins, allowSamePortLocalhostOrigin, overlayWsPath, appWsPath, profileRepository, providerKeyStore, captureSourceProvider, captureController, ocrTestProvider, translateTestProvider, diagnosticsProvider })` is the T-006 through T-010 server factory. `translateTestProvider.runTranslateTest({ profile, input })` is the T-009-002 boundary; T-009-003 adds the in-memory translation runtime status override that broadcasts translate-test transitions through `/api/status` and `/ws/app` without changing the route's response shape. `diagnosticsProvider.collectDiagnostics()` is the T-010-002 boundary for process-local diagnostic log entries and optional safe metadata.
- Bind behavior:
  - `bindAddress` defaults to `127.0.0.1` and any other value, including `0.0.0.0`, `::`, LAN IPs, or hostnames, raises `NON_LOCALHOST_BIND_REJECTED` before listening.
  - `preferredPort` defaults to `39600`; when unavailable, the server may try sequential local ports up to `maxPortAttempts` and must report the selected port through `/health` and `/api/status`.
  - A port conflict after all attempts returns a canonical retryable `PORT_UNAVAILABLE` error to the caller instead of silently binding to a remote interface.
- HTTP behavior:
  - `GET /health` returns `HealthResponse` with `bindAddress: "127.0.0.1"` and the selected port.
  - `GET /overlay` returns the OBS Browser Source HTML shell generated by `src/server/overlay-renderer.js`. The response must be transparent, self-contained, no-store, free of external assets, and must not embed or render `sourceText`, raw OCR text, translated debug text, provider keys, logs, or screenshots.
  - `WS UPGRADE /ws/overlay` is the OBS subtitle stream. Non-upgrade HTTP requests to this path return a canonical `WS_REJECTED` `ApiError` instead of exposing a partial HTML or debug response.
  - `WS UPGRADE /ws/app` is the local app status stream; non-upgrade GET requests return the same canonical retryable `WS_REJECTED` `ApiError`. The endpoint is configurable through `appWsPath` and defaults to `/ws/app`.
  - `GET /api/status` returns `AppStatus`; `overlayUrl` is computed from the selected local port, `overlayClients` comes from `OverlayState.snapshot()`, and `lastSubtitle` is sanitized with no `sourceText` field by default. If the runtime-status producer fails, the endpoint still returns a redacted `AppStatus` with `backend: "error"` and `translation.code: "RUNTIME_STATUS_SOURCE_FAILED"` instead of leaking the raw exception.
  - T-007-003 adds `GET/POST /api/profiles`, `GET/PUT/DELETE /api/profiles/{id}`, `PUT /api/profiles/active`, and `GET /api/profiles/{id}/export` to the same dependency-free server core. These routes require an injected `profileRepository`, accept/return the canonical profile contracts, preserve `VALIDATION_ERROR.details.fieldErrors`, map `PROFILE_NOT_FOUND` to HTTP 404 and `CANNOT_DELETE_ACTIVE_PROFILE` to HTTP 409, and return `DB_UNAVAILABLE` if the repository dependency is absent.
  - T-007-004 adds `GET/POST /api/themes`, `GET/PUT/DELETE /api/themes/{id}`, `GET /api/profiles/{id}/glossary/export`, and `POST /api/profiles/{id}/glossary/import`. These routes use the same injected configuration repository, map `THEME_NOT_FOUND` to HTTP 404, map built-in/update/delete and in-use conflicts to HTTP 409, and map `GLOSSARY_IMPORT_INVALID` to HTTP 400 with redacted row-level details.
  - Unsupported paths and methods return `ApiError` envelopes; raw exception text, provider keys, OCR text, translated text, captured images, and debug payloads must not be included.
  - CORS must not use `*`; responses may echo only configured local Electron origins or same-port localhost overlay origins. `allowSamePortLocalhostOrigin` defaults to `true` and may be set to `false` by a future hardened deployment that wants configured origins only. Profile CRUD expands preflight methods to `GET, POST, PUT, DELETE, OPTIONS`.

## First-Run Renderer Flow Contract
- T-011-002 adds `src/ui/first-run-flow.js`, a pure renderer-side contract for the First-Run Wizard. It does not add HTTP routes and performs no fetch/persistence itself; instead it emits frozen HTTP intent descriptors that must continue to match the endpoints in this file.
- Flow/API order: product boundary and privacy acknowledgement happen before cloud-provider setup; profile draft fields are gathered with the existing `ProfileCreateRequest` vocabulary; provider readiness is established with `PUT /api/keys/{provider}` for key-requiring providers; capture source and ROI are selected; `POST /api/profiles` persists the profile; `POST /api/ocr/test` and `POST /api/translate/test` run against the returned `profileId`; `PUT /api/profiles/active` finishes setup.
- Provider key intent: `buildProviderKeySaveIntent({ provider, apiKey })` validates the body with `validateProviderKeyWriteRequest({ apiKey }, { provider })` and targets `/api/keys/{provider}`. It marks the intent `sensitive`, omits the key from JSON serialization, exposes the actual `{ apiKey }` only through `makeBody()` for immediate fetch use, and exposes `{ apiKey: "[REDACTED]" }` through `safeIntentForLog`.
- Translation test intent: `buildTranslationTestIntent({ profileId, text })` validates with `validateTranslateTestRequest`, targets `/api/translate/test`, and keeps the supplied `text` behind `makeBody()` with a redacted log-safe body. Raw test text must not appear in wizard state, log-safe descriptors, error snapshots, diagnostics, or status view models.
- Profile and activation intents: `buildProfileCreateIntent(state)` validates the generated body with `validateProfileCreateRequest` and refuses to create the profile until provider readiness, capture source, and ROI are satisfied. `buildActiveProfileIntent({ profileId })` targets `/api/profiles/active` with only `{ profileId }`.
- Result application: from API responses, first-run state records only `profileId`, `activeProfileId`, `providerKeySaved`, `ocrTestPassed`, and `translationTestPassed`; boundary/privacy/overlay copy acknowledgements are separate user-progress booleans and are required before the flow reports complete. It intentionally does not retain OCR `text`, translation `sourceText`, `translatedText`, provider responses, provider keys, stack traces, or debug payloads from API responses.
- Error handling: `sanitizeFirstRunError` accepts `ApiError` envelopes and keeps only safe `code`, redacted `message`, `retryable`, value-free `fieldErrors`, and recovery action ids. Unknown exceptions are collapsed to `UNKNOWN_ERROR`/`Action failed`.

## OBS Overlay HTML Renderer
- `renderOverlayHtml({ initialFrame?, themeId?, maxLines?, statusPath?, wsPath? })` returns a complete HTML document for `/overlay`.
- The document is optimized for OBS Browser Source:
  - `html` and `body` use transparent backgrounds, fixed full-viewport layout, no scrollbars, and `pointer-events: none`.
  - Subtitle layout is constrained to a broadcast safe area and supports 1-3 visible lines through CSS line clamping.
  - Built-in theme ids are `classic_subtitle`, `stream_box`, and `minimal`; unknown ids fall back to `classic_subtitle`.
  - The page has no remote fonts, images, scripts, stylesheets, analytics, telemetry, or third-party network dependencies.
- Rendering/privacy behavior:
  - Initial and live subtitles must be rendered only from sanitized `SubtitleFrame.escapedText`.
  - `sourceText`, raw OCR text, provider keys, logs, screenshots, and translated debug payloads must not appear in the generated HTML by default.
  - Runtime JavaScript must ignore `sourceText` and `translatedText` fields if a future stream payload includes them.
  - Malicious payloads such as `<script>`, event handler attributes, or `</script>` sequences must appear as text and must not create executable DOM nodes.
- Runtime behavior:
  - On load, the overlay fetches `/api/status` once to restore the latest sanitized subtitle snapshot.
  - It then connects to `/ws/overlay` and reconnects with bounded exponential backoff. T-006-003 implements the server WebSocket endpoint; T-006-002 locks the browser-side behavior and safety contract.
  - Frame expiry uses `displayMs` from `SubtitleFrame`; absent or invalid values fall back to the renderer default.

## WebSocket Endpoints
| Method | Path | Purpose | Client Sends | Server Sends | Error Codes |
|---|---|---|---|---|---|
| WS UPGRADE | `/ws/app` | App status stream | optional ping | `AppStatus` snapshots/events | `WS_REJECTED` |
| WS UPGRADE | `/ws/overlay` | OBS subtitle stream | optional ping | `SubtitleFrame` snapshots/events | `WS_REJECTED` |

## Server Smoke Command
- T-006-005 adds `npm run smoke:server` as the executable parent-closeout smoke for the dependency-free localhost server core.
- The smoke command starts `createLocalApiServer` on an ephemeral `127.0.0.1` port and verifies the live wire contract for `/health`, `/api/status`, `/overlay`, `/ws/app`, and `/ws/overlay`.
- The command must use real HTTP requests and raw WebSocket clients, not direct function calls, for endpoint behavior.
- Required smoke assertions:
  - `/health` reports the selected localhost port and `bindAddress: "127.0.0.1"`.
  - `/api/status` returns sanitized `AppStatus`, omits `lastSubtitle.sourceText`, and redacts provider-key shaped messages.
  - `/overlay` returns self-contained no-store OBS HTML with CSP/nosniff headers, no remote assets, and escaped subtitle text.
  - non-upgrade `/ws/app` and `/ws/overlay` return canonical retryable `WS_REJECTED` envelopes.
  - `/ws/app` sends sanitized `AppStatus` on connect and broadcasts overlay client count, subtitle publish, and clear changes.
  - `/ws/overlay` replays the latest sanitized subtitle and broadcasts subtitle publish and clear changes.
- Smoke output must be concise JSON and must not include provider keys, raw OCR/source text, translated debug text, screenshots, stack traces, or remote hosts.

## Configuration API Smoke Command
- T-007-006 adds `npm run smoke:config` as the executable parent-closeout smoke for the dependency-free profile/configuration API core.
- The smoke command starts `createLocalApiServer` on an ephemeral `127.0.0.1` port with injected `profileRepository` and `providerKeyStore` implementations and exercises the live HTTP route surface instead of calling route handlers directly.
- Required smoke assertions:
  - `/health` reports the selected localhost port and `bindAddress: "127.0.0.1"`.
  - `GET/POST /api/profiles`, `GET/PUT/DELETE /api/profiles/{id}`, `PUT /api/profiles/active`, and `GET /api/profiles/{id}/export` return canonical shapes and preserve safe export/privacy behavior.
  - `GET/POST /api/themes`, `GET/PUT/DELETE /api/themes/{id}` cover custom theme mutation plus built-in theme conflict behavior.
  - `GET /api/profiles/{id}/glossary/export` and `POST /api/profiles/{id}/glossary/import` cover glossary round trips.
  - `GET/PUT /api/settings/privacy` covers privacy read/update and `Allow: GET, PUT` for unsupported methods.
  - `PUT/DELETE /api/keys/{provider}` return only `{ ok: true }`; `GET /api/keys/{provider}` proves there is no readback endpoint; unknown providers return `PROVIDER_UNKNOWN`.
- Smoke output must be concise JSON and must not include provider keys, raw OCR/source text, translated debug text, screenshots, stack traces, or remote hosts.

## Capture/OCR API Contract Validation
- T-008-001 adds the executable contract validation boundary for the capture/OCR API surface before endpoint wiring.
- `validateCaptureSourcesResponse({ sources })` validates `GET /api/capture/sources` output. `sources` must be an array of `CaptureSource` entries; each source accepts only `kind`, `id`, `label`, and optional `bounds`; `kind` must be in `["monitor", "window"]`, `id` and `label` must be non-empty, and `bounds` must be finite and positive when present.
- `validateCaptureStartRequest({ profileId })` validates `POST /api/capture/start`; the only accepted field is a non-empty `profileId`.
- `validateOcrTestRequest({ profileId, roi? })` validates `POST /api/ocr/test`; `profileId` is required and `roi`, when supplied, must satisfy the same finite positive `RoiRect` rules used by profiles.
- `validateOcrResult(OcrResult)` validates OCR engine output before route responses or runtime status mapping. `text` and `normalizedText` must be strings, `confidence` must be finite in `[0, 1]`, `durationMs` must be finite and non-negative, `accepted` must be boolean, accepted results must omit `rejectionReason`, and rejected results must use the controlled `OCR_REJECTION_REASONS` vocabulary from `src/core/ocr-text.js`.
- Unknown fields are rejected with field-level validation errors, and validation details must not include provider keys, raw OCR text, captured images, screenshots, stack traces, logs, or translated debug payloads.

## Translation Test API Contract Validation
- T-009-001 adds the executable contract validation boundary for the translation test API surface before endpoint wiring.
- `validateTranslateTestRequest({ profileId, text })` validates `POST /api/translate/test`; `profileId` and `text` are required non-empty strings and no other request fields are accepted.
- `validateTranslationResult(TranslationResult)` validates provider output before route responses or runtime status mapping. `sourceText`, `translatedText`, and `provider` must be strings, `provider` must be in `["deepl", "echo"]`, `durationMs` must be finite and non-negative, and `cacheHit` must be boolean.
- Unknown fields are rejected with field-level validation errors, and validation details must not include provider keys, raw OCR/source text, translated debug text, screenshots, stack traces, logs, provider response bodies, or cache/debug payloads.

## Capture Source Enumeration Endpoint
- T-008-002 wires `GET /api/capture/sources` into the localhost API harness with a dependency-injected `captureSourceProvider.enumerateCaptureSources()` boundary. The provider returns `CaptureSourcesResponse` synchronously or asynchronously; the future Electron/Windows adapter owns concrete monitor/window discovery behind this interface.
- The route must call `assertCaptureSourcesResponse` before writing JSON so only `kind`, `id`, `label`, and optional `bounds` can leave the backend. Invalid provider output, missing provider methods, and thrown provider errors map to canonical `CAPTURE_ENUM_FAILED` `ApiError` responses.
- `CAPTURE_ENUM_FAILED` responses must be privacy-safe: they may include validator field names/codes for invalid provider output, but must not include provider keys, raw OCR text, captured images, screenshots, stack traces, debug logs, or raw provider exception text.
- Only `GET` is allowed on `/api/capture/sources`; other methods return `METHOD_NOT_ALLOWED` with `Allow: GET`. The endpoint preserves the existing localhost bind, CORS, no-store-free JSON, and no-persistence behavior.

## Capture Start/Stop Endpoints
- T-008-004 wires `POST /api/capture/start` and `POST /api/capture/stop` into the localhost API harness with a dependency-injected `captureController` boundary. The future Electron/Windows adapter owns the real desktop capture loop behind this interface.
- `POST /api/capture/start` validates the body with `assertCaptureStartRequest`, loads the profile through `profileRepository.getProfile(profileId)`, requires a saved valid `captureSource`, and calls `captureController.startCapture({ profile, captureSource })`. The response is always the fixed `{ ok: true }`; controller output is never serialized.
- `POST /api/capture/start` and `POST /api/capture/stop` are serialized inside the process so concurrent requests cannot double-dispatch into the controller. A start request while a capture session is already running returns `CAPTURE_ALREADY_RUNNING`.
- `POST /api/capture/stop` stops the in-process active capture session by calling `captureController.stopCapture({ profileId })`. When no capture session is running, it returns `CAPTURE_NOT_RUNNING` before calling the controller. If the controller reports `CAPTURE_NOT_RUNNING`, the API re-syncs its in-memory session to idle; generic stop failures leave the active session present so a later stop can retry. The response is always the fixed `{ ok: true }`; controller output is never serialized.
- Successful start sets the sanitized in-memory `capture` runtime status to `state: "running"` with `code: "CAPTURE_RUNNING"` and the active profile id. Successful stop sets `capture` to `state: "idle"` with `code: "CAPTURE_STOPPED"` while keeping the last active profile id visible. Both transitions are reflected by `GET /api/status` and broadcast to `/ws/app`.
- Missing/invalid saved capture source returns `CAPTURE_SOURCE_MISSING` before controller calls. Missing controller methods and generic controller failures return privacy-safe `CAPTURE_FAILED`. A controller-raised `CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE` is preserved as retryable without echoing raw exception text.
- Capture start/stop errors must not include provider keys, raw OCR text, translated text, captured images, screenshot paths, stack traces, debug logs, or raw controller exception text. The endpoints do not persist capture frames, OCR text, source-list cache, provider keys, logs, diagnostics, or runtime status.
- Only `POST` is allowed on `/api/capture/start` and `/api/capture/stop`; other methods return `METHOD_NOT_ALLOWED` with `Allow: POST`. The endpoints preserve the existing localhost bind and CORS behavior.

## Manual OCR Test Endpoint
- T-008-003 wires `POST /api/ocr/test` into the localhost API harness with a dependency-injected `ocrTestProvider.runOcrTest({ profile, roi })` boundary. The future OCR adapter owns screenshot capture, ROI crop, preprocessing, and PaddleOCR execution behind this interface.
- The route validates the request with `assertOcrTestRequest`, loads the profile through `profileRepository.getProfile(profileId)`, uses request `roi` when supplied or `profile.roi` otherwise, and returns `ROI_MISSING` when neither exists. Profile lookup preserves `PROFILE_NOT_FOUND` and `DB_UNAVAILABLE` behavior from the profile API.
- Provider output must pass `assertOcrResult` before response. Successful responses return only `text`, `normalizedText`, `confidence`, `durationMs`, `accepted`, and optional `rejectionReason`; invalid provider output, missing provider methods, and thrown provider errors map to privacy-safe `OCR_ENGINE_ERROR`.
- `OCR_ENGINE_ERROR` responses may include validator field names/codes for invalid engine output, but must not include provider keys, captured images, screenshots, stack traces, raw provider exception text, or debug logs. Raw OCR text appears only in a valid `OcrResult` response for the user's explicit manual test request and is not persisted by this route.
- Only `POST` is allowed on `/api/ocr/test`; other methods return `METHOD_NOT_ALLOWED` with `Allow: POST`. The endpoint preserves the existing localhost bind and CORS behavior.

## Translate Test Endpoint
- T-009-002 wires `POST /api/translate/test` into the localhost API harness with a dependency-injected `translateTestProvider.runTranslateTest({ profile, input })` boundary. The future provider-backed adapter owns DeepL/echo translation, key resolution, and HTTP transport behind this interface.
- The route validates the request with `assertTranslateTestRequest`, rejecting missing/empty `profileId` or `text` and any extra request field before any repository or provider call. It then loads the profile through `profileRepository.getProfile(profileId)` and prepares the translation `input` through `prepareTranslationInput({ text, glossary: profile.glossary, provider: profile.translationProvider, targetLang: profile.targetLang })`, so glossary application, cache key derivation, and provider/target-language vocabulary checks share one boundary with the runtime pipeline.
- Provider output must pass `assertTranslationResult` and its `provider` must match the loaded profile's `translationProvider` before response. Successful responses return only `sourceText`, `translatedText`, `provider`, `durationMs`, and `cacheHit` from the validated `TranslationResult`; provider response bodies, internal cache keys, glossary attribution, request payloads, and debug fields are not serialized.
- Provider failures are mapped to canonical privacy-safe `ApiError` codes with `retryable` derived from `providerErrorRetryable`. Recognized provider codes (`PROVIDER_KEY_MISSING`, `PROVIDER_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`, `PROVIDER_NETWORK_ERROR`, `PROVIDER_RESPONSE_INVALID`, `PROVIDER_UNKNOWN`, `TARGET_LANG_INVALID`) are preserved with controlled safe messages; unrecognized or non-`ContractError` throws collapse to `PROVIDER_UNKNOWN`. `PROFILE_NOT_FOUND` (404) and `DB_UNAVAILABLE` (503) propagate from the profile repository unchanged.
- HTTP status mapping: `TARGET_LANG_INVALID` and `PROVIDER_UNKNOWN` → 400 (shared with profile/key validation flows that already use `PROVIDER_UNKNOWN` for unknown provider ids), `PROVIDER_RATE_LIMITED` and `PROVIDER_QUOTA_EXCEEDED` → 429, `PROVIDER_KEY_MISSING` → 503, `PROVIDER_AUTH_FAILED`/`PROVIDER_NETWORK_ERROR`/`PROVIDER_RESPONSE_INVALID` → 502.
- `PROVIDER_*` and `TARGET_LANG_INVALID` responses must not include provider keys, raw request `text`, glossary entries, provider response bodies, stack traces, raw provider exception text, or debug logs. Validator field errors for invalid provider output remain value-free. Translated text appears only in a valid `TranslationResult` response for the user's explicit manual test and is not persisted by this route.
- Only `POST` is allowed on `/api/translate/test`; other methods return `METHOD_NOT_ALLOWED` with `Allow: POST`. The endpoint preserves the existing localhost bind and CORS behavior, matching `/api/ocr/test`.

## Translation Runtime Status Broadcast
- T-009-003 adds an in-memory translation `RuntimeStatus` override inside `createLocalApiServer` analogous to the capture override, so `/api/translate/test` activity is reflected in `GET /api/status` and `/ws/app` without changing the route's `TranslationResult` response shape locked in T-009-002.
- On a valid translate-test attempt (one that passes `assertTranslateTestRequest`), the server publishes `translation: { state: "running", code: "TRANSLATE_TEST_RUNNING", message: "Translate test running", retryable: false }` before invoking the injected `translateTestProvider.runTranslateTest`. On a successful run, the server publishes `translation: { state: "ok", code: "TRANSLATE_TEST_OK", message: "Translate test succeeded", retryable: false }` after provider output passes `assertTranslationResult` and the provider-match check.
- Provider failures from `runTranslateTest`, plus input-preparation errors that map to provider-vocabulary codes (`PROVIDER_UNKNOWN`, `TARGET_LANG_INVALID`) and missing-provider failures, publish `translation: { state: "error", ... }` derived from `providerErrorToRuntimeStatus(error, { clock })`, so `code`, `retryable`, and the redacted `message` follow the documented provider error vocabulary.
- Profile lookup errors (`PROFILE_NOT_FOUND`, `DB_UNAVAILABLE`), result-validation errors (`PROVIDER_RESPONSE_INVALID` raised by `assertTranslationResult`/provider-match), and other non-provider-vocabulary failures publish `translation: { state: "error", ... }` with a safe redacted fallback that uses the `ContractError.code` and a controlled message; `retryable` is derived from `providerErrorRetryable` and the local `RETRYABLE_API_ERROR_CODES` allow-list, never from raw provider exception text.
- The runtime status broadcast preserves all T-009-002 privacy invariants: supplied request `text`, provider `translatedText`, glossary entries, internal `cacheKey`, provider keys, stack traces, and raw provider exception text never appear in the `AppStatus` snapshot, broadcast frames, or `/api/status` response. The `running`, `ok`, and `error` statuses carry only `state`, `updatedAt`, `code`, the controlled `message`, and `retryable`.
- Malformed JSON bodies, `assertTranslateTestRequest` validation failures, `OPTIONS` preflight requests, and disallowed HTTP methods on `/api/translate/test` do not change the in-memory translation runtime status and do not publish `/ws/app` frames; only valid translate-test attempts mutate the override.
- The `/api/translate/test` response shape is unchanged: successful responses still return only the canonical `TranslationResult` fields, and error responses still return canonical `ApiError` envelopes with the existing HTTP status mapping. The translation runtime status override is observable only through `GET /api/status` and `/ws/app` snapshots.

## Diagnostics Bundle Endpoint
- T-010-002 wires `GET /api/diagnostics/bundle` into the localhost API harness
  with an optional dependency-injected `diagnosticsProvider` boundary. The
  future Electron/FastAPI runtime owns concrete log collection behind this
  interface.
- When provided, `diagnosticsProvider.collectDiagnostics()` may return either
  an array of log entries or an object with `{ logLines, appVersion?,
  backendVersion?, os?, activeProfileId? }`. Log entries may be strings or
  structured objects. Metadata, when present, must be non-empty strings except
  `activeProfileId`, which may be `null`. The route applies safe defaults from
  server options (`appVersion`, `backendVersion`, `osName`, `activeProfileId`)
  and then calls `buildDiagnosticBundle`.
- The route must validate the final response with `assertDiagnosticBundle`
  before writing JSON. Only the canonical `DiagnosticBundle` fields can leave
  the process.
- Missing diagnostics provider returns a valid minimal bundle with empty
  `redactedLogs`; it is not an error. Provider exceptions, non-array log
  sources, invalid metadata, invalid bundle clocks, and validator failures map
  to `DIAGNOSTICS_FAILED`.
- `DIAGNOSTICS_FAILED` responses must not include provider keys, raw OCR/source
  text, translated text, screenshots, image paths, stack traces, raw provider
  response bodies, raw provider exception text, or debug payloads. Error details
  may include value-free field names/codes only when produced by the bundle
  validator.
- Only `GET` is allowed on `/api/diagnostics/bundle`; other methods return
  `METHOD_NOT_ALLOWED` with `Allow: GET`. The endpoint preserves the existing
  localhost bind, CORS behavior, no-persistence behavior, and on-demand
  generation.

## Diagnostics API Smoke Command
- T-010-003 adds `npm run smoke:diagnostics` as the executable parent-closeout smoke for the dependency-free diagnostics bundle API core.
- The smoke command starts `createLocalApiServer` on ephemeral `127.0.0.1` ports and exercises `GET /health` plus `GET /api/diagnostics/bundle` over real HTTP instead of calling route handlers directly.
- Required smoke assertions:
  - `/health` reports the selected localhost port and `bindAddress: "127.0.0.1"`.
  - `GET /api/diagnostics/bundle` without a diagnostics provider returns a valid minimal `DiagnosticBundle` with empty `redactedLogs` and safe metadata defaults.
  - `OPTIONS` and wrong-method requests on `/api/diagnostics/bundle` do not call `diagnosticsProvider.collectDiagnostics()`; wrong methods return `METHOD_NOT_ALLOWED` with `Allow: GET`.
  - Provider metadata and active profile id are normalized through the route, provider string/object log entries are redacted, the response matches the canonical `DiagnosticBundle` shape, and the command does not copy redacted log contents into stdout.
  - Provider throws and invalid provider output map to privacy-safe `DIAGNOSTICS_FAILED` envelopes without leaking provider keys, OCR/source text, translated output, screenshot/image paths, stack traces, provider responses, raw exception text, or debug payloads.
- Smoke output must be concise JSON and must not include provider keys, raw OCR/source text, translated output, screenshot/image paths, stack traces, raw provider exception text, raw provider response bodies, or remote hosts.

## Translation API Smoke Command
- T-009-004 adds `npm run smoke:translation` as the executable parent-closeout smoke for the dependency-free translation test API core.
- The smoke command starts `createLocalApiServer` on an ephemeral `127.0.0.1` port with injected `profileRepository` and `translateTestProvider` implementations and exercises the live HTTP/WebSocket route surface instead of calling route handlers directly.
- Required smoke assertions:
  - `/health` reports the selected localhost port and `bindAddress: "127.0.0.1"`.
  - `OPTIONS`, wrong-method, and malformed `POST /api/translate/test` requests do not call the provider and do not mutate `/api/status.translation` or publish non-idle `/ws/app` frames.
  - Successful `POST /api/translate/test` returns only the canonical `TranslationResult` fields, passes glossary/cache-prepared input into the injected provider seam, and publishes `TRANSLATE_TEST_RUNNING` then `TRANSLATE_TEST_OK` through `/ws/app` and `/api/status`.
  - Provider failures return canonical retryable/non-retryable `ApiError` envelopes and publish `TRANSLATE_TEST_RUNNING` then provider-vocabulary `error` status through `/ws/app` and `/api/status`.
- Smoke output must be concise JSON and must not include provider keys, raw source/test text, translated output, glossary replacement text, translation cache keys, stack traces, raw provider exception text, or remote hosts. The successful `/api/translate/test` response may contain explicit manual-test `sourceText` and `translatedText`, but the smoke must not copy those values into stdout, stderr, status frames, or error envelopes.

## Capture/OCR API Smoke Command
- T-008-005 adds `npm run smoke:capture-ocr` as the executable parent-closeout smoke for the dependency-free capture/OCR API core.
- The smoke command starts `createLocalApiServer` on an ephemeral `127.0.0.1` port with injected `profileRepository`, `captureSourceProvider`, `captureController`, and `ocrTestProvider` implementations and exercises the live HTTP route surface instead of calling route handlers directly.
- Required smoke assertions:
  - `/health` reports the selected localhost port and `bindAddress: "127.0.0.1"`.
  - `GET /api/capture/sources` returns only validated `CaptureSource` fields, and provider exceptions map to privacy-safe `CAPTURE_ENUM_FAILED`.
  - `POST /api/ocr/test` returns a validated `OcrResult` for a profile ROI, `ROI_MISSING` before engine calls when the profile has no ROI, and privacy-safe `OCR_ENGINE_ERROR` for engine failure.
  - `POST /api/capture/start` calls the injected controller with the saved `captureSource`, returns fixed `{ ok: true }`, updates `/api/status.capture` to `CAPTURE_RUNNING`, and rejects a second start as `CAPTURE_ALREADY_RUNNING` without a second controller start.
  - `POST /api/capture/stop` returns fixed `{ ok: true }`, updates `/api/status.capture` to `CAPTURE_STOPPED`, and rejects an idle stop as `CAPTURE_NOT_RUNNING`.
- Smoke output must be concise JSON and must not include provider keys, raw OCR/source text, screenshot paths, captured image identifiers, stack traces, raw provider/controller exception text, or remote hosts.

### `/ws/overlay` Wire Contract
- T-006-003 implements `/ws/overlay` in the dependency-free localhost server core. The production FastAPI sidecar must preserve the same observable behavior.
- Upgrade behavior:
  - The endpoint accepts only valid WebSocket version 13 upgrades for the configured path, defaulting to `/ws/overlay`.
  - Invalid upgrade headers, unsupported WebSocket versions, non-GET requests, and wrong paths are rejected with `WS_REJECTED` or `NOT_FOUND` without logging request payloads.
  - When an `Origin` header is present, it must pass the same local/configured-origin policy as the HTTP CORS helper; raw local clients with no `Origin` header are accepted.
  - The server remains bound to `127.0.0.1`; WebSocket support must not introduce a LAN, wildcard, or remote bind mode.
- Client lifecycle:
  - Accepted overlay clients increment `OverlayState.overlayClients`; closed, errored, or protocol-rejected clients decrement it exactly once.
  - On connect, the server replays the latest non-expired sanitized subtitle frame when one exists.
  - `OverlayState.publishFrame(frame)` broadcasts the newly sanitized frame to all connected overlay clients.
  - `OverlayState.clearFrame()` broadcasts a clear event to all connected overlay clients.
- Message shapes:
  - Replay and live subtitle messages use `{ "type": "subtitle", "replay": boolean, "frame": SubtitleFrame }`.
  - Clear messages use `{ "type": "clear", "frame": null }`.
  - Server pong responses to client text pings use `{ "type": "pong" }`; WebSocket ping control frames receive pong control frames.
  - Supported client opcodes are text, ping, pong, and close. Binary and fragmented client frames are rejected as protocol errors.
  - Client text messages are bounded to 16 KiB. Client control frames are bounded to the RFC 6455 125-byte payload limit.
- Privacy and safety:
  - All WebSocket subtitle frames are sanitized through the shared overlay subtitle contract before sending.
  - `sourceText`, raw OCR text, provider keys, logs, screenshots, stack traces, and debug payloads must not be included in `/ws/overlay` messages.
  - The overlay browser runtime must continue to render `frame.escapedText` and ignore `translatedText` and `sourceText`.
  - Client messages are accepted only for lightweight ping/close handling and are never persisted or logged by default.

## Desktop Renderer Shell Contract
- T-011-001 adds the dependency-free desktop UI shell contract in `src/ui/desktop-shell.js`. It is a pure JS module with no runtime dependency on `createLocalApiServer`, no persistence, no SQLite schema change, and no addition to `package.json` dependencies. The future Electron/React renderer must consume it as the single source for entry-route resolution, route registry, AppStatus sanitization, and recovery action derivation.
- Route registry: `ROUTE_REGISTRY` is a frozen map keyed by route id. Every entry exposes `{ id, title, group, requiresSetup, sidebar, capabilities }` where `capabilities` always declares `loading`, `empty`, `error`, `success`, and `recovery`. `SIDEBAR_ROUTES` is the deterministic sidebar ordering for the Navigation Groups in `UI_SPEC.md`; the First-Run wizard is intentionally excluded from the sidebar and treated as the entry route when setup is incomplete.
- Setup completeness: `isSetupComplete({ activeProfileId, providerKeySaved, captureSourceSelected, roiSaved })` requires a non-empty active profile id plus boolean `true` for the other three flags. `resolveEntryRoute(setup)` returns `first-run` for incomplete setup and `home` for complete setup. Setup state is supplied by the Electron host; the renderer never derives setup completeness from raw `AppStatus` fields alone.
- Route normalization: `normalizeRoute(routeId, { setup?, backendRecovery? })` accepts only known first-class ids, redirects `requiresSetup` routes to `first-run` when setup is incomplete, and falls back to `home` for unknown ids, prototype-pollution-shaped strings, non-strings, and `null`/`undefined`. Unknown user-supplied route ids never echo through the resolved route. `backendRecovery=true` is the narrow setup-incomplete exception for Home / Status only, so a failed backend startup can show recovery actions before setup completion; it does not unlock other setup-required routes.
- AppStatus sanitization: `sanitizeAppStatus(status, { port })` returns a frozen view-model status with only `backend`, `activeProfileId`, `overlayUrl`, `overlayUrlTrusted`, `overlayClients`, `capture`, `ocr`, `translation`, and `lastSubtitle`. `sanitizeRuntimeStatus` reduces a `RuntimeStatus` to `{ state, code, retryable, updatedAt }` — `message`, raw provider exception text, provider keys, and debug payloads are stripped. `sanitizeLastSubtitle` exposes only `id`, `profileId`, `themeId`, `createdAt`, `displayMs`, and `escapedText`; `sourceText`, `translatedText`, and `provider` are removed. `backend` outside the documented vocabulary collapses to `starting` and non-integer/negative `overlayClients` clamp to `0`.
- Localhost overlay URL trust: `isTrustedOverlayUrl(url, { port })` requires `http://127.0.0.1:<port>/overlay` with no query, fragment, or userinfo. `localhost`, `0.0.0.0`, LAN IPs, missing ports, port mismatches, `https://`, and non-string inputs are rejected. Untrusted URLs become `null` with `overlayUrlTrusted=false` in the view model so Home/Status and OBS Setup Guide cannot offer a non-loopback URL even if the backend mis-reports one.
- Recovery action derivation: `deriveRecoveryActions(runtimeStatus)` reads `state`, `code`, and `retryable` only. Idle/ok/running statuses produce an empty list. The controlled action vocabulary covers provider, capture, OCR, profile/DB, and transport errors (`PROVIDER_KEY_MISSING`, `PROVIDER_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_QUOTA_EXCEEDED`, `PROVIDER_NETWORK_ERROR`, `PROVIDER_RESPONSE_INVALID`, `PROVIDER_UNKNOWN`, `TARGET_LANG_INVALID`, `CAPTURE_SOURCE_MISSING`, `CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE`, `CAPTURE_ALREADY_RUNNING`, `CAPTURE_NOT_RUNNING`, `CAPTURE_FAILED`, `CAPTURE_ENUM_FAILED`, `OCR_ENGINE_ERROR`, `ROI_MISSING`, `PROFILE_NOT_FOUND`, `DB_UNAVAILABLE`, `BACKEND_NOT_READY`, `PORT_UNAVAILABLE`, `WS_REJECTED`, `RUNTIME_STATUS_SOURCE_FAILED`, `DIAGNOSTICS_FAILED`). `retryable=true` prepends `retry`. Unknown codes fall back to `open_diagnostics`. `RuntimeStatus.message` text is never inspected.
- View model: `buildViewModel({ route, appStatus, port, setup })` returns a frozen `{ route: { id, title, group, capabilities }, sidebar, setupComplete, status, recoveries: { capture, ocr, translation } }` snapshot. When no route is requested, incomplete setup enters `first-run` and complete setup enters `home`; when a route is requested, setup-required routes redirect to `first-run` until setup is complete while non-setup routes such as `about` remain reachable. The optional stateful harness `createDesktopShell({ port, setup, initialRoute, appStatus })` exposes `snapshot()`, `navigate(routeId)`, `consumeAppStatus(status)`, `updateSetup(partial)`, and `setPort(port)`; every method returns a new frozen view model, performs no I/O, and writes no persistence. `updateSetup(partial)` copies only the allow-listed setup fields (`activeProfileId`, `providerKeySaved`, `captureSourceSelected`, `roiSaved`) so prototype-shaped keys cannot change the setup-complete gate.

## Home Status Renderer Contract
- T-011-003 adds `src/ui/home-status-actions.js`, a pure renderer-side Home/Status contract. It does not add HTTP routes, perform fetch/WebSocket/clipboard/host-command I/O, persist state, or depend on Electron/React. It consumes raw `AppStatus` by calling `desktop-shell.buildViewModel` so Home/Status uses the same sanitization, setup gate, overlay URL trust, and recovery vocabulary as the shell.
- Home view model: `buildHomeStatusViewModel({ appStatus, setup, port, backendRecovery?, actionFeedback? })` returns a frozen snapshot with `readiness`, `activeProfileId`, card summaries for backend, overlay, capture, OCR, translation, a sanitized last-subtitle preview, enabled/disabled action descriptors, and redacted feedback. `backendRecovery=true` is reserved for the failed-backend-startup entry path and only keeps Home / Status reachable while setup is incomplete. The view model omits `RuntimeStatus.message`, `sourceText`, raw OCR text, `translatedText`, provider keys, provider responses, stack traces, screenshots, captured image paths, debug payloads, and untrusted overlay URLs.
- Status connection intents: `buildHomeActionIntent("refresh_status", viewModel)` returns `GET /api/status`; `buildHomeActionIntent("connect_status_stream", viewModel)` returns a WebSocket connect intent for `ws://127.0.0.1:<port>/ws/app`. The WebSocket URL is derived only from the validated local numeric port, never from `AppStatus.overlayUrl` or user input.
- OBS URL clipboard intent: `buildHomeActionIntent("copy_overlay_url", viewModel)` returns a clipboard-write intent only when the sanitized shell status accepted the backend-reported `http://127.0.0.1:<port>/overlay` URL. Missing, LAN, wildcard, `localhost`, wrong-port, query, fragment, userinfo, and `https` overlay URLs are unavailable and must raise `HOME_ACTION_UNAVAILABLE` if invoked.
- Capture and recovery intents: capture start uses `POST /api/capture/start` with only `{ profileId }` from the sanitized active profile id; capture stop uses `POST /api/capture/stop` with no body. Recovery actions map to route-navigation or host-command intents (`translation-settings`, `capture-setup`, `logs-diagnostics`, `profiles`, backend restart, network troubleshooting, wait/retry) without parsing messages or echoing raw exception text.
- Action feedback: `createHomeActionFeedback({ actionId, state, code?, message?, updatedAt? })` creates the visible success/error/running feedback state used for copy confirmation and retry failures. Messages are redacted and controlled by action id/state; field values are not retained from failed API responses.

## Capture/OCR/Translation Setup Renderer Contract
- T-011-004 adds `src/ui/setup-screens.js`, a pure renderer-side contract for Capture Setup, OCR Preview, and Translation Settings. It performs no fetch, WebSocket, clipboard, host-command, SQLite, secure-store, or filesystem I/O, and adds no server route. The future Electron/React renderer must bind side effects to the frozen intent descriptors emitted by this module.
- State: `createSetupScreensState(...)` keeps an allow-listed draft of profile settings only: `captureSource`, `roi`, `captureHz`, `ocrPreset`, `ocrConfidenceFloor`, `translationProvider`, and v1-fixed `targetLang`. Prototype-shaped keys, API keys, manual translation test text, provider responses, stack traces, screenshot paths, capture frame identifiers, and debug payloads are ignored. Capture sources are copied into visible UI state with only `kind`, `id`, `label`, and optional `bounds`; log-safe snapshots redact capture source labels because window titles may contain private context.
- Profile update intents: `buildCaptureSettingsUpdateIntent(state)`, `buildOcrSettingsUpdateIntent(state)`, `buildTranslationSettingsUpdateIntent(state)`, and `buildProfileSettingsUpdateIntent(state, { fields })` all target `PUT /api/profiles/{id}` and validate the generated `ProfileUpdateRequest` with the existing validators before emitting a descriptor. Empty updates and missing `profileId` raise `ContractError("VALIDATION_ERROR")` with value-free field errors.
- Capture/OCR intents: `buildCaptureSourcesIntent()` targets `GET /api/capture/sources`; `buildOcrPreviewIntent(state, { roi? })` targets `POST /api/ocr/test` with `{ profileId, roi? }` and validates `OcrTestRequest`. OCR preview results are validated with `validateOcrResult` before entering state.
- Translation intents: `buildProviderKeySaveIntent({ provider, apiKey })` targets `PUT /api/keys/{provider}` and keeps the key behind `makeBody()` with `{ apiKey: "[REDACTED]" }` in `safeSetupIntentForLog`. `buildTranslationPreviewIntent(state, { text })` targets `POST /api/translate/test`, validates `TranslateTestRequest`, keeps manual test text behind `makeBody()`, and redacts it in log-safe descriptors.
- Transient result handling: `applyOcrPreviewResult` may store recognized/normalized OCR text for the visible preview, and `applyTranslationPreviewResult` may store translated preview text for the visible preview. `safeSetupScreensStateForLog` and sanitized errors must redact those fields. The setup contract must not persist preview text, source text, screenshots, provider responses, or keys.
- Error handling: `sanitizeSetupScreenError` accepts `ApiError` envelopes and keeps only safe `code`, redacted `message`, `retryable`, value-free `fieldErrors`, and recovery action ids derived from `code`/`retryable`; unknown exceptions collapse to `UNKNOWN_ERROR` / `Action failed`. The sanitizer is idempotent over its own output and re-derives recovery actions when re-sanitizing stored errors. Recovery actions must not parse raw message text.

## Overlay/Privacy/Diagnostics Closeout Renderer Contract
- T-011-005 adds `src/ui/closeout-screens.js`, a pure renderer-side contract for Overlay Theme Editor, OBS Setup Guide, Privacy Settings, and Logs/Diagnostics. It performs no fetch, WebSocket, clipboard, browser, host-command, SQLite, secure-store, or filesystem I/O; it emits frozen intent descriptors that the Electron host must bind to side effects.
- Theme intents: `buildThemesListIntent()` targets `GET /api/themes`; `buildThemeCreateIntent`, `buildThemeDuplicateIntent`, `buildThemeUpdateIntent`, and `buildThemeDeleteIntent` target the existing theme routes and validate request bodies with the overlay theme validators before emitting descriptors. Built-in themes are read-only in the view model and cannot produce update/delete intents. `buildProfileThemeUpdateIntent({ profileId, overlayThemeId })` targets `PUT /api/profiles/{id}` with only `{ overlayThemeId }`.
- OBS intents: `buildObsSetupViewModel({ appStatus, setup, port })` delegates status sanitization and overlay URL trust to `desktop-shell.buildViewModel`. Copy/open actions are enabled only for trusted `http://127.0.0.1:<port>/overlay` URLs, and `/ws/app` connection URLs are derived only from the validated numeric local port.
- Privacy intents: `buildPrivacySettingsReadIntent()` targets `GET /api/settings/privacy`; `buildPrivacySettingsUpdateIntent(state)` targets `PUT /api/settings/privacy` with the complete allow-listed `PrivacySettings` draft and validates it before emission. Debug persistence warnings are derived from booleans and budget validation, not from raw field messages. Debug screenshot directories are visible UI data but redacted in safe-log snapshots.
- Diagnostics intents: `buildDiagnosticsBundleIntent()` targets `GET /api/diagnostics/bundle`. `applyDiagnosticsBundleResult` validates `DiagnosticBundle`, defensively redacts every log line again, and stores only the canonical bundle shape. `buildDiagnosticBundleCopyIntent(state)` is a sensitive clipboard intent; log-safe descriptors include bundle counts and redaction summary only, never log contents.
- Error handling: closeout screen errors keep only safe `code`, redacted `message`, `retryable`, value-free `fieldErrors`, and recovery action ids derived from `code`/`retryable`; they must never parse message text or echo API keys, OCR/source text, translated text, screenshots, stack traces, provider responses, diagnostic logs, or debug payloads.

## Validation Rules
- `ProfileExport` must reject forbidden fields: API keys, OCR text history, translated text history, captured image paths, screenshots, log payloads.
- `RoiRect` values must be finite numbers with positive width and height.
- `captureHz` must be `0`, `1`, `2`, `3`, or `4`; `0` means manual test mode only.
- `ocrConfidenceFloor` must be between `0` and `1`.
- `targetLang` is fixed to `"en"` in v1.
- Provider ids are controlled vocabulary values registered by the backend; v1 required ids are `deepl` and `echo`.
- Built-in theme ids are `classic_subtitle`, `stream_box`, and `minimal`; built-in themes are read-only and can only be duplicated into custom themes.
- `CaptureStartRequest` accepts only `{ profileId }`; `OcrTestRequest` accepts only `{ profileId, roi? }`; `CaptureSourcesResponse` accepts only `{ sources: CaptureSource[] }`.
- `OcrResult` accepted responses omit `rejectionReason`; rejected responses require `rejectionReason in ["EMPTY_TEXT", "CONFIDENCE_TOO_LOW", "NOISE_TEXT", "DUPLICATE_TEXT"]`.

### T-007-004 Theme And Glossary Contracts
- `OverlayThemeCreateRequest` requires a non-empty `name` and either `baseThemeId` or `cssJson`. When `baseThemeId` is supplied, the new custom theme copies the base theme CSS unless `cssJson` is also supplied. `cssJson` is a JSON object whose values are strings, finite numbers, or booleans; nested objects, arrays, nulls, functions, provider keys, OCR text, translated text, screenshots, logs, and other forbidden diagnostic field names are rejected. Invalid `cssJson` returns `VALIDATION_ERROR` with `details.fieldErrors[].code` such as `THEME_CSS_INVALID`, `THEME_CSS_VALUE_INVALID`, or `THEME_CSS_FORBIDDEN_FIELD`.
- `OverlayThemeUpdateRequest` accepts a non-empty subset of `name` and `cssJson`. Built-in themes cannot be updated or deleted; duplicate a built-in theme first and edit the custom copy.
- Theme reads return `OverlayTheme` with `builtIn: boolean` and parsed `cssJson`. Theme writes persist booleans as `0`/`1` and JSON through the `overlay_themes.css_json` column. Custom theme ids are generated by the repository and must not collide with built-in theme ids.
- Deleting a custom theme checks `profile_settings.overlay_theme_id` first. If any profile still references the theme, the API returns `THEME_IN_USE` rather than orphaning profile settings.
- Glossary export returns `{ terms, format: "json" }` from the current profile and does not include glossary revision, OCR text, translation text, source screenshots, provider keys, logs, or diagnostic payloads.
- Glossary import accepts `{ format: "json", content }` where `content` is either a JSON array of `GlossaryTerm` or an object `{ "terms": GlossaryTerm[] }`. It also accepts `{ format: "csv", content }` with a required header containing `sourceTerm,targetTerm` and optional `id,note`. CSV uses RFC4180-style quoted fields. Missing CSV ids are generated by the repository.
- Glossary import is all-or-nothing in v1. If parsing, shape validation, duplicate ids, or duplicate normalized source terms fail, no profile rows are written and the API returns `GLOSSARY_IMPORT_INVALID` or `VALIDATION_ERROR` with `details.rejected`/`details.fieldErrors`. On success it replaces the profile glossary through the same profile update path and returns `{ terms, rejected: [] }`.

### T-007-005 Privacy And Provider Key Contracts
- `GET /api/settings/privacy` returns the singleton `PrivacySettings` row. If the row is unexpectedly absent, the repository returns the same `DEFAULT_PRIVACY_SETTINGS` privacy-first shape seeded during initialization.
- `PUT /api/settings/privacy` accepts a complete `PrivacySettings` object and calls `assertPrivacySettings` before any SQLite write. It returns the persisted settings and never returns provider keys, OCR text, translated text, screenshots, logs, or diagnostic payloads.
- `PUT /api/keys/{provider}` accepts `{ apiKey: string, provider?: string }`, validates it through `validateProviderKeyWriteRequest`, writes the key through the secure-store adapter boundary only, and always returns `{ ok: true }` on success. It must never persist keys through SQLite, log the key, echo the key, or expose a read-back endpoint.
- `DELETE /api/keys/{provider}` removes the provider key through the same secure-store adapter boundary and returns `{ ok: true }`. Unknown providers return `PROVIDER_UNKNOWN`; unavailable secure storage returns `KEYCHAIN_UNAVAILABLE`.
- `createProviderKeyStore({ adapter })` is the dependency-free OS-secure-storage boundary used by the localhost API harness. The adapter must expose write/delete primitives only; the returned store intentionally exposes no `readProviderKey`, `listProviderKeys`, or raw-secret accessor.

### T-007-001 Contract Validation Boundary
- `src/contracts/validation.js` is the single executable contract surface that the
  upcoming profile/settings persistence and HTTP routes must call before
  touching SQLite, OS secure storage, or the runtime pipeline. All validators
  emit `ContractError` envelopes with `code: "VALIDATION_ERROR"` and
  `details.fieldErrors: { field, code, message }[]` so the API layer can
  render the canonical `ApiError` shape without parsing message text.
- `validateProfileCreateRequest` enforces required fields `name`, `ocrPreset`,
  `ocrConfidenceFloor`, `captureHz`, `translationProvider`, `targetLang`,
  `overlayThemeId`, and `glossary`. Optional fields are `gameTitle`,
  `captureSource`, and `roi`; when present they are validated with the same
  rules. Unknown writable fields produce `UNKNOWN_PROFILE_FIELD`, matching the
  update validator, so `apiKey`, OCR text, translated text, screenshot, and log
  field names cannot be smuggled into create requests.
  - `ocrPreset` is a v1 controlled vocabulary: `default_dialogue`,
    `pixel_font_dark_bg`, `pixel_font_light_bg`, `high_contrast`,
    `adv_textbox`, `menu_text`. Unknown presets produce
    `OCR_PRESET_INVALID`.
  - `captureSource.kind` must be `monitor` or `window`; `id` and `label`
    must be non-empty strings; `bounds`, when present, follows the
    `RoiRect` contract.
  - `glossary` is required as an array, may be empty, and each entry must
    have non-empty `id`, `sourceTerm`, and `targetTerm` strings (`note` is
    optional).
  - `overlayThemeId` must be a non-empty string. Built-in theme ids
    (`classic_subtitle`, `stream_box`, `minimal`) remain a controlled
    vocabulary at the persistence layer; custom theme ids are accepted but
    must reference an existing theme row at the API layer.
- `validateProfileUpdateRequest` accepts any non-empty subset of the
  `ProfileCreateRequest` fields. Unknown writable fields produce
  `UNKNOWN_PROFILE_FIELD`; an empty body produces `VALIDATION_ERROR`. The
  validator is the only place where API key, OCR text, translated text,
  screenshots, and log field names are explicitly not writable through
  profile updates.
- `validateProfileExport` combines schema validation with the forbidden-field
  scan. `schemaVersion` must be `1`, `forbiddenFieldsPolicy` must equal
  `"reject_api_keys_ocr_text_translation_text_images_logs"`, `exportedAt`
  must be a non-empty string, and `profile` must be a full `Profile` with
  non-empty `id`/`createdAt`/`updatedAt` plus a valid create-request body;
  export shape errors use `IMPORT_SCHEMA_INVALID` field codes. Any forbidden
  field anywhere in the payload surfaces as
  `IMPORT_CONTAINS_FORBIDDEN_FIELD` field errors inside the same
  `VALIDATION_ERROR` envelope, so API keys, OCR text history, translated
  text history, screenshots, and log payloads cannot round-trip through
  import/export.
- `validatePrivacySettings` enforces booleans for `saveRecentOcrText`,
  `saveRecentTranslations`, and `saveDebugScreenshots`; non-negative
  integers for `recentOcrLimit`, `recentTranslationLimit`, and
  `debugRetentionDays`; and an optional non-empty string for
  `debugScreenshotDirectory`. The exported `DEFAULT_PRIVACY_SETTINGS`
  constant (`saveRecentOcrText: false`, `recentOcrLimit: 0`,
  `saveRecentTranslations: false`, `recentTranslationLimit: 0`,
  `saveDebugScreenshots: false`, `debugRetentionDays: 0`) is the
  privacy-first default that the persistence layer must seed on first run;
  the validator accepts those defaults and rejects attempts to enable OCR text,
  translation text, or screenshot persistence unless the matching limit or
  retention field is a positive integer.
- `validateProviderKeyWriteRequest({ apiKey }, { provider })` is the only
  validation surface for `PUT /api/keys/{provider}`. `provider` (either from
  the path parameter or, for adapter callers, from the body) must be one
  of the controlled vocabulary providers (`deepl`, `echo`) or the validator
  emits `PROVIDER_UNKNOWN`. If both the path parameter and request body include
  a provider, they must match or the validator emits `PROVIDER_PATH_MISMATCH`.
  `apiKey` must be a non-empty non-whitespace string. The response stays
  `{ ok: true }` via `apiKeyWriteResponse()`; the validator must never persist,
  echo, log, or return the supplied key value under any failure path.

## OCR Text Normalization And Filtering
- Runtime OCR candidates pass through a deterministic normalize -> filter -> duplicate-suppress sequence before translation.
- `normalizeOcrText` applies Unicode `NFKC`, strips control and zero-width characters, collapses Unicode whitespace to one ASCII space, and trims edges.
- Non-string OCR text normalizes to `""`.
- `evaluateOcrCandidate` rejects candidates in this order:
  - `EMPTY_TEXT`: normalized text is empty.
  - `CONFIDENCE_TOO_LOW`: confidence is not finite, outside `[0, 1]`, or below the active profile's `ocrConfidenceFloor`.
  - `NOISE_TEXT`: normalized text has no Unicode letter or number characters.
- `processOcrCandidate` adds duplicate suppression after a candidate passes evaluation:
  - `DUPLICATE_TEXT`: SHA-256 hash of normalized text matches an in-memory entry inside the active TTL window.
- Duplicate suppression requires a caller-provided `DuplicateSuppressor`. Omitting it runs normalization/filtering only; passing any other object is a validation error.
- Duplicate suppression is in-memory only and stores `{ hash, firstSeenAt }` records. It must not store raw OCR text, normalized OCR text, captured images, or translated text.
- Duplicate suppression snapshots are diagnostic-safe by contract: they expose only TTL metadata and hashes/timestamps.

## Glossary Application And Translation Cache Keys
- Per-profile glossary terms are applied after OCR normalization and before translation provider calls.
- Glossary matching is deterministic and literal:
  - `sourceTerm` and candidate source text are normalized with the OCR normalization contract.
  - `targetTerm` is Unicode `NFKC` normalized, whitespace-collapsed, and trimmed.
  - Empty `sourceTerm` or `targetTerm` values are invalid.
  - Duplicate normalized `sourceTerm` values are invalid for one profile revision.
  - Terms are applied in longest-source-term-first order, then by source term, then by id. This prevents shorter terms from consuming part of a longer proper noun.
  - "Longest" and tie-break ordering are measured by deterministic JavaScript UTF-16 code unit order to match literal runtime matching.
  - Replacement is single-pass and non-cascading: inserted target text is not reprocessed by later glossary terms.
- `glossaryRevision` is a SHA-256 hex digest of the canonical, sorted `{ sourceTerm, targetTerm }` pairs that affect replacement. Term ids and notes do not affect the revision.
- `appliedTerms` is an in-process attribution payload for runtime translation/debug UI only. It contains literal source/target glossary text and must not be persisted to disk, logs, profile exports, or `DiagnosticBundle` outputs.
- Translation cache keys are generated by `src/core/translation-cache.js` in this shape:
  - `v1:<provider>:<targetLang>:<glossaryRevision>:<sourceTextHash>`
  - `sourceTextHash` is SHA-256 over the normalized source text before glossary replacement.
  - `targetLang` is fixed to `en` in v1.
  - Provider ids must be controlled vocabulary values from the profile contract.
- Translation cache keys and glossary revisions must never include raw OCR text, glossary target text, provider API keys, or translated output.

## Translation Provider Adapters
- Provider adapters live in `src/core/translation-providers.js` and expose a common interface: `provider.name` plus `await provider.translate({ sourceText, targetLang })`. Adapter internals such as DeepL endpoint URLs are not exposed on the adapter object.
- `translate` always returns a frozen `TranslationResult` containing `sourceText` (NFKC + whitespace-collapsed), `translatedText`, `provider`, `durationMs`, and `cacheHit: false`. Cache hit/miss attribution is the responsibility of a future caching layer, not the adapter.
- `sourceText` must be a string; non-strings raise `VALIDATION_ERROR`. `targetLang` is validated against the v1 contract (`en` only) and invalid values throw `TARGET_LANG_INVALID` before any provider call.
- v1 required adapters:
  - `createEchoProvider({ clock? })` — deterministic, local, no network. Returns the normalized source text as the translated text so tests and offline runs can exercise the pipeline without provider credentials. Without an injected clock, `durationMs` is `0`.
  - `createDeepLProvider({ fetchClient, apiKeyResolver, endpoint?, clock? })` — never opens its own network connection. The caller must inject a `fetchClient` (a `fetch`-like function returning `{ status, json() }`) and an `apiKeyResolver` (async function that returns the DeepL API key from OS secure storage). The endpoint defaults to the DeepL Free endpoint and can be overridden for tests.
- Unrecognized options passed to `createProvider` are ignored by adapters that do not require them; adapters must not throw for unknown options.
- DeepL request shape: `POST endpoint` with `Authorization: DeepL-Auth-Key <key>` header and a URL-encoded body containing `text`, `target_lang=EN`, and `source_lang=JA`. The API key only appears in the `Authorization` header; it must never appear in the URL, query string, error message, error details, or any log output.
- Provider failure mapping (DeepL adapter, all `ContractError`):
  - Missing, empty, or whitespace-only resolved key, or resolver throws -> `PROVIDER_KEY_MISSING`.
  - HTTP `401` or `403` -> `PROVIDER_AUTH_FAILED`.
  - HTTP `429` -> `PROVIDER_RATE_LIMITED` (retryable).
  - HTTP `456` -> `PROVIDER_QUOTA_EXCEEDED`.
  - HTTP `5xx` or thrown fetch/network exceptions -> `PROVIDER_NETWORK_ERROR` (retryable).
  - HTTP `2xx` with missing/invalid JSON or missing `translations[0].text` -> `PROVIDER_RESPONSE_INVALID`.
  - Other non-`2xx` statuses -> `PROVIDER_UNKNOWN`.
- `RETRYABLE_PROVIDER_ERROR_CODES` is `['PROVIDER_RATE_LIMITED', 'PROVIDER_NETWORK_ERROR']`. All other adapter errors are non-retryable until user action.
- Adapter errors set `error.details.provider` to the provider id and, for HTTP failures, `error.details.status` so the API layer can map to `ApiError.retryable` without re-parsing message text.
- `createProvider(name, options)` is a factory that returns the matching adapter for `name in ['echo', 'deepl']`; unknown names throw `PROVIDER_UNKNOWN`.

## Subtitle Frames And Overlay State
- Subtitle frame primitives live in `src/core/subtitle-state.js`.
- `createSubtitleFrame` builds the runtime `SubtitleFrame` contract from translated text and profile/theme metadata:
  - `id` is caller-injected, generated by an injected `idFactory`, or derived from the frame timestamp as a deterministic fallback.
  - `createdAt` is an ISO timestamp from an injected `clock` or the current runtime clock.
  - `translatedText` is Unicode `NFKC` normalized, control/zero-width stripped, whitespace-collapsed, and trimmed.
  - `escapedText` is generated with the shared HTML escaping contract and is the only string the overlay DOM should render.
  - `displayMs` must be a positive finite number. The default is `7000`.
  - `themeId` defaults to `classic_subtitle` when omitted. `profileId`, `themeId` when supplied, provider, and translated text must be non-empty strings.
  - `confidence`, when present, must be finite and inside `[0, 1]`.
- Privacy/debug behavior:
  - `sourceText` is omitted by default. It is included only when `includeSourceText: true` is passed and the normalized source text is non-empty.
  - `confidence` is omitted by default unless explicitly supplied.
  - Subtitle frames are in-memory runtime state only in this slice; they must not be written to SQLite, logs, diagnostics, or profile exports by default.
- `OverlayState` is an in-memory state manager for `/ws/overlay` and app status:
  - `publishFrame(frame)` stores the latest frozen subtitle frame and returns a snapshot. It always omits `sourceText` from replay snapshots, even if the input frame was created with debug source text.
  - `connectClient()` / `disconnectClient()` update `overlayClients`, connection counters, and `updatedAt`.
  - `snapshot()` returns a frozen object with `overlayClients`, `lastSubtitle`, `updatedAt`, `connectionsOpened`, and `connectionsClosed`.
  - Reconnected overlay clients read the latest frame via `latestFrame()` if the frame has not expired.
  - Frame expiry uses `createdAt + displayMs`; expired frames are omitted from snapshots and `latestFrame()`.
  - `clearFrame()` removes the latest frame without changing client counters.

## Runtime OCR-To-Overlay Pipeline
- Deterministic runtime composition lives in `src/core/runtime-pipeline.js`.
- `runOcrToOverlayPipeline({ profile, ocrCandidate, provider, duplicateSuppressor?, overlayState?, nowMs?, clock?, idFactory?, includeSourceText? })` executes one candidate through the same core sequence the live runtime uses:
  1. OCR normalization/filtering uses the same reason-code contract as `processOcrCandidate`.
  2. Rejected OCR candidates return `{ accepted: false, stage: "ocr", rejectionReason }` and must not call a translation provider or publish a subtitle frame.
  3. Duplicate suppression is two-phase in the runtime pipeline: it checks the hash before translation, but records the accepted OCR hash only after provider translation and subtitle publication succeed. Provider failures therefore remain retryable for unchanged on-screen text.
  4. `prepareTranslationInput` applies glossary terms and creates a privacy-safe translation cache key over the normalized pre-glossary source text.
  5. The injected provider translates the glossary-applied text with `targetLang="en"` for v1.
  6. `createSubtitleFrame` builds the escaped subtitle frame, and `OverlayState.publishFrame` stores it when an overlay state object is supplied.
- The runtime result is an in-process object only. It may contain normalized OCR text and glossary attribution for UI/debug workflows, but default persistence, diagnostics, logs, profile export, and overlay replay must not include raw/source OCR text.
- `cacheKey` is safe for status surfaces and diagnostics because it contains only controlled identifiers and hashes. It must not contain raw OCR text, glossary target text, provider keys, or translated output.
- Provider failures propagate as their existing `ContractError` codes and must not publish a subtitle frame. Callers may map retryability with `isRetryableProviderError`.
- Overlay snapshots from this pipeline must replay `escapedText` and omit `sourceText` by default even when the internal subtitle frame is built with debug source text.

### Synthetic First-Run Stream Harness
- T-012-001 adds `runSyntheticFirstRunStream({ profile, provider, clock?, idFactory?, overlayState?, maxDurationMs? })` in `src/core/synthetic-first-run-stream.js`.
- The harness is a core contract, not an HTTP route. It uses the supplied in-memory `overlayState` when present or creates one when omitted, feeds the frozen Japanese `SYNTHETIC_OCR_CANDIDATE` through `runOcrToOverlayPipeline`, and requires an injected deterministic provider that returns an English subtitle for test evidence.
- Success returns a frozen summary with `schemaVersion: "synthetic-first-run-stream.v1"`, `startedAt`, `completedAt`, `durationMs`, `maxDurationMs`, `withinBudget`, profile/provider/target/theme fingerprints, `stage`, `overlayPublished`, subtitle metadata, and `privacy` guarantees. `stage` is one of `"ocr"`, `"translation"`, `"overlay"`, or the harness-only `"error"` sentinel for provider/profile/pipeline failures before a runtime stage can complete.
- Subtitle metadata is evidence-only: it includes id/provider/theme/timing plus SHA-256 hashes of the translated and escaped overlay text. The summary must not include `sourceText`, `translatedText`, `escapedText`, provider keys, screenshots, image paths, stack traces, or debug payloads.
- Failure summaries are frozen and sanitized. OCR rejection reports the controlled rejection code without text. Provider/pipeline errors use redacted messages and value-free field errors. `error.details` is dropped except for `fieldErrors[].field` and `fieldErrors[].code`; field-error messages and arbitrary provider details are never serialized. Timeout keeps any published subtitle hash evidence but sets `withinBudget=false` and a `TIMEOUT` failure.
- The harness introduces no SQLite schema changes, no profile export changes, no network calls, no native OCR/capture dependency, no concrete DeepL credential use, and no durable logs.

### First-Run Stream Smoke Command
- T-012-002 adds `npm run smoke:first-run-stream` as a dependency-free live localhost smoke over the existing `createLocalApiServer` and synthetic harness contracts.
- The smoke starts the server on an ephemeral `127.0.0.1` port, connects `/ws/app` and `/ws/overlay`, runs `runSyntheticFirstRunStream` with a shared in-memory `OverlayState`, then verifies:
  - `GET /health` reports the selected localhost port and version.
  - Initial `GET /api/status` and `/ws/app` snapshots contain no last subtitle and redact runtime messages.
  - `/ws/overlay` receives the live subtitle with `replay: false`, and a late `/ws/overlay` client receives the latest subtitle with `replay: true`.
  - `/ws/app` broadcasts overlay client count and latest subtitle status.
  - Post-publish `GET /api/status` exposes only a sanitized `lastSubtitle` with no `sourceText`.
  - `GET /overlay` serves no-store, CSP-protected, self-contained HTML with no remote script, stylesheet, image, or font fetch.
- The command may inspect the visible English subtitle internally to prove broadcast readiness, but stdout is limited to structured evidence: command name, localhost bind/port/overlay URL, stage/budget flags, subtitle id/provider/theme/timing, SHA-256 hashes, privacy guarantees, and named check results. Stdout and stderr must not contain the synthetic Japanese source text, raw translated text, provider keys, screenshot/image paths, logs, stack traces, cache keys, or debug payloads.
- The smoke adds no new HTTP routes, no SQLite schema changes, no profile export changes, no native OCR/capture dependency, no real provider credential use, and no durable logs.

### Backend Recovery Smoke Command
- T-012-003 adds `npm run smoke:backend-recovery` as a dependency-free live localhost smoke over the existing `createLocalApiServer`, `OverlayState`, and `createSubtitleFrame` contracts.
- The smoke reserves a free preferred localhost port, starts a backend on that port, publishes a deterministic in-memory subtitle frame, verifies `/health`, `/api/status`, `/overlay`, and `/ws/overlay`, stops the backend, then starts a fresh backend instance on the same preferred port and verifies the same surfaces again. This models the Electron host restarting the backend process rather than reusing a stopped server object.
- Port-conflict coverage uses a localhost blocker to occupy a preferred port. With multiple attempts configured, the backend must select a later localhost port and keep `/health` and `/api/status` aligned to the selected port. With `maxPortAttempts=1`, startup must fail with `ContractError` code `PORT_UNAVAILABLE`; `buildApiErrorFromContractError` must map it to an `ApiError` with `retryable: true` and details for `bindAddress`, `preferredPort`, and `maxPortAttempts`.
- After the blocker releases, a fresh backend must start on the original preferred port and serve the same health/status/overlay/WebSocket checks. Recovery evidence is code-driven: UI and host callers must use the controlled error code/retryability instead of parsing raw exception messages.
- Stdout is limited to command name, localhost bind, selected/restarted/fallback/recovered ports, `PORT_UNAVAILABLE` code/retryability/details, SHA-256 hashes of internally verified overlay text/HTML evidence, and named checks. Stdout and stderr must not contain raw OCR/source text, translated text, provider keys, screenshot/image paths, stack traces, logs, cache keys, arbitrary error details, or debug payloads.
- The smoke adds no new HTTP routes, no SQLite schema changes, no profile export changes, no native OCR/capture dependency, no real provider credential use, no npm dependency, and no durable logs.

## Error Model
- Canonical error shape: `ApiError`.
- Validation error code: `VALIDATION_ERROR` with `details.fieldErrors`.
- Retryable errors: provider network failure, rate limit, backend starting, capture source temporarily unavailable, WebSocket reconnect.
- Non-retryable until user action: missing provider key, invalid provider key, profile not found, invalid import schema, forbidden export/import field, non-localhost bind attempt.
- User-facing messages should be concise and actionable; raw exception text is diagnostic-only.

## WebSocket Behavior
- `/ws/app` sends status snapshots on connection and on state changes.
- `/ws/overlay` sends the latest sanitized `SubtitleFrame` on connection if one exists, then new frames.
- Clients reconnect with exponential backoff; the server must tolerate duplicate reconnects.
- Subtitle frames transport both normalized `translatedText` and pre-escaped `escapedText`; overlay DOM code must render `escapedText` for broadcast output.
- Debug fields such as source text and confidence may be omitted from overlay frames unless debug mode is enabled.

### `/ws/app` Wire Contract
- T-006-004 implements `/ws/app` in the dependency-free localhost server core as a separate stream from `/ws/overlay`. The production FastAPI sidecar must preserve the same observable behavior.
- Upgrade and origin behavior:
  - The endpoint accepts only valid WebSocket version 13 upgrades for the configured path, defaulting to `/ws/app`.
  - When an `Origin` header is present, it must pass the same configured/same-port localhost policy as the HTTP `resolveCorsOrigin` helper and the `/ws/overlay` endpoint; raw local clients without an `Origin` header are accepted.
  - Non-upgrade `GET /ws/app` returns the canonical retryable `WS_REJECTED` `ApiError` with HTTP `426`.
  - The server remains bound to `127.0.0.1`; `/ws/app` must not introduce a LAN, wildcard, or remote bind mode.
- Snapshot and broadcast lifecycle:
  - On connect, the server sends one `{ "type": "status", "status": AppStatus }` snapshot built by the same `buildAppStatus` helper used for `GET /api/status`.
  - `createLocalApiServer(...).publishStatus()` re-emits the current `AppStatus` snapshot to all connected `/ws/app` clients. Callers invoke it whenever they update `runtimeStatus`, `backendState`, or `activeProfileId` so connected UI clients see runtime state changes without polling.
  - The endpoint subscribes to `OverlayState` events so `publishFrame`, `clearFrame`, `connectClient`, and `disconnectClient` automatically broadcast a fresh sanitized `AppStatus` snapshot.
- Client frame handling:
  - Client text messages are bounded to 16 KiB; client control frames follow the RFC 6455 125-byte limit, matching `/ws/overlay`.
  - Text pings (`"ping"` or `{"type":"ping",...}`) are answered with `{"type":"pong"}`; WebSocket control ping frames receive control pong frames with the same payload.
  - Supported client opcodes are text, ping, pong, and close; binary and fragmented client frames are rejected as protocol errors.
- Privacy and safety:
  - `AppStatus` snapshots on `/ws/app` are sanitized through `buildAppStatus`: `lastSubtitle` runs through `sanitizeSubtitleForOverlay` and `runtimeStatus.message` is run through `redactSecrets`.
  - `/ws/app` must never include provider keys, `sourceText`, raw OCR text, translated debug text, captured images, stack traces, or any other debug payloads.
  - Client message bodies are accepted only for lightweight ping/close handling and are never persisted or logged by default.

### Runtime Error Mapping
- `src/core/translation-providers.js` exports two helpers so callers can derive runtime/UI/API state from a `ContractError` code without parsing user-facing messages:
  - `providerErrorToRuntimeStatus(error, { clock? })` returns a frozen `RuntimeStatus` with `state: "error"`, `code` (the original provider code or `PROVIDER_UNKNOWN`), `retryable` (matching `RETRYABLE_PROVIDER_ERROR_CODES`), `updatedAt` (ISO), and a `redactSecrets`-redacted `message` when one is present.
  - `providerErrorRetryable(errorOrCode)` returns the same retryability as `isRetryableProviderError(code)` but accepts either a `ContractError`-shaped object or a bare code string.
- `local-api-server.buildApiErrorFromContractError(error, { retryable? })` builds a canonical `ApiError` envelope from a `ContractError`, defaulting `retryable` to `providerErrorRetryable(code)` plus the server's small retryable transport/runtime code set such as `WS_REJECTED` and `PORT_UNAVAILABLE`. Callers can override `retryable` explicitly when a higher-level decision (for example, exhausted retry budget) needs to suppress retry hints.

## Data Persistence Contracts
- Normal profile/theme/glossary changes are durable immediately after successful API response.
- Translation cache may be cleared without losing profile configuration.
- Provider API keys are write-only through API; there is no endpoint that reads back a key value.
- Diagnostics bundles are generated on demand and redacted before return.
- T-007-002 defines the dependency-free SQLite repository boundary that profile/configuration routes must use before the production FastAPI storage adapter lands. The repository accepts an injected SQLite-like adapter with `exec(sql)` and `run(sql, params)` and is responsible for applying schema version 1, seeding defaults, and validating request envelopes before writes.

### T-007-002 SQLite Configuration Repository Boundary
- `src/storage/sqlite-config-store.js` exposes:
  - `SQLITE_SCHEMA_VERSION = 1`
  - `SQLITE_SCHEMA_STATEMENTS`
  - `getSqliteSchemaSql()`
  - `getBuiltInThemeSeedRows()`
  - `createSqliteConfigRepository({ database, clock?, idFactory? })`
- The schema version 1 tables are:
  - `app_meta`: app metadata, including `schema_version = "1"`.
  - `profiles`: profile identity, name, optional game title, and timestamps.
  - `profile_settings`: one row per profile for capture source JSON, ROI JSON, OCR preset, OCR confidence floor, capture Hz, translation provider id, target language, overlay theme id, and glossary revision.
  - `glossary_terms`: per-profile source/target terms and optional notes.
  - `overlay_themes`: built-in/custom theme records with CSS/token JSON and a `built_in` guard.
  - `privacy_settings`: singleton row seeded from `DEFAULT_PRIVACY_SETTINGS`.
  - `translation_cache`: metadata-only cache rows keyed by provider, target language, source text hash, glossary revision, and cache key.
- `initialize()` executes all schema statements, upserts `app_meta.schema_version = "1"`, inserts the singleton default privacy row with `ON CONFLICT DO NOTHING`, and inserts the built-in theme rows with `ON CONFLICT DO NOTHING` so existing user settings are not overwritten.
- `initialize()` must not silently downgrade or overwrite a non-`1` `schema_version`. The SQL upsert is guarded against mismatched existing values, and adapters that expose `changes=0` surface `DB_SCHEMA_INCOMPATIBLE`.
- `createProfile(ProfileCreateRequest)` must call `assertProfileCreateRequest` and compute glossary revision before any SQLite write. It writes `profiles`, `profile_settings`, and `glossary_terms`, then returns a `Profile` object with `id`, `createdAt`, and `updatedAt`.
- `listProfiles()` reads all profile rows with settings and glossary terms and returns frozen `Profile[]` values ordered by recent update.
- `getProfile(profileId)` reads one profile by id and throws `PROFILE_NOT_FOUND` when absent.
- `updateProfile(profileId, ProfileUpdateRequest)` must validate the patch before any write, merge it with the existing profile, recompute glossary revision when needed, update `profiles`, `profile_settings`, and `glossary_terms` in one transaction, and return the updated frozen `Profile`.
- `deleteProfile(profileId)` must throw `PROFILE_NOT_FOUND` when absent, throw `CANNOT_DELETE_ACTIVE_PROFILE` when `app_meta.active_profile_id` matches the target id, and otherwise delete profile rows through the schema cascade.
- `setActiveProfile(profileId)` must verify that the profile exists, then upsert `app_meta.active_profile_id`.
- `exportProfile(profileId)` must return a frozen `ProfileExport` with `schemaVersion: 1`, the current `forbiddenFieldsPolicy`, `exportedAt`, and a validated `profile`. The export must not include provider API keys, OCR text history, translated text history, captured images, screenshots, logs, stack traces, or diagnostics.
- Profile ids `active` and `import` are reserved by the v1 route surface (`/api/profiles/active` and future `/api/profiles/import`) and must be rejected at the repository boundary if an injected id factory or import path tries to create them.
- `listThemes()`, `getTheme(themeId)`, `createTheme(OverlayThemeCreateRequest)`, `updateTheme(themeId, OverlayThemeUpdateRequest)`, and `deleteTheme(themeId)` must use the schema version 1 `overlay_themes` table, keep built-in themes read-only, and block deletion while a profile uses the theme.
- `exportGlossary(profileId)` and `importGlossary(profileId, GlossaryImportRequest)` must operate on the profile glossary only, update `profile_settings.glossary_revision` through the existing profile update path, and must not persist or return raw OCR text, translated text, provider keys, screenshots, logs, or diagnostic payloads.
- `getPrivacySettings()` returns the singleton row as `PrivacySettings` or the `DEFAULT_PRIVACY_SETTINGS` fallback if the row has not been seeded yet.
- `savePrivacySettings(PrivacySettings)` must call `assertPrivacySettings` before any SQLite write and persists boolean values as `0`/`1`.
- Provider API key writes are intentionally out of scope for this repository. There is no `saveProviderKey`/read-key method because `PUT /api/keys/{provider}` must use the separate secure-store adapter boundary and return only `{ ok: true }`.
- `createProviderKeyStore({ adapter })` wraps OS secure storage for provider key write/delete. It validates provider ids and write request bodies before calling `adapter.writeSecret`, maps adapter failures to `KEYCHAIN_UNAVAILABLE` without including the secret in message/details, and exposes no read/list method.
- Privacy invariant: schema statements and repository write parameters must not introduce provider API keys, raw OCR text/source text, translated text, image/screenshot blobs, log payloads, stack traces, or diagnostic bundles. The only source-text-like field in normal SQLite is `source_text_hash`.

## Versioning
- Strategy: v1 local API is versioned by app release and `app_meta.schema_version`.
- Backward compatibility policy: profile exports include `schemaVersion`; imports support the current version and one previous compatible version after v1.1.
- Breaking changes require `CHANGELOG_DECISIONS.md` and `MIGRATION_PLAN.md` updates before implementation.

## API Acceptance Criteria
- [x] `/health` proves bind address is `127.0.0.1` in the T-006 localhost server core.
- [ ] Profile export never includes forbidden fields.
- [ ] Saving a key returns only `{ ok: true }` and key readback is impossible.
- [ ] Overlay WebSocket receives a valid `SubtitleFrame` and reconnects to the last frame.
- [x] Malicious subtitle payloads render as text in overlay renderer tests.
- [ ] Provider failure categories map to distinct error codes.
- [ ] Tests cover localhost bind enforcement, validation errors, redaction, and WebSocket reconnect.

## Product API Priorities
- 一時的なMVP APIではなく、選択フローの安定契約として扱う。
- 契約（request/response/error）を明確化する。
- 監視・運用を考慮したエラー分類とバージョニングを維持する。
- localhost-only、secret write-only、profile export safe by defaultを破らない。

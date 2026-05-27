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

## REST Endpoints
| Method | Path | Purpose | Request | Response | Error Codes |
|---|---|---|---|---|---|
| GET | `/health` | Backend health check | - | `HealthResponse` | `BACKEND_NOT_READY` |
| GET | `/overlay` | OBS Browser Source HTML | - | HTML | `OVERLAY_UNAVAILABLE` |
| GET | `/api/status` | Runtime status for UI | - | `AppStatus` | `BACKEND_NOT_READY` |
| GET | `/api/capture/sources` | Enumerate monitors/windows | - | `{ sources: CaptureSource[] }` | `CAPTURE_ENUM_FAILED` |
| POST | `/api/capture/start` | Start capture loop | `{ profileId: string }` | `{ ok: true }` | `PROFILE_NOT_FOUND`, `CAPTURE_SOURCE_MISSING`, `CAPTURE_FAILED` |
| POST | `/api/capture/stop` | Stop capture loop | - | `{ ok: true }` | `CAPTURE_NOT_RUNNING` |
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
| POST | `/api/profiles/{id}/glossary/import` | Import glossary JSON/CSV | `{ format: "json" | "csv", content: string }` | `{ terms: GlossaryTerm[], rejected: object[] }` | `PROFILE_NOT_FOUND`, `GLOSSARY_IMPORT_INVALID` |
| GET | `/api/themes` | List themes | - | `{ themes: OverlayTheme[] }` | `DB_UNAVAILABLE` |
| POST | `/api/themes` | Create custom theme or duplicate built-in | `OverlayThemeCreateRequest` | `OverlayTheme` | `THEME_NOT_FOUND`, `VALIDATION_ERROR` |
| PUT | `/api/themes/{id}` | Update theme | `OverlayThemeUpdateRequest` | `OverlayTheme` | `THEME_NOT_FOUND`, `VALIDATION_ERROR` |
| DELETE | `/api/themes/{id}` | Delete custom theme | - | `{ ok: true }` | `THEME_NOT_FOUND`, `CANNOT_DELETE_BUILT_IN_THEME`, `THEME_IN_USE` |
| GET | `/api/settings/privacy` | Read privacy settings | - | `PrivacySettings` | `DB_UNAVAILABLE` |
| PUT | `/api/settings/privacy` | Update privacy settings | `PrivacySettings` | `PrivacySettings` | `VALIDATION_ERROR`, `DB_WRITE_FAILED` |
| PUT | `/api/keys/{provider}` | Save provider API key | `{ apiKey: string }` | `{ ok: true }` | `KEYCHAIN_UNAVAILABLE`, `PROVIDER_UNKNOWN`, `VALIDATION_ERROR` |
| DELETE | `/api/keys/{provider}` | Remove provider API key | - | `{ ok: true }` | `KEYCHAIN_UNAVAILABLE`, `PROVIDER_UNKNOWN` |
| GET | `/api/diagnostics/bundle` | Build redacted diagnostics | - | `DiagnosticBundle` | `DIAGNOSTICS_FAILED` |

## Localhost HTTP Server Core
- T-006 introduces a dependency-free localhost server core in `src/server/local-api-server.js` as the executable wire-contract harness for the v1 local API. The production sidecar may wrap or port this contract to Python FastAPI, but endpoint shapes, bind restrictions, error envelopes, and privacy rules must remain compatible.
- `createLocalApiServer({ bindAddress, preferredPort, maxPortAttempts, version, overlayState, runtimeStatus, activeProfileId, allowedOrigins, allowSamePortLocalhostOrigin, overlayWsPath, appWsPath })` is the T-006 server factory.
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
  - Unsupported paths and methods return `ApiError` envelopes; raw exception text, provider keys, OCR text, translated text, captured images, and debug payloads must not be included.
  - CORS must not use `*`; responses may echo only configured local Electron origins or same-port localhost overlay origins. `allowSamePortLocalhostOrigin` defaults to `true` and may be set to `false` by a future hardened deployment that wants configured origins only.

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

## Validation Rules
- `ProfileExport` must reject forbidden fields: API keys, OCR text history, translated text history, captured image paths, screenshots, log payloads.
- `RoiRect` values must be finite numbers with positive width and height.
- `captureHz` must be `0`, `1`, `2`, `3`, or `4`; `0` means manual test mode only.
- `ocrConfidenceFloor` must be between `0` and `1`.
- `targetLang` is fixed to `"en"` in v1.
- Provider ids are controlled vocabulary values registered by the backend; v1 required ids are `deepl` and `echo`.
- Built-in theme ids are `classic_subtitle`, `stream_box`, and `minimal`; built-in themes are read-only and can only be duplicated into custom themes.

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
- `savePrivacySettings(PrivacySettings)` must call `assertPrivacySettings` before any SQLite write and persists boolean values as `0`/`1`.
- Provider API key writes are intentionally out of scope for this repository. There is no `saveProviderKey`/read-key method because `PUT /api/keys/{provider}` must use OS secure storage and return only `{ ok: true }`.
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

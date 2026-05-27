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

type OcrResult = {
  text: string;
  normalizedText: string;
  confidence: number;
  durationMs: number;
  accepted: boolean;
  rejectionReason?: string;
};

type TranslationResult = {
  sourceText: string;
  translatedText: string;
  provider: string;
  durationMs: number;
  cacheHit: boolean;
};

type SubtitleFrame = {
  id: string;
  profileId: string;
  sourceText?: string;
  translatedText: string;
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
| POST | `/api/translate/test` | Test provider with supplied text | `{ profileId: string, text: string }` | `TranslationResult` | `PROVIDER_KEY_MISSING`, `PROVIDER_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_NETWORK_ERROR` |
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

## WebSocket Endpoints
| Method | Path | Purpose | Client Sends | Server Sends | Error Codes |
|---|---|---|---|---|---|
| WS UPGRADE | `/ws/app` | App status stream | optional ping | `AppStatus` snapshots/events | `WS_REJECTED` |
| WS UPGRADE | `/ws/overlay` | OBS subtitle stream | optional ping | `SubtitleFrame` snapshots/events | `WS_REJECTED` |

## Validation Rules
- `ProfileExport` must reject forbidden fields: API keys, OCR text history, translated text history, captured image paths, screenshots, log payloads.
- `RoiRect` values must be finite numbers with positive width and height.
- `captureHz` must be `0`, `1`, `2`, `3`, or `4`; `0` means manual test mode only.
- `ocrConfidenceFloor` must be between `0` and `1`.
- `targetLang` is fixed to `"en"` in v1.
- Provider ids are controlled vocabulary values registered by the backend; v1 required ids are `deepl` and `echo`.
- Built-in theme ids are `classic_subtitle`, `stream_box`, and `minimal`; built-in themes are read-only and can only be duplicated into custom themes.

## Error Model
- Canonical error shape: `ApiError`.
- Validation error code: `VALIDATION_ERROR` with `details.fieldErrors`.
- Retryable errors: provider network failure, rate limit, backend starting, capture source temporarily unavailable, WebSocket reconnect.
- Non-retryable until user action: missing provider key, invalid provider key, profile not found, invalid import schema, forbidden export/import field, non-localhost bind attempt.
- User-facing messages should be concise and actionable; raw exception text is diagnostic-only.

## WebSocket Behavior
- `/ws/app` sends status snapshots on connection and on state changes.
- `/ws/overlay` sends the latest `SubtitleFrame` on connection if one exists, then new frames.
- Clients reconnect with exponential backoff; the server must tolerate duplicate reconnects.
- Subtitle text is transported as plain strings and escaped by the overlay before DOM insertion.
- Debug fields such as source text and confidence may be omitted from overlay frames unless debug mode is enabled.

## Data Persistence Contracts
- Normal profile/theme/glossary changes are durable immediately after successful API response.
- Translation cache may be cleared without losing profile configuration.
- Provider API keys are write-only through API; there is no endpoint that reads back a key value.
- Diagnostics bundles are generated on demand and redacted before return.

## Versioning
- Strategy: v1 local API is versioned by app release and `app_meta.schema_version`.
- Backward compatibility policy: profile exports include `schemaVersion`; imports support the current version and one previous compatible version after v1.1.
- Breaking changes require `CHANGELOG_DECISIONS.md` and `MIGRATION_PLAN.md` updates before implementation.

## API Acceptance Criteria
- [ ] `/health` proves bind address is `127.0.0.1`.
- [ ] Profile export never includes forbidden fields.
- [ ] Saving a key returns only `{ ok: true }` and key readback is impossible.
- [ ] Overlay WebSocket receives a valid `SubtitleFrame` and reconnects to the last frame.
- [ ] Malicious subtitle payloads render as text in overlay tests.
- [ ] Provider failure categories map to distinct error codes.
- [ ] Tests cover localhost bind enforcement, validation errors, redaction, and WebSocket reconnect.

## Product API Priorities
- 一時的なMVP APIではなく、選択フローの安定契約として扱う。
- 契約（request/response/error）を明確化する。
- 監視・運用を考慮したエラー分類とバージョニングを維持する。
- localhost-only、secret write-only、profile export safe by defaultを破らない。

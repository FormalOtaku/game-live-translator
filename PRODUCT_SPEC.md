# PRODUCT_SPEC

## Product Overview
- name: Game Live Translator
- type: desktop streaming utility
- delivery shape: Electron + React + TypeScript desktop app with Python 3.11 FastAPI sidecar
- owner: codex
- status: v1 core scope aligned from kickoff docs

## Goal
- Primary problem: Japanese-only games are difficult to stream to English-speaking audiences because viewers cannot follow story, dialog, choices, or tutorials from the game screen.
- Product promise: read only visible Japanese text from the user's screen, translate it to English, and render stream-ready subtitles in OBS Studio without modifying the game.
- Success metric: a first-time Windows 10/11 OBS user can complete setup, add the Browser Source URL, select an OCR region, and see an English subtitle from a Japanese test scene within 5 minutes.

## Scope
### In Scope For v1 Core
- Windows 10/11 desktop app.
- OBS Studio Browser Source overlay served from localhost.
- Japanese horizontal OCR to English subtitles.
- Capture source selection and one rectangular ROI per active profile.
- OCR preprocessing presets for common game text styles.
- Translation provider adapter architecture with user-supplied API keys.
- DeepL as the v1 baseline cloud provider adapter plus a deterministic local `echo` debug provider for tests.
- Game-specific profiles for capture ROI, OCR preset, translation provider selection, overlay theme, and glossary.
- Overlay theme editor with live preview and 1-3 line subtitle modes.
- Translation cache and duplicate OCR suppression to reduce API cost and flicker.
- Privacy-first defaults, diagnostics, and recoverable error states.
- GitHub Releases distribution target: Windows installer and portable ZIP.

### Out Of Scope For v1 Core
- Game modification, memory reading, process injection, DRM bypass, ROM/ISO/game-file parsing, or asset extraction.
- Distribution of game scripts, translated scripts, game screenshots, or game text corpora.
- Claiming official localization quality or publisher endorsement.
- macOS/Linux production packaging.
- Guaranteed vertical Japanese OCR.
- Full offline machine translation.
- OBS WebSocket automatic source creation; manual Browser Source setup is the supported path.
- Community preset marketplace, cloud sync, chat integration, TTS, and SRT/VTT export.
- Telemetry or analytics collection.

## Users
- Primary persona: streamer using Windows + OBS who plays Japanese-only retro games, JRPGs, ADV, visual novels, indie, or doujin games for an English-speaking audience.
- Secondary persona: bilingual VTuber or curator who wants better subtitle presentation, glossary control, and clear privacy boundaries.
- Contributor persona: OSS maintainer who needs explicit contracts for OCR, translation, overlay, storage, privacy, and test fixtures.

## Product Principles
- OBS-first: the primary output is an OBS Browser Source, not a generic translation window.
- No game modification: the app only reads visible pixels from user-selected screen regions.
- Privacy-first: OCR images, OCR full text, and translated full text are not persisted by default.
- User-owned provider keys: users bring their own translation API keys; keys are never logged, exported, or stored in plaintext files.
- Stream-ready UX: latency, readability, duplicate suppression, recovery, and diagnostics matter as much as OCR accuracy.
- Core open source: core features remain open source; monetization must focus on donations, support, setup help, or custom themes.

## Functional Requirements
### FR-001 Capture And ROI
- The user can select a screen or window capture source.
- The user can draw and save one rectangular OCR ROI per profile.
- The active ROI is previewed before capture starts.
- Capture frequency is profile-configurable as 0, 1, 2, 3, or 4 Hz; `0` means manual-only capture for setup/testing.
- Capture failures are shown as recoverable errors and do not crash the app.

### FR-002 OCR Pipeline
- The default OCR path recognizes Japanese horizontal text from the active ROI.
- OCR preprocessing presets include at least: `default_dialogue`, `pixel_font_dark_bg`, `pixel_font_light_bg`, `high_contrast`, `adv_textbox`, and `menu_text`.
- OCR output includes raw text, normalized text, confidence, source profile id, and timing.
- Low-confidence, empty, or noise-like OCR results are filtered before translation.
- Duplicate suppression prevents repeated translations of the same normalized text.

### FR-003 Translation Pipeline
- Translation is Japanese to English for v1.
- Translation providers are accessed through a common adapter interface; DeepL is the v1 baseline cloud adapter and `echo` is the local deterministic debug adapter.
- Provider API keys are stored only through OS secure storage.
- Missing, invalid, rate-limited, quota-exceeded, and network-failed provider states have distinct user-facing errors.
- Translation cache keys include provider, normalized source text hash, target language, and glossary revision.
- Per-profile glossary terms stabilize proper nouns and game terms.

### FR-004 OBS Overlay
- The backend serves `GET /overlay` from `http://127.0.0.1:<port>/overlay`.
- The overlay has a transparent background and renders subtitles suitable for OBS Browser Source.
- The overlay HTML is self-contained and must not load remote fonts, images, scripts, stylesheets, analytics, or telemetry.
- Subtitle updates arrive through a local WebSocket or equivalent stream.
- Incoming subtitle text is escaped and rendered as text, never interpreted as HTML.
- The overlay reconnects automatically and restores the latest subtitle state after reconnect.

### FR-005 Profiles And Themes
- Users can create, rename, duplicate, delete, import, export, and activate profiles.
- Profile exports include ROI, OCR preset, provider id, target language, theme, glossary, and capture settings.
- Profile exports never include API keys, OCR text, translated text, images, or logs.
- Users can edit font family, size, weight, colors, stroke, shadow, background box, line height, max width, position, fade, and visible line count.
- Built-in themes include at least `classic_subtitle`, `stream_box`, and `minimal`.
- Built-in themes are read-only templates; users save edits as custom themes that can be renamed, duplicated, updated, deleted, imported, and exported.

### FR-006 First-Run And Diagnostics
- First-run setup covers privacy explanation, provider choice, key entry, OBS URL copy, capture source, ROI draw, test OCR, and test translation.
- Home/Status shows backend health, active profile, port, overlay URL, capture state, last OCR status, last translation status, provider, and overlay client connection count.
- Logs/Diagnostics shows redacted operational logs and can produce a redacted diagnostic bundle.
- Backend sidecar crashes and port conflicts are recoverable through UI actions.

## Non-Functional Requirements
- Performance: typical 1-3 line dialog reaches the overlay within 1.5-2.0 seconds p50 on a reference Windows machine when the provider is healthy; cache hits should be faster.
- Reliability: a synthetic 30-minute streaming session completes without unrecovered app, backend, OCR, translation, or overlay failure.
- Security: the server binds only to `127.0.0.1`; CORS is minimal; subtitle payloads are escaped; profile import validates schema; arbitrary filesystem paths are not accepted through APIs.
- Privacy: default settings persist no OCR images, no OCR full text, and no translated full text; debug persistence requires explicit opt-in and visible warnings.
- Accessibility: all desktop UI controls are keyboard reachable, focus is visible, and UI color contrast meets WCAG AA for body text.
- Observability: logs include component, event, severity, timestamps, durations, and error codes, but never secrets or full game text by default.

## Data Requirements
- SQLite stores profiles, profile settings, glossary terms, translation cache, overlay themes, and app metadata.
- SQLite must not store provider API keys.
- `app_meta.schema_version` tracks migrations.
- Debug persistence, if implemented, is gated by explicit privacy settings and stored separately from normal operational data.
- T-007-002 locks `schema_version=1` as an executable SQLite SQL/repository boundary. The schema stores profile configuration, glossary terms, built-in/custom overlay theme metadata, privacy settings, app metadata, and translation-cache metadata only; provider keys remain OS-secure-storage-only and raw OCR text, translated text, images, screenshots, and logs are not normal SQLite payloads.

## API Impact
- v1 introduces a localhost-only internal API between Electron UI, Python sidecar, and OBS overlay.
- Stable contracts are defined in `API_SPEC.md` and include REST status/config/profile operations plus WebSocket app and overlay streams.
- Error responses use a canonical envelope and retryability classification.
- T-006 implements the executable localhost HTTP contract core first: `/health` and `/api/status` must prove the selected `127.0.0.1` bind, selected port, sanitized overlay URL, overlay client count, and canonical error shape before broader profile/capture endpoints are added.
- T-006-003 adds the executable `/ws/overlay` contract: OBS Browser Source clients can reconnect, receive the latest non-expired sanitized subtitle frame, receive live subtitle broadcasts, and update overlay client counts without exposing source text or remote network surfaces.
- T-006-004 adds the executable `/ws/app` app status stream: Electron Home/Status clients receive a sanitized `AppStatus` snapshot on connect and a fresh sanitized snapshot whenever runtime status (capture/OCR/translation) or overlay state (latest subtitle, overlay client count) changes, without exposing provider keys, raw OCR/source text, stack traces, or other debug payloads. Provider `ContractError` codes are mapped into `RuntimeStatus.state/code/message/retryable` and `ApiError.retryable` without parsing message text.
- T-006-005 adds `npm run smoke:server` as a parent-closeout smoke for the localhost API/OBS overlay server core, covering live HTTP, AppStatus WebSocket, overlay WebSocket replay/broadcast, and privacy invariants.
- T-007-001 adds the executable profile/settings contract validation boundary in `src/contracts/validation.js` and `src/contracts/security.js`. `ProfileCreateRequest`, `ProfileUpdateRequest`, `ProfileExport`, `PrivacySettings`, and `ProviderKey` write requests must pass this validator before SQLite persistence and HTTP route handlers run. `DEFAULT_PRIVACY_SETTINGS` is the privacy-first seed used by the first-run wizard and the persistence layer.
- T-007-002 adds the executable configuration repository boundary in `src/storage/sqlite-config-store.js`. It consumes the T-007-001 validators before writes, seeds `DEFAULT_PRIVACY_SETTINGS`, seeds built-in overlay themes, and exposes dependency-injected SQLite adapter calls so the future Python FastAPI sidecar can preserve the same table/parameter contract.
- T-007-003 wires the profile repository and localhost HTTP contract for profile CRUD, active profile selection, and safe profile export. Profile creates/updates validate before SQLite writes, active profile id is stored as app metadata, deleting the active profile is blocked, and exported profile JSON is validated against `ProfileExport` so API keys, OCR text, translated text, images, screenshots, and logs cannot be returned.
- T-007-004 wires overlay theme CRUD and per-profile glossary export/import into the same repository and localhost HTTP contract. Built-in themes remain read-only templates, custom themes are blocked from deletion while in use, and glossary import is all-or-nothing so invalid JSON/CSV rows cannot partially overwrite a working profile glossary.
- T-007-005 wires privacy settings and write-only provider key APIs. Privacy settings are read/updated through the SQLite repository boundary, while provider key writes/deletes go through a separate secure-store adapter only; provider keys still have no read-back API, SQLite repository method, profile export path, log path, or diagnostic payload path.
- T-007-006 adds `npm run smoke:config` as the parent-closeout smoke for the profile/configuration API core, covering live HTTP profile CRUD/active/export, theme CRUD, glossary import/export, privacy settings, provider key write/delete-only semantics, and config API privacy invariants.
- T-008-001 adds the executable capture/OCR API validation boundary in `src/contracts/validation.js`. `CaptureSourcesResponse`, `CaptureStartRequest`, `OcrTestRequest`, and `OcrResult` must pass this validator before capture/OCR route handlers are wired, so source enumeration, manual OCR testing, ROI overrides, and OCR rejection reasons share one privacy-safe shape.
- T-008-002 wires `GET /api/capture/sources` into the localhost API harness through a dependency-injected capture source provider. The route validates source lists before returning them, maps unavailable/failed/invalid enumeration to privacy-safe `CAPTURE_ENUM_FAILED`, and leaves concrete Windows monitor/window discovery to the future Electron adapter without adding persistence or native dependencies in the core contract.
- T-008-003 wires `POST /api/ocr/test` into the localhost API harness through a dependency-injected OCR test provider. The route validates the profile-bound request, uses a request ROI override or saved profile ROI, returns `ROI_MISSING` before engine calls when no ROI exists, validates the OCR engine result before responding, and maps engine failures to privacy-safe `OCR_ENGINE_ERROR` without persisting OCR text or screenshots.
- T-008-004 wires `POST /api/capture/start` and `POST /api/capture/stop` through a dependency-injected capture controller. The routes validate profile/source readiness, update sanitized capture runtime status for `/api/status` and `/ws/app`, return fixed `{ ok: true }` success envelopes, and never serialize capture frames, screenshot paths, raw OCR text, controller output, or provider keys.
- T-008-005 adds `npm run smoke:capture-ocr` as the parent-closeout smoke for the capture/OCR API core, covering live HTTP source enumeration, manual OCR success/failure, capture start/stop status, conflict behavior, and privacy invariants with injected adapters.
- T-009-001 adds the executable translation test API validation boundary in `src/contracts/validation.js`. `TranslateTestRequest` and `TranslationResult` must pass this validator before the `/api/translate/test` route is wired, so First-Run and Translation Settings share one privacy-safe shape for supplied text, provider output, and field errors.
- T-009-002 wires `POST /api/translate/test` through a dependency-injected translation provider seam. The route validates the request, loads the profile, prepares the translation input through the shared glossary/cache helper, validates provider output, and maps provider failures to canonical privacy-safe `ApiError` codes with retryability driven by `providerErrorRetryable`. Runtime translation-status broadcast remains scoped to T-009-003.
- T-009-003 adds an in-memory translation `RuntimeStatus` override inside `createLocalApiServer` so valid `/api/translate/test` attempts publish `running` before provider work, `ok` on success, and `error` on provider/input/result/profile failures via `/api/status` and `/ws/app`. Provider-vocabulary failures use `providerErrorToRuntimeStatus`; profile/DB/validation/provider-response failures fall back to a safe redacted status. The route response shape is unchanged, and supplied text, translated text, glossary entries, cache keys, provider keys, and raw exceptions never appear in the broadcast.

## UI Impact
- v1 introduces desktop screens documented in `UI_SPEC.md`: First-Run Wizard, Home/Status, Capture Setup, OCR Preview, Translation Settings, Glossary, Overlay Theme Editor, OBS Setup Guide, Profiles, Privacy Settings, Logs/Diagnostics, and About/Support.
- The OBS overlay is a separate minimal HTML surface, optimized for transparency and legibility rather than app navigation.

## Acceptance Criteria
- [ ] First-run setup can produce a visible English subtitle in OBS from a synthetic Japanese test scene within 5 minutes.
- [x] OCR, translation, cache, glossary, duplicate suppression, and overlay update work end-to-end with deterministic core fixtures.
- [ ] API keys do not appear in SQLite, exported profiles, logs, diagnostics bundles, or error messages.
- [ ] Default settings create no OCR image files, OCR full-text logs, or translation full-text logs.
- [x] The T-006 localhost server core refuses non-localhost bind configuration before listening.
- [x] T-006 localhost API/OBS overlay server core has a repeatable smoke command covering `/health`, `/api/status`, `/overlay`, `/ws/app`, and `/ws/overlay`.
- [x] T-007 profile/configuration API core has a repeatable smoke command covering profiles, themes, glossary, privacy settings, and write-only provider keys.
- [x] T-008 capture/OCR API core has a repeatable smoke command covering source enumeration, manual OCR test, capture start/stop status, and no-leak errors.
- [x] Overlay escaping is verified with malicious OCR/subtitle payload fixtures in core and overlay renderer tests.
- [ ] Capture, translation, overlay reconnect, backend restart, and port conflict have recoverable UI states.
- [ ] 1280x720, 1920x1080, and 2560x1440 overlay layouts do not clip or overlap subtitle text.
- [ ] `npm test`, `npm run build`, `npm run lint`, and Claude sidecar review evidence pass for each completed slice.

## Regression Test Strategy
- Unit: OCR normalization, confidence filtering, duplicate suppression, glossary replacement, translation cache keying, profile schema validation, SQLite configuration repository contract, redaction, HTML escaping.
- Backend integration: localhost bind, health/status, capture start/stop, OCR test, translation test, profile CRUD/import/export, privacy settings, diagnostics bundle, WebSocket streams.
- UI: first-run happy path, missing key error, provider failure, ROI save, profile CRUD, theme editing, privacy warnings, keyboard traversal.
- Overlay: frame rendering, reconnect, line count limits, transparent background, escaping, responsive safe area at required OBS resolutions.
- Manual release: 30-minute synthetic stream, OBS Browser Source setup, Windows installer and portable ZIP smoke tests.

## Product Mode Priorities
- 選択したスコープはMVPではなくproduction-grade v1として完成させる。
- 保守性・信頼性・運用性を優先する。
- エラー状態・空状態・回復導線・テスト・運用証跡を初期実装から含める。
- 仕様変更時の後方互換性を考慮する。
- プライバシーと権利リスク低減を機能要件と同等に扱う。

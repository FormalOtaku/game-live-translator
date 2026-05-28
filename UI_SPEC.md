# UI_SPEC

## UX Direction
- Product tone: calm, practical, stream-control utility.
- Design keywords: OBS-first, privacy-explicit, low-friction setup, readable diagnostics, no-surprises automation.
- Primary design constraint: the streamer may be minutes away from going live; the UI must make health, errors, and next actions obvious.
- Explicit anti-patterns:
  - Marketing-style landing pages inside the app.
  - Decorative hero cards, large empty panels, or animation-heavy onboarding.
  - Hidden network behavior or unclear cloud provider data flow.
  - Color-only status signals.
  - Raw stack traces as the primary user-facing error.

## Quality Bar
- Target: usable v1 interface for selected flows, not a placeholder MVP skin.
- Every selected flow defines success, loading, empty, error, and recovery states.
- All primary actions have clear affordances and deterministic feedback.
- Accessibility basics are required in the first implementation, not deferred to polish.

## Information Architecture
- Navigation model: persistent left sidebar grouped by workflow.
- Active profile: always visible near the top of the sidebar with a profile switcher.
- Entry points:
  - No completed setup: First-Run Wizard.
  - Existing profile: Home / Status.
  - Failed backend startup: Home / Status with recovery banner.

## Navigation Groups
- Live: Home / Status, Capture Setup, OCR Preview.
- Translation: Translation Settings, Glossary.
- Output: Overlay Theme Editor, OBS Setup Guide.
- Configure: Profiles, Privacy Settings.
- Help: Logs / Diagnostics, About / Support.

## Screen Specifications
### Screen: First-Run Wizard
- Purpose: guide a new user from first launch to a working OBS subtitle.
- Steps:
  1. Welcome and product boundary: explains no game modification and no script distribution.
  2. Privacy explanation: explains that cloud providers receive recognized text when enabled.
  3. Profile basics: profile name, optional game title, and v1 defaults.
  4. Translation provider selection.
  5. API key entry and test; key field is write-only after save.
  6. OBS Browser Source setup with copyable overlay URL.
  7. Capture source selection.
  8. ROI draw.
  9. Test OCR.
  10. Test translation.
  11. Save profile and finish.
- API sequencing: OCR and translation test endpoints are profile-bound in the current API, so the wizard persists a profile after provider, source, and ROI are valid, then runs `/api/ocr/test` and `/api/translate/test` against that profile id. The final step activates the profile through `/api/profiles/active`.
- Loading: provider validation, source enumeration, OCR, and translation steps show labeled progress.
- Empty: no windows/screens found, no provider selected, or no OCR text recognized.
- Error: invalid key, network failure, OCR engine failure, capture permission/source failure.
- Recovery: retry, go back, choose debug provider, restart backend, or open diagnostics depending on error.

### Screen: Home / Status
- Purpose: one-screen readiness check before streaming.
- Inputs: active profile selector, Start/Stop translation toggle, copy overlay URL, restart backend.
- Outputs: backend status, bound port, overlay URL, overlay client count, capture state, last OCR status, last translation status, provider, profile, and version.
- Runtime source: Home/Status consumes the core OCR-to-overlay pipeline snapshot for last OCR status, last translation status, privacy-safe cache key, and overlay client count; it must not invent alternate rejection or provider status codes.
- Backend source: Home/Status reads `/api/status` from the selected `127.0.0.1` port; the displayed overlay URL must match the backend-reported `overlayUrl` and must never be constructed from a LAN, wildcard, or user-supplied host.
- Streaming source: Home/Status subscribes to `/ws/app` (default path) on the same `127.0.0.1` port to receive `{ type: "status", status: AppStatus }` snapshots on connect and on runtime/overlay state changes. UI must trust the sanitized snapshot fields and must not parse `RuntimeStatus.message` text for retryability — `RuntimeStatus.retryable` (mapped from provider `ContractError` codes by the backend) drives retry-affordance copy. `sourceText`, raw OCR text, provider keys, stack traces, and debug payloads must never appear in the UI from `/ws/app`.
- Action contract: Home/Status exposes only safe renderer intents. Status refresh targets `GET /api/status`; live updates connect to `ws://127.0.0.1:<port>/ws/app`; capture controls target `POST /api/capture/start` with the active profile id and `POST /api/capture/stop`; copy-overlay uses the sanitized trusted backend URL only; backend restart and troubleshooting actions are host-command intents. Copy feedback is a short-lived view-model state, not blocking I/O.
- Loading: initial status fetch.
- Empty: no active profile.
- Error: backend down, port unavailable, overlay disconnected, provider unavailable.
- Recovery: restart backend, re-run setup, copy logs, open relevant settings screen.

### Screen: Capture Setup
- Purpose: choose capture source and define OCR region.
- Inputs: source picker, refresh source list, draw ROI, capture frequency 0/1/2/3/4 Hz where `0` is manual-only, manual test capture.
- Outputs: live ROI preview, coordinates, source details, capture timing.
- Renderer contract: Capture Setup uses the T-011-004 setup-screen contract to keep an in-memory profile draft for `captureSource`, `roi`, and `captureHz`, fetch source choices through `GET /api/capture/sources`, and save only allow-listed profile update fields through `PUT /api/profiles/{id}` after both a source and ROI exist. Source lists are copied into visible UI state with only `kind`, `id`, `label`, and optional `bounds`; log-safe snapshots redact labels because window titles may contain private context. Provider keys, screenshot paths, capture frames, raw OCR text, translated text, and debug payloads are not retained.
- Loading: enumerating screens/windows.
- Empty: no eligible source found.
- Error: source disappeared, capture failed, ROI out of bounds.
- Recovery: refresh sources, redraw ROI, switch source.

### Screen: OCR Preview
- Purpose: tune OCR quality before going live.
- Inputs: OCR preset, confidence floor, run OCR now, show preprocessing preview.
- Outputs: recognized text, normalized text, confidence, rejected lines with reason, timing.
- Renderer contract: OCR Preview uses `POST /api/ocr/test` with `{ profileId, roi? }` for one-shot tests and `PUT /api/profiles/{id}` for `ocrPreset` / `ocrConfidenceFloor` updates. Recognized and normalized text may appear only in the transient screen view model for the current preview; log-safe snapshots and errors redact those text fields and never persist screenshots or OCR engine debug payloads.
- Loading: OCR in progress.
- Empty: no ROI or no recognized text.
- Error: OCR engine unavailable or preprocessing failure.
- Recovery: change preset, lower confidence floor, retry, open diagnostics.

### Screen: Translation Settings
- Purpose: configure provider and test translation.
- Inputs: provider selector, write-only API key field, target language display fixed to English for v1, translation style, test translation.
- Outputs: provider status, last error, cache status, key saved indicator.
- Renderer contract: Translation Settings uses write-only `PUT /api/keys/{provider}` for key saves, `PUT /api/profiles/{id}` for provider/target-language settings, and `POST /api/translate/test` for manual provider tests. API keys and manual test text are fetch-time-only inputs exposed through intent `makeBody()` functions, not serializable state. Translated preview text may appear only in the transient screen view model; log-safe snapshots redact translated/source text and provider responses.
- Loading: provider test in progress.
- Empty: no provider selected.
- Error: missing key, invalid key, quota/rate limit, network failure, provider timeout.
- Recovery: edit key, switch provider, retry, use debug provider.

### Screen: Glossary
- Purpose: stabilize character names, proper nouns, and game terms per profile.
- Inputs: add/edit/delete terms, import/export glossary CSV or JSON through profile-scoped glossary endpoints.
- Outputs: validated term list and preview of source text after glossary substitution.
- Loading: loading profile glossary.
- Empty: no terms.
- Error: duplicate term, invalid import format.
- Recovery: edit conflicting term, download rejected import report.

### Screen: Overlay Theme Editor
- Purpose: design OBS subtitle presentation.
- Inputs: theme name, duplicate built-in theme, create custom theme, delete custom theme, font, size, weight, text color, stroke, shadow, background box, line height, max width, anchor, fade, visible lines.
- Outputs: live preview, theme JSON summary, open overlay in browser.
- Loading: theme fetch/save.
- Empty: no custom theme; show read-only built-in defaults and a duplicate action.
- Error: invalid color/font value or save failure.
- Recovery: reset field, duplicate a built-in theme, restore built-in values, retry save.

### Screen: OBS Setup Guide
- Purpose: help the user add the Browser Source manually.
- Inputs: copy URL, recommended width/height, test subtitle, connection check.
- Outputs: step list, current local URL, overlay client connected/disconnected status.
- Loading: checking overlay client.
- Empty: no Browser Source connected yet.
- Error: server down, wrong port, OBS cache issue.
- Recovery: restart backend, copy URL again, open troubleshooting.

### Screen: Profiles
- Purpose: manage game-specific configurations.
- Inputs: create, rename, duplicate, delete, activate, import, export.
- Outputs: profile table with source, ROI, OCR preset, provider, theme, updated time.
- Loading: profile list fetch.
- Empty: no profiles.
- Error: import schema failure, delete active profile blocked unless another profile is selected.
- Recovery: create default profile, inspect import errors, choose replacement active profile.

### Screen: Privacy Settings
- Purpose: make persistence and external API behavior explicit.
- Inputs: toggles for saving recent OCR text, saving translated text, and saving debug screenshots.
- Outputs: warning text, storage path, retention setting, clear-now action, current disk usage for debug data.
- Loading: settings fetch.
- Empty: no debug data exists.
- Error: cannot clear files, cannot open folder, setting save failed.
- Recovery: retry, open diagnostics, disable debug persistence.

### Screen: Logs / Diagnostics
- Purpose: troubleshoot without exposing secrets or game text by default.
- Inputs: severity filter, component filter, search, copy diagnostic bundle.
- Outputs: redacted log list, recent error summary, bundle preview.
- Loading: reading logs.
- Empty: no logs yet.
- Error: log file unavailable.
- Recovery: restart backend, copy minimal diagnostics.
- Backing API readiness: `npm run smoke:diagnostics` verifies that copy diagnostic bundle works when no provider/log state exists and that provider logs are redacted before the bundle preview can display them.

### Screen: About / Support
- Purpose: version, license, links, support/donation, setup restart.
- Inputs: re-run setup, open docs, open security policy, copy version info.
- Outputs: app version, backend version, OS summary, license and third-party notices links.
- States: success plus link-open failure handling.

## Design Tokens
- Typography:
  - UI font: Segoe UI, system-ui, sans-serif.
  - Type ramp: 12 caption, 14 body, 16 subtitle, 20 section heading, 28 page heading.
  - Line height: 1.4 body, 1.25 headings.
- Colors:
  - background `#0f1115`
  - surface `#171b24`
  - surface raised `#202636`
  - border `#30384a`
  - text primary `#edf1f7`
  - text secondary `#aab3c5`
  - accent `#6fa8ff`
  - success `#4cc38a`
  - warning `#f2c065`
  - danger `#f2727a`
- Spacing: 4, 8, 12, 16, 24, 32, 48.
- Radius: 6px controls, 8px repeated cards, 10px modals.
- Motion: 150ms standard, 220ms emphasized, disabled for `prefers-reduced-motion`.

## Accessibility
- Keyboard navigation: all controls reachable by Tab; modal focus is trapped and restored.
- Focus visibility: 2px accent outline with 2px offset.
- Color contrast threshold: WCAG AA, 4.5:1 for body text and 3:1 for large text/icons.
- Screen reader expectations: inputs have labels, errors are associated with fields, status changes use ARIA live regions in the desktop UI.
- Overlay accessibility: OBS overlay is not interactive; it must prioritize legible broadcast output through stroke/background controls.

## Responsive Rules
- Desktop app target: minimum 1100x720.
- 900-1099px: sidebar collapses to icons with tooltips.
- Below 900px: show resize guard; mobile is out of scope.
- Overlay: responsive to OBS Browser Source dimensions and anchored by theme settings.
- Overlay runtime: rendered subtitles must come from `SubtitleFrame.escapedText` in the OCR-to-overlay pipeline snapshot, not from raw OCR text, translated debug text, or debug-only source text.
- Overlay shell: `/overlay` is a transparent, non-interactive, self-contained HTML document with no remote assets; it restores the latest subtitle from `/api/status` and then listens to `/ws/overlay` for replay and live subtitle updates.

## Desktop Renderer Shell Contract
- T-011-001 adds `src/ui/desktop-shell.js` as the dependency-free pure JS renderer contract for the future Electron/React desktop UI. The module performs no persistence, has no runtime dependency on `createLocalApiServer`, and is safe to load in either the Electron main process or the renderer.
- Route registry: every first-class screen above (`first-run`, `home`, `capture-setup`, `ocr-preview`, `translation-settings`, `glossary`, `overlay-theme`, `obs-setup`, `profiles`, `privacy`, `logs-diagnostics`, `about`) is registered with a frozen `{ id, title, group, requiresSetup, sidebar, capabilities }` entry. `capabilities` always declares `loading`, `empty`, `error`, `success`, and `recovery` so missing render branches surface in review rather than at runtime. The sidebar registry excludes `first-run` and preserves the `Live → Translation → Output → Configure → Help` ordering from Navigation Groups.
- Entry route: `resolveEntryRoute(setup)` returns `first-run` when setup is incomplete and `home` when complete. `isSetupComplete({ activeProfileId, providerKeySaved, captureSourceSelected, roiSaved })` requires a non-empty active profile id and explicit boolean `true` for the other three flags; non-boolean truthy values are intentionally rejected so callers cannot smuggle partial state into the gate.
- Route normalization: `normalizeRoute(routeId, { setup?, backendRecovery? })` returns the requested id for known first-class routes, redirects `requiresSetup` routes to `first-run` when setup is incomplete, and falls back to `home` for unknown ids. Unknown ids, prototype-pollution-shaped strings, numbers, and `null`/`undefined` never echo through to the resolved route. `backendRecovery=true` is the only setup-incomplete exception: it allows Home / Status so a failed backend startup can show recovery actions before First-Run is available, but other setup-required routes still redirect to First-Run.
- Sanitized AppStatus consumption: `sanitizeAppStatus(status, { port })` returns a frozen view-model status that contains only `backend`, `activeProfileId`, `overlayUrl`, `overlayUrlTrusted`, `overlayClients`, `capture`, `ocr`, `translation`, and `lastSubtitle`. Runtime statuses are reduced to `{ state, code, retryable, updatedAt }` — `message`, raw provider exception text, provider keys, and debug payloads are dropped. `lastSubtitle` exposes only `id`, `profileId`, `themeId`, `createdAt`, `displayMs`, and `escapedText`; `sourceText`, `translatedText`, and `provider` are removed so the renderer cannot leak raw OCR/source text or provider attribution.
- Localhost overlay URL trust: `isTrustedOverlayUrl(url, { port })` requires `http://127.0.0.1:<port>/overlay` with no query, fragment, or userinfo. `localhost`, `0.0.0.0`, LAN IPs, missing ports, port mismatches, and `https://` forms are untrusted. Untrusted URLs are replaced with `null` and `overlayUrlTrusted=false` so the Home/Status copy-overlay-URL affordance never serves a non-loopback URL.
- Recovery action derivation: `deriveRecoveryActions(runtimeStatus)` reads `state`, `code`, and `retryable` only. Idle/ok/running statuses produce an empty action list. Known error codes map to a frozen controlled vocabulary (`open_translation_settings`, `edit_api_key`, `wait_and_retry`, `switch_provider`, `check_network`, `open_diagnostics`, `open_capture_setup`, `refresh_sources`, `redraw_roi`, `stop_capture`, `start_capture`, `restart_backend`, `open_profiles`). `retryable=true` prepends `retry`. Unknown codes fall back to `open_diagnostics`. `RuntimeStatus.message` text is never parsed.
- View model: `buildViewModel({ route, appStatus, port, setup })` returns a frozen `{ route, sidebar, setupComplete, status, recoveries }` snapshot. With no requested route, incomplete setup enters `first-run` and complete setup enters `home`; with a requested route, setup-required screens redirect to `first-run` until setup is complete while non-setup screens such as `about` remain reachable. The renderer harness `createDesktopShell({ port, setup, initialRoute, appStatus })` exposes `snapshot`, `navigate`, `consumeAppStatus`, `updateSetup`, and `setPort`; every method returns a new frozen view model, performs no I/O, and writes no persistence. `updateSetup` copies only the allow-listed setup fields so prototype-shaped keys cannot flip setup completion.

## First-Run Flow Contract
- T-011-002 adds `src/ui/first-run-flow.js` as the dependency-free pure JS contract for the First-Run Wizard. It performs no I/O, has no React/Electron dependency, and stores no provider API key, raw OCR text, or raw translation test text in serializable state.
- Step registry: the frozen step list is `boundary`, `privacy`, `profile-basics`, `provider`, `provider-key`, `obs-overlay`, `capture-source`, `roi`, internal `persist-profile`, `ocr-test`, `translation-test`, and `finish`. `persist-profile` is hidden from the visible stepper but is explicit in the contract because `/api/ocr/test` and `/api/translate/test` require a persisted `profileId`.
- Draft state: the wizard draft is allow-listed to `ProfileCreateRequest` fields (`name`, optional `gameTitle`, `captureSource`, `roi`, `ocrPreset`, `ocrConfidenceFloor`, `captureHz`, `translationProvider`, `targetLang`, `overlayThemeId`, `glossary`). Default draft values are privacy-safe v1 defaults (`default_dialogue`, confidence `0.6`, capture `2 Hz`, target `en`, built-in theme `classic_subtitle`, empty glossary). Unknown fields, prototype-shaped fields, API keys, and raw test text are ignored.
- Provider readiness: `echo` is treated as local debug-ready without a key; `deepl` requires successful write-only key save through `/api/keys/deepl`. The key-save intent keeps the actual key behind a non-enumerable `makeBody()` call path for fetch-time use and exposes only `{ apiKey: "[REDACTED]" }` through `safeIntentForLog`.
- HTTP intents: the flow emits frozen request descriptors for `GET /api/capture/sources`, `POST /api/profiles`, `PUT /api/keys/{provider}`, `POST /api/ocr/test`, `POST /api/translate/test`, and `PUT /api/profiles/active`. Sensitive OCR/translation/provider-key inputs are never present in `JSON.stringify(intent)` or the log-safe intent.
- Progress and setup: profile creation records only `profileId`; OCR and translation success record booleans only; final activation records `activeProfileId`. First-run completion additionally requires explicit boundary, privacy, and overlay-copy acknowledgements. `deriveDesktopSetup(state)` returns exactly the shell setup contract `{ activeProfileId, providerKeySaved, captureSourceSelected, roiSaved }` so `desktop-shell.isSetupComplete` remains the single entry-route gate.
- Error handling: `sanitizeFirstRunError(error)` accepts `ApiError`, `ContractError`, or unknown exceptions and returns only `{ code, message, retryable, fieldErrors, recoveryActions }`. Field errors are value-free, secrets are redacted, unknown exceptions collapse to `Action failed`, and recovery derives from `code`/`retryable` only.

## Home Status Actions Contract
- T-011-003 adds `src/ui/home-status-actions.js` as the dependency-free pure JS contract for the Home / Status screen. The module consumes raw `AppStatus` only by delegating through `desktop-shell.buildViewModel`, then emits a frozen home-specific view model with backend, overlay, capture, OCR, translation, and last-subtitle cards. It may pass `backendRecovery=true` only for the failed-backend-startup entry path.
- Readiness: the Home view model reports `loading`, `ready`, `warning`, or `error` from sanitized backend state, trusted overlay URL availability, overlay client count, and sanitized runtime status states. It does not parse runtime `message` text and does not invent provider/capture/OCR codes outside the desktop-shell recovery vocabulary.
- Safe actions: `buildHomeActionIntent(actionId, viewModel)` emits renderer-owned intent descriptors only: `GET /api/status`, `WS_CONNECT ws://127.0.0.1:<port>/ws/app`, `POST /api/capture/start`, `POST /api/capture/stop`, trusted clipboard copy for the backend-reported overlay URL, route navigation, or host commands such as backend restart. The module performs no fetch, WebSocket, clipboard, shell, or persistence I/O itself.
- OBS URL copy: copy action is enabled only when `desktop-shell` has accepted `http://127.0.0.1:<port>/overlay` as trusted. LAN, wildcard, `localhost`, query, fragment, userinfo, wrong-port, and missing-port URLs are unavailable and never copied. `createHomeActionFeedback` carries visible success/error feedback for the UI and redacts secrets before serialization.
- Privacy: the Home view model and intents never contain `RuntimeStatus.message`, provider keys, raw OCR/source text, translated text, provider responses, stack traces, screenshots, captured image paths, debug payloads, or untrusted overlay URLs.

## UX Acceptance Criteria
- [ ] First-run wizard is completable by keyboard only.
- [ ] Every first-class screen above has explicit loading, empty, error, success, and recovery rendering.
- [ ] Copy overlay URL gives visible confirmation and does not block the UI.
- [ ] Privacy warning appears before enabling any debug persistence.
- [ ] Provider key field never displays a stored key after save.
- [ ] Overlay theme preview updates within 500ms of local changes.
- [ ] Status screen always shows the next actionable recovery step for backend, capture, provider, and overlay failures.
- [x] Desktop renderer shell registers every first-class screen with loading/empty/error/success/recovery capabilities, routes incomplete setup-required screens to First-Run, falls back safely on unknown routes, trusts only backend-reported `http://127.0.0.1:<port>/overlay`, and derives recovery actions from RuntimeStatus.code/retryable without parsing message text.
- [x] First-run flow contract emits profile/key/capture/OCR/translation/activation HTTP intents aligned with the current localhost API, keeps API keys and raw translation test text out of serializable state/log-safe descriptors, requires boundary/privacy/overlay acknowledgements for completion, and derives the desktop setup gate from active profile, provider readiness, capture source, and ROI state.
- [x] Home/Status action contract emits trusted overlay-copy feedback state, status fetch/stream intents, capture start/stop intents, backend recovery actions, and relevant navigation/host-command intents without performing I/O or serializing raw runtime payloads.

## Product UX Priorities
- プレースホルダーUIではなく、選択フローを実用できるv1品質にする。
- 一貫した導線とエラーハンドリング。
- アクセシビリティと運用時の可観測性を考慮。
- OBS導線を短くする。
- 配信中の不安を減らす状態表示を優先する。

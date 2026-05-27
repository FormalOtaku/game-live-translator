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
  3. Translation provider selection.
  4. API key entry and test; key field is write-only after save.
  5. OBS Browser Source setup with copyable overlay URL.
  6. Capture source selection.
  7. ROI draw.
  8. Test OCR.
  9. Test translation.
  10. Save profile and finish.
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
- Loading: initial status fetch.
- Empty: no active profile.
- Error: backend down, port unavailable, overlay disconnected, provider unavailable.
- Recovery: restart backend, re-run setup, copy logs, open relevant settings screen.

### Screen: Capture Setup
- Purpose: choose capture source and define OCR region.
- Inputs: source picker, refresh source list, draw ROI, capture frequency 0/1/2/3/4 Hz where `0` is manual-only, manual test capture.
- Outputs: live ROI preview, coordinates, source details, capture timing.
- Loading: enumerating screens/windows.
- Empty: no eligible source found.
- Error: source disappeared, capture failed, ROI out of bounds.
- Recovery: refresh sources, redraw ROI, switch source.

### Screen: OCR Preview
- Purpose: tune OCR quality before going live.
- Inputs: OCR preset, confidence floor, run OCR now, show preprocessing preview.
- Outputs: recognized text, normalized text, confidence, rejected lines with reason, timing.
- Loading: OCR in progress.
- Empty: no ROI or no recognized text.
- Error: OCR engine unavailable or preprocessing failure.
- Recovery: change preset, lower confidence floor, retry, open diagnostics.

### Screen: Translation Settings
- Purpose: configure provider and test translation.
- Inputs: provider selector, write-only API key field, target language display fixed to English for v1, translation style, test translation.
- Outputs: provider status, last error, cache status, key saved indicator.
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
- Overlay shell: `/overlay` is a transparent, non-interactive, self-contained HTML document with no remote assets; it restores the latest subtitle from `/api/status` and then listens to `/ws/overlay` when that endpoint is available.

## UX Acceptance Criteria
- [ ] First-run wizard is completable by keyboard only.
- [ ] Every first-class screen above has explicit loading, empty, error, success, and recovery rendering.
- [ ] Copy overlay URL gives visible confirmation and does not block the UI.
- [ ] Privacy warning appears before enabling any debug persistence.
- [ ] Provider key field never displays a stored key after save.
- [ ] Overlay theme preview updates within 500ms of local changes.
- [ ] Status screen always shows the next actionable recovery step for backend, capture, provider, and overlay failures.

## Product UX Priorities
- プレースホルダーUIではなく、選択フローを実用できるv1品質にする。
- 一貫した導線とエラーハンドリング。
- アクセシビリティと運用時の可観測性を考慮。
- OBS導線を短くする。
- 配信中の不安を減らす状態表示を優先する。

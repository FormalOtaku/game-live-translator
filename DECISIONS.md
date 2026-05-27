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

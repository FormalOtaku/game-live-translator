# MIGRATION_PLAN

## Current Baseline
- Runtime schema version: `1` at the executable SQL/repository boundary.
- First schema seed: `app_meta.schema_version = 1`.
- v1 persistence target: SQLite in the user's app data directory.
- Current implementation note: T-007-002 defines schema SQL and repository adapter calls without binding to a concrete Node SQLite driver. The production Python FastAPI sidecar must preserve the same schema/parameter contract when it owns the real SQLite connection.

## Trigger
- What change requires migration: any change after schema implementation that alters profile, settings, glossary, translation cache, overlay theme, app metadata, profile export, or API contract compatibility.
- Owner: codex until project ownership is reassigned.

## Compatibility Strategy
- Backward compatibility window: after v1.0, support the current profile export schema and at least one previous compatible export schema.
- Dual-read / dual-write strategy: not needed before v1 schema exists. If a future storage refactor happens, implement dual-read first, then migrate, then remove old reads in a later major release.
- Secret handling: API keys are never migrated through SQLite or JSON. Key migrations must use OS secure storage APIs directly and must not expose values in logs or diagnostic bundles.

## Initial Schema Plan
1. `profiles`: profile identity, display name, optional game title, timestamps.
2. `profile_settings`: capture source, ROI JSON, OCR preset, provider id, target language, theme id, capture frequency, confidence floor.
3. `glossary_terms`: per-profile source term, target term, note.
4. `translation_cache`: provider/source hash/glossary revision metadata entries; no raw source text or translated text payloads in the default schema.
5. `overlay_themes`: theme display name and CSS/token JSON.
6. `privacy_settings`: singleton privacy settings row seeded from `DEFAULT_PRIVACY_SETTINGS`.
7. `app_meta`: schema version and feature flags.

## Schema Version 1 Boundary
- `src/storage/sqlite-config-store.js` is the executable schema/repository contract for T-007. It accepts an injected SQLite-like adapter and does not add a Node SQLite dependency.
- Fresh databases run all schema statements, set `app_meta.schema_version` to `"1"`, insert built-in overlay themes, and insert the default privacy settings row without overwriting later user changes.
- Initialization must not overwrite a non-`1` `app_meta.schema_version`; future migrations own forward movement from version 1.
- `privacy_settings` is a singleton row with `id = 1`; profile/configuration tables persist ISO timestamp columns so update ordering and migration audits remain observable.
- Profile writes validate `ProfileCreateRequest` and compute glossary revision before any SQL write, then persist `profiles`, `profile_settings`, and `glossary_terms`.
- Privacy settings writes validate `PrivacySettings` before any SQL write and store booleans as integer `0`/`1`.
- Provider API keys are excluded from all SQLite schema and repository methods. Key migrations must remain an OS secure storage concern.

## No-Migration Runtime Slices
- 2026-05-28 T-005-005: OCR-to-overlay runtime pipeline is in-memory only. It introduces no SQLite tables, no profile export schema changes, no cache persistence, and no key storage movement. Future persistence slices must decide explicitly which sanitized pipeline fields, if any, are durable.
- 2026-05-28 T-006-001: Localhost HTTP server core is in-memory only. It introduces no SQLite tables, no profile export schema changes, no persistent status store, and no key storage movement. Port selection and runtime status are process state only.
- 2026-05-28 T-006-002: OBS overlay HTML renderer is stateless and self-contained. It introduces no SQLite tables, no theme persistence, no profile export schema changes, and no key storage movement. Built-in theme CSS in this slice is runtime code only.
- 2026-05-28 T-006-003: Overlay WebSocket replay and broadcast state is in-memory only. It introduces no SQLite tables, no durable client sessions, no profile export schema changes, no cache persistence, and no key storage movement.
- 2026-05-28 T-006-004: `/ws/app` app status stream and runtime error mapping are in-memory only. They introduce no SQLite tables, no durable status store, no profile export schema changes, no cache persistence, and no key storage movement. Connected clients receive sanitized `AppStatus` snapshots derived from `OverlayState` and process-level runtime status; no migration is needed.
- 2026-05-28 T-006-005: `npm run smoke:server` and the server smoke runbook add no runtime persistence. The smoke uses in-memory fixtures and an ephemeral localhost port only; no SQLite migration, key storage migration, profile export migration, or cache migration is needed.
- 2026-05-28 T-007-001: Profile/settings contract validation is a pure validator slice in `src/contracts/`. It introduces no SQLite tables, no key storage movement, no cache persistence, and no profile export schema bump (`PROFILE_EXPORT_SCHEMA_VERSION` stays at `1`). `DEFAULT_PRIVACY_SETTINGS` is documented as the privacy-first seed that the future first-run/T-007 persistence slice must write on a fresh database; no migration is needed because there is no prior persisted PrivacySettings shape.

## Migration Steps
1. Pre-checks: confirm current `app_meta.schema_version`, backup DB, verify disk write access, verify app is not actively capturing.
2. Data/schema migration: run forward-only migration in a transaction.
3. Verification: run integrity checks, count expected rows, verify API status, verify active profile loads.
4. Cutover: update `app_meta.schema_version` only after verification passes.

## Rollback Strategy
- Rollback trigger: migration transaction fails, active profile cannot load, or privacy invariant is violated.
- Rollback steps: abort transaction when possible; otherwise restore pre-migration backup.
- Data recovery notes: translation cache may be discarded; profiles, themes, glossary, and privacy settings must be preserved.

## Verification Checklist
- [ ] Functional checks pass.
- [ ] Regression tests pass.
- [ ] Active profile loads and can be exported without forbidden fields.
- [ ] API keys are absent from SQLite and JSON exports.
- [ ] Observability logs remain redacted.
- [ ] Error rate unchanged or improved.

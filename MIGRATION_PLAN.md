# MIGRATION_PLAN

## Current Baseline
- Runtime schema version: not implemented yet.
- Planned first schema: `app_meta.schema_version = 1`.
- v1 persistence target: SQLite in the user's app data directory.

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
4. `translation_cache`: provider/source hash/glossary revision cache entries.
5. `overlay_themes`: theme display name and CSS/token JSON.
6. `app_meta`: schema version and feature flags.

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

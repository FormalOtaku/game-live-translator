# CHANGELOG_DECISIONS

## Rule
- Record one entry per major change.
- Each entry must include impact scope: DB/API/UI.
- Each entry must state regression test strategy before merge.

## Entries
### CHG-20260527-001
- Date: 2026-05-27
- Summary: Aligned the authoritative PRODUCT/UI/API specs with the kickoff documents for Game Live Translator v1 core.
- Reason: The initial spec files were placeholders. Implementation needs a concrete production-grade v1 scope before code slices start.
- Impact scope (DB/API/UI):
  - DB: SQLite becomes the v1 persistence layer for profiles, settings, glossary, translation cache, overlay themes, and app metadata. API keys must remain outside the DB.
  - API: Introduces a localhost-only FastAPI contract for health, status, capture, OCR test, translation test, profiles, themes, privacy settings, key write/delete, diagnostics, and WebSocket streams.
  - UI: Defines the first-run wizard and primary desktop screens with loading, empty, error, success, and recovery states.
- Risk: Large upfront spec surface can drift if implementation slices are not kept small.
- Regression tests added first: This is a spec-only slice. The next test slice must add contract tests that lock privacy defaults, profile export redaction, localhost-only bind, and overlay escaping before feature implementation expands.
- Migration needed: No runtime migration yet. Future implementation must start at `schema_version=1` and update MIGRATION_PLAN.md for breaking schema changes.
- Rollback plan: Revert this spec-alignment commit and restore placeholder specs if the scope is rejected before implementation begins.

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

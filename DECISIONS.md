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

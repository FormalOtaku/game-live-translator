# TASKS

## Status Rule
- `todo`: not started
- `doing`: in progress
- `blocked`: waiting external input
- `done`: complete and verified

## Slice Tracking Rule
- Use hierarchical IDs for slices (example: `T-004-001`, `T-004-002`).
- Keep exactly one `doing` slice per active parent task (WIP limit = 1).
- After each slice commit, update `STATE.md` section `Slice Progress`.
- Slice done criteria: implementation + `npm test` pass + unresolved `P1/P2=0` + `TASKS.md`/`STATE.md` sync.

## Backlog
| ID | Title | Status | Owner | Notes |
|---|---|---|---|---|
| T-003 | Add/maintain regression tests first | todo | codex | |
| T-004 | Stabilize build/test in devcontainer | todo | codex | |

## Done
| ID | Title | Date | Evidence |
|---|---|---|---|
| T-001 | Bootstrap project workflow | 2026-05-27 | GitHub SSH remote verified; Claude sidecar review imported clean with unresolved P1/P2=0; `npm test`, `npm run build`, and `npm run lint` passed |
| T-002 | Align PRODUCT/UI/API specs with kickoff scope | 2026-05-27 | PRODUCT/UI/API/brief/migration/decision specs aligned; Claude sidecar re-review clean with unresolved P1/P2=0 and must_fix=0; `npm test`, `npm run build`, and `npm run lint` passed |

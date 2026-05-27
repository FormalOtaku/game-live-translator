# STATE

## Project Snapshot
- repo_name: Game_Live_Translator
- repo_path: /home/murasaki01/Projects/Game_Live_Translator
- project_type: node
- project_mode: product
- initialized_at: 2026-05-27T11:43:37.247Z

## Runtime Commands
- build: `npm run build`
- test: `npm test`
- lint: `npm run lint`

## Workflow Default
1. `maestro_claude_team_patch` or `maestro_claude_make_patch`
2. `git apply --check` then `git apply`
   - on apply-check failure, pass stderr/stdout to next patch call as `apply_check_failure`
3. Run test command (`npm test`)
4. On failure, call `maestro_claude_fix_patch`, apply patch, rerun tests
5. `maestro_claude_team_review`
6. If `partial=true` or `needs_full_diff=true`, rerun review with complete diff
7. Create PR summary
8. Slice done criteria: implementation + tests pass + unresolved P1/P2=0 + TASKS/STATE sync
9. Review cadence: module diff per slice, full diff at parent-task completion

## Spec Sources
- product: `PRODUCT_SPEC.md`
- ui: `UI_SPEC.md`
- api: `API_SPEC.md`
- decisions: `CHANGELOG_DECISIONS.md`
- migration: `MIGRATION_PLAN.md`

## Container Workflow
- Default development environment: `.devcontainer` + `Dockerfile`
- Run build/test inside container for reproducibility

## Active Branch
- branch: main
- base_branch: origin/main

## Current Focus
- milestone:
- active_task_ids: (none)
- connectivity_checks: GitHub SSH remote verified; Claude sidecar connectivity verified through Maestro MCP

## Slice Progress (Update Every Slice)
- current_slice_prefix: T-007
- current_slice_id: T-007-004
- current_slice_goal: Theme and glossary API contracts
- current_slice_status: doing
- completed_slices: 3
- total_slices: 6
- progress_pct: 50
- next_slice_id: T-007-005
- next_slice_goal: Privacy settings and write-only key API
- last_checkpoint: 2026-05-27T20:12:43.980Z
## Session Flow
- current_session_role: execution
- recommended_next_session_role: execution
- checkpoint_status: none
- checkpoint_reason: T-007 parent still in progress; no human checkpoint required until parent closeout.
- last_completed_slice: T-007-003
- handoff_summary: T-007-003 complete: profile CRUD/active/export API core added. SQLite repository now supports list/get/update/delete/get-active/set-active/export with schema v1, reserved id rejection for active/import, transactional write checks, and safe ProfileExport validation. Local API server now exposes profile list/create/get/update/delete/activate/export routes with canonical redacted ApiError mapping and validation details. Specs/decisions/migration notes updated. Local npm test/build/lint and Docker npm test/build/lint pass; git diff --check pass; Claude sidecar T-007-003-r2 imported clean with must_fix=0 and unresolved P1/P2=0.
- next_action: continue T-007-004
- updated_at: 2026-05-27T20:12:43.978Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

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
- current_slice_prefix: T-006
- current_slice_id: T-006-002
- current_slice_goal: OBS overlay HTML renderer and safety fixtures
- current_slice_status: todo
- completed_slices: 1
- total_slices: 5
- progress_pct: 20
- next_slice_id: T-006-002
- next_slice_goal: OBS overlay HTML renderer and safety fixtures
- last_checkpoint: 2026-05-27T16:09:40.068Z
## Session Flow
- current_session_role: supervisor
- recommended_next_session_role: execution
- checkpoint_status: satisfied
- checkpoint_reason: T-006-001 review recheck satisfied: Claude sidecar T-006-001-r2 imported, must_fix=0, unresolved P1/P2=0; local and devcontainer npm test/build/lint pass.
- last_completed_slice: T-006-001
- handoff_summary: T-006-001 complete: localhost-only HTTP server core added with 127.0.0.1 bind enforcement, selected port fallback/reporting, /health, sanitized /api/status, redacted ApiError envelopes, no-wildcard CORS, and 12 focused tests. Local and devcontainer npm test/build/lint pass. Claude sidecar T-006-001-r2 review imported with must_fix=0 and unresolved P1/P2=0. Next slice is T-006-002 OBS overlay HTML renderer and safety fixtures.
- next_action: start_execution_session
- updated_at: 2026-05-27T16:09:40.065Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

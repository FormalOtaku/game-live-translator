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
- current_slice_id: T-006-003
- current_slice_goal: Overlay WebSocket replay and broadcast core
- current_slice_status: todo
- completed_slices: 2
- total_slices: 5
- progress_pct: 40
- next_slice_id: T-006-003
- next_slice_goal: Overlay WebSocket replay and broadcast core
- last_checkpoint: 2026-05-27T16:48:31.746Z
## Session Flow
- current_session_role: supervisor
- recommended_next_session_role: execution
- checkpoint_status: satisfied
- checkpoint_reason: T-006-002 review recheck satisfied: Claude sidecar T-006-002-r2 imported clean with findings=0, must_fix=0, unresolved P1/P2=0; local and devcontainer npm test/build/lint pass.
- last_completed_slice: T-006-002
- handoff_summary: T-006-002 complete: OBS overlay HTML renderer added with transparent self-contained Browser Source shell, /overlay route, no-store/CSP/nosniff headers, escapedText-only initial/live rendering, source/raw/debug text omission, no remote assets, bounded WebSocket reconnect bootstrap, theme/maxLines fallbacks, and safety fixtures. Local and devcontainer npm test/build/lint pass with 107 tests. Claude sidecar T-006-002-r2 review imported clean with findings=0, must_fix=0, unresolved P1/P2=0. Next slice is T-006-003 Overlay WebSocket replay and broadcast core.
- next_action: start_execution_session
- updated_at: 2026-05-27T16:48:31.744Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

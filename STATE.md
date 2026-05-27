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
- branch:
- base_branch:

## Current Focus
- milestone:
- active_task_ids: (none)

## Slice Progress (Update Every Slice)
- current_slice_prefix: T-001
- current_slice_id: T-001
- current_slice_goal: Bootstrap project workflow
- current_slice_status: todo
- completed_slices: 0
- total_slices: 1
- progress_pct: 0
- next_slice_id: T-001
- next_slice_goal: Bootstrap project workflow
- last_checkpoint: 2026-05-27T11:43:53.688Z
## Session Flow
- current_session_role: 
- recommended_next_session_role: spec
- checkpoint_status: none
- checkpoint_reason: 
- last_completed_slice: 
- handoff_summary: 
- next_action: start_spec_session
- updated_at: 2026-05-27T11:43:37.247Z
## Risks
-

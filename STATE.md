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
- current_slice_prefix: T-001
- current_slice_id: T-001
- current_slice_goal: Bootstrap project workflow
- current_slice_status: done
- completed_slices: 1
- total_slices: 1
- progress_pct: 100
- next_slice_id: T-002
- next_slice_goal: Align PRODUCT/UI/API specs with kickoff scope
- last_checkpoint: 2026-05-27T12:07:44+09:00
## Session Flow
- current_session_role: 
- recommended_next_session_role: spec
- checkpoint_status: ok
- checkpoint_reason: T-001 bootstrap verified with clean Claude sidecar review and passing npm test/build/lint.
- last_completed_slice: T-001
- handoff_summary: Repository remote, kickoff docs, ignore rules, and Maestro/Claude review path are ready for product spec alignment.
- next_action: start T-002 spec alignment slice
- updated_at: 2026-05-27T12:09:00+09:00
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

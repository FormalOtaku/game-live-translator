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
- active_task_ids: T-008
- connectivity_checks: GitHub SSH remote verified; Claude sidecar connectivity verified through Maestro MCP

## Slice Progress (Update Every Slice)
- current_slice_prefix: T-008
- current_slice_id: T-008-005
- current_slice_goal: Capture OCR smoke runbook and parent closeout
- current_slice_status: doing
- completed_slices: 4
- total_slices: 5
- progress_pct: 80
- next_slice_id:
- next_slice_goal:
- last_checkpoint: 2026-05-27T22:45:41.475Z
## Session Flow
- current_session_role: execution
- recommended_next_session_role: execution
- checkpoint_status: none
- checkpoint_reason: T-008 parent remains in progress; no human checkpoint required after deterministic capture start/stop route slice.
- last_completed_slice: T-008-004
- handoff_summary: T-008-004 complete: added capture start/stop API backed by injected captureController, serialized runtime operations, profile/captureSource validation, privacy-safe AppStatus updates, deterministic ok envelopes, CAPTURE_ALREADY_RUNNING and stop retry/resync semantics. Verification: local npm test 260 pass, npm run build pass, npm run lint pass, git diff --check pass; Docker game-live-translator-dev npm test 260 pass, build pass, lint pass; Claude agent-pass review T-008-004-r2 clean with unresolved P1/P2=0.
- next_action: Continue T-008-005 capture OCR smoke runbook and T-008 parent closeout.
- updated_at: 2026-05-27T22:45:41.472Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

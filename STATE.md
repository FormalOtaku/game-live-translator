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
- active_task_ids: T-009
- connectivity_checks: GitHub SSH remote verified; Claude sidecar connectivity verified through Maestro MCP

## Slice Progress (Update Every Slice)
- current_slice_prefix: T-009
- current_slice_id: T-009-004
- current_slice_goal: Translation API smoke runbook and parent closeout
- current_slice_status: doing
- completed_slices: 3
- total_slices: 4
- progress_pct: 75
- next_slice_id:
- next_slice_goal:
- last_checkpoint: 2026-05-28T00:28:51.573Z
## Session Flow
- current_session_role: execution
- recommended_next_session_role: execution
- checkpoint_status: satisfied
- checkpoint_reason: Deterministic verification and imported Claude review evidence satisfied for T-009-003; no human validation required.
- last_completed_slice: T-009-003
- handoff_summary: T-009-003 complete: /api/translate/test now publishes privacy-safe translation runtime status through /api/status and /ws/app with running/ok/error transitions, provider-vocabulary/fallback error mapping, no malformed/preflight/wrong-method mutation, and no raw source/result/glossary/cache leakage. Verification passed locally and in Docker: node --check, node --test test/local-api-server.test.js 78 pass, npm test 279 pass, npm run build/lint pass, git diff --check pass. Claude sidecar T-009-003-r3 review imported clean with must_fix=0 and unresolved P1/P2=0. T-009-004 is now doing: translation API smoke runbook and parent closeout.
- next_action: start T-009-004 translation API smoke runbook and parent closeout
- updated_at: 2026-05-28T00:28:51.570Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

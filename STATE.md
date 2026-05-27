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
- current_slice_id: T-009-003
- current_slice_goal: Translation runtime status broadcast
- current_slice_status: doing
- completed_slices: 2
- total_slices: 4
- progress_pct: 50
- next_slice_id: T-009-004
- next_slice_goal: Translation API smoke runbook and parent closeout
- last_checkpoint: 2026-05-27T23:48:10.522Z
## Session Flow
- current_session_role: supervisor
- recommended_next_session_role: execution
- checkpoint_status: satisfied
- checkpoint_reason: Deterministic verification and imported Claude review evidence satisfied for T-009-002; no human validation required.
- last_completed_slice: T-009-002
- handoff_summary: T-009-002 complete: POST /api/translate/test is wired through translateTestProvider.runTranslateTest with assertTranslateTestRequest, profile lookup, prepareTranslationInput, TranslationResult validation, provider/profile match enforcement, canonical TranslationResult serialization, provider/profile error mapping, privacy-safe redaction, and method/CORS coverage. Verification passed locally and in Docker: node --check files, node --test test/local-api-server.test.js 75 pass, npm test 276 pass, npm run build/lint pass, git diff --check pass. Claude sidecar T-009-002-r2 review imported clean with unresolved P1/P2=0 and must_fix=0. T-009-003 is now doing: translation runtime status broadcast.
- next_action: start T-009-003 translation runtime status broadcast implementation
- updated_at: 2026-05-27T23:48:10.519Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

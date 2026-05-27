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
- current_slice_id: T-009-002
- current_slice_goal: Translation test endpoint provider seam
- current_slice_status: doing
- completed_slices: 1
- total_slices: 4
- progress_pct: 25
- next_slice_id: T-009-003
- next_slice_goal: Translation runtime status broadcast
- last_checkpoint: 2026-05-27T23:20:32.994Z
## Session Flow
- current_session_role: supervisor
- recommended_next_session_role: execution
- checkpoint_status: satisfied
- checkpoint_reason: Deterministic validation and imported Claude review evidence satisfied for T-009-001; no human validation required.
- last_completed_slice: T-009-001
- handoff_summary: T-009-001 complete: translation test contract boundary is executable with validate/assert helpers for TranslateTestRequest and TranslationResult, privacy-safe focused tests, and specs/decision/migration notes. Verification passed locally and in Docker: node --check files, node --test test/contracts.test.js 69 pass, npm test 265 pass, npm run build/lint pass, git diff --check pass. Claude sidecar T-009-001-r1 review imported clean with unresolved P1/P2=0 and must_fix=0. T-009-002 is now doing: implement POST /api/translate/test provider seam.
- next_action: start T-009-002 endpoint provider seam implementation
- updated_at: 2026-05-27T23:20:32.991Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

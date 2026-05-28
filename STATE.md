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
- active_task_ids: T-010
- connectivity_checks: GitHub SSH remote verified; Claude sidecar connectivity verified through Maestro MCP

## Slice Progress (Update Every Slice)
- current_slice_prefix: T-010
- current_slice_id: T-010-003
- current_slice_goal: Diagnostics smoke runbook and parent closeout
- current_slice_status: doing
- completed_slices: 2
- total_slices: 3
- progress_pct: 67
- next_slice_id:
- next_slice_goal:
- last_checkpoint: 2026-05-28T01:46:32.788Z
## Session Flow
- current_session_role: execution
- recommended_next_session_role: execution
- checkpoint_status: satisfied
- checkpoint_reason: T-010-002 deterministic local/Docker validation passed and Claude sidecar review evidence imported clean; no human validation required.
- last_completed_slice: T-010-002
- handoff_summary: T-010-002 complete: wired GET /api/diagnostics/bundle into createLocalApiServer through optional diagnosticsProvider.collectDiagnostics(), with no-provider minimal bundle, provider metadata defaults, strict provider activeProfileId normalization, buildDiagnosticBundle/assertDiagnosticBundle validation, privacy-safe DIAGNOSTICS_FAILED mapping, method/CORS coverage, and docs/decisions/migration updates. Verification: local node checks, node --test test/local-api-server.test.js 82 pass, npm test 289 pass, npm run build/lint pass, git diff --check pass; Docker Node 20 npm test 289 pass and build/lint pass. Claude sidecar T-010-002-r2 module review imported clean with findings=2 P3, must_fix=0, unresolved P1/P2=0.
- next_action: start_execution_session
- updated_at: 2026-05-28T01:46:32.786Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

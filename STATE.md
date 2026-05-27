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
- current_slice_prefix: T-003
- current_slice_id: T-003
- current_slice_goal: Add/maintain regression tests first
- current_slice_status: done
- completed_slices: 3
- total_slices: 4
- progress_pct: 75
- next_slice_id: T-004
- next_slice_goal: Stabilize build/test in devcontainer
- last_checkpoint: 2026-05-27T12:49:01+09:00
## Session Flow
- current_session_role: 
- recommended_next_session_role: execution
- checkpoint_status: ok
- checkpoint_reason: T-003 verified with 23 passing node tests, build/lint, and clean Claude sidecar review.
- last_completed_slice: T-003
- handoff_summary: Foundational Node contract helpers now lock v1 privacy/security/API invariants before broader implementation. Tests cover localhost-only bind enforcement, profile export forbidden-field rejection, write-only API key response, diagnostics secret redaction, overlay HTML escaping, captureHz/RoiRect/ocrConfidenceFloor/targetLang/provider validation, and built-in theme delete rejection.
- next_action: start T-004 build/test stabilization and replace placeholder build/lint scripts with meaningful checks
- updated_at: 2026-05-27T12:50:00+09:00
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

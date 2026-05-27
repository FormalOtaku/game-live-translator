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
- current_slice_prefix: (none)
- current_slice_id: (none)
- current_slice_goal: (none)
- current_slice_status: (none)
- completed_slices: 0
- total_slices: 0
- progress_pct: 0
- next_slice_id: (none)
- next_slice_goal: (none)
- last_checkpoint: 2026-05-27T23:08:32.104Z
## Session Flow
- current_session_role: execution
- recommended_next_session_role: spec
- checkpoint_status: satisfied
- checkpoint_reason: T-008 deterministic closeout evidence is satisfied; no human visual/device validation required for this dependency-free API contract parent.
- last_completed_slice: T-008-005
- handoff_summary: T-008 parent complete: capture/OCR API core now has executable validators, GET /api/capture/sources, POST /api/ocr/test, POST /api/capture/start, POST /api/capture/stop, privacy-safe runtime status, and npm run smoke:capture-ocr parent closeout evidence. Verification: local npm test 261 pass, build/lint pass, smoke:capture-ocr pass, git diff --check pass; Docker game-live-translator-dev npm test 261 pass, build/lint pass, smoke:capture-ocr pass; Claude T-008-005-r3 full-diff review clean with unresolved P1/P2=0.
- next_action: Start a spec session to define the next parent task, likely concrete Windows capture/OCR adapter integration and product-level smoke, before editing new implementation files.
- updated_at: 2026-05-27T23:08:32.101Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

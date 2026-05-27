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
- current_slice_prefix: T-007
- current_slice_id: T-007-006
- current_slice_goal: Configuration API smoke runbook and parent closeout
- current_slice_status: doing
- completed_slices: 5
- total_slices: 6
- progress_pct: 83
- next_slice_id:
- next_slice_goal:
- last_checkpoint: 2026-05-27T21:03:59.614Z
## Session Flow
- current_session_role: execution
- recommended_next_session_role: execution
- checkpoint_status: none
- checkpoint_reason: T-007 parent still in progress; no human checkpoint required until parent closeout.
- last_completed_slice: T-007-005
- handoff_summary: T-007-005 complete: privacy settings GET/PUT and write-only provider key PUT/DELETE contracts landed. Added SQLite getPrivacySettings fallback, secure-store provider key write/delete boundary with no read/list method, local API privacy/key routes with redacted KEYCHAIN_UNAVAILABLE handling, malformed JSON guards, and spec/decision/migration/changelog updates. Local and Docker npm test/build/lint pass with 229 tests; git diff --check passes; Claude sidecar T-007-005-r2 clean with must_fix=0 and unresolved P1/P2=0.
- next_action: start T-007-006 configuration API smoke runbook and T-007 parent closeout
- updated_at: 2026-05-27T21:03:59.611Z
## Risks
- GitHub CLI token remains invalid, but git SSH remote is usable for repository push/pull.

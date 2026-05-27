# AGENTS.md

## Default Operation Mode (Codex Self-Driving)
Codex should execute implementation and verification directly, not just propose steps.
Prefer running all build/test steps inside the project devcontainer when available.

## Product Quality Target (Default)
- Default to a production-grade v1 outcome, not an MVP/prototype outcome.
- Do not intentionally reduce scope to "minimum viable" unless the user explicitly asks for MVP, prototype, spike, or throwaway exploration.
- Keep slices small for execution safety, but each completed slice must preserve final-product quality: real error states, usable UX, diagnostics, docs/runbook updates, regression tests, and review evidence.
- If time or context is limited, narrow the feature surface rather than lowering quality inside the selected surface.

## Natural Language Task Resolution (Required)
When the user says `next`, `continue`, `次`, `次を実装して`, or gives any vague continuation request, resolve the work item from Maestro task state before editing files.

1. Inspect `maestro progress --path . --json --no-sync-state` when available, then `.maestro/tasks.json`, `.maestro/state.json`, `TASKS.md`, and `STATE.md`.
2. Prefer the active `doing` slice. If none exists, pick the first actionable `todo` slice in the current parent queue.
3. Do not infer "next" from previous review `info`/`P3` findings, recommended tests, or free-form notes unless that work is already promoted to the active/next slice in `TASKS.md` or structured Maestro state.
4. State the selected slice ID and goal before making edits.
5. If no actionable slice exists, create or activate a small cleanup slice first; do not edit arbitrary review suggestions as implicit next work.

## Mandatory Claude Sidecar Review Evidence (Required)
Before marking any slice done, running `maestro task complete`, creating a checkpoint, or writing a final slice summary, Codex must attempt Claude sidecar review through Maestro evidence flow.

1. Prefer MCP `maestro_agent_pass_run` with `agent=claude`, `mode=review`, `control=tmux`, `claude_full_permission=false`, and the current slice id.
2. For normal slices, use module-focused scope; for parent closeout, cleanup, or PR/milestone gates, use full-diff scope.
3. Treat review as usable evidence only after `receive` and `import-review-evidence` succeed, or when the MCP tool returns an equivalent imported review evidence result.
4. Do not replace this with raw shell `maestro agent-pass run` when MCP tools are available. Do not treat `maestro_claude_team_review` handoff creation, partial output, or a failed launch as clean review evidence.
5. Do not use legacy direct review tools such as `maestro_claude_review`, `maestro_claude_security_audit`, or `maestro_claude_test_plan` as fallback evidence for this mandatory gate; they can be advisory only. The mandatory gate must stay on `maestro_agent_pass_run` / `agent-pass-auto` so the sidecar receives the captured current diff and produces importable evidence.
6. If MCP/tool approval rejects the sidecar because external Claude use is blocked by host/tenant policy, do not keep asking the user in a loop and do not attempt a workaround. Record degraded review evidence with `status=policy_blocked`, `review_completed=false`, `clean=false`, and continue only under the degraded-review fallback when deterministic verification passes.
7. If external Claude use is merely missing repo-scoped consent, ask once for explicit repo-scoped approval. After one approval attempt, treat any further host-policy rejection as `policy_blocked` evidence rather than another user prompt.
8. If sidecar review was explicitly authorized and then fails because of timeout, trust prompt, stalled TUI, or missing artifact, record degraded evidence and continue only under the documented timeout/degraded-review fallback; do not claim `review clean`.
9. Exact approval request to ask when blocked: `このrepoの code/diff/task context を Claude Code sidecar に送信して review/patch に使うことを、この Codex session で承認します。`
10. Spec-only, docs-only, and small CLI slices still require this review attempt unless the user explicitly disables Claude sidecar use for the session.

## Mandatory Loop
1. Generate patch with `maestro_claude_team_patch` (preferred) or `maestro_claude_make_patch`
2. Validate and apply patch:
   - `git apply --check <patch>`
   - `git apply <patch>`
   - If `git apply --check` fails, pass the full failure output to the next `maestro_claude_team_patch` / `maestro_claude_make_patch` call as `apply_check_failure`
3. Execute test command: `npm test` (build should be included here when possible)
4. If test/build fails:
   - call `maestro_claude_fix_patch` with full failure log and related files
   - apply returned patch
   - rerun `npm test`
   - repeat up to 2 iterations
5. Run `maestro_claude_team_review` on the resulting diff
6. Resolve every HIGH / must_fix issue
7. Generate PR summary with change list, test evidence, and review responses

## Review Cadence Policy
- Per slice: run review on module-focused diff (`src/**` + related tests/docs).
- Exclude generated artifacts (for example `dist/**`) from default review target.
- Full-diff review: run at parent-task completion (`T-xxx` unit) or milestone/merge checkpoints.
- Do not force full-diff review on every slice when module review and tests are healthy.

## Partial and Scope Rules
- If review/patch returns `partial=true`, do not use it as final decision. Rerun until non-partial, or explicitly mark human follow-up.
- If review returns `needs_full_diff=true`, rerun with complete diff.
- Respect `scope.mode` and `scope.missing_context`; triage/partial scopes require confirmation pass on full context.
- Full-diff timeout fallback (permanent rule):
  - If full-diff `team_review` times out 2 consecutive attempts, do not deadlock the loop.
  - If `merged_must_fix=[]` (or must-fix unavailable due timeout), unresolved `P1/P2=0` on module review, and `npm test` is passing, allow forward progress and commit.
  - Record this exception in `DECISIONS.md` and `TASKS.md` with a short rationale.
  - Force another full-diff attempt at the next scheduled checkpoint.

## Project Commands
- build: `npm run build`
- test: `npm test`
- lint: `npm run lint`

## Repo Manuals
- User operation guide: `USER_MANUAL_JA.md`
- Parent-task validation checklist: `PARENT_TASK_CHECKLIST_JA.md`
- Codex execution runbook: `CODEX_RUNBOOK_JA.md`
- When UI/CLI behavior is unclear, consult these manuals first, then proceed with the smallest corrective slice.

## Safety Baseline
- Never send secrets/private keys/.env content to review prompts.
- Keep diff size within tool limits; split by module when needed.
- Keep `--allowedTools ""` for claude subprocess isolation.

## Change Management Rules
- Update spec files first, then implementation:
  - `PRODUCT_SPEC.md`
  - `UI_SPEC.md`
  - `API_SPEC.md`
  - `CHANGELOG_DECISIONS.md`
  - `MIGRATION_PLAN.md`
- For every major change, record impact scope explicitly: DB/API/UI.
- Add regression tests before merge to protect existing behavior.
- After each committed slice, update progress trackers:
  - `TASKS.md` status rows
  - `STATE.md` section `Slice Progress`
  - `STATE.md` section `Session Flow`
  - `DECISIONS.md` when execution policy or scope changed
- At the end of each session, record structured handoff via `maestro session handoff ...`
- After manual validation or review recheck, record checkpoint result via `maestro checkpoint mark ok|more-evidence|mismatch`
- Run one Codex session per slice and restart for the next slice to avoid long-context degradation.

## Slice Decomposition Sizing (Required)
- Define child slices before heavy execution (`Start Active Task Prompt` or equivalent) and keep the queue explicit in `TASKS.md`.
- Recommended size per parent task (`T-xxx`):
  - target: 3-6 child slices (`T-xxx-001...`)
  - warning: 1-2 slices is usually too coarse (higher timeout/review risk)
  - warning: 7+ slices is usually too fragmented (overhead-heavy) unless scope is truly broad
- One child slice should be one PR-sized unit that can complete in one Codex session with:
  - one clear user-visible or contract-visible outcome,
  - passing tests,
  - unresolved `P1/P2=0` on module review.
- NightRun readiness should be treated as decomposition gate:
  - if `needs_decomposition`, split first and rerun readiness; avoid forcing monolith mode unless explicitly intentional.

## Slice Done Criteria (Required)
- A slice is done only when all are satisfied:
  - implementation completed,
  - `npm test` passes,
  - unresolved `P1/P2=0` on module review,
  - `TASKS.md` and `STATE.md` are synchronized.
- Keep WIP limit strict: exactly one `doing` slice for the active parent task.

## Spec Session Phases (Required)
- Run spec chat in three phases, in order:
  1. Idea elicitation: extract user intent, constraints, and success criteria.
  2. Implementation details: clarify API/data/non-functional/test/ops requirements.
  3. UI details: clarify flows, information hierarchy, and visual direction.
- Ask 1-3 questions at a time.
- At the end of each phase, list `confirmed` and `unresolved(todo)` explicitly.

## Core/UI Two-Stage Delivery Policy
Use a two-stage approach without lowering the product bar.

- Stage A: V1 Core Product
  - Implement the complete selected user flow with real contracts, error handling, observability hooks, regression tests, and a usable baseline UX.
  - Goal: user can rely on the flow without manual explanation; this is not a disposable MVP shell.
- Stage B: Experience Refinement
  - After core contracts stabilize, run dedicated UI/design slices for hierarchy, visual direction, motion, accessibility, and responsive behavior.
  - Do not defer essential UX states, accessibility basics, or error/recovery behavior to "polish" if they affect the selected flow.
- Checkpoint:
  - Before entering UI Loop, ensure core tests pass and unresolved `P1/P2=0`.

## User Checkpoint Gate (Major Feature Unit)
Codex must avoid unnecessary human checkpoints. Ask for user validation only
when the remaining validation requires human judgment or access that Codex
cannot reasonably perform.

- Codex-owned validation is the default. Do not stop for checks that can be
  verified from the terminal or local files, including:
  - `npm test`, `npm run build`, `npm run lint`, type checks, and smoke commands.
  - CLI stdout/stderr shape, JSON schema/content, exit codes, and generated file existence.
  - Static HTML/report sanity that can be checked by reading the file, parsing embedded data,
    verifying linked assets, or running a local smoke command.
  - Maestro state drift, checkpoint artifacts, review evidence import, and P1/P2/must_fix counts.
- When user-facing behavior changes, first perform an autonomous validation pass:
  - run deterministic commands and relevant smoke commands;
  - inspect representative output or generated artifacts;
  - record what was verified in the slice summary.
- Ask the user for hands-on validation only when at least one is true:
  - visual taste, product direction, wording preference, or UX feel is the actual decision;
  - browser/device/OS behavior cannot be checked by available local automation;
  - credentials, external accounts, hardware, private data, or destructive production action is required;
  - acceptance depends on the user's subjective confirmation rather than deterministic evidence.
- If human validation is required:
  - Finish loop with passing tests and unresolved `P1/P2=0`.
  - Provide a short runbook and the exact reason Codex cannot validate it alone.
  - Do not continue to the next major slice until user responds `OK` or provides correction feedback.
- If user reports mismatch:
  - Switch to Course Correction Protocol, update specs first, then resume normal loop.

## Course Correction Protocol (When Direction Drifts)
Use this protocol when manual testing reveals UX mismatch, interaction bugs, or requirement drift.

1. Capture facts first
   - Record repro steps and expected vs actual behavior in `TASKS.md` or issue notes.
2. Update spec before code
   - Revise `PRODUCT_SPEC.md` / `UI_SPEC.md` / `API_SPEC.md`.
   - Add one decision entry in `DECISIONS.md` with rationale and impact.
3. Declare impact scope
   - Mark affected areas explicitly: DB/API/UI/Tests.
4. Re-slice work
   - Break corrective work into small PR slices in `TASKS.md`.
5. Add regression tests first
   - Add/extend tests that reproduce the drift before implementing fixes.
6. Resume normal loop
   - `team_patch -> apply -> test -> fix_patch(on fail) -> team_review`.
7. Final gate
   - Run full-diff review before merge for corrected scope.

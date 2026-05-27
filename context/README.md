# Context Registry

Machine-readable subsystem knowledge for Maestro.

Files:
- `context/index.json` is the committed routing registry.
- `context/subsystems/` stores canonical subsystem docs.
- `context/failures/` stores durable failure memory.
- `.maestro/context/drift-report.json` is runtime-only derived drift state.
- Supported glob syntax is limited to `*`, `**`, and `?`.
- Patterns using `[]` or `{}` are warned on during validation.

Suggested workflow:
1. Add or update subsystem entries in `context/index.json`.
2. Write short implementation-facing docs in `context/subsystems/*.md`.
3. Run `maestro context status --path . --json` to validate the registry.
4. Run `maestro context suggest --path . --role execution --json` before a slice.
5. Run `maestro context drift --path . --json` before integration checkpoints.
6. Promote resolved review/test/night-run failures with `maestro context record-failure ...`.

Failure memory entry contract (`context/failures/<subsystem>.md`):
- `# Failure Memory: <subsystem>` header
- one `## <title>` block per incident
- metadata bullets: `recorded_at`, `source`, `evidence_path`
- required sections: `### Symptom`, `### Trigger`, `### Root Cause`, `### Fix`, `### Test Added`
- optional section: `### Notes`

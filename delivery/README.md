# Delivery Topology

This directory is the committed source of truth for multi-track delivery planning.

Files:
- `topology.json`: initiative and parent-branch registry
- `initiatives/*.md`: initiative-level planning docs
- `branches/*.md`: parent-branch-level spec deltas and integration notes

Rules:
- Keep `1 worktree = 1 active parent task`
- Use `Parent Branching` for spec or deliverable divergence
- Use `Parallel Work Lanes` for speed inside one parent branch
- Keep runtime locks and active lane state in `.maestro/parallel-work.json`, not here
- Run `maestro topology status --path . --json` to inspect registry health
- Use `maestro branch create|status|decide --path . ...` to maintain parent-branch contracts
- Use `maestro parallel status|start|complete --path . ...` to manage runtime work lanes

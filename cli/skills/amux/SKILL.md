---
name: amux
description: Run and manage persistent processes and TTYs with the bundled `amux` CLI inside Treefold-managed Sessions.
---

# amux

Use `amux` for long-lived processes whose logs or lifecycle must survive the invoking shell or Agent turn.

Inside a Treefold-managed Session, preserve the inherited `AMUX_SOCKET`, `AMUX_STATE_DIR`, `AMUX_DAEMON`, and `AMUX_WORKSPACE`. Do not create another daemon or workspace.

```bash
amux workspace inspect "$AMUX_WORKSPACE" --json
amux run --name api -- cargo run
amux ps --workspace "$AMUX_WORKSPACE"
amux logs "$AMUX_WORKSPACE/api"
```

Inspect ownership before lifecycle changes. Prefer `stop`; never stop, restart, kill, or remove the current process identified by `AMUX_PROCESS_ID`.

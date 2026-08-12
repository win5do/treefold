# Keymap configuration plan

Keymap customization is intentionally deferred. Treefold does not create or read
`keymap.toml` yet. This document fixes the intended boundary so implementation
can be added later without expanding `settings.toml` into a mixed-purpose file.

## File ownership

User overrides will live at:

```text
$TREEFOLD_HOME/config/keymap.toml
```

The file will have its own `schema_version`, independent of
`settings.toml`, because command identifiers and binding semantics evolve on a
different schedule from ordinary preferences. Built-in bindings remain
application resources; the user file stores overrides only.

An illustrative future format is:

```toml
schema_version = 1

[bindings]
"session.new_shell" = "Primary+Shift+T"
"sidebar.toggle" = "Primary+B"
"command_palette.open" = "Primary+K"
```

This example is not a supported runtime contract yet.

## Design constraints

- Commands use stable semantic IDs rather than labels, routes, or component
  names.
- `Primary` maps to Command on macOS and Control on Windows/Linux. Explicit
  platform overrides may be introduced only if this abstraction is
  insufficient.
- Missing bindings fall back to built-in defaults. Users can disable or replace
  individual defaults without copying the complete built-in map.
- Loading validates syntax, unknown command IDs, duplicate chords, reserved OS
  shortcuts, and conflicts within the same UI context.
- Settings UI and manual file edits share `keymap.toml` as the only source of
  truth. SQLite must not mirror key bindings.
- Writes are atomic and preserve unrelated keys and comments where practical.
- A newer unsupported `schema_version` is never overwritten by an older Treefold
  build.

## Deferred implementation

Implementation should begin only when commands have a centralized registry and
the product has agreed on conflict scopes. The initial delivery should include:

1. a command registry with IDs, labels, default bindings, and availability
   contexts;
2. a typed loader and validator for `keymap.toml`;
3. a resolver that merges built-in bindings with user overrides;
4. import, export, reset, and conflict feedback in Settings;
5. focused unit and UI tests for precedence, platform modifiers, disabled
   bindings, and ambiguous chords.

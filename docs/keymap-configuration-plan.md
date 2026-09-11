# Settings and keymap configuration

Treefold stores user overrides in two independent files beneath `$TREEFOLD_HOME/config`.
Each file requires `schema_version = 1`. New files contain only that header.
Missing preference keys and command bindings inherit application defaults.

## Settings

`settings.toml` supports `language` (`system`, `en-US`, `zh-CN`), `theme`
(`system`, `light`, `dark`), `agents.codex.extra_args` (an argument array), and
`amux.keep_daemon_running_on_exit` (boolean). Defaults are `system`, `system`,
`[]`, and `false`, respectively.

```toml
schema_version = 1
theme = "dark"
```

The Settings UI saves only fields changed since loading the form. GET
`/api/settings` returns the complete effective settings; PATCH accepts partial
updates. Unspecified keys and unknown file keys are preserved. An explicit
value remains an override even if it equals the current default. Existing full
configuration files are not pruned: older writes cannot be distinguished from
intentional user choices.

Restoring defaults removes the override rather than writing today's default:

```json
{"reset":["theme","agents.codex.extra_args"]}
```

`reset` accepts those four leaf paths. Values in the same PATCH are applied after
resets. The UI's Restore defaults button resets all four preferences. Users may
also remove individual keys directly in the TOML file. Settings are reloaded
from disk by the backend; reopening Settings refreshes the effective values.

## Keymap

`keymap.toml` maps stable command IDs to shortcuts. Strings override the default,
`false` disables the shortcut, and omitting the key follows the default:

```toml
schema_version = 1

[bindings]
"session.new" = "cmd+n"
"session.close" = false
```

| Command | Default | Availability |
| --- | --- | --- |
| `session.new` | `super+t` | Active Project, Workspace, or Fork |
| `session.close` | `super+w` | Current Session; same action as its close button |
| `session.next` | `ctrl+tab` | Next visible, running Session in the current scope |
| `session.previous` | `ctrl+shift+tab` | Previous visible, running Session in the current scope |

Switching follows the sidebar order and wraps at either end. New Session opens a
keyboard-accessible type and directory chooser within the current scope. It
prefers the current Session's directory, then the Project default if available,
then the first eligible directory. Type initially follows the selected Session
or the most recently created type in the current window. Search and arrow keys
select a directory; Enter creates it. Agent creation requires a ready Git directory.

Shortcuts are case-insensitive and normalized to `super+ctrl+alt+shift+key`
order, omitting modifiers that are absent. `cmd`, `command`, and `meta` are
aliases of `super`; `control` aliases `ctrl`; `opt` and `option` alias `alt`.
`super` always means the Super/Command modifier, not platform-dependent Primary.
The key is a single printable character (following the keyboard layout), F1–F24, or one of `tab`, `enter`, `space`, `backspace`,
`delete`, `arrowup`, `arrowdown`, `arrowleft`, `arrowright`, `home`, `end`,
`pageup`, `pagedown`, `plus` (the `+` key). At least one of super, ctrl, or alt is required.
Sequences and multiple bindings per command are not currently supported.

The left navigation in Settings opens the Keymap editor. Click a binding to
record a combination. Escape cancels recording; Tab leaves the recorder.
Disable writes `false`; Restore default removes the key. Changes save
immediately. The editor shows default/user/disabled state and reports conflicts.
The same active chord cannot be assigned to two commands, including defaults;
disable or rebind the existing command first. Unknown commands, invalid types,
invalid chords, and a set of reserved OS/window shortcuts are rejected without
changing the file.

GET `/api/keymap` returns registered commands, defaults, effective bindings and
sources. PATCH `/api/keymap` accepts `{"bindings":{"session.close":false}}`;
a JSON `null` binding removes its override. UI saves and direct file edits share
one source of truth. The UI refreshes Keymap every two seconds while active.
Malformed configuration is reported, not silently replaced with defaults.

Bound actions consume keyboard input before it reaches the terminal. Disabled
bindings leave the key available to the terminal. App commands are suspended
while a dialog/menu/recorder is open, during IME composition, in ordinary text
fields, or when their context is unavailable. These are application shortcuts,
not system-wide registrations. OS-reserved shortcuts remain outside Treefold's
control.

Both files preserve unrelated keys and comments during patches and use atomic
replacement. Unsupported schema versions are rejected without rewriting the
file. No preferences or bindings are mirrored into SQLite or browser storage.

## Design references

The command editor, explicit user overrides, reset, and conflict feedback draw
on [VS Code's keybinding design](https://code.visualstudio.com/docs/configure/keybindings).
Modifier aliases and consuming only executable terminal actions follow
[Ghostty's keybinding concepts](https://ghostty.org/docs/config/keybind).
Treefold uses its own TOML format; it does not import either product's syntax.

### Platform key names

Matching and API responses use canonical `super`. Configuration accepts `cmd`,
`command`, `meta`, and `win` as aliases. UI recording writes `cmd` on macOS,
`win` on Windows, and `super` elsewhere. The UI displays `⌘` on macOS and
`Win` on Windows. Updating a binding preserves other entries' original spelling.

# Settings and keymap configuration

Treefold stores user overrides in two independent files beneath `$TREEFOLD_HOME/config`.
Settings use `schema_version = 3`; keymaps use `schema_version = 1`. New files contain only their schema header.
Missing preference keys and command bindings inherit application defaults.

## Settings

`settings.toml` supports `language` (`system`, `en-US`, `zh-CN`), `theme`
(`system`, `light`, `dark`), `agents.order` and each Agent's `command` (a complete CLI launch command), and
`amux.keep_daemon_running_on_exit` (boolean). Language and theme default to `system`; launch commands default
to empty (using `codex`, `claude`, `opencode`, or `pi`), and daemon retention defaults to `false`. Agent order defaults to
Codex, Claude Code, OpenCode, Pi.

```toml
schema_version = 3
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
{"reset":["theme","agents.codex.command"]}
```

`reset` accepts preference leaf paths, `agents.order`, and each supported
Agent's `command` path. Values in the same PATCH are applied
after resets. Preferences and individual Agents have separate reset actions. Users may
also remove individual keys directly in the TOML file. Settings are reloaded
from disk by the backend; reopening Settings refreshes the effective values.

### Agent CLI settings

Settings → Agents configures Codex, Claude Code, OpenCode, and Pi. Drag rows or
use the up/down controls to set their order. New Agent Sessions select the first
installed CLI in that order. The order list and New Session only show installed
CLIs. Each Agent has an independently collapsible settings panel with its installed
version; unavailable Agents remain configurable. Installation and
login remain the user's responsibility.

```toml
[agents]
order = ["codex", "claude_code", "opencode", "pi"]

[agents.pi]
# Omit command or leave it empty to use `pi` from PATH.
command = 'pi --model "model name"'
```

Commands include the executable and its arguments. The input placeholder shows
the default command. Quoting and escapes are supported, including executable
paths with spaces. Commands are passed as an argv array without a shell; pipes,
redirection, command chaining, and command substitution are rejected. Treefold-managed
arguments cannot be overridden. Launch commands must select interactive mode:
subcommands (including `codex resume`), positional prompts/paths, explicit `--`,
and help/version modes are rejected. Each adapter declares supported option
arity, so `--model resume` remains a value while `--model x resume` is rejected.
Unknown options and short-option clusters are rejected rather than guessed;
new CLI/extension flags need an adapter rule. Pi requires separate option values
and supports its exact multi-letter short options. Known variadic options consume
their values until the next option; quote a list or repeat options where supported.
CLI option values and configuration-file contents are not fully validated here.
Settings changes take effect on the next launch.

Settings validation, executable detection, and launch use the same public parser.
Adapters are private to the agents module and only validate/build CLI arguments;
`LaunchContext` carries launch inputs without a persistence model dependency.
The public launch function validates before resolving the executable or building
arguments. Codex owns its log-directory, developer-instruction, and resume options.
Invalid settings writes leave the existing file untouched. Existing commands
outside these rules must be corrected in `settings.toml`; they are never silently
rewritten to remove arguments.
Schema 1 Codex argument arrays migrate through schema 2 strings to schema 3
commands. Schema 2 paths and arguments combine with reversible quoting, preserving
argument values and unknown settings. All four Agents support Resume of the
saved native conversation when its exact association is available. See
[Agent Sessions and metadata](agent-session-metadata.md) for provider-specific
association, validation, and legacy Session limitations.

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
initially selects the first eligible directory and the first installed Agent
in settings order. The standard chooser initially selects and focuses Shell.
The choice order is type, directory,
then Agent (when applicable). Right enters the next group. Left returns from
Agent to directory and stays in place at the directory level;
Up/Down selects within the directory or Agent group; arrow keys never switch type. Agents appear in a single column below
directories. Enter creates the Session from any choice group. Tab and Shift+Tab
switch between Shell and Agent and focus the selected directory. If no directory
is eligible, focus stays on the selected type. In the Agent-only
chooser, Tab leaves the current choice unchanged. Agent creation requires a
ready Git directory.

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

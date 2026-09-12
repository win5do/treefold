# Open With on macOS

The Project, Workspace, and Fork sidebar context menus expose **Open With**.
Project actions use the default directory; Workspace and Fork actions resolve
that owner's checkout directory. Missing directories and launch errors appear
as an error toast. The menu does not change the preferred application or write
user settings.

Supported apps are grouped in a fixed order, and only detected apps are shown:

- Finder
- VS Code, VS Code Insiders, Cursor, Zed (including Preview/Nightly), Sublime Text,
  Windsurf, IntelliJ IDEA, GoLand, RustRover, WebStorm, PyCharm, PhpStorm, Rider,
  CLion, Android Studio
- Terminal, iTerm2, Ghostty, cmux, Warp, Kitty

Discovery checks `/Applications`, `~/Applications`, the system Finder/Terminal
locations, and JetBrains Toolbox's `~/Library/Application Support/JetBrains/Toolbox/apps`.
JetBrains version-suffixed bundle names are supported. Detection refreshes when
the submenu opens; launch rechecks installation and directory existence.

The renderer sends an application ID and absolute directory through the
sandboxed preload. Main validates the sender and the ID against the catalog.
The catalog and launch service are owned by `src/main/open-in`; no arbitrary
commands or application paths are accepted from the renderer.

Editors, Finder, Terminal, and iTerm2 receive the directory through macOS `open -a`.
[iTerm2's directory-open handler](https://github.com/gnachman/iTerm2/blob/master/sources/AppKit/iTermApplicationDelegate.m)
creates a session with that working directory. Ghostty and Kitty start a new
instance with an explicit working-directory argument.
[Warp's new-window URI](https://docs.warp.dev/terminal/more-features/uri-scheme)
encodes the directory as its `path` parameter.

cmux requires its bundled `Contents/Resources/bin/cmux` CLI. Treefold opens the
App, waits for a successful read-only `ping`, then issues exactly one
[`new-workspace --cwd`](https://manaflow-ai-cmux.mintlify.app/cli/workspaces)
command. Socket access follows the user's cmux configuration; Treefold does not
change it. A rejected connection is surfaced as a launch error. Inherited
`CMUX_*` context is removed to avoid targeting the workspace that launched
Treefold.

Verification uses temporary app directories and an intercepted command runner,
a deterministic hidden Electron fixture, and the packaged preload/main bridge.
It does not launch the user's editors or terminals. App-specific behavior across
all third-party versions is outside this automated coverage.

# Linux development

Linux supports development through `just app-dev` and host-architecture packaging
through `just build`. The Linux targets are AppImage, deb and rpm.

Linux hides the native menu bar. The application menu in the lower-left corner
contains Settings, Resources, Agent Integration, update checks, About and Quit.
Service warnings appear both on the menu button and on the relevant entry.
macOS retains its native application menu as well.

## Arch Linux / KDE

Use Node.js 24.12 or newer, Rust, Git, `just`, and a working C compiler/linker.
The repository declares its Rust version in `rust-toolchain.toml`. If
`RUSTUP_TOOLCHAIN` is set, it overrides that file; check `rustup show` before
building. Node and `just` can be installed with mise if they are missing:

```sh
mise use node@24 just
```

Run from this checkout in your graphical desktop session:

```sh
npm install
# Optional: use the amux checkout next to this repository.
export TREEFOLD_AMUX_MANIFEST=../amux/Cargo.toml
just app-dev
```

Keep that export in the same shell as `just app-dev`. Without it, builds use the
locked Git revision of amux. Do not change Cargo manifests or lockfiles to select
a local checkout. See [amux development](amux-development.md) for details.

The command builds the backend, Treefold CLI and amux, stages the CLI binaries
and both Skills in `src/backend/bundle-staging/dev-sidecars`, then starts Vite
and Electron. Electron starts and supervises the backend. amux is started as
needed for Sessions. Renderer edits use HMR; `just app-dev-watch` additionally
rebuilds main, preload, backend and the selected amux source.

Development data lives in `.treefold-dev/`. `TREEFOLD_DEV_HOME` selects a different
development home, `TREEFOLD_UI_PORT` changes the renderer port (default `15011`),
and `TREEFOLD_API_PORT` selects a backend port (automatically allocated by default).
Logs are in the development home's `logs/` directory. Closing the window normally
hides it to the tray; use Quit to stop the app. amux lifetime follows the saved
`amux.keep_daemon_running_on_exit` preference.

Electron uses the desktop's display environment. Keep `DISPLAY` and
`WAYLAND_DISPLAY` available. No `--no-sandbox` flag is required for the verified
Arch KDE development setup. If Electron reports missing shared libraries,
inspect `ldd node_modules/electron/dist/electron` and install the corresponding
system packages with pacman; mise manages development tools, not desktop libraries.

If npm installation fails while downloading Electron, retry
`node node_modules/electron/install.js`, then rerun `npm install`. This downloads
the pinned binary and validates its checksum; it does not require changing the
Electron version or disabling TLS verification.

## Build and install

Install the packaging utilities on Arch (development tools can still use mise):

```sh
sudo pacman -S --needed dpkg rpm-tools libxcrypt-compat
just build
```

The build prepares release sidecars, checks TypeScript, builds Electron assets,
and emits `release/Treefold-<version>-<arch>.AppImage`, `.deb` and `.rpm`, plus
`release/linux-unpacked/` (`linux-arm64-unpacked/` on arm64). All components use
the same version; set `TREEFOLD_BUILD_VERSION` for a reproducible version value.
The default build uses the host architecture. It neither installs nor publishes.
Arch also needs `libxcrypt-compat` for electron-builder’s bundled Ruby helper.
On Debian/Ubuntu, install `rpm` and `libarchive-tools` for packaging; electron-builder
supplies its packaging helper. Git and the Electron desktop libraries are runtime
requirements. Direct AppImage execution requires FUSE 2 (`sudo pacman -S --needed
fuse2` on Arch). Without `libfuse.so.2`, use the verified extraction mode:

```sh
test_home=$(mktemp -d /tmp/treefold-manual.XXXXXX)
TREEFOLD_HOME="$test_home" APPIMAGE_EXTRACT_AND_RUN=1 \
  ./release/Treefold-0.2.0-x86_64.AppImage
```

This uses isolated application data. Quit through the application menu when
finished; closing the window normally hides it to the tray. No `--no-sandbox`
flag is needed. The extraction mode has been checked on Arch KDE; direct FUSE
launch still needs validation on a machine with FUSE 2 installed.

Packages inherit the host's libc requirements. Building on a recent Arch system
does not promise compatibility with older distributions. Release CI builds Linux
x64 on Ubuntu 24.04; test the resulting packages on each supported distribution
before expanding the compatibility claim.

`just install-app-local` builds and installs an unpacked Linux application under
`$XDG_DATA_HOME/treefold/app` (default `~/.local/share/treefold/app`), adds
`~/.local/bin/treefold-desktop` and a desktop entry. `TREEFOLD_INSTALL_DIR` overrides
the parent of `app/`. Quit the installed application before replacing it. The
installer validates the staged application and restores the previous one if
replacement fails. Package-manager installation of deb/rpm is separate.

AppImage launches copy sidecars and Agent integration resources into a
content-addressed directory below `$TREEFOLD_HOME/data/bundled-resources/`.
This keeps installed CLI/Skill symlinks and an amux daemon usable after the
AppImage unmounts. Old resource versions are retained because a daemon may still
use them. Keep the AppImage in a stable location; launching a moved AppImage and
repairing Agent integration updates its CLI launcher mapping.

## Desktop behavior

Linux defaults use `Ctrl+Shift+T` for a new Session, `Ctrl+Shift+W` to close a
Session, and `Ctrl+Shift+P` for the command palette. Explicit `keymap.toml`
overrides remain unchanged. macOS retains its existing defaults.

Open In provides Files through the system default file manager (`xdg-open`),
Terminal through a system terminal launcher or a detected common terminal, and
installed Ghostty, VS Code and Zed executables found on PATH. Terminal preference
is `xdg-terminal-exec`, then `x-terminal-emulator`, then common desktop terminals.
Arguments stay separate from directory paths, including paths containing spaces.
The Shell is selected from an executable `$SHELL`, the account's login Shell,
then `/bin/bash` or `/bin/sh`; zsh is not required.

After installing CLI integration, `treefold open` focuses or starts Treefold;
`treefold open .` opens the directory's Project or import dialog. Packaged CLI
binaries locate the adjacent GUI, and AppImage's staged CLI remembers its image
path. `TREEFOLD_DESKTOP_PATH` can explicitly select a GUI executable or AppImage.
Desktop entries and repeated CLI invocations forward directories to the existing
instance rather than starting another backend.

Update checks require a supported Linux artifact for the current architecture.
If a newer release has no matching artifact, the UI reports that separately.
Updates link to the release page for manual installation; Linux never shows
Homebrew upgrade instructions.

## Focused verification

After dependencies are installed, run:

```sh
just check-backend
just typecheck
cargo xtask backend test terminal::
npm run test:integration -- tests/integration/backend.test.ts tests/integration/terminal-startup.test.ts
npm run test:electron -- tests/electron/app-dev.test.ts
```

The development Electron test invokes `just app-dev` with an isolated temporary
home, suppresses window activation, exercises the real preload and backend,
types into a real Shell Session, and checks shutdown and restart. It requires a
graphical session and does not require a packaged macOS App. The terminal startup
integration test uses a fixture Agent; it does not require Codex authentication.
Deterministic UI fixtures use Electron offscreen rendering on Linux to keep
animations and screenshots working while their windows remain hidden. Desktop
lifecycle tests use the normal rendering backend selected by the desktop session.

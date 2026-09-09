default: check

default-home := env("HOME") + "/.treefold"
dev-home := env("TREEFOLD_DEV_HOME", justfile_directory() + "/.treefold-dev")

app-dev:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev

app-default:
    TREEFOLD_HOME="{{ default-home }}" npm run dev

app-dev-no-watch:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev:no-watch

app-default-no-watch:
    TREEFOLD_HOME="{{ default-home }}" npm run dev:no-watch

check:
    npm run typecheck
    cargo xtask database check
    cargo fmt --manifest-path backend/Cargo.toml --check
    cargo check --manifest-path backend/Cargo.toml

build:
    npm run bundle:desktop

# Build an ad-hoc signed, timestamped App + DMG and install the App in /Applications.
install-app-local:
    node scripts/install-app-local.mjs

clean:
    cargo clean --manifest-path backend/Cargo.toml
    rm -rf out dist release

# Browser-only development; desktop integration uses app-dev.
web-dev:
    npm run dev:web

test:
    npm run test:backend
    npm run test:desktop
    npm run test:ui

test-electron:
    npm run test:electron

default: check

default-home := env("HOME") + "/.treefold"
dev-home := env("TREEFOLD_DEV_HOME", justfile_directory() + "/.treefold-dev")

app-dev:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev:desktop

app-default:
    TREEFOLD_HOME="{{ default-home }}" npm run dev:desktop

app-dev-no-watch:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev:desktop -- --no-watch

app-default-no-watch:
    TREEFOLD_HOME="{{ default-home }}" npm run dev:desktop -- --no-watch

check:
    npm run typecheck
    cargo xtask database check
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
    cargo check --manifest-path src-tauri/Cargo.toml

build:
    npm run tauri build

# Build an ad-hoc signed, timestamped App + DMG and install the App in /Applications.
install-app-local:
    node scripts/install-app-local.mjs

clean:
    cargo clean --manifest-path src-tauri/Cargo.toml
    rm -rf dist

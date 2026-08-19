default: check

default-home := env("HOME") + "/.treefold"
dev-home := env("TREEFOLD_DEV_HOME", justfile_directory() + "/.treefold-dev")

install:
    npm install

app-dev:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev:desktop

app-default:
    TREEFOLD_HOME="{{ default-home }}" npm run dev:desktop

app-default-browser:
    TREEFOLD_HOME="{{ default-home }}" TREEFOLD_API_PORT="$$(node scripts/random-port.mjs)" npm run dev:desktop

app-dev-no-watch:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev:desktop -- --no-watch

app-default-no-watch:
    TREEFOLD_HOME="{{ default-home }}" npm run dev:desktop -- --no-watch

check:
    npm run typecheck
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
    cargo check --manifest-path src-tauri/Cargo.toml

build:
    npm run tauri build

clean:
    cargo clean --manifest-path src-tauri/Cargo.toml
    rm -rf dist

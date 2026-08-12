default: check

install:
    npm install

dev:
    npm run dev:desktop

dev-no-watch:
    npm run dev:desktop -- --no-watch

check:
    npm run typecheck
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
    cargo check --manifest-path src-tauri/Cargo.toml

build:
    npm run tauri build

clean:
    cargo clean --manifest-path src-tauri/Cargo.toml
    rm -rf dist

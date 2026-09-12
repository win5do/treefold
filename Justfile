default: help

# List available recipes.
help:
    @just --list

default-home := env("HOME") + "/.treefold"
dev-home := env("TREEFOLD_DEV_HOME", justfile_directory() + "/.treefold-dev")

# Start desktop development with isolated local data and hot reload.
app-dev:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev

# Start desktop development against ~/.treefold intentionally.
app-default:
    TREEFOLD_HOME="{{ default-home }}" npm run dev

# Start isolated desktop development without main/preload/Rust watching.
app-dev-no-watch:
    TREEFOLD_HOME="{{ dev-home }}" npm run dev:no-watch

# Use ~/.treefold without main/preload/Rust watching.
app-default-no-watch:
    TREEFOLD_HOME="{{ default-home }}" npm run dev:no-watch

# Run TypeScript, database, and Rust checks.
check: actions-check typecheck database-check check-backend

# Generate the Rust keymap declaration from the TypeScript action model.
actions-generate:
    npm run actions:generate

# Ensure committed Rust action metadata matches its TypeScript source.
actions-check:
    npm run actions:check

# Check application, tooling, and test TypeScript.
typecheck:
    npm run typecheck

# Check Rust formatting and compilation.
check-backend:
    cargo fmt --manifest-path src/backend/Cargo.toml --check
    cargo check --manifest-path src/backend/Cargo.toml

# Validate migrations and offline SQLx metadata.
database-check:
    cargo xtask database check

# Regenerate offline SQLx metadata after query or migration changes.
database-prepare:
    cargo xtask database prepare

# Build the standalone Rust backend.
build-backend:
    cargo build --manifest-path src/backend/Cargo.toml

# Prepare sidecars independently (dev or bundle).
prepare-sidecars mode="dev":
    cargo xtask sidecars {{ quote(mode) }}

# Build the signed App and DMG with one shared version.
build:
    node scripts/bundle-app.ts

# Build an ad-hoc signed, timestamped App + DMG and install the App in /Applications.
install-app-local:
    node scripts/install-app-local.ts

# Remove generated Rust, frontend, and packaging outputs.
clean:
    cargo clean --manifest-path src/backend/Cargo.toml
    rm -rf out dist release

# Run Rust, backend lifecycle/install, and deterministic Electron UI tests.
test: test-backend test-integration test-ui

# Run Rust tests.
test-backend:
    cargo test --manifest-path src/backend/Cargo.toml

# Build the backend before running Playwright backend and installation tests.
test-integration: build-backend
    npm run test:integration

# Run deterministic Electron UI tests.
test-ui:
    npm run test:ui

# Test packaged and development Electron lifecycles; run build first.
test-electron:
    npm run test:electron

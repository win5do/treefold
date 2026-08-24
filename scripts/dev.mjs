import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAvailablePort } from "./random-port.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriArgs = process.argv.slice(2);
const devServerPort = process.env.TREEFOLD_UI_PORT || "15011";
if (!/^\d+$/.test(devServerPort)) {
  console.error(`[treefold dev] invalid TREEFOLD_UI_PORT: ${devServerPort}`);
  process.exit(1);
}

const configuredApiPort = process.env.TREEFOLD_API_PORT;
if (configuredApiPort !== undefined && !/^\d+$/.test(configuredApiPort)) {
  console.error(`[treefold dev] invalid TREEFOLD_API_PORT: ${configuredApiPort}`);
  process.exitCode = 1;
  process.exit();
}
const apiPort = configuredApiPort || String(await findAvailablePort());

const devUrl = `http://127.0.0.1:${devServerPort}`;
const config = JSON.stringify({ build: { devUrl } });
const env = { ...process.env };
env.TREEFOLD_API_ADDR = `127.0.0.1:${apiPort}`;
env.VITE_TREEFOLD_API_BASE = `http://127.0.0.1:${apiPort}`;

const optionBoundary = tauriArgs.indexOf("--");
const tauriOptions = optionBoundary < 0 ? tauriArgs : tauriArgs.slice(0, optionBoundary);
const targetOption = tauriOptions.find((argument) => argument.startsWith("--target="));
const targetIndex = tauriOptions.findIndex((argument) => argument === "--target" || argument === "-t");
const target = targetOption?.slice("--target=".length)
  || (targetIndex >= 0 ? tauriOptions[targetIndex + 1] : undefined);
const profile = tauriOptions.includes("--release") ? "release" : "debug";
const targetDir = path.join(root, "src-tauri", "target");
const bundledBinDir = env.TREEFOLD_BUNDLED_BIN_DIR
  ? path.resolve(root, env.TREEFOLD_BUNDLED_BIN_DIR)
  : path.join(targetDir, ...(target ? [target] : []), profile);

if (!env.TREEFOLD_BUNDLED_BIN_DIR) {
  const amuxManifest = path.resolve(
    root,
    env.TREEFOLD_AMUX_MANIFEST || path.join("..", "amux", "Cargo.toml"),
  );
  if (!existsSync(amuxManifest)) {
    console.error("[treefold dev] amux source is required; set TREEFOLD_AMUX_MANIFEST");
    process.exit(1);
  }

  const cargoOptions = [
    ...(profile === "release" ? ["--release"] : []),
    ...(target ? ["--target", target] : []),
    "--target-dir", targetDir,
  ];
  const buildSidecar = (name, manifestPath) => {
    console.log(`[treefold dev] Preparing ${name} sidecar`);
    execFileSync("cargo", [
      "build", ...cargoOptions, "--bin", name, "--manifest-path", manifestPath,
    ], { cwd: root, env, stdio: "inherit" });
  };

  buildSidecar("treefold", path.join(root, "cli", "Cargo.toml"));
  buildSidecar("amux", amuxManifest);
  env.TREEFOLD_AMUX_SKILL_DIR ||= path.join(path.dirname(amuxManifest), "skills", "amux");
}
env.TREEFOLD_BUNDLED_BIN_DIR = bundledBinDir;

for (const name of ["treefold", "amux"]) {
  if (!existsSync(path.join(bundledBinDir, name))) {
    console.error(`[treefold dev] missing ${name} sidecar in ${bundledBinDir}`);
    process.exit(1);
  }
}

console.log(`[treefold dev] UI:  ${devUrl}`);
console.log(`[treefold dev] API: http://127.0.0.1:${apiPort}`);

const child = spawn("npm", ["run", "tauri", "--", "dev", "--config", config, ...tauriArgs], {
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`[treefold dev] failed to start: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

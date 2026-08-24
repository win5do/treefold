import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { findAvailablePort } from "./random-port.mjs";
import { devSidecarRoot, root, runXtask } from "./xtask.mjs";

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

const bundledBinDir = env.TREEFOLD_BUNDLED_BIN_DIR
  ? path.resolve(root, env.TREEFOLD_BUNDLED_BIN_DIR)
  : path.join(devSidecarRoot, "bin");

if (!env.TREEFOLD_BUNDLED_BIN_DIR) {
  runXtask(["sidecars", "dev", "--", ...tauriArgs], { env });
  env.TREEFOLD_AMUX_SKILL_DIR ||= path.join(devSidecarRoot, "skills", "amux");
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

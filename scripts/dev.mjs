import { spawn } from "node:child_process";
import { findAvailablePort } from "./random-port.mjs";

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

console.log(`[treefold dev] UI:  ${devUrl}`);
console.log(`[treefold dev] API: http://127.0.0.1:${apiPort}`);

const child = spawn("npm", ["run", "tauri", "--", "dev", "--config", config, ...process.argv.slice(2)], {
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

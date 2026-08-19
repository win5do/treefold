import { spawn } from "node:child_process";
import { createServer } from "node:net";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a loopback port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const devServerPort = await freePort();

const apiPort = process.env.TREEFOLD_API_PORT;
if (apiPort !== undefined && !/^\d+$/.test(apiPort)) {
  console.error(`[treefold dev] invalid TREEFOLD_API_PORT: ${apiPort}`);
  process.exitCode = 1;
  process.exit();
}

const devUrl = `http://127.0.0.1:${devServerPort}`;
const config = JSON.stringify({ build: { devUrl } });
const env = {
  ...process.env,
  TREEFOLD_DEV_SERVER_PORT: String(devServerPort),
};

if (apiPort !== undefined) {
  env.TREEFOLD_API_ADDR = `127.0.0.1:${apiPort}`;
  env.VITE_TREEFOLD_API_BASE = `http://127.0.0.1:${apiPort}`;
}

console.log(`[treefold dev] UI:  ${devUrl}`);

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

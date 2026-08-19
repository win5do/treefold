import { randomInt } from "node:crypto";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";

const MIN_PORT = 50_001;
const MAX_PORT = 60_000;
const MAX_ATTEMPTS = 32;

function availablePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function findAvailablePort() {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const port = randomInt(MIN_PORT, MAX_PORT);
    if (await availablePort(port)) return port;
  }

  throw new Error(`could not find an available port in ${MIN_PORT}-${MAX_PORT - 1}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${await findAvailablePort()}\n`);
  } catch (error) {
    console.error(`[treefold] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

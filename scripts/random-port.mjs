import { randomInt } from "node:crypto";
import { createServer } from "node:net";

const MIN_PORT = 50_000;
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

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
  const port = randomInt(MIN_PORT, MAX_PORT);
  if (await availablePort(port)) {
    process.stdout.write(`${port}\n`);
    process.exit(0);
  }
}

console.error(`[treefold] could not find an available port in ${MIN_PORT}-${MAX_PORT - 1}`);
process.exit(1);

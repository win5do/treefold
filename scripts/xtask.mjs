import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const devSidecarRoot = path.join(root, "backend", "bundle-staging", "dev-sidecars");

export function runXtask(args, { env = process.env } = {}) {
  execFileSync("cargo", ["xtask", ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  });
}

import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

test("packaged amux CLI supports runtime recovery", async () => {
  const app = process.env.TREEFOLD_ELECTRON_APP || path.resolve(
    "release", process.arch === "arm64" ? "mac-arm64" : "mac",
    "Treefold.app/Contents/MacOS/Treefold",
  );
  const executable = path.resolve(path.dirname(app), "../Resources/bin/amux");
  const home = await mkdtemp(path.join(tmpdir(), "treefold-packaged-amux-"));
  const env: NodeJS.ProcessEnv = { ...process.env, AMUX_STATE_DIR: home };
  delete env.AMUX_SOCKET;
  const run = promisify(execFile);
  try {
    // Same-version Git upgrades must ship the new CLI, not a cached old binary.
    await run(executable, ["daemon", "recover", "fixture"], { env, timeout: 60_000 });
    const { stdout } = await run(executable, ["daemon", "status", "fixture", "--json"], { env, timeout: 5_000 });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, name: "fixture", runtime: { state: "healthy" } });
  } finally {
    try {
      await run(executable, ["daemon", "stop", "fixture"], { env, timeout: 20_000 });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});

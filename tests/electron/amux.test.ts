import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { packagedResources } from './packaged-paths.ts';

test("packaged amux CLI supports runtime recovery", async () => {
  const executable = path.join(packagedResources(), 'bin/amux');
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

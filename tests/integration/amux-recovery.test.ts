import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Backend } from "../../src/main/backend.ts";

test("unresponsive amux preserves Sessions across backend restart and recovers explicitly", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp("/tmp/treefold-amux-recovery-");
  const home = path.join(root, "home");
  const repository = path.join(root, "repository");
  const run = promisify(execFile);
  const service = () => new Backend({
    executable: path.resolve(process.env.TREEFOLD_BACKEND_PATH || "src/backend/target/debug/treefold-backend"),
    env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: "127.0.0.1:0" },
  });
  let backend = service();
  let api = "";
  let suspendedPid: number | undefined;
  const registration = async () => {
    const directory = path.join(home, "data/amux/daemons");
    const name = (await readdir(directory, { withFileTypes: true })).find(entry => entry.isDirectory())!.name;
    return JSON.parse(await readFile(path.join(directory, name, "daemon.json"), "utf8")) as { pid: number; instance_id: string };
  };
  const request = async (resource: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${api}${resource}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(response.ok, await response.clone().text()).toBeTruthy();
    return response.status === 204 ? undefined : response.json();
  };
  try {
    await mkdir(repository);
    await run("git", ["init", "-b", "main", repository]);
    await run("git", ["-C", repository, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "fixture"]);
    api = await backend.start();
    await request("/api/settings", "PATCH", { amux: { keep_daemon_running_on_exit: true } });
    const project = await request("/api/projects", "POST", { name: "Recovery", path: repository });
    const session = await request(`/api/projects/${project.id}/sessions`, "POST", { kind: "shell" });
    await expect.poll(async () => (await request(`/api/sessions/${session.id}`)).initializing).toBe(false);
    expect((await request(`/api/sessions/${session.id}`)).status).toBe("running");
    const old = await registration();
    await backend.stop();
    process.kill(old.pid, "SIGSTOP");
    suspendedPid = old.pid;
    backend = service();
    api = await backend.start();
    const status = await request("/api/amux");
    expect(status.state).toBe("unresponsive");
    expect(status.recovery_available).toBe(true);
    expect((await request(`/api/sessions/${session.id}`)).status).toBe("running");
    await request("/api/settings", "PATCH", { amux: { keep_daemon_running_on_exit: false } });
    await request("/api/amux/recover", "POST");
    suspendedPid = undefined;
    expect((await registration()).instance_id).not.toBe(old.instance_id);
    expect((await request("/api/amux")).state).toBe("healthy");
    // Preserve a shim's recorded exit result, or report a failed execution if
    // forced recovery interrupted the shim before it could record that result.
    expect(["exited", "failed"]).toContain((await request(`/api/sessions/${session.id}`)).status);
  } finally {
    if (suspendedPid) { try { process.kill(suspendedPid, "SIGCONT"); } catch { /* already exited */ } }
    if (api) {
      await fetch(`${api}/api/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amux: { keep_daemon_running_on_exit: false } }) }).catch(() => {});
    }
    await backend.stop();
    await rm(root, { recursive: true, force: true });
  }
});

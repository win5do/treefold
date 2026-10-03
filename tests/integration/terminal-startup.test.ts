import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, readdir } from "node:fs/promises";
import path from "node:path";
import { Backend } from "../../src/main/backend.ts";

test("Codex waits for the controlling terminal, then probes colors on the same amux PID", async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp("/tmp/treefold-terminal-startup-");
  const bin = path.join(root, "bin");
  const repository = path.join(root, "repository");
  const started = path.join(root, "started.json");
  const result = path.join(root, "probe.json");
  const run = promisify(execFile);
  const sockets: WebSocket[] = [];
  let api: string | undefined;
  const ownedPids = new Set<number>();
  const processes = async () => (await run("ps", ["-axo", "pid=,ppid=,stat="])).stdout.trim().split("\n").map(line => {
    const [pid, parent, state] = line.trim().split(/\s+/);
    return { pid: Number(pid), parent: Number(parent), state };
  });
  const rememberRuntime = async () => {
    const directory = path.join(root, "home/data/amux/daemons");
    for (const name of await readdir(directory).catch(() => [] as string[])) {
      const registration = await readFile(path.join(directory, name, "daemon.json"), "utf8").catch(() => "");
      if (registration) ownedPids.add(JSON.parse(registration).pid);
    }
    const snapshot = await processes();
    let changed = true;
    while (changed) {
      changed = false;
      for (const process of snapshot) {
        if (ownedPids.has(process.parent) && !ownedPids.has(process.pid)) {
          ownedPids.add(process.pid);
          changed = true;
        }
      }
    }
  };
  const backend = new Backend({
    executable: path.resolve(process.env.TREEFOLD_BACKEND_PATH || "src/backend/target/debug/treefold-backend"),
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TREEFOLD_HOME: path.join(root, "home"), CODEX_HOME: path.join(root, "codex-home"), TREEFOLD_API_ADDR: "127.0.0.1:0" },
  });
  try {
    await mkdir(bin);
    await mkdir(repository);
    await run("git", ["init", "-b", "main", repository]);
    await run("git", ["-C", repository, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "fixture"]);
    await writeFile(path.join(bin, "codex"), `#!${process.execPath}
const fs = require('node:fs');
const started = ${JSON.stringify(started)};
const result = ${JSON.stringify(result)};
const dir = require('node:path').join(process.env.CODEX_HOME, 'sessions');
fs.mkdirSync(dir, {recursive: true});
const instructions = JSON.parse(process.argv.find(arg => arg.startsWith('developer_instructions=')).slice('developer_instructions='.length));
const meta = id => JSON.stringify({type: 'session_meta', timestamp: new Date().toISOString(), payload: {id, cwd: process.cwd(), timestamp: new Date().toISOString()}}) + '\\n';
// A simultaneous standalone Codex in the same cwd must never be associated.
fs.writeFileSync(dir + '/ghostty.jsonl', meta('standalone-codex'));
fs.writeFileSync(dir + '/managed.jsonl', meta('managed-codex'));
setTimeout(() => fs.appendFileSync(dir + '/managed.jsonl', JSON.stringify({type: 'response_item', payload: {role: 'developer', content: [{type: 'input_text', text: instructions}]}}) + '\\n'), 350);

fs.writeFileSync(started, JSON.stringify({pid: process.pid, rows: process.stdout.rows, cols: process.stdout.columns, amuxIoMode: process.env.AMUX_IO_MODE}));
process.stdin.setRawMode(true);
process.stdin.resume();
let received = '';
let done = false;
function finish(ok) {
  if (done) return;
  done = true;
  fs.writeFileSync(result, JSON.stringify({ok, received}));
}
process.stdin.on('data', data => {
  received += data.toString();
  if (received.includes(']10;rgb:') && received.includes(']11;rgb:')) finish(true);
});
process.stdout.write(${JSON.stringify("\x1b]10;?\x1b\\\x1b]11;?\x1b\\")});
setTimeout(() => finish(false), 100);
`, { mode: 0o755 });
    api = await backend.start();
    const post = async (resource: string, body: unknown = {}) => {
      const response = await fetch(`${api}${resource}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.ok, await response.clone().text()).toBeTruthy();
      return response.status === 204 ? undefined : response.json();
    };
    const project = await post("/api/projects", { name: "Terminal startup", path: repository });
    const session = await post(`/api/projects/${project.id}/sessions`, { kind: "codex" });
    expect(session.argv[0]).toBe(path.join(bin, "codex"));
    const exists = (file: string) => access(file).then(() => true, () => false);
    // Deliberately exceed Codex's probe deadline before attaching any terminal.
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(await exists(started)).toBe(false);

    const attach = async (identity: string) => {
      const socket = new WebSocket(`${api!.replace("http:", "ws:")}/api/sessions/${session.id}/terminal?controller_client_id=${identity}&input_client_id=${identity}&after_output_sequence=0`);
      sockets.push(socket);
      socket.binaryType = "arraybuffer";
      let ownership = "";
      let sequence = 0;
      let output = "";
      let responded = false;
      socket.addEventListener("message", event => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          if (message.type === "ownership_state") ownership = message.state;
        } else if (event.data instanceof ArrayBuffer) {
          output += new TextDecoder().decode(new Uint8Array(event.data, 8));
          if (ownership === "controller" && !responded && output.includes("]11;?")) {
            responded = true;
            socket.send(JSON.stringify({ type: "input", sequence: ++sequence, data: Buffer.from("\x1b]10;rgb:eeee/eeee/eeee\x1b\\\x1b]11;rgb:1111/1313/1515\x1b\\").toString("base64") }));
          }
        }
      });
      await expect.poll(() => ownership).not.toBe("");
      return { socket, ownership };
    };
    const controller = await attach("controller");
    expect(controller.ownership).toBe("controller");
    const readonly = await attach("observer");
    expect(readonly.ownership).toBe("readonly");
    readonly.socket.send(JSON.stringify({ type: "terminal_ready", rows: 33, cols: 99 }));
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await exists(started)).toBe(false);
    const processViews = await (await fetch(`${api}/api/processes`)).json();
    const pid = processViews.find((process: { session_id: string }) => process.session_id === session.id)?.pid;
    expect(pid).toBeGreaterThan(0);
    controller.socket.send(JSON.stringify({ type: "terminal_ready", rows: 33, cols: 99 }));
    await expect.poll(() => exists(result)).toBe(true);
    expect(JSON.parse(await readFile(started, "utf8"))).toEqual({ pid, rows: 33, cols: 99, amuxIoMode: "tty" });
    expect(JSON.parse(await readFile(result, "utf8")).ok).toBe(true);
    const currentSession = async () => (await fetch(`${api}/api/sessions/${session.id}`)).json();
    await expect.poll(async () => (await currentSession()).agent_session_id, { timeout: 10_000 }).toBe("managed-codex");
    expect((await currentSession()).status).toBe("running");
    await post(`/api/sessions/${session.id}/stop`);
    expect((await currentSession()).agent_session_id).toBe("managed-codex");

    // Stopping a still-waiting Session must not launch the target afterward.
    await rm(started);
    const cancelled = await post(`/api/projects/${project.id}/sessions`, { kind: "codex" });
    await post(`/api/sessions/${cancelled.id}/stop`);
    expect(await exists(started)).toBe(false);
    const restart = await fetch(`${api}/api/sessions/${cancelled.id}/restart`, {method: "POST"});
    expect(restart.status).toBe(409);
    expect((await restart.json()).error.code).toBe("CODEX_SESSION_ID_PENDING");
    expect(await exists(started)).toBe(false);

    // Metadata flushed at shutdown must also be recovered for a stopped Session.
    const shutdownId = "shutdown-codex";
    await writeFile(path.join(root, "codex-home/sessions/shutdown.jsonl"), [
      {type: "session_meta", payload: {id: shutdownId, cwd: cancelled.original_cwd}},
      {type: "response_item", payload: {role: "developer", content: [{text: `<treefold_runtime_context>${JSON.stringify({session: {id: cancelled.id}})}</treefold_runtime_context>`}]}},
    ].map(value => JSON.stringify(value)).join("\n") + "\n");
    await rememberRuntime();
    await post("/api/amux/stop");
    const recovered = await (await fetch(`${api}/api/sessions/${cancelled.id}`)).json();
    expect(recovered.agent_session_id).toBe(shutdownId);
    expect(recovered.status).toBe("stopped");

    // The daemon is offline, but its persisted process still reserves this name.
    // The very first Restart must remove that record after bringing amux online.
    await rememberRuntime();
    await Promise.all(sockets.map(socket => new Promise<void>(resolve => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.addEventListener("close", () => resolve(), {once: true});
      socket.close();
    })));
    await expect.poll(async () => (await (await fetch(`${api}/api/amux`)).json()).running, { timeout: 15_000 }).toBe(false);
    const resumed = await post(`/api/sessions/${session.id}/restart`);
    expect(resumed.status).toBe("running");
    expect(resumed.agent_session_id).toBe("managed-codex");
    expect(resumed.argv).toContain("resume");
    expect(resumed.argv).toContain("managed-codex");
    expect(await exists(started)).toBe(false);
    const resumedController = await attach("resumed-controller");
    resumedController.socket.send(JSON.stringify({ type: "terminal_ready", rows: 33, cols: 99 }));
    await expect.poll(() => exists(started)).toBe(true);
    await post(`/api/sessions/${session.id}/stop`);

  } finally {
    try {
      await rememberRuntime();
      await Promise.all(sockets.map(socket => new Promise<void>(resolve => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.addEventListener("close", () => resolve(), {once: true});
        socket.close();
      })));
      if (api) await fetch(`${api}/api/amux/stop`, { method: "POST" });
    } finally {
      await backend.stop();
      // A stop response acknowledges the request; daemon and shims may still write.
      await expect.poll(async () => (await processes()).filter(process => ownedPids.has(process.pid) && !process.state.startsWith("Z")), {
        message: "isolated amux daemon and descendants must exit before removing their files", timeout: 15_000,
      }).toEqual([]);
      await rm(root, { recursive: true, force: true });
    }
  }
});

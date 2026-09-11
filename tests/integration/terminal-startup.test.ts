import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
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
  const backend = new Backend({
    executable: path.resolve(process.env.TREEFOLD_BACKEND_PATH || "src/backend/target/debug/treefold-backend"),
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TREEFOLD_HOME: path.join(root, "home"), TREEFOLD_API_ADDR: "127.0.0.1:0" },
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
fs.writeFileSync(started, JSON.stringify({pid: process.pid, rows: process.stdout.rows, cols: process.stdout.columns}));
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
    expect(session.argv[0]).toBe("codex");
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
    const processes = await (await fetch(`${api}/api/processes`)).json();
    const pid = processes.find((process: { session_id: string }) => process.session_id === session.id)?.pid;
    expect(pid).toBeGreaterThan(0);
    controller.socket.send(JSON.stringify({ type: "terminal_ready", rows: 33, cols: 99 }));
    await expect.poll(() => exists(result)).toBe(true);
    expect(JSON.parse(await readFile(started, "utf8"))).toEqual({ pid, rows: 33, cols: 99 });
    expect(JSON.parse(await readFile(result, "utf8")).ok).toBe(true);
    await post(`/api/sessions/${session.id}/stop`);

    // Stopping a still-waiting Session must not launch the target afterward.
    await rm(started);
    const cancelled = await post(`/api/projects/${project.id}/sessions`, { kind: "codex" });
    await post(`/api/sessions/${cancelled.id}/stop`);
    expect(await exists(started)).toBe(false);
  } finally {
    for (const socket of sockets) socket.close();
    try {
      if (api) await fetch(`${api}/api/amux/stop`, { method: "POST" });
    } finally {
      await backend.stop();
      await rm(root, { recursive: true, force: true });
    }
  }
});

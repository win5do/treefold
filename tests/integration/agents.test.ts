import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Backend } from '../../src/main/backend.ts';

// Inert executables exercise the real API -> adapter -> amux launch chain without credentials.
test('Agents receive context, capture identity and title, and resume their native conversation', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'treefold-agent-launch-')));
  const home = path.join(root, 'home');
  const repository = path.join(root, 'repository with spaces');
  const executable = path.resolve(process.env.TREEFOLD_BACKEND_PATH || 'src/backend/target/debug/treefold-backend');
  const backend = new Backend({ executable, env: { ...process.env, CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), OPENCODE_CONFIG_DIR: path.join(root, 'opencode'), OPENCODE_CLI_CONFIG_CONTENT: '{"plugins":["-fixture.disabled"]}', OPENCODE_CONFIG_CONTENT: '{ /* retained */ "model": "test/model", "instructions": [], }', TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' }, timeout: 15000 });
  let url: string | undefined;
  const sockets: WebSocket[] = [];
  const ownedPids = new Set<number>();
  try {
    await mkdir(repository);
    execFileSync('git', ['init', repository]);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial']);
    url = await backend.start();
    const request = async (route: string, body: unknown, method = 'POST') => fetch(`${url}${route}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const projectResponse = await request('/api/projects', { name: 'Agent launch test', path: repository });
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json();
    const agents: Record<string, { command: string }> = {};
    for (const kind of ['codex', 'claude_code', 'opencode', 'pi']) {
      agents[kind] = { command: JSON.stringify(path.join(root, `missing-${kind}`)) };
    }
    expect((await request('/api/settings', { agents, amux: { keep_daemon_running_on_exit: true } }, 'PATCH')).ok).toBe(true);
    for (const kind of Object.keys(agents)) {
      const failed = await request(`/api/projects/${project.id}/sessions`, { kind });
      expect(failed.status).toBe(400);
      expect(await failed.text()).toContain('not installed');
    }
    expect(await (await fetch(`${url}/api/projects/${project.id}/sessions`)).json()).toEqual([]);
    const settingsPath = path.join(home, 'config/settings.toml');
    const savedSettings = await readFile(settingsPath, 'utf8');
    for (const [kind, command] of [
      ['codex', 'codex resume previous'],
      ['claude_code', 'claude --model sonnet update'],
      ['opencode', 'opencode run task'],
      ['pi', 'pi --mode rpc'],
    ]) {
      const invalid = await request('/api/settings', { agents: { [kind]: { command } } }, 'PATCH');
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).toMatch(/subcommands|managed by Treefold/);
      expect(await readFile(settingsPath, 'utf8')).toBe(savedSettings);
    }
    const attach = async (id: string) => {
      const socket = new WebSocket(`${url!.replace("http:", "ws:")}/api/sessions/${id}/terminal?controller_client_id=fixture-${id}&input_client_id=fixture-${id}`);
      sockets.push(socket);
      socket.addEventListener("message", event => {
        if (typeof event.data !== "string") return;
        const message = JSON.parse(event.data);
        if (message.type === "ownership_state" && message.state === "controller") {
          socket.send(JSON.stringify({ type: "terminal_ready", rows: 33, cols: 99 }));
        }
      });
      return socket;
    };
    for (const kind of ['codex', 'claude_code', 'opencode', 'pi']) {
      const script = path.join(root, `${kind} cli`);
      await writeFile(`${script}.cjs`, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('1.2.3'); process.exit(0); }
const kind = ${JSON.stringify(kind)};
const nativeId = kind === 'opencode' ? 'ses_' + process.env.TREEFOLD_SESSION_ID : process.env.TREEFOLD_SESSION_ID.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const value = flag => args[args.indexOf(flag) + 1];
const write = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, data); };
const line = value => JSON.stringify(value) + '\\n';
(async () => {
  let instructions;
  let effectiveCwd = process.cwd();
  if (kind === 'codex') {
    const dir = JSON.parse(args.find(arg => arg.startsWith('log_dir=')).slice('log_dir='.length));
    write(path.join(dir, 'codex-tui.log'), 'time INFO session_loop{thread_id=' + nativeId + '}: codex_core::session: new\\n');
    write(path.join(process.env.CODEX_HOME, 'session_index.jsonl'), line({ id:nativeId, thread_name:'Fixture title', updated_at:'2026-10-03' }));
    instructions = JSON.parse(args.find(arg => arg.startsWith('developer_instructions=')).slice('developer_instructions='.length));
  } else if (kind === 'claude_code') {
    write(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'fixture', nativeId + '.jsonl'), line({type:'user', sessionId:nativeId}) + line({type:'custom-title', sessionId:nativeId, customTitle:'Fixture title'}));
    instructions = value('--append-system-prompt');
  } else if (kind === 'pi') {
    if (!fs.existsSync(value('--session'))) write(value('--session'), line({type:'session', version:3, id:nativeId, cwd:process.cwd()}) + line({type:'session_info',name:'Fixture title'}));
    effectiveCwd = JSON.parse(fs.readFileSync(value('--session'),'utf8').split('\\n')[0]).cwd;
    instructions = value('--append-system-prompt');
  } else {
    const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
    instructions = fs.readFileSync(config.instructions.at(-1), 'utf8');
  }
  if (!args.includes('No hook')) {
    if (kind === 'codex' || kind === 'claude_code') {
      const command = kind === 'codex'
        ? args.find(arg => arg.startsWith('hooks.SessionStart=')).match(/command='([^']+)'/)[1]
        : JSON.parse(fs.readFileSync(path.join(value('--plugin-dir'), 'hooks/hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command;
      require('node:child_process').execFileSync('/bin/sh', ['-c', command], { input: JSON.stringify({ session_id: nativeId }) });
    } else if (kind === 'pi') {
      const extension = await import(require('node:url').pathToFileURL(value('--extension')).href);
      extension.default({on: (_event, callback) => callback({reason:'startup'}, {sessionManager:{getSessionId:()=>nativeId}})});
    } else {
      const tui = JSON.parse(process.env.OPENCODE_CLI_CONFIG_CONTENT);
      const extension = await import(require('node:url').pathToFileURL(path.join(tui.plugins[0], 'tui.js')).href);
      const dispose = extension.default.setup({ui:{router:{current:()=>({type:'session',sessionID:nativeId})}},data:{session:{get:()=>({id:nativeId}),root:id=>id}}});
      dispose();
    }
  }
  process.stdout.write('\\x1b]2;Fixture title\\x07');
  fs.appendFileSync(path.join(process.env.TREEFOLD_HOME, 'launch-' + process.env.TREEFOLD_SESSION_ID + '.jsonl'), line({pid:process.pid, cwd:effectiveCwd, args, instructions, nativeId}));
  process.stdin.resume();
})().catch(error => { console.error(error); process.exit(1); });
`, { mode: 0o700 });
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      await writeFile(script, `#!/bin/sh\nif [ "$1" = --version ]; then printf '1.2.3\\n'; exit 0; fi\nexec ${quote(process.execPath)} ${quote(`${script}.cjs`)} "$@"\n`, { mode: 0o700 });
      const args = "--model 'model with spaces $HOME;$(echo literal)'";
      expect((await request('/api/settings', { agents: { [kind]: { command: `${JSON.stringify(script)} ${args}` } } }, 'PATCH')).ok).toBe(true);
      const system = await (await fetch(`${url}/api/system`)).json();
      expect(system.agents.find((agent: { kind: string }) => agent.kind === kind)).toMatchObject({ available: true, executable: script, version: "1.2.3" });
      const createdResponse = await request(`/api/projects/${project.id}/sessions`, { kind, initial_prompt: "Initial task" });
      expect(createdResponse.status).toBe(201);
      const session = await createdResponse.json();
      expect(session.kind).toBe(kind);
      const record = path.join(home, `launch-${session.id}.jsonl`);
      const launches = async (): Promise<{pid:number; cwd:string; args:string[]; instructions:string; nativeId:string}[]> => (await readFile(record, 'utf8').catch(() => '')).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      const firstSocket = await attach(session.id);
      await expect.poll(async () => (await launches()).length).toBe(1);
      const first = (await launches())[0]; ownedPids.add(first.pid);
      expect(first.cwd).toBe(repository);
      expect(first.args.slice(0, 2)).toEqual(['--model', 'model with spaces $HOME;$(echo literal)']);
      expect(first.args).toContain("Initial task");
      expect(first.instructions).toContain(session.id);
      expect(first.instructions).toContain("read_only");
      const current = async () => (await fetch(`${url}/api/sessions/${session.id}`)).json();
      await expect.poll(async () => (await current()).agent_session_id, { timeout: 10000 }).toBe(first.nativeId);
      await expect.poll(async () => (await current()).terminal_title, { timeout: 10000 }).toBe('Fixture title');
      expect((await current()).name).toBe(({codex:'Codex',claude_code:'Claude Code',opencode:'OpenCode',pi:'Pi'} as Record<string,string>)[kind]);
      if (kind === 'opencode') {
        // Reopen the backend with invalid inherited config while amux retains the
        // existing conversation. Resume must fail before stopping/removing it.
        const inlineConfig = backend.env.OPENCODE_CONFIG_CONTENT;
        await backend.stop();
        const persisted = new DatabaseSync(path.join(home, 'data/treefold_1.sqlite'), {readOnly:true});
        try { expect(persisted.prepare('SELECT terminal_title FROM sessions WHERE id = ?').get(session.id)?.terminal_title).toBe('Fixture title'); }
        finally { persisted.close(); }
        backend.env.OPENCODE_CONFIG_CONTENT = '{';
        url = await backend.start();
        const nativeProcess = async () => {
          const processes = await (await fetch(`${url}/api/processes`)).json();
          return processes.find((process: { session_id: string }) => process.session_id === session.id);
        };
        await expect.poll(async () => (await nativeProcess())?.pid).toBe(first.pid);
        const invalidResume = await request(`/api/sessions/${session.id}/restart`, {});
        expect(invalidResume.status).toBe(409);
        expect(await invalidResume.text()).toContain('Invalid OPENCODE_CONFIG_CONTENT');
        expect((await nativeProcess()).pid).toBe(first.pid);
        expect((await current()).status).toBe('running');
        expect((await launches()).length).toBe(1);
        expect(() => process.kill(first.pid, 0)).not.toThrow();
        await backend.stop();
        backend.env.OPENCODE_CONFIG_CONTENT = inlineConfig;
        url = await backend.start();
      }
      expect((await request(`/api/sessions/${session.id}/stop`, {})).ok).toBe(true);
      await new Promise<void>(resolve => {
        if (firstSocket.readyState === WebSocket.CLOSED) return resolve();
        firstSocket.addEventListener("close", () => resolve(), { once: true });
        firstSocket.close();
      });
      if (kind === 'pi') {
        // Native Pi uses the persisted header cwd, even when its parent starts elsewhere.
        const history = first.args[first.args.indexOf('--session') + 1];
        const text = await readFile(history, 'utf8');
        const end = text.indexOf("\n");
        const header = JSON.parse(text.slice(0, end));
        header.cwd = path.join(root, 'removed-worktree');
        await writeFile(history, JSON.stringify(header) + text.slice(end));
      }
      expect((await request('/api/settings', { agents: { [kind]: { command: `${JSON.stringify(script)} --model restarted` } } }, 'PATCH')).ok).toBe(true);
      const resumed = await request(`/api/sessions/${session.id}/restart`, {});
      expect(resumed.ok, `${kind}: ${await resumed.clone().text()}`).toBe(true);
      await attach(session.id);
      await expect.poll(async () => (await launches()).length).toBe(2);
      const second = (await launches())[1]; ownedPids.add(second.pid);
      expect(second.args.slice(0, 2)).toEqual(['--model', 'restarted']);
      expect(second.cwd).toBe(repository);
      expect(second.args).not.toContain('Initial task');
      expect((await current()).agent_session_id).toBe(first.nativeId);
      if (kind !== 'pi') expect(second.args).toContain(first.nativeId);
      expect((await request(`/api/sessions/${session.id}/stop`, {})).ok).toBe(true);
      expect((await current()).terminal_title).toBe('Fixture title');
      const database = new DatabaseSync(path.join(home, 'data/treefold_1.sqlite'), {readOnly:true});
      try { expect(database.prepare('SELECT terminal_title FROM sessions WHERE id = ?').get(session.id)?.terminal_title).toBe('Fixture title'); }
      finally { database.close(); }

      const withoutHook = await (await request(`/api/projects/${project.id}/sessions`, {kind, initial_prompt:'No hook'})).json();
      await attach(withoutHook.id);
      const uncaptured = async () => (await fetch(`${url}/api/sessions/${withoutHook.id}`)).json();
      await expect.poll(async () => (await uncaptured()).terminal_title, {timeout:10000}).toBe('Fixture title');
      expect((await uncaptured()).agent_session_id).toBeUndefined();
      expect((await request(`/api/sessions/${withoutHook.id}/stop`, {})).ok).toBe(true);
      const rejected = await request(`/api/sessions/${withoutHook.id}/restart`, {});
      expect(rejected.status).toBe(409);
      expect(await rejected.text()).toContain('Hook or extension');
      expect((await uncaptured()).id).toBe(withoutHook.id);
      expect((await request('/api/settings', { agents: { [kind]: { command: JSON.stringify(path.join(root, 'missing')) } } }, 'PATCH')).ok).toBe(true);
      expect((await request(`/api/sessions/${session.id}/restart`, {})).status).toBe(400);
      expect((await current()).id).toBe(session.id);
    }
  } finally {
    for (const name of await readdir(path.join(home, 'data/amux/daemons')).catch(() => [] as string[])) {
      const data = await readFile(path.join(home, 'data/amux/daemons', name, 'daemon.json'), 'utf8').catch(() => '');
      if (data) ownedPids.add(JSON.parse(data).pid);
    }
    for (const socket of sockets) socket.close();
    try { if (url) await fetch(`${url}/api/amux/stop`, {method:'POST'}); } finally { await backend.stop(); }
    await expect.poll(() => [...ownedPids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), {timeout:15000}).toEqual([]);
    await rm(root, { recursive: true, force: true });
  }
});

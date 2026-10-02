import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Backend } from '../../src/main/backend.ts';

// Inert executables exercise the real API -> adapter -> amux launch chain without credentials.
test('installed Agent CLIs receive literal arguments and cwd; missing CLIs cannot create Sessions', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'treefold-agent-launch-')));
  const home = path.join(root, 'home');
  const repository = path.join(root, 'repository with spaces');
  const executable = path.resolve(process.env.TREEFOLD_BACKEND_PATH || 'src/backend/target/debug/treefold-backend');
  const backend = new Backend({ executable, env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' }, timeout: 15000 });
  try {
    await mkdir(repository);
    execFileSync('git', ['init', repository]);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial']);
    const url = await backend.start();
    const request = async (route: string, body: unknown, method = 'POST') => fetch(`${url}${route}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const projectResponse = await request('/api/projects', { name: 'Agent launch test', path: repository });
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json();
    const agents: Record<string, { command: string }> = {};
    for (const kind of ['codex', 'claude_code', 'opencode', 'pi']) {
      agents[kind] = { command: JSON.stringify(path.join(root, `missing-${kind}`)) };
    }
    expect((await request('/api/settings', { agents }, 'PATCH')).ok).toBe(true);
    for (const kind of Object.keys(agents)) {
      const failed = await request(`/api/projects/${project.id}/sessions`, { kind });
      expect(failed.status).toBe(400);
      expect(await failed.text()).toContain('not installed');
    }
    expect(await (await fetch(`${url}/api/projects/${project.id}/sessions`)).json()).toEqual([]);
    for (const kind of ['claude_code', 'opencode', 'pi']) {
      const script = path.join(root, `${kind} cli`);
      await writeFile(script, '#!/bin/sh\nif [ "$1" = --version ]; then printf "1.2.3\\n"; exit 0; fi\nprintf "%s\\n" "$PWD" "$@" > "$TREEFOLD_HOME/launch-$TREEFOLD_SESSION_ID.txt"\n', { mode: 0o700 });
      const args = '--model "model with spaces" --test-value \'$HOME;$(echo literal)\'';
      expect((await request('/api/settings', { agents: { [kind]: { command: `${JSON.stringify(script)} ${args}` } } }, 'PATCH')).ok).toBe(true);
      const system = await (await fetch(`${url}/api/system`)).json();
      expect(system.agents.find((agent: { kind: string }) => agent.kind === kind)).toMatchObject({ available: true, executable: script, version: "1.2.3" });
      const createdResponse = await request(`/api/projects/${project.id}/sessions`, { kind });
      expect(createdResponse.status).toBe(201);
      const session = await createdResponse.json();
      expect(session.kind).toBe(kind);
      const record = path.join(home, `launch-${session.id}.txt`);
      await expect.poll(async () => readFile(record, 'utf8').catch(() => '')).toBe(`${repository}\n--model\nmodel with spaces\n--test-value\n$HOME;$(echo literal)\n`);
      expect(session.argv).toEqual([script, '--model', 'model with spaces', '--test-value', '$HOME;$(echo literal)']);
      expect((await request('/api/settings', { agents: { [kind]: { command: `${JSON.stringify(script)} --model restarted` } } }, 'PATCH')).ok).toBe(true);
      expect((await request(`/api/sessions/${session.id}/restart`, {})).ok).toBe(true);
      await expect.poll(async () => readFile(record, 'utf8').catch(() => '')).toBe(`${repository}\n--model\nrestarted\n`);
      expect((await request('/api/settings', { agents: { [kind]: { command: JSON.stringify(path.join(root, 'missing')) } } }, 'PATCH')).ok).toBe(true);
      expect((await request(`/api/sessions/${session.id}/restart`, {})).status).toBe(400);
      const sessions = await (await fetch(`${url}/api/projects/${project.id}/sessions`)).json();
      expect(sessions.some((item: { id: string }) => item.id === session.id)).toBe(true);
    }
  } finally {
    await backend.stop();
    await rm(root, { recursive: true, force: true });
  }
});

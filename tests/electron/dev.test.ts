import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function until(check: () => boolean | Promise<boolean>, description: string, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

test('electron-vite watches main, preload and Rust while releasing the previous backend', async () => {
  test.setTimeout(240000);
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-vite-'));
  let output = '';
  const child = spawn(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'dev', '--watch'], {
    detached: true,
    env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_UI_PORT: String(await availablePort()), TREEFOLD_API_ADDR: '127.0.0.1:0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const runningUntil = (check: () => boolean | Promise<boolean>, description: string) => until(() => {
    if (child.exitCode !== null || child.signalCode) throw new Error(`Dev process exited (${child.exitCode ?? child.signalCode})`);
    return check();
  }, description);
  const endpoints = () => [...output.matchAll(/\[treefold dev\] API: (http:\/\/127\.0\.0\.1:\d+)/g)].map(match => match[1]);
  const readyCount = async () => ((await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => '')).match(/Treefold .* ready; API/g) || []).length;
  const touch = (file: string) => utimes(file, new Date(), new Date());
  try {
    await runningUntil(async () => await readyCount() >= 1, 'initial dev startup');
    assert.equal((await fetch(`${endpoints()[0]}/api/health`)).status, 200);
    const before = output.length;
    await touch('src/preload/index.ts');
    await runningUntil(() => output.slice(before).includes('electron preload scripts rebuilt successfully'), 'preload reload');
    await touch('src/main/index.ts');
    await runningUntil(async () => await readyCount() >= 2, 'main restart');
    assert.doesNotMatch(output.slice(before), /Preparing treefold sidecar/, 'Electron-only edits must skip Rust compilation');
    await assert.rejects(fetch(`${endpoints()[0]}/api/health`));
    await touch('src/backend/src/main.rs');
    await runningUntil(async () => await readyCount() >= 3, 'Rust rebuild and restart');
    assert.equal((await fetch(`${endpoints().at(-1)}/api/health`)).status, 200);
    assert.doesNotMatch(output, /Another Treefold backend|couldn't start|Untrusted desktop/);
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    let stopped = false;
    try {
      try { process.kill(-child.pid!, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      await until(async () => {
        if (child.exitCode === null && child.signalCode === null) return false;
        try { await readFile(path.join(home, 'runtime/api-url')); return false; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
      }, 'dev process and backend cleanup', 15000);
      stopped = true;
    } finally {
      try {
        // Escalate only when graceful shutdown failed, never after a completed exit.
        if (!stopped) {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    }
  }
});

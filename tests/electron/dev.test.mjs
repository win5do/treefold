import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function availablePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(check, description, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

test('electron-vite watches main, preload and Rust while releasing the previous backend', { timeout: 240000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-vite-'));
  let output = '';
  const child = spawn(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'dev', '--watch'], {
    detached: true,
    env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_UI_PORT: String(await availablePort()), TREEFOLD_API_ADDR: '127.0.0.1:0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const runningUntil = (check, description) => until(() => {
    if (child.exitCode !== null || child.signalCode) throw new Error(`Dev process exited (${child.exitCode ?? child.signalCode})`);
    return check();
  }, description);
  const endpoints = () => [...output.matchAll(/\[treefold dev\] API: (http:\/\/127\.0\.0\.1:\d+)/g)].map(match => match[1]);
  const readyCount = async () => ((await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => '')).match(/Treefold .* ready; API/g) || []).length;
  const touch = file => utimes(file, new Date(), new Date());
  try {
    await runningUntil(async () => await readyCount() >= 1, 'initial dev startup');
    assert.equal((await fetch(`${endpoints()[0]}/api/health`)).status, 200);
    const before = output.length;
    await touch('electron/preload.ts');
    await runningUntil(() => output.slice(before).includes('electron preload scripts rebuilt successfully'), 'preload reload');
    await touch('electron/main.ts');
    await runningUntil(async () => await readyCount() >= 2, 'main restart');
    assert.doesNotMatch(output.slice(before), /Preparing treefold sidecar/, 'Electron-only edits must skip Rust compilation');
    await assert.rejects(fetch(`${endpoints()[0]}/api/health`));
    await touch('backend/src/main.rs');
    await runningUntil(async () => await readyCount() >= 3, 'Rust rebuild and restart');
    assert.equal((await fetch(`${endpoints().at(-1)}/api/health`)).status, 200);
    assert.doesNotMatch(output, /Another Treefold backend|couldn't start|Untrusted desktop/);
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    try {
      await until(async () => {
        try { await readFile(path.join(home, 'runtime/api-url')); return false; }
        catch (error) { return error.code === 'ENOENT'; }
      }, 'backend cleanup', 15000);
    } finally {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await rm(home, { recursive: true, force: true });
    }
  }
});

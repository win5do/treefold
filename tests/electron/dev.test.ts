import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm, utimes, realpath } from 'node:fs/promises';
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

test('electron-vite watches main, preload, backend and selected amux while releasing the previous backend', async () => {
  test.setTimeout(240000);
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-vite-'));
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--manifest-path', 'src/backend/Cargo.toml', '--format-version', '1'], { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })) as { packages: { name: string; manifest_path: string }[] };
  const originalAmux = metadata.packages.find(pkg => pkg.name === 'amux-runtime');
  assert.ok(originalAmux);
  const amux = path.join(await realpath(home), 'amux worktree');
  await cp(path.dirname(originalAmux.manifest_path), amux, { recursive: true, filter: source => !['.git', 'target'].includes(path.basename(source)) });
  const amuxManifest = path.join(amux, 'Cargo.toml');
  await writeFile(amuxManifest, (await readFile(amuxManifest, 'utf8')).replace(/^version = .*$/m, 'version = "0.0.0-treefold-test"'));
  const amuxCli = path.join(amux, 'src/bin/amux.rs');
  await writeFile(amuxCli, (await readFile(amuxCli, 'utf8')).replace('about = "', 'about = "Treefold local amux fixture: '));
  const amuxLock = await readFile(path.join(amux, 'Cargo.lock'), 'utf8');
  const backendLock = await readFile('src/backend/Cargo.lock', 'utf8');
  const externalLog = path.join(home, 'external-open.jsonl');
  const externalHook = path.join(home, 'external-boundary.cjs');
  const externalReady = path.join(home, 'external-ready');
  // Guard the OS boundary even if navigation regresses: record, never launch a browser.
  await writeFile(externalHook, `
if (process.versions.electron) {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function(request, ...args) {
    const value = load.call(this, request, ...args);
    if (request === 'electron' && value.shell) {
      require('node:fs').writeFileSync(${JSON.stringify(externalReady)}, 'ready');
      value.shell.openExternal = async url => require('node:fs').appendFileSync(${JSON.stringify(externalLog)}, JSON.stringify(url) + '\\n');
    }
    return value;
  };
}
`);
  const assertNoExternalBrowser = async () => assert.equal(await readFile(externalLog, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  }), '', 'development reload must not request an external browser');
  let output = '';
  const child = spawn(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'dev', '--watch'], {
    detached: true,
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${externalHook}`].filter(Boolean).join(" "), TREEFOLD_AMUX_MANIFEST: path.join(amux, 'Cargo.toml'), TREEFOLD_HOME: home, TREEFOLD_UI_PORT: String(await availablePort()), TREEFOLD_API_ADDR: '127.0.0.1:0' },
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
    const staged = 'src/backend/bundle-staging/dev-sidecars';
    assert.equal(JSON.parse(await readFile(path.join(staged, 'amux-source.json'), 'utf8')).manifest_path, path.join(amux, 'Cargo.toml'));
    const amuxSkill = path.join(amux, 'skills/amux/SKILL.md');
    const skill = `${await readFile(amuxSkill, 'utf8')}\n<!-- local worktree watcher -->\n`;
    await writeFile(amuxSkill, skill);
    await touch(path.join(amux, 'src/lib.rs'));
    const stagedSkill = path.resolve(staged, 'agent-integration/skills/amux');
    await runningUntil(async () => await readyCount() >= 4 && await readFile(path.join(stagedSkill, 'SKILL.md'), 'utf8') === skill, 'local amux Rust rebuild and Skill refresh');
    assert.match(execFileSync(path.join(staged, 'bin/amux'), ['--help'], { encoding: 'utf8' }), /Treefold local amux fixture/);
    const integration = await (await fetch(`${endpoints().at(-1)}/api/agent-integration`)).json() as { components: { id: string; version: string; source_path: string }[] };
    for (const id of ['amux_cli', 'amux_skill']) {
      assert.equal(integration.components.find(component => component.id === id)?.version, '0.0.0-treefold-test');
    }
    assert.equal(integration.components.find(component => component.id === 'amux_skill')?.source_path, stagedSkill, 'development must not use a previous release Skill');
    assert.equal(await readFile(path.join(amux, 'Cargo.lock'), 'utf8'), amuxLock, 'local CLI builds must preserve the source lock');
    assert.equal(await readFile('src/backend/Cargo.lock', 'utf8'), backendLock, 'local development must preserve the Git dependency lock');
    assert.equal((await fetch(`${endpoints().at(-1)}/api/health`)).status, 200);
    assert.doesNotMatch(output, /Another Treefold backend|couldn't start|Untrusted desktop/);
    assert.equal(await readFile(externalReady, 'utf8'), 'ready', 'external browser guard must be installed');
    await assertNoExternalBrowser();
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

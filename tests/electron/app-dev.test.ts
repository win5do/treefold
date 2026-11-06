import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port allocated');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return String(address.port);
}

test('just app-dev starts the GUI, backend and sidecars and can restart after a Shell Session', async () => {
  test.setTimeout(240_000);
  const root = await mkdtemp(path.join(tmpdir(), 'treefold-app-dev-'));
  const home = path.join(root, 'home');
  const repository = path.join(root, 'repository');
  const run = promisify(execFile);
  let desktop: ElectronApplication | undefined;
  let api: string | undefined;
  try {
    await mkdir(path.join(home, 'config'), { recursive: true });
    await writeFile(path.join(home, 'config/settings.toml'), 'schema_version = 3\nlanguage = "en-US"\n[amux]\nkeep_daemon_running_on_exit = false\n');
    await mkdir(repository);
    await run('git', ['init', '-b', 'main', repository]);
    await run('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'fixture']);

    // Keep the production main/preload and real backend, but suppress native
    // activation during automation. No production test switches are needed.
    const hook = path.join(root, 'hidden.cjs');
    await writeFile(hook, `
if (process.versions.electron) {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function(request, ...args) {
    const value = load.call(this, request, ...args);
    if (request === 'electron' && value.BrowserWindow) {
      Module._load = load;
      const { app, BrowserWindow } = value;
      BrowserWindow.prototype.show = function() {};
      BrowserWindow.prototype.focus = function() {};
      app.on('browser-window-created', (_, window) => window.webContents.setBackgroundThrottling(false));
      if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
    }
    return value;
  };
}
`);
    // Playwright attaches to Electron's own inspectors through the normal just
    // entry point. Forward its arguments to Electron, not to npm or Vite.
    const launcher = path.join(root, 'launch.cjs');
    await writeFile(launcher, `#!${process.execPath}
const { spawn } = require('node:child_process');
const port = flag => process.argv.slice(2).find(arg => arg.startsWith(flag + '='))?.split('=')[1];
const child = spawn('just', ['app-dev'], { stdio: 'inherit', env: {
  ...process.env, V8_INSPECTOR_PORT: port('--inspect'), REMOTE_DEBUGGING_PORT: port('--remote-debugging-port'),
  NODE_OPTIONS: '--require=' + ${JSON.stringify(hook)},
} });
child.on('error', error => { console.error(error); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_DEV_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0', SHELL: '/bin/bash' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NO_SANDBOX;
    for (const firstLaunch of [true, false]) {
      env.TREEFOLD_UI_PORT = await availablePort();
      desktop = await electron.launch({ executablePath: launcher, cwd: process.cwd(), env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)), chromiumSandbox: true, timeout: 120_000 });
      const page = await desktop.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await expect(page.getByTestId('application-menu-trigger')).toBeVisible({ timeout: 30_000 });
      if (process.platform === 'linux') {
        expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
      } else if (process.platform === 'darwin') {
        expect(await desktop.evaluate(({ Menu }) => ['about', 'check-for-updates'].every(id => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled))).toBe(true);
      }
      api = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
      expect((await fetch(`${api}/api/health`)).ok).toBe(true);
      const integration = await (await fetch(`${api}/api/agent-integration`)).json();
      const staged = path.resolve('src/backend/bundle-staging/dev-sidecars');
      expect(integration.components.find((component: { id: string }) => component.id === 'amux_skill').source_path).toBe(path.join(staged, 'agent-integration/skills/amux'));
      await run(path.join(staged, 'bin/treefold'), ['--help']);
      await run(path.join(staged, 'bin/amux'), ['--help']);
      if (firstLaunch) {
        const post = async (resource: string, body = {}) => {
          const response = await fetch(`${api}${resource}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          expect(response.ok, await response.clone().text()).toBe(true);
          return response.json();
        };
        const project = await post('/api/projects', { name: 'Development smoke', path: repository });
        const session = await post(`/api/projects/${project.id}/sessions`, { kind: 'shell' });
        await page.goto(`${page.url().split('#')[0]}#/projects/${project.id}/sessions/${session.id}`);
        const terminal = page.locator('.xterm-helper-textarea');
        await expect(terminal).toBeAttached();
        await terminal.focus();
        await terminal.pressSequentially("printf 'treefold-%s\\n' app-dev-ready");
        await terminal.press('Enter');
        await expect.poll(async () => (await fetch(`${api}/api/sessions/${session.id}/logs?follow=false`)).text()).toContain('treefold-app-dev-ready');
        expect((await (await fetch(`${api}/api/amux`)).json()).state).toBe('healthy');
      }
      expect(errors).toEqual([]);
      const registrations = path.join(home, 'data/amux/daemons');
      const daemonPids: number[] = [];
      for (const name of await readdir(registrations)) {
        const record = await readFile(path.join(registrations, name, 'daemon.json'), 'utf8').catch(() => '');
        if (record) daemonPids.push(JSON.parse(record).pid);
      }
      if (firstLaunch) await desktop.close();
      else {
        const closed = desktop.waitForEvent('close');
        await page.getByTestId('application-menu-trigger').click();
        await page.getByRole('menuitem', { name: 'Quit Treefold', exact: true }).click();
        await closed;
      }
      desktop = undefined;
      await expect.poll(() => fetch(`${api}/api/health`).then(() => false, () => true)).toBe(true);
      await expect.poll(() => readFile(path.join(home, 'runtime/api-url')).then(() => false, () => true)).toBe(true);
      for (const pid of daemonPids) {
        // amux allows ten seconds for task shutdown before releasing its daemon.
        await expect.poll(async () => {
          // kill(pid, 0) also succeeds for exited zombies awaiting OS reaping.
          const { stdout } = await run('ps', ['-axo', 'pid=,stat=']);
          const row = stdout.trim().split('\n').map(line => line.trim().split(/\s+/))
            .find(([value]) => Number(value) === pid);
          return !row || row[1].startsWith('Z');
        }, { timeout: 15_000 }).toBe(true);
      }
    }
  } catch (error) {
    if (desktop) await desktop.windows()[0]?.screenshot({ path: '/tmp/treefold-app-dev-failure.png' }).catch(() => {});
    console.error(await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => 'No desktop log'));
    throw error;
  } finally {
    try { if (desktop) await desktop.close(); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
});

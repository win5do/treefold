import type { ElectronApplication } from 'playwright-core';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const executablePath = process.env.TREEFOLD_ELECTRON_APP || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold');
test('packaged Electron loads Rust API, persists settings, and preserves close-to-tray lifecycle', { timeout: 60000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-app-'));
  const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
  delete env.ELECTRON_RUN_AS_NODE;
  await mkdir(path.join(home, 'config'));
  await writeFile(path.join(home, 'config/settings.toml'), 'schema_version = 1\nlanguage = "en-US"\n');
  let desktop: ElectronApplication | undefined, apiUrl: string | undefined;
  try {
    desktop = await electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByTestId('open-settings').waitFor();
    assert.match(page.url(), /^treefold:\/\/app\//);
    apiUrl = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
    assert.equal((await fetch(`${apiUrl}/api/health`)).status, 200);
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })).state), 'granted');
    await page.getByTestId('open-settings').click();
    await page.getByRole('dialog').waitFor();
    await page.getByTestId('settings-theme').selectOption('dark');
    const saved = page.waitForResponse(response => response.url() === `${apiUrl}/api/settings` && response.request().method() === 'PATCH');
    await page.getByTestId('settings-save').click();
    const savedResponse = await saved;
    assert.equal(savedResponse.status(), 200);
    const requestId = savedResponse.request().headers()['x-request-id'];
    assert.match(requestId, /^[a-z0-9-]{36}$/);
    assert.equal(savedResponse.headers()['x-request-id'], requestId);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await (await fetch(`${apiUrl}/api/settings`)).json()).theme, 'dark');
    // Exercise the isolated preload-to-main bridge; mock only the native picker.
    await desktop.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/tmp/treefold-picker-test'] }); });
    assert.equal(await page.evaluate(() => window.treefoldDesktop!.openDirectory({ title: 'Test picker', directory: true, multiple: false })), '/tmp/treefold-picker-test');
    await page.evaluate(() => window.treefoldDesktop!.log('info', 'desktop-smoke-log'));
    const desktopLog = await readFile(path.join(home, 'logs/desktop.log'), 'utf8');
    assert.match(desktopLog, /INFO \[renderer\] desktop-smoke-log/);
    assert.ok(desktopLog.includes(`request_id=${requestId} HTTP PATCH /api/settings status=200`));
    assert.ok((await readFile(path.join(home, 'logs/treefold_rCURRENT.log'), 'utf8')).includes(`request_id=${requestId} HTTP PATCH /api/settings status=200`));
    assert.match(desktopLog, /INFO \[main\] Treefold .* ready/);
    assert.doesNotMatch(desktopLog, /Treefold backend starting|Rust API listening/);
    assert.match(await readFile(path.join(home, 'logs/treefold_rCURRENT.log'), 'utf8'), /\[backend\] Treefold backend starting/);
    const prefs = await desktop.evaluate(({ BrowserWindow }) => {
      const p = (BrowserWindow.getAllWindows()[0].webContents as Electron.WebContents & { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration };
    });
    assert.deepEqual(prefs, { contextIsolation: true, sandbox: true, nodeIntegration: false });
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.equal((await fetch(`${apiUrl}/api/health`)).status, 200);
    await desktop.evaluate(({ app }) => app.emit('activate'));
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    await page.screenshot({ path: '/tmp/treefold-electron-packaged.png' });
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => 'No desktop log'));
    if (desktop) { const page = desktop.windows()[0]; if (page) await page.screenshot({ path: '/tmp/treefold-electron-app-failure.png' }).catch(() => {}); }
    throw error;
  } finally {
    if (desktop) await desktop.close();
    try {
      if (apiUrl) {
        await assert.rejects(fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) }));
        await assert.rejects(readFile(path.join(home, 'runtime/api-url')), { code: 'ENOENT' });
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  }
});

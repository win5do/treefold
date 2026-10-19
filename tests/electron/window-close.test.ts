import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const executablePath = process.env.TREEFOLD_ELECTRON_APP || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold');

test('window close applies saved quit behavior immediately and after restart, stopping the backend', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-window-close-'));
  const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const settingsPath = path.join(home, 'config/settings.toml');
  await mkdir(path.dirname(settingsPath));
  await writeFile(settingsPath, 'schema_version = 3\nlanguage = "en-US"\n');
  let desktop: ElectronApplication | undefined;
  try {
    for (const firstLaunch of [true, false]) {
      desktop = await electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
      const page = await desktop.firstWindow();
      await page.getByTestId('open-settings').waitFor();
      const apiUrl = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
      await page.getByTestId('open-settings').click();
      const behavior = page.getByRole('combobox', { name: 'When closing the window' });
      await expect(behavior).toHaveValue(firstLaunch ? 'hide_to_tray' : 'quit');
      if (firstLaunch) {
        await behavior.selectOption('quit');
        const saved = page.waitForResponse(response => response.url() === `${apiUrl}/api/settings` && response.request().method() === 'PATCH');
        await page.getByTestId('settings-save').click();
        expect((await saved).ok()).toBe(true);
        await expect(page.getByTestId('settings-save')).toBeEnabled();
        expect(await readFile(settingsPath, 'utf8')).toContain('close_behavior = "quit"');
      }
      await page.keyboard.press('Escape');
      const closed = desktop.waitForEvent('close');
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await closed;
      desktop = undefined;
      await expect(fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      await expect(readFile(path.join(home, 'runtime/api-url'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally {
    try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); }
  }
});

test('window close reads file edits and falls back to tray when settings cannot be loaded', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-window-close-fallback-'));
  const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const settingsPath = path.join(home, 'config/settings.toml');
  await mkdir(path.dirname(settingsPath));
  const settings = 'schema_version = 3\nlanguage = "en-US"\nclose_behavior = "quit"\n';
  await writeFile(settingsPath, settings);
  let desktop: ElectronApplication | undefined;
  try {
    desktop = await electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await desktop.firstWindow();
    await page.getByTestId('open-settings').waitFor();
    const apiUrl = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
    for (const contents of [settings.replace('quit', 'hide_to_tray'), 'invalid toml [']) {
      await writeFile(settingsPath, contents);
      await desktop.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.close();
        window.close();
      });
      await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
      expect((await fetch(`${apiUrl}/api/health`)).ok).toBe(true);
      await desktop.evaluate(({ app }) => app.emit('activate'));
      await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    }
    expect(await readFile(path.join(home, 'logs/desktop.log'), 'utf8')).toContain('Could not read window close behavior; hiding to tray');
    await writeFile(settingsPath, settings.replace('quit', 'hide_to_tray'));
    // Explicit Quit must bypass the close preference and still stop the backend.
    await desktop.close();
    desktop = undefined;
    await expect(fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  } finally {
    try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); }
  }
});

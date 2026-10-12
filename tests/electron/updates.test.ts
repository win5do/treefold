import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron, type ElectronApplication } from '@playwright/test';

type Fixture = { status: number; tag: string; prerelease: boolean; calls: number; links: string[] };
type UpdateGlobal = typeof globalThis & { updateFixture: Fixture };

test('stable updates: startup notice, menu checks, release link, errors, reload and localization', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-updates-'));
  const executablePath = process.env.TREEFOLD_ELECTRON_APP || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(path.join(home, 'config'));
    await writeFile(path.join(home, 'config/settings.toml'), 'schema_version = 1\nlanguage = "en-US"\n');
    const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    // Intercept only the update endpoint; keep production asset and backend transport.
    await desktop.evaluate(({ net, shell }) => {
      const state: Fixture = { status: 200, tag: 'v99.0.0', prerelease: false, calls: 0, links: [] };
      (globalThis as UpdateGlobal).updateFixture = state;
      const original = net.fetch.bind(net);
      net.fetch = async (url, options) => {
        if (url !== 'https://api.github.com/repos/win5do/treefold/releases/latest') return original(url, options);
        state.calls++;
        return new Response(JSON.stringify({ tag_name: state.tag, draft: false, prerelease: state.prerelease }), {
          status: state.status, headers: { 'Content-Type': 'application/json' },
        });
      };
      shell.openExternal = async url => { state.links.push(url); };
    });
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByTestId('open-settings').waitFor();
    expect(await desktop.evaluate(() => (globalThis as UpdateGlobal).updateFixture.calls)).toBe(0);
    // The packaged App uses the real 30-second startup timer.
    await page.getByRole('button', { name: 'View update', exact: true }).click({ timeout: 45_000 });
    const dialog = page.getByRole('dialog', { name: 'Check for Updates…', exact: true });
    await expect(dialog).toContainText('Treefold 99.0.0 is available.');
    await expect(dialog).toContainText('brew update && brew upgrade --cask win5do/tap/treefold');
    await dialog.getByRole('link', { name: 'Open release page' }).click();
    expect(await desktop.evaluate(() => (globalThis as UpdateGlobal).updateFixture.links)).toEqual(['https://github.com/win5do/treefold/releases/tag/v99.0.0']);
    await page.keyboard.press('Escape');
    const checkMenu = () => desktop!.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('check-for-updates')!;
      if (!item.enabled) throw new Error('Update menu unavailable');
      item.click();
    });
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await checkMenu();
    await expect(dialog).toBeVisible();
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(dialog).toContainText('Treefold 99.0.0 is available.');
    await page.keyboard.press('Escape');
    for (const [status, tag, prerelease, message] of [
      [200, 'v0.0.1', false, 'No newer stable version is available.'],
      [200, 'v99.0.0-alpha.1', false, 'No stable release has been published yet.'],
      [200, 'v99.0.0', true, 'No stable release has been published yet.'],
      [404, '', false, 'No stable release has been published yet.'],
      [403, '', false, 'Could not check for updates. Please try again later.'],
    ] as const) {
      await desktop.evaluate((_electron, values) => {
        Object.assign((globalThis as UpdateGlobal).updateFixture, values);
      }, { status, tag, prerelease });
      await checkMenu();
      await expect(dialog).toContainText(message);
      await page.keyboard.press('Escape');
    }
    await desktop.evaluate(() => { Object.assign((globalThis as UpdateGlobal).updateFixture, { status: 200, tag: 'v99.0.0', prerelease: false }); });
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      desktop.evaluate(({ BrowserWindow, Menu }) => {
        BrowserWindow.getAllWindows()[0].webContents.reload();
        Menu.getApplicationMenu()!.getMenuItemById('check-for-updates')!.click();
      }),
    ]);
    await expect(dialog).toContainText('Treefold 99.0.0 is available.');
    await page.keyboard.press('Escape');
    await page.getByTestId('open-settings').click();
    await page.getByTestId('settings-language').selectOption('zh-CN');
    await page.getByTestId('settings-save').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.keyboard.press('Escape');
    await expect.poll(() => desktop!.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('check-for-updates')!.label)).toBe('检查更新…');
    await checkMenu();
    await expect(page.getByRole('dialog', { name: '检查更新…', exact: true })).toContainText('Treefold 99.0.0 已发布。');
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => 'No desktop log'));
    await desktop?.windows()[0]?.screenshot({ path: '/tmp/treefold-updates-failure.png' }).catch(() => {});
    throw error;
  } finally {
    try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); }
  }
});

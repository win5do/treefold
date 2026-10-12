import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron, type ElectronApplication } from '@playwright/test';

test('About menu opens the shared dialog, restores the window, and survives reload', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-about-'));
  const executablePath = process.env.TREEFOLD_ELECTRON_APP || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(path.join(home, 'config'));
    await writeFile(path.join(home, 'config/settings.toml'), 'schema_version = 1\nlanguage = "en-US"\n');
    const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const settings = page.getByTestId('open-settings');
    await settings.waitFor();
    await settings.focus();
    const openAbout = () => desktop!.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('about')!;
      if (!item.label || !item.enabled) throw new Error('About menu unavailable');
      item.click();
    });
    await openAbout();
    const dialog = page.getByRole('dialog', { name: 'About Treefold', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(await desktop.evaluate(({ app }) => app.getVersion()));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await expect(dialog).toContainText(commit.slice(0, 7));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { (window as typeof window & { copiedCommit: string }).copiedCommit = text; },
      } });
    });
    await dialog.getByRole('button', { name: 'Copy full Git commit', exact: true }).click();
    expect(await page.evaluate(() => (window as typeof window & { copiedCommit: string }).copiedCommit)).toBe(commit);
    // Exercise the production external-link boundary without opening a browser.
    await desktop.evaluate(({ shell }) => {
      (globalThis as typeof globalThis & { aboutLinks: string[] }).aboutLinks = [];
      shell.openExternal = async url => { (globalThis as typeof globalThis & { aboutLinks: string[] }).aboutLinks.push(url); };
    });
    for (const href of ['https://github.com/win5do/treefold', 'https://treefold.fffeng566.workers.dev/', 'https://github.com/win5do']) {
      await dialog.locator(`a[href="${href}"]`).click();
    }
    await expect.poll(() => desktop!.evaluate(() => (globalThis as typeof globalThis & { aboutLinks: string[] }).aboutLinks)).toEqual([
      'https://github.com/win5do/treefold', 'https://treefold.fffeng566.workers.dev/', 'https://github.com/win5do',
    ]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(settings).toBeFocused();

    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await openAbout();
    await expect(dialog).toBeVisible();
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    await openAbout();
    await expect(dialog).toBeVisible();
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      desktop.evaluate(({ BrowserWindow, Menu }) => {
        BrowserWindow.getAllWindows()[0].webContents.reload();
        Menu.getApplicationMenu()!.getMenuItemById('about')!.click();
      }),
    ]);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await settings.click();
    await page.getByTestId('settings-language').selectOption('zh-CN');
    await page.getByTestId('settings-save').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.keyboard.press('Escape');
    await openAbout();
    await page.getByRole('dialog', { name: '关于 Treefold', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => 'No desktop log'));
    await desktop?.windows()[0]?.screenshot({ path: '/tmp/treefold-about-menu-failure.png' }).catch(() => {});
    throw error;
  } finally {
    try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); }
  }
});

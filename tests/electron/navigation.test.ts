import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { build } from 'vite';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('renderer reload stays in Electron while external links use the browser boundary', async () => {
  const directory = await mkdtemp('/tmp/treefold-navigation-');
  const server = createServer((_request, response) => response.end('<!doctype html><title>Navigation fixture</title><p>Ready</p>'));
  let desktop: ElectronApplication | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const url = `http://127.0.0.1:${address.port}`; // Same format as electron-vite.
    const entry = path.join(directory, 'main.ts');
    await writeFile(entry, `
import { app, BrowserWindow, shell } from 'electron';
import { installNavigation } from ${JSON.stringify(path.resolve('src/main/navigation.ts'))};
app.setPath('userData', ${JSON.stringify(path.join(directory, 'home'))});
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
const opened = [];
shell.openExternal = async url => { opened.push(url); };
app.whenReady().then(async () => {
  const window = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, backgroundThrottling: false}});
  installNavigation(window.webContents, ${JSON.stringify(url)}, url => shell.openExternal(url), error => { throw error; });
  // Expose observations only in this test-owned main process.
  globalThis.navigationOpened = opened;
  await window.loadURL(${JSON.stringify(url)});
});
app.on('window-all-closed', () => app.quit());
`);
    await build({ configFile: false, logLevel: 'error', build: {outDir: directory, emptyOutDir: false,
      lib: {entry, formats: ['cjs'], fileName: () => 'main.cjs'}, rollupOptions: {external: ['electron']},
    }});
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({args: [path.join(directory, 'main.cjs')], env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))});
    const page = await desktop.firstWindow();
    await expect(page.getByText('Ready', {exact: true})).toBeVisible();
    const opened = () => desktop!.evaluate(() => (globalThis as typeof globalThis & {navigationOpened: string[]}).navigationOpened);
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.evaluate(() => window.location.reload()),
    ]);
    expect(await opened()).toEqual([]);
    expect(page.url()).toBe(`${url}/`);
    await page.evaluate(() => { window.location.href = 'https://example.test/external'; });
    await expect.poll(opened).toEqual(['https://example.test/external']);
    expect(page.url()).toBe(`${url}/`);
    await page.evaluate(() => { window.open('https://example.test/new-window'); });
    await expect.poll(opened).toEqual(['https://example.test/external', 'https://example.test/new-window']);
    expect(desktop.windows()).toHaveLength(1);
  } finally {
    try { await desktop?.close(); } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(directory, {recursive: true, force: true});
    }
  }
});

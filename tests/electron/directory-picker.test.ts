import { _electron, test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const executablePath = process.env.TREEFOLD_ELECTRON_APP || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold');

test('directory picker starts at home and remembers successful selections across App restarts', async () => {
  test.setTimeout(90_000);
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-picker-'));
  const selected = path.join(home, 'selected');
  await mkdir(selected);
  const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
  delete env.ELECTRON_RUN_AS_NODE;
  let desktop: ElectronApplication | undefined;
  async function launch() {
    desktop = await _electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await desktop.firstWindow();
    await page.getByTestId('open-settings').waitFor();
    return page;
  }
  async function mockPicker(reply: { canceled: boolean; filePaths: string[] }) {
    await desktop!.evaluate(({ dialog }, reply) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.at(-1) as { defaultPath?: string };
        (globalThis as typeof globalThis & { pickerDefaultPath?: string }).pickerDefaultPath = options.defaultPath;
        return reply;
      };
    }, reply);
  }
  async function defaultPath() {
    return desktop!.evaluate(() => (globalThis as typeof globalThis & { pickerDefaultPath?: string }).pickerDefaultPath);
  }
  const stateFile = path.join(home, 'data/electron/directory-picker.json');
  try {
    let page = await launch();
    const userHome = await desktop!.evaluate(({ app }) => app.getPath('home'));
    await mockPicker({ canceled: false, filePaths: [selected] });
    expect(await page.evaluate(() => window.treefoldDesktop!.openDirectory({ directory: true, multiple: false }))).toBe(selected);
    expect(await defaultPath()).toBe(userHome);
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({ lastDirectory: selected });
    await mockPicker({ canceled: true, filePaths: [] });
    expect(await page.evaluate(() => window.treefoldDesktop!.openDirectory({ directory: true, multiple: false }))).toBeNull();
    expect(await defaultPath()).toBe(selected);
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({ lastDirectory: selected });
    await desktop!.close(); desktop = undefined;

    page = await launch();
    await mockPicker({ canceled: true, filePaths: [] });
    await page.evaluate(() => window.treefoldDesktop!.openDirectory({ directory: true, multiple: false }));
    expect(await defaultPath()).toBe(selected);
    await rm(selected, { recursive: true });
    await page.evaluate(() => window.treefoldDesktop!.openDirectory({ directory: true, multiple: false }));
    expect(await defaultPath()).toBe(userHome);
    await desktop!.close(); desktop = undefined;

    await writeFile(stateFile, '{invalid JSON');
    page = await launch();
    await mockPicker({ canceled: true, filePaths: [] });
    await page.evaluate(() => window.treefoldDesktop!.openDirectory({ directory: true, multiple: false }));
    expect(await defaultPath()).toBe(userHome);
  } finally {
    try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); }
  }
});

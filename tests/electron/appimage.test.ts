import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

for (const mode of ['direct', 'extract'] as const) {
  test(`AppImage ${mode} starts with sandbox and keeps CLI and Skills usable after unmount`, async () => {
    test.skip(process.platform !== 'linux', 'Linux AppImage lifecycle');
    const artifact = (await readdir('release')).find(file => file.endsWith(`-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`));
    expect(artifact, 'Build the AppImage with just build before running Electron tests').toBeTruthy();
    const executablePath = path.resolve('release', artifact!);
    const home = await mkdtemp(path.join(tmpdir(), 'treefold-appimage-'));
    let desktop: ElectronApplication | undefined;
    try {
      await mkdir(path.join(home, 'config'));
      await writeFile(path.join(home, 'config/settings.toml'), 'schema_version = 3\nlanguage = "en-US"\n');
      const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
      delete env.APPIMAGE_EXTRACT_AND_RUN;
      if (mode === 'extract') env.APPIMAGE_EXTRACT_AND_RUN = '1';
      delete env.ELECTRON_RUN_AS_NODE;
      desktop = await _electron.launch({ executablePath, chromiumSandbox: true, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
      const page = await desktop.firstWindow();
      await page.getByTestId('application-menu-trigger').waitFor();
      const api = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
      expect((await fetch(`${api}/api/health`)).status).toBe(200);
      expect(await desktop.evaluate(() => process.argv.includes('--no-sandbox'))).toBe(false);
      const directories = await readdir(path.join(home, 'data/bundled-resources'));
      expect(directories).toHaveLength(1);
      const resources = path.join(home, 'data/bundled-resources', directories[0]);
      expect(await readFile(path.join(resources, 'desktop-path'), 'utf8')).toBe(executablePath);
      await desktop.close();
      desktop = undefined;
      await expect(fetch(`${api}/api/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      const { stdout } = await promisify(execFile)(path.join(resources, 'bin/treefold'), ['--version']);
      expect(stdout).toMatch(/^treefold /);
      expect(await readFile(path.join(resources, 'agent-integration/skills/amux/SKILL.md'), 'utf8')).toContain('amux');
    } finally { try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); } }
  });
}

import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, rm, realpath, writeFile, readFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectOpenRequests } from '../../src/main/open-project.ts';

test('open requests survive startup and stale acknowledgements preserve the latest directory', () => {
  const requests = createProjectOpenRequests(() => {});
  requests.receive('/tmp/first');
  const first = requests.pending()!;
  expect(first.path).toBe('/tmp/first');
  requests.receive('/tmp/second');
  requests.acknowledge(first.id);
  expect(requests.pending()!.path).toBe('/tmp/second');
  requests.acknowledge(requests.pending()!.id);
  expect(requests.pending()).toBeNull();
});

for (const multi of [false, true]) test(`packaged App imports ${multi ? 'a symlink container' : 'a repository'} and treefold open navigates to the existing Project`, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-open-project-'));
  const repository = path.join(await realpath(home), '中文 repository');
  const executablePath = process.env.TREEFOLD_ELECTRON_APP || path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Treefold.app/Contents/MacOS/Treefold');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(path.join(home, 'config'));
    await writeFile(path.join(home, 'config/settings.toml'), 'schema_version = 1\nlanguage = "en-US"\n');
    await mkdir(repository);
    if (multi) {
      for (const name of ['fe-cps', 'hacking-cps']) {
        const target = path.join(await realpath(home), name);
        execFileSync('git', ['init', '-b', 'main', target]);
        await symlink(target, path.join(repository, name));
      }
    } else {
      await mkdir(path.join(repository, 'src'));
      execFileSync('git', ['init', '-b', 'main', repository]);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await desktop.firstWindow();
    await page.getByTestId('open-settings').waitFor();
    // Reload removes renderer subscriptions; the main process must retain the
    // OS event until the newly mounted Project flow can read it.
    await desktop.evaluate(({ app, BrowserWindow }, directory) => {
      BrowserWindow.getAllWindows()[0].webContents.reload();
      app.emit('open-file', { preventDefault() {} }, directory);
    }, repository);
    const dialog = page.getByRole('dialog', { name: /^New Project/ });
    await expect(dialog.getByRole('textbox', { name: 'Project directory', exact: true })).toHaveValue(repository);
    const api = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
    expect(await (await fetch(`${api}/api/projects`)).json()).toEqual([]);
    if (multi) await dialog.getByRole('checkbox', { name: /hacking-cps/ }).uncheck();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
    await expect(page).toHaveURL(/#\/projects\/[a-f0-9]{32}$/);
    const projectUrl = page.url();
    expect((await (await fetch(`${api}/api/projects`)).json())[0].open_path).toBe(repository);
    if (multi) await mkdir(path.join(repository, 'added-later'));
    await page.goto('treefold://app/index.html');
    await page.getByTestId('open-settings').waitFor();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    // Route the real CLI's application lookup to this exact test build, keeping
    // the user's installed Treefold and home out of the LaunchServices request.
    const shim = path.join(home, 'bin');
    await mkdir(shim);
    await writeFile(path.join(shim, 'open'), '#!/bin/sh\n[ "$1" = "-a" ] && [ "$2" = "Treefold" ] || exit 99\nshift 2\nexec /usr/bin/open -a "$TREEFOLD_TEST_APP" "$@"\n', { mode: 0o755 });
    const contents = path.dirname(path.dirname(executablePath));
    execFileSync(path.join(contents, 'Resources/bin/treefold'), ['open', '.'], {
      cwd: multi ? repository : path.join(repository, 'src'),
      env: { ...env, PATH: `${shim}:${process.env.PATH}`, TREEFOLD_TEST_APP: path.dirname(contents) },
    });
    await expect(page).toHaveURL(projectUrl);
    expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(dialog).toHaveCount(0);
    expect(await (await fetch(`${api}/api/projects`)).json()).toHaveLength(1);
  } catch (error) {
    console.error(await readFile(path.join(home, 'logs/desktop.log'), 'utf8').catch(() => 'No desktop log'));
    if (desktop) {
      console.error('Pending open request:', await desktop.windows()[0]?.evaluate(() => window.treefoldDesktop?.pendingOpenProject()).catch(() => undefined));
      await desktop.windows()[0]?.screenshot({ path: '/tmp/treefold-open-project-failure.png' }).catch(() => {});
    }
    throw error;
  } finally { try { await desktop?.close(); } finally { await rm(home, { recursive: true, force: true }); } }
});

import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { detectApps, openInApp, type DetectedApp } from '../../src/main/open-in/service.ts';
import { appCatalog } from '../../src/main/open-in/catalog.ts';

test('detects supported apps in user Applications and Toolbox, omits missing apps and deduplicates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'treefold-app-detection-'));
  try {
    const system = path.join(root, 'Applications'), user = path.join(root, 'user/Applications'), toolbox = path.join(root, 'Toolbox/apps');
    for (const file of [path.join(system, 'Visual Studio Code.app'), path.join(user, 'Visual Studio Code.app'), path.join(user, 'Zed Preview.app'), path.join(toolbox, 'Goland/ch-0/2026.2/GoLand.app'), path.join(user, 'Unknown.app'), path.join(user, 'cmux.app')]) await mkdir(file, { recursive: true });
    const options = { roots: [system, user], toolboxRoot: toolbox, platform: 'darwin' };
    let apps = await detectApps(options);
    expect(apps.filter(app => app.group === 'editor').map(app => app.id)).toEqual(['vscode', 'zed', 'goland']);
    expect(apps.find(app => app.id === 'vscode')!.appPath).toBe(path.join(system, 'Visual Studio Code.app'));
    expect(apps.some(app => app.id === 'cmux')).toBe(false);
    const cli = path.join(user, 'cmux.app/Contents/Resources/bin/cmux');
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, '#!/bin/sh\nexit 0\n'); await chmod(cli, 0o755);
    apps = await detectApps(options);
    expect(apps.find(app => app.id === 'cmux')!.cli).toBe(cli);
    expect(await detectApps({ ...options, platform: 'linux' })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validates desktop requests and preserves special directory characters in launch arguments', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'treefold-open-in-'));
  const directory = path.join(root, '中文 space \' " $HOME `touch nope`');
  await mkdir(directory);
  const detected: DetectedApp[] = appCatalog.map(app => ({ ...app, appPath: `/Applications/${app.label}.app`, cli: '/Applications/cmux.app/Contents/Resources/bin/cmux' }));
  const calls: { command: string; args: string[] }[] = [];
  const dependencies = { detect: async () => detected, run: async (command: string, args: string[]) => { calls.push({ command, args }); } };
  try {
    for (const id of ['finder', 'terminal', 'iterm2', 'vscode', 'goland', 'rustrover', 'ghostty', 'kitty', 'warp', 'cmux']) await openInApp(id, directory, dependencies);
    expect(calls.find(call => call.args.includes('/Applications/VS Code.app'))!.args).toEqual(['-a', '/Applications/VS Code.app', directory]);
    expect(calls.find(call => call.args.includes('/Applications/Ghostty.app'))!.args).toEqual(['-na', '/Applications/Ghostty.app', '--args', `--working-directory=${directory}`]);
    expect(calls.find(call => call.args.includes('/Applications/Warp.app'))!.args.at(-1)).toBe(`warp://action/new_window?path=${encodeURIComponent(directory)}`);
    expect(calls.slice(-3).map(call => call.args)).toEqual([['-a', '/Applications/cmux.app'], ['ping'], ['new-workspace', '--cwd', directory]]);
    const count = calls.length;
    for (const [id, dir] of [['arbitrary-command', directory], ['finder', 'relative'], ['finder', root + '/missing'], ['finder', '\0']]) await expect(openInApp(id, dir, dependencies)).rejects.toThrow();
    await expect(openInApp('finder', directory, { ...dependencies, detect: async () => [] })).rejects.toThrow('no longer installed');
    expect(calls).toHaveLength(count);
    await expect(openInApp('finder', directory, { ...dependencies, run: async () => { throw new Error('launch failed'); } })).rejects.toThrow('launch failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('cmux startup retries readiness without duplicating workspace creation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'treefold-cmux-start-'));
  const app = { ...appCatalog.find(app => app.id === 'cmux')!, appPath: '/Applications/cmux.app', cli: '/Applications/cmux.app/Contents/Resources/bin/cmux' };
  const calls: string[][] = [];
  let pings = 0;
  try {
    await openInApp('cmux', directory, {
      detect: async () => [app],
      run: async (_command, args) => {
        calls.push(args);
        if (args[0] === 'ping' && ++pings === 1) throw new Error('Socket not ready');
      },
    });
    expect(calls).toEqual([['-a', app.appPath], ['ping'], ['ping'], ['new-workspace', '--cwd', directory]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import { packagedExecutable } from './packaged-paths.ts';
import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readShellPath } from '../../src/main/shell-path.ts';
import { selectShell } from '../../src/main/shell.ts';
import { isExecutable } from '../../src/main/executable.ts';

const systemPath = '/usr/bin:/bin:/usr/sbin:/sbin';
const fixtureShell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
const fixtureRc = process.platform === 'darwin' ? '.zshrc' : '.bashrc';

async function fixture() {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'treefold-shell-path-')));
  const env = { HOME: home, ZDOTDIR: home, SHELL: fixtureShell, PATH: systemPath };
  await writeFile(path.join(home, '.bash_profile'), '. "$HOME/.bashrc"\n');
  return { home, env };
}

for (const shell of ['/bin/zsh', '/bin/bash']) test(`reads login and interactive PATH from ${shell} despite startup output`, async () => {
  test.skip(!await isExecutable(shell), `${shell} is not installed`);
  const { home, env } = await fixture();
  const bin = path.join(home, '中文 bin \' "$HOME`literal`\nline ');
  const expected = `${bin}:/login/bin:${systemPath}`;
  const warnings: string[] = [];
  try {
    const profile = 'export PATH="/login/bin:/usr/bin:/bin:/usr/sbin:/sbin"\n';
    const rc = 'printf "startup banner\\n"\nprintf "private startup output\\n" >&2\nexport PATH="$TEST_BIN:$PATH"\n';
    await writeFile(path.join(home, shell.endsWith('zsh') ? '.zprofile' : '.bash_profile'), profile + (shell.endsWith('bash') ? '. "$HOME/.bashrc"\n' : ''));
    await writeFile(path.join(home, shell.endsWith('zsh') ? '.zshrc' : '.bashrc'), rc);
    const inherited = { ...env, SHELL: shell, TEST_BIN: bin };
    const resolved = await readShellPath({ env: inherited, onWarning: message => warnings.push(message) });
    expect(warnings).toEqual([]);
    expect(resolved).toBe(expected);
    expect(inherited.PATH).toBe(systemPath);
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const failure of ['nonzero', 'empty', 'no-frame', 'too-much-output', 'timeout']) test(`shell PATH ${failure} keeps inherited environment and reports a safe warning`, async () => {
  const { home, env } = await fixture();
  const warnings: string[] = [];
  const rc: Record<string, string> = {
    nonzero: 'echo secret-value; exit 7\n',
    empty: 'export PATH=""\n',
    'no-frame': 'echo secret-value; exit 0\n',
    'too-much-output': '/usr/bin/yes secret-value\n',
    timeout: 'trap "" TERM\n/bin/sleep 60 &\necho $! > "$HOME/child-pid"\nwait\n',
  };
  try {
    await writeFile(path.join(home, fixtureRc), rc[failure] || '');
    const inherited = { ...env };
    expect(await readShellPath({ env: inherited, timeout: 1000, onWarning: message => warnings.push(message) })).toBeUndefined();
    expect(inherited.PATH).toBe(systemPath);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Keeping inherited PATH');
    expect(warnings[0]).not.toContain('secret-value');
    if (failure === 'timeout') {
      const pid = Number(await readFile(path.join(home, 'child-pid'), 'utf8'));
      await expect.poll(() => {
        try { process.kill(pid, 0); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
      }).toBe(false);
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('selects an executable environment shell, account shell, then bash or sh', async () => {
  const { home } = await fixture();
  try {
    const preferred = path.join(home, 'preferred shell');
    const blocked = path.join(home, 'not executable');
    await writeFile(preferred, '#!/bin/sh\n', { mode: 0o755 });
    await writeFile(blocked, '', { mode: 0o644 });
    expect(await selectShell({ SHELL: preferred }, '/bin/sh')).toBe(preferred);
    for (const shell of ['', 'relative', blocked, path.join(home, 'missing')]) {
      expect(await selectShell({ SHELL: shell }, '/bin/sh')).toBe('/bin/sh');
    }
    expect(await selectShell({}, null)).toBe(await isExecutable('/bin/bash') ? '/bin/bash' : '/bin/sh');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('packaged App detects Codex from the default shell with a Finder-like PATH', async () => {
  const { home, env } = await fixture();
  const bin = path.join(home, 'agent bin');
  const treefoldHome = path.join(home, 'treefold');
  const executablePath = packagedExecutable();
  let desktop: ElectronApplication | undefined;
  let apiUrl: string | undefined;
  try {
    await mkdir(bin);
    await writeFile(path.join(bin, 'codex'), '#!/usr/bin/env sh\n[ "$1" = --version ] || exit 9\nprintf "codex-shell-fixture 1.0\\n"\n', { mode: 0o755 });
    await writeFile(path.join(home, fixtureRc), 'echo "shell startup banner"\nexport PATH="$HOME/agent bin:$PATH"\nexport TREEFOLD_HOME="/must-not-import-shell-settings"\n');
    const launchEnv: NodeJS.ProcessEnv = { ...process.env, ...env, TREEFOLD_HOME: treefoldHome, TREEFOLD_API_ADDR: '127.0.0.1:0' };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath, chromiumSandbox: true, env: Object.fromEntries(Object.entries(launchEnv).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await desktop.firstWindow();
    apiUrl = await page.evaluate(() => window.treefoldDesktop!.apiUrl());
    const system = await (await fetch(`${apiUrl}/api/system`)).json();
    expect(system.treefold_home).toBe(treefoldHome);
    expect(system.agents.find((agent: { kind: string }) => agent.kind === 'codex')).toMatchObject({
      available: true, executable: path.join(bin, 'codex'), version: 'codex-shell-fixture 1.0',
    });
    expect((await desktop.evaluate(() => process.env.PATH))?.split(':')[0]).toBe(bin);
  } finally {
    try {
      await desktop?.close();
      if (apiUrl) await expect(fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally { await rm(home, { recursive: true, force: true }); }
  }
});

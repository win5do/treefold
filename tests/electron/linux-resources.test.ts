import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { directoryFromArguments } from '../../src/main/open-arguments.ts';
import { persistentAppImageResources } from '../../src/main/appimage-resources.ts';

test('directory arguments support CLI flags, desktop paths and file URLs without consuming runtime flags', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-arguments-'));
  try {
    const directory = path.join(home, '中文 directory');
    await mkdir(directory);
    expect(directoryFromArguments(['app', '--open-directory', directory], '/', true)).toBe(directory);
    expect(directoryFromArguments(['app', '--open-directory', '--ozone-platform=wayland', directory], '/', true)).toBe(directory);
    expect(directoryFromArguments(['app', `--open-directory=${directory}`, '--ozone-platform=wayland'], '/', true)).toBe(directory);
    expect(directoryFromArguments(['app', '--', pathToFileURL(directory).href], '/', true)).toBe(directory);
    expect(directoryFromArguments(['app', '中文 directory'], home, true)).toBe(directory);
    expect(directoryFromArguments(['electron', '/source', '--inspect=1234', directory], '/', false)).toBe(directory);
    expect(directoryFromArguments(['app', '--inspect=1234', 'file:///missing'], '/', true)).toBeUndefined();
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('AppImage integration resources survive unmount and invalidate when content or launcher changes', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-appimage-resources-'));
  try {
    const source = path.join(home, 'mount/resources');
    await mkdir(path.join(source, 'bin'), { recursive: true });
    await mkdir(path.join(source, 'agent-integration/skills/amux'), { recursive: true });
    await writeFile(path.join(source, 'bin/treefold'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(path.join(source, 'agent-integration/skills/amux/SKILL.md'), 'skill');
    const image = path.join(home, 'Treefold.AppImage');
    const staged = await persistentAppImageResources(source, home, image);
    expect(await persistentAppImageResources(source, home, image)).toBe(staged);
    expect((await stat(path.join(staged, 'bin/treefold'))).mode & 0o111).not.toBe(0);
    expect(await readFile(path.join(staged, 'desktop-path'), 'utf8')).toBe(image);
    await writeFile(path.join(source, 'agent-integration/skills/amux/SKILL.md'), 'new skill');
    const updated = await persistentAppImageResources(source, home, image);
    expect(updated).not.toBe(staged);
    expect(await persistentAppImageResources(source, home, `${image}.moved`)).not.toBe(updated);
    await rm(path.join(home, 'mount'), { recursive: true });
    expect(await readFile(path.join(staged, 'agent-integration/skills/amux/SKILL.md'), 'utf8')).toBe('skill');
  } finally { await rm(home, { recursive: true, force: true }); }
});

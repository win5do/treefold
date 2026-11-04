import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { installLinuxApp } from '../../scripts/install-linux-app.ts';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'treefold-linux-install-'));
  const source = path.join(root, 'source');
  const installDir = path.join(root, 'local app');
  const options = { binDir: path.join(root, 'bin'), applicationsDir: path.join(root, 'applications') };
  for (const file of ['treefold-desktop', 'resources/bin/treefold', 'resources/bin/treefold-backend', 'resources/bin/amux']) {
    const target = path.join(source, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '#!/bin/sh\nprintf "treefold 0.2.0\\n"\n');
    chmodSync(target, 0o755);
  }
  for (const file of ['resources/app.asar', 'resources/icon.png', 'resources/agent-integration/manifest.json']) {
    const target = path.join(source, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'fixture');
  }
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, source, installDir, options, cleanup };
}

test('Linux local installation creates desktop and CLI-launchable GUI entry points and replaces old application', () => {
  const f = fixture();
  try {
    const installed = installLinuxApp(f.source, f.installDir, '0.2.0', f.options);
    assert.equal(installed, path.join(f.installDir, 'app'));
    assert.equal(readlinkSync(path.join(f.options.binDir, 'treefold-desktop')), path.join(installed, 'treefold-desktop'));
    const desktop = readFileSync(path.join(f.options.applicationsDir, 'treefold-desktop.desktop'), 'utf8');
    assert.ok(desktop.includes(`Exec="${path.join(installed, 'treefold-desktop')}" -- %F`));
    assert.ok(desktop.includes(`Icon=${path.join(installed, 'resources/icon.png')}`));
    writeFileSync(path.join(installed, 'old-file'), 'old');
    installLinuxApp(f.source, f.installDir, '0.2.0', f.options);
    assert.equal(existsSync(path.join(installed, 'old-file')), false);
    assert.deepEqual(readdirSync(f.installDir), ['app']);
    assert.deepEqual(readdirSync(f.options.applicationsDir), ['treefold-desktop.desktop']);
  } finally { f.cleanup(); }
});

test('Linux local installation preserves application and desktop entry when staged version is wrong', () => {
  const f = fixture();
  try {
    const installed = installLinuxApp(f.source, f.installDir, '0.2.0', f.options);
    writeFileSync(path.join(installed, 'previous'), 'keep');
    const desktopFile = path.join(f.options.applicationsDir, 'treefold-desktop.desktop');
    const previousDesktop = readFileSync(desktopFile, 'utf8');
    assert.throws(() => installLinuxApp(f.source, f.installDir, '9.9.9', f.options), /does not match/);
    assert.equal(readFileSync(path.join(installed, 'previous'), 'utf8'), 'keep');
    assert.equal(readFileSync(desktopFile, 'utf8'), previousDesktop);
    assert.deepEqual(readdirSync(f.installDir), ['app']);
  } finally { f.cleanup(); }
});

test('Linux local installation leaves an unrelated launcher untouched', () => {
  const f = fixture();
  try {
    mkdirSync(f.options.binDir);
    const launcher = path.join(f.options.binDir, 'treefold-desktop');
    writeFileSync(launcher, 'user launcher');
    assert.throws(() => installLinuxApp(f.source, f.installDir, '0.2.0', f.options), /unrelated launcher/);
    assert.equal(readFileSync(launcher, 'utf8'), 'user launcher');
    assert.equal(existsSync(f.installDir), false);
  } finally { f.cleanup(); }
});

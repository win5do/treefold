import { mock } from 'node:test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installApp } from '../../scripts/install-app-local.ts';

for (const failure of ['missing source', 'invalid signature']) {
  test(`local installation preserves the existing App on ${failure}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'treefold-install-test-'));
    try {
      const installDir = path.join(root, 'Applications');
      const installedApp = path.join(installDir, 'Treefold.app');
      mkdirSync(installedApp, { recursive: true });
      writeFileSync(path.join(installedApp, 'previous-version'), 'keep this App');
      const sourceApp = path.join(root, 'source.app');
      if (failure === 'invalid signature') {
        mkdirSync(sourceApp);
        writeFileSync(path.join(sourceApp, 'unsigned'), 'invalid App');
      }
      assert.throws(() => installApp(sourceApp, installDir, '0.1.0'));
      assert.equal(readFileSync(path.join(installedApp, 'previous-version'), 'utf8'), 'keep this App');
      assert.deepEqual(readdirSync(installDir), ['Treefold.app']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// Inject filesystem failures after staging while exercising real backup/restore moves.
for (const failRestore of [false, true]) {
  test(`failed replacement ${failRestore ? 'retains the recovery backup' : 'restores the previous App'}`, async () => {
    const fs = (await import('node:fs')).default;
    const childProcess = (await import('node:child_process')).default;
    const { syncBuiltinESMExports } = await import('node:module');
    const root = mkdtempSync(path.join(tmpdir(), 'treefold-install-rollback-'));
    const installDir = path.join(root, 'Applications');
    const installedApp = path.join(installDir, 'Treefold.app');
    const sourceApp = path.join(root, 'source.app');
    mkdirSync(installedApp, { recursive: true });
    writeFileSync(path.join(installedApp, 'previous-version'), 'keep this App');
    mkdirSync(sourceApp);
    writeFileSync(path.join(sourceApp, 'new-version'), 'replacement');
    const rename = fs.renameSync;
    try {
      mock.method(childProcess, 'spawnSync', (command: string) => ({
        status: command === 'pgrep' ? 1 : 0,
        stdout: '', stderr: 'Signature=adhoc',
      }));
      mock.method(childProcess, 'execFileSync', (command: string, args: string[]) => {
        if (command === 'ditto') fs.cpSync(args[0], args[1], { recursive: true });
        return command === 'plutil' ? '0.1.0\n' : '';
      });
      mock.method(fs, 'renameSync', (source: string, destination: string) => {
        if (source.includes('.treefold-install-') &&
          (path.basename(source) === 'Treefold.app' || failRestore)) {
          throw new Error('simulated rename failure');
        }
        rename(source, destination);
      });
      syncBuiltinESMExports();
      assert.throws(() => installApp(sourceApp, installDir, '0.1.0'), /simulated rename failure/);
      if (failRestore) {
        const [transaction] = readdirSync(installDir);
        assert.ok(transaction.startsWith('.treefold-install-'));
        assert.equal(readFileSync(path.join(installDir, transaction, 'Treefold.previous.app/previous-version'), 'utf8'), 'keep this App');
      } else {
        assert.equal(readFileSync(path.join(installedApp, 'previous-version'), 'utf8'), 'keep this App');
        assert.deepEqual(readdirSync(installDir), ['Treefold.app']);
      }
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { bundleApp } from './bundle-app.ts';
import { assertLinuxAppStopped, installLinuxApp } from './install-linux-app.ts';

function assertAppStopped(installedApp: string) {
  const executable = path.join(installedApp, 'Contents/MacOS');
  const pattern = `${executable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`;
  const result = spawnSync('pgrep', ['-f', pattern], { stdio: 'ignore' });
  if (result.status === 0) throw new Error(`Quit the installed Treefold App before replacing ${installedApp}`);
  if (result.error || result.status !== 1) throw result.error ?? new Error('Could not check whether Treefold is running');
}

function verifyApp(appPath: string, expectedVersion: string) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  const details = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  if (details.status !== 0) throw details.error ?? new Error(details.stderr);
  if (!`${details.stdout}${details.stderr}`.includes('Signature=adhoc')) throw new Error('Packaged App is not ad-hoc signed');
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    const actual = execFileSync('plutil', ['-extract', key, 'raw', path.join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    if (actual !== expectedVersion) throw new Error(`${key} ${actual} does not match ${expectedVersion}`);
  }
}

export function installApp(appPath: string, installDir: string, version: string) {
  const installedApp = path.join(installDir, 'Treefold.app');
  assertAppStopped(installedApp);
  mkdirSync(installDir, { recursive: true });
  const transaction = mkdtempSync(path.join(installDir, '.treefold-install-'));
  const stagedApp = path.join(transaction, 'Treefold.app');
  const previousApp = path.join(transaction, 'Treefold.previous.app');
  let previousMoved = false;
  try {
    execFileSync('ditto', [appPath, stagedApp], { stdio: 'inherit' });
    verifyApp(stagedApp, version);
    assertAppStopped(installedApp);
    if (existsSync(installedApp)) {
      renameSync(installedApp, previousApp);
      previousMoved = true;
    }
    try {
      renameSync(stagedApp, installedApp);
    } catch (error) {
      if (previousMoved) {
        renameSync(previousApp, installedApp);
        previousMoved = false;
      }
      throw error;
    }
    previousMoved = false;
  } finally {
    // Preserve the backup if restoring the previous App itself failed.
    if (!previousMoved) rmSync(transaction, { recursive: true, force: true });
  }
  return installedApp;
}

if (import.meta.main) {
  const linux = process.platform === 'linux';
  if (!linux && process.platform !== 'darwin') throw new Error('Local installation supports macOS and Linux.');
  const dataDir = process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share');
  const installDir = path.resolve(process.env.TREEFOLD_INSTALL_DIR ?? (linux ? path.join(dataDir, 'treefold') : '/Applications'));
  if (linux) assertLinuxAppStopped(path.join(installDir, 'app'));
  else assertAppStopped(path.join(installDir, 'Treefold.app'));
  const { appPath, version, artifacts } = await bundleApp({ localInstall: true });
  const installedApp = linux ? installLinuxApp(appPath, installDir, version, {
    binDir: path.join(homedir(), '.local/bin'), applicationsDir: path.join(dataDir, 'applications'),
  }) : installApp(appPath, installDir, version);
  console.log(`Installed Treefold ${version} at ${installedApp}`);
  for (const artifact of artifacts) console.log(`Packaged: ${artifact}`);
}

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function assertLinuxAppStopped(installedApp: string) {
  const executable = path.join(installedApp, 'treefold-desktop');
  const pattern = executable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = spawnSync('pgrep', ['-f', `^${pattern}( |$)`], { stdio: 'ignore' });
  if (result.status === 0) throw new Error(`Quit the installed Treefold App before replacing ${installedApp}`);
  if (result.error || result.status !== 1) throw result.error ?? new Error('Could not check whether Treefold is running');
}

function verifyLinuxApp(appPath: string, version: string) {
  for (const file of ['treefold-desktop', 'resources/bin/treefold', 'resources/bin/treefold-backend', 'resources/bin/amux']) {
    accessSync(path.join(appPath, file), constants.X_OK);
  }
  for (const file of ['resources/app.asar', 'resources/icon.png', 'resources/agent-integration/manifest.json']) {
    accessSync(path.join(appPath, file), constants.R_OK);
  }
  const actual = execFileSync(path.join(appPath, 'resources/bin/treefold'), ['--version'], { encoding: 'utf8' }).trim();
  if (actual !== `treefold ${version}`) throw new Error(`Packaged CLI version ${actual} does not match ${version}`);
}

function desktopQuoted(value: string) {
  if (/[\r\n]/.test(value)) throw new Error('Desktop installation paths must not contain newlines');
  // Desktop entries unescape backslashes before parsing Exec's quoted arguments.
  return `"${value.replaceAll('\\', '\\\\\\\\').replace(/(["`$])/g, '\\\\$1').replaceAll('%', '%%')}"`;
}

export function installLinuxApp(appPath: string, installDir: string, version: string, options: { binDir: string; applicationsDir: string }) {
  const installedApp = path.join(installDir, 'app');
  const executable = path.join(installedApp, 'treefold-desktop');
  const launcher = path.join(options.binDir, 'treefold-desktop');
  const desktopFile = path.join(options.applicationsDir, 'treefold-desktop.desktop');
  const stagedDesktop = `${desktopFile}.${randomUUID()}.tmp`;
  const stagedLauncher = `${launcher}.${randomUUID()}.tmp`;
  const previousDesktop = existsSync(desktopFile) ? readFileSync(desktopFile) : undefined;
  const desktop = `[Desktop Entry]\nType=Application\nName=Treefold\nExec=${desktopQuoted(executable)} -- %F\nIcon=${path.join(installedApp, 'resources/icon.png')}\nTerminal=false\nCategories=Development;\nStartupWMClass=treefold\nMimeType=inode/directory;\n`;
  const existingLauncher = lstatSync(launcher, { throwIfNoEntry: false });
  if (existingLauncher && (!existingLauncher.isSymbolicLink() || path.resolve(path.dirname(launcher), readlinkSync(launcher)) !== executable)) {
    throw new Error(`Refusing to replace an unrelated launcher: ${launcher}`);
  }
  assertLinuxAppStopped(installedApp);
  mkdirSync(installDir, { recursive: true });
  mkdirSync(options.binDir, { recursive: true });
  mkdirSync(options.applicationsDir, { recursive: true });
  const transaction = mkdtempSync(path.join(installDir, '.treefold-install-'));
  const stagedApp = path.join(transaction, 'app');
  const previousApp = path.join(transaction, 'previous');
  let previousMoved = false;
  let replaced = false;
  let desktopReplaced = false;
  try {
    cpSync(appPath, stagedApp, { recursive: true, verbatimSymlinks: true });
    verifyLinuxApp(stagedApp, version);
    // Prepare integration files before replacing the application. Each rename
    // happens on its destination filesystem so a separate ~/.local mount works.
    writeFileSync(stagedDesktop, desktop);
    if (!existingLauncher) symlinkSync(executable, stagedLauncher);
    assertLinuxAppStopped(installedApp);
    if (existsSync(installedApp)) {
      renameSync(installedApp, previousApp);
      previousMoved = true;
    }
    renameSync(stagedApp, installedApp);
    replaced = true;
    renameSync(stagedDesktop, desktopFile);
    desktopReplaced = true;
    if (!existingLauncher) renameSync(stagedLauncher, launcher);
    previousMoved = false;
  } catch (error) {
    if (desktopReplaced) {
      if (previousDesktop) writeFileSync(desktopFile, previousDesktop);
      else rmSync(desktopFile, { force: true });
    }
    if (replaced) rmSync(installedApp, { recursive: true, force: true });
    if (previousMoved) {
      renameSync(previousApp, installedApp);
      previousMoved = false;
    }
    throw error;
  } finally {
    rmSync(stagedDesktop, { force: true });
    rmSync(stagedLauncher, { force: true });
    if (!previousMoved) rmSync(transaction, { recursive: true, force: true });
  }
  return installedApp;
}

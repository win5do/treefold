import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build, Platform } from 'electron-builder';
import { valid } from 'semver';

const root = path.resolve(import.meta.dirname, '..');

type BundleOptions = { localInstall?: boolean; directoryOnly?: boolean };

export async function bundleDesktop({ localInstall = false, directoryOnly = false }: BundleOptions = {}) {
  if (process.platform !== 'darwin') throw new Error('Treefold currently supports macOS desktop packaging.');
  const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const version = process.env.TREEFOLD_BUILD_VERSION ?? (localInstall
    ? `${metadata.version.split(/[+-]/, 1)[0]}-alpha.${timestamp}`
    : metadata.version);
  if (valid(version) !== version) throw new Error(`TREEFOLD_BUILD_VERSION must be valid SemVer, received: ${version}`);

  const env = { ...process.env, TREEFOLD_BUILD_VERSION: version };
  execFileSync('cargo', ['xtask', 'sidecars', 'bundle'], { cwd: root, env, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });

  let appPath: string | undefined;
  const artifacts = await build({
    projectDir: root,
    targets: Platform.MAC.createTarget(directoryOnly ? 'dir' : undefined),
    publish: 'never',
    config: {
      extraMetadata: { version },
      buildVersion: version,
      afterSign(context) {
        appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      },
    },
  });
  if (!appPath) throw new Error('electron-builder did not produce a signed App');
  return { appPath, version, artifacts };
}

if (import.meta.main) await bundleDesktop({ directoryOnly: process.argv.includes('--dir') });

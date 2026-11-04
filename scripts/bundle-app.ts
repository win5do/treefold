import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build, Platform } from 'electron-builder';
import { resolveBuildVersion } from './build-version.ts';

const root = path.resolve(import.meta.dirname, '..');

type BundleOptions = { localInstall?: boolean; directoryOnly?: boolean };

export async function bundleApp({ localInstall = false, directoryOnly = false }: BundleOptions = {}) {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Treefold desktop packaging supports macOS and Linux.');
  const platform = process.platform === 'darwin' ? Platform.MAC : Platform.LINUX;
  const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const version = resolveBuildVersion(metadata.version, { localInstall, override: process.env.TREEFOLD_BUILD_VERSION });

  const env = {
    ...process.env,
    TREEFOLD_BUILD_VERSION: version,
    ...(process.platform === 'darwin' ? { MACOSX_DEPLOYMENT_TARGET: process.env.MACOSX_DEPLOYMENT_TARGET ?? '14.0' } : {}),
  };
  execFileSync('cargo', ['xtask', 'sidecars', 'bundle'], { cwd: root, env, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });

  // Keep only the current package; preserve previous artifacts if compilation fails.
  const outputDirectory = path.join(root, 'release');
  // Finder can recreate .DS_Store while the output directory is being removed.
  rmSync(outputDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

  let appPath: string | undefined;
  const artifacts = await build({
    projectDir: root,
    targets: platform.createTarget(directoryOnly ? 'dir' : undefined),
    publish: 'never',
    config: {
      directories: { output: outputDirectory },
      extraMetadata: { version },
      buildVersion: version,
      afterPack(context) {
        if (context.electronPlatformName === 'linux') appPath = context.appOutDir;
      },
      afterSign(context) {
        if (context.electronPlatformName === 'darwin') appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      },
    },
  });
  if (!appPath) throw new Error('electron-builder did not produce an application');
  return { appPath, version, artifacts };
}

if (import.meta.main) await bundleApp({ directoryOnly: process.argv.includes('--dir') });

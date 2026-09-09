import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');

if (process.platform !== 'darwin') throw new Error('Treefold currently supports macOS desktop packaging.');
const env = { ...process.env };
const version = env.TREEFOLD_BUILD_VERSION;
if (version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('TREEFOLD_BUILD_VERSION must be valid SemVer');
execFileSync('cargo', ['xtask', 'sidecars', 'bundle'], { cwd: root, env, stdio: 'inherit' });
execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });
execFileSync('npx', ['--no-install', 'electron-builder', '--mac', ...(process.argv.includes('--dir') ? ['--dir'] : []),
  ...(version ? [`--config.extraMetadata.version=${version}`, `--config.buildVersion=${version}`] : [])], { cwd: root, env, stdio: 'inherit' });

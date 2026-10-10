import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gt, valid } from 'semver';
import { releaseVersionFiles, validateReleaseVersion } from './release-version.ts';

export function release(root: string, version: string, dryRun = false) {
  validateReleaseVersion(version);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const requireClean = () => {
    if (git('status', '--porcelain', '--untracked-files=all')) {
      throw new Error('Release requires a clean working tree and index, including untracked files.');
    }
  };
  if (git('branch', '--show-current') !== 'main') throw new Error('Release must run on main.');
  requireClean();
  const current = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!valid(current) || !gt(version, current)) throw new Error(`Release version must be newer than ${current}.`);

  git('fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main', '--tags');
  git('merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD');
  const tag = `v${version}`;
  for (const existing of git('tag', '--list', 'v*').split('\n')) {
    const previous = existing.slice(1);
    if (valid(previous) && !gt(version, previous)) {
      throw new Error(`Release version must be newer than existing tag ${existing}.`);
    }
  }
  const files = releaseVersionFiles(root, version);
  console.log(`Release ${tag}: update ${[...files.keys()].join(', ')}, commit, tag, and atomically push main + tag to origin.`);
  if (dryRun) return;
  requireClean();
  try {
    for (const [file, contents] of files) writeFileSync(path.join(root, file), contents);
    releaseVersionFiles(root, version, true);
    git('diff', '--check');
    git('add', '--', ...files.keys());
    git('commit', '--only', '-m', `chore: release ${version}`, '--', ...files.keys());
    requireClean();
    releaseVersionFiles(root, version, true);
    git('tag', '-a', tag, '-m', `Treefold ${tag}`);
    git('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}:refs/tags/${tag}`);
  } catch (error) {
    console.error(`Release stopped. Local changes, commit, or tag are retained for inspection; nothing is reset or force-pushed.
If the release commit and tag were created and only the push failed, inspect them and retry:
git push --atomic origin HEAD:refs/heads/main refs/tags/${tag}:refs/tags/${tag}`);
    throw error;
  }
  console.log(`Pushed ${tag}. Follow publication with: gh run list --workflow release.yml`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const mode = args[0]?.startsWith('--') ? args.shift() : undefined;
  const [version] = args;
  if (args.length !== 1 || !version || (mode && mode !== '--check' && mode !== '--dry-run')) {
    throw new Error('Usage: node scripts/release.ts [--check | --dry-run] <version>');
  }
  const root = path.resolve(import.meta.dirname, '..');
  if (mode === '--check') {
    releaseVersionFiles(root, version, true);
    console.log(`All Treefold release versions match ${version}.`);
  } else {
    release(root, version, mode === '--dry-run');
  }
}

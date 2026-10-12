import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gt } from 'semver';
import { validateReleaseVersion } from './release-version.ts';

const caskPath = 'Casks/treefold.rb';
const downloadUrl = 'https://github.com/win5do/treefold/releases/download/v#{version}/Treefold-#{version}-arm64.dmg';

export function updateHomebrewCask(contents: string, version: string, checksum: string) {
  validateReleaseVersion(version);
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Expected the verified DMG SHA-256.');
  const versions = [...contents.matchAll(/^  version "([^"]+)"$/gm)];
  const checksums = [...contents.matchAll(/^  sha256 "([a-f0-9]{64})"$/gm)];
  if (versions.length !== 1 || checksums.length !== 1
    || !contents.startsWith('cask "treefold" do\n')
    || !contents.includes(`  url "${downloadUrl}"\n`)) {
    throw new Error('Unexpected Treefold cask format; refusing to rewrite it.');
  }
  const current = versions[0][1];
  validateReleaseVersion(current);
  if (gt(current, version)) return { contents, status: 'newer' as const };
  if (current === version) {
    if (checksums[0][1] !== checksum) throw new Error(`Checksum mismatch for already published tap version ${version}.`);
    return { contents, status: 'unchanged' as const };
  }
  return {
    contents: contents.replace(versions[0][0], `  version "${version}"`)
      .replace(checksums[0][0], `  sha256 "${checksum}"`),
    status: 'updated' as const,
  };
}

// The workflow provides a dedicated, clean checkout of the tap's main branch.
export function syncHomebrewTap(directory: string, version: string, checksum: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Tap checkout must be clean.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Tap checkout must be on main.');
  git('pull', '--ff-only', 'origin', 'main');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'refs/remotes/origin/main')) {
    throw new Error('Tap checkout must match origin/main.');
  }
  const file = path.join(directory, caskPath);
  const result = updateHomebrewCask(readFileSync(file, 'utf8'), version, checksum);
  if (result.status !== 'updated') {
    console.log(result.status === 'newer' ? `Tap already has a newer version; skipping ${version}.` : `Tap already matches ${version}.`);
    return result.status;
  }
  writeFileSync(file, result.contents);
  git('diff', '--check');
  git('add', '--', caskPath);
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '--only', '-m', `chore: update Treefold to ${version}`, '--', caskPath);
  // A concurrent tap change must reject this push, never overwrite remote history.
  // Rerunning the failed Actions job gets a fresh checkout and repeats the version check.
  git('push', 'origin', 'HEAD:refs/heads/main');
  console.log(`Updated Homebrew tap to ${version}.`);
  return result.status;
}

if (import.meta.main) {
  const [directory, version, checksum, ...extra] = process.argv.slice(2);
  if (!directory || !version || !checksum || extra.length) {
    throw new Error('Usage: node scripts/update-homebrew-tap.ts <tap-directory> <version> <sha256>');
  }
  syncHomebrewTap(path.resolve(directory), version, checksum);
}

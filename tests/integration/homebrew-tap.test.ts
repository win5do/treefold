import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { syncHomebrewTap, updateHomebrewCask } from '../../scripts/update-homebrew-tap.ts';

const oldChecksum = 'a'.repeat(64);
const newChecksum = 'b'.repeat(64);
const cask = `cask "treefold" do
  version "0.1.0-alpha.2"
  sha256 "${oldChecksum}"

  url "https://github.com/win5do/treefold/releases/download/v#{version}/Treefold-#{version}-arm64.dmg"
  depends_on arch: :arm64
  depends_on macos: :sonoma
  app "Treefold.app"
  caveats "Keep this installation advice."
end
`;

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'treefold-tap-'));
  const remote = path.join(directory, 'remote.git');
  const root = path.join(directory, 'tap');
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = (...args: string[]) => run(root, ...args);
  run(directory, 'init', '--bare', '--initial-branch=main', remote);
  run(directory, 'clone', remote, root);
  git('config', 'user.name', 'Tap test');
  git('config', 'user.email', 'tap-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
  mkdirSync(path.join(root, 'Casks'));
  writeFileSync(path.join(root, 'Casks/treefold.rb'), cask);
  writeFileSync(path.join(root, 'README.md'), 'Preserve unrelated files.\n');
  git('add', '--', 'Casks/treefold.rb', 'README.md');
  git('commit', '-m', 'Initial tap');
  git('push', 'origin', 'main');
  return { directory, remote, root, git, run, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('tap promotion preserves Cask fields and pushes only its verified version and checksum', () => {
  const f = fixture();
  try {
    expect(syncHomebrewTap(f.root, '0.1.0-alpha.3', newChecksum)).toBe('updated');
    const expected = cask.replace('0.1.0-alpha.2', '0.1.0-alpha.3').replace(oldChecksum, newChecksum);
    expect(f.run(f.directory, '--git-dir', f.remote, 'show', 'main:Casks/treefold.rb')).toBe(expected.trim());
    expect(f.git('status', '--porcelain')).toBe('');
    expect(f.git('diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('Casks/treefold.rb');
    expect(f.git('log', '-1', '--format=%s')).toBe('chore: update Treefold to 0.1.0-alpha.3');
    const head = f.git('rev-parse', 'HEAD');
    expect(syncHomebrewTap(f.root, '0.1.0-alpha.3', newChecksum)).toBe('unchanged');
    expect(syncHomebrewTap(f.root, '0.1.0-alpha.2', oldChecksum)).toBe('newer');
    expect(f.git('rev-parse', 'HEAD')).toBe(head);
    expect(() => syncHomebrewTap(f.root, '0.1.0-alpha.3', oldChecksum)).toThrow(/Checksum mismatch/);
    expect(f.git('status', '--porcelain')).toBe('');
    expect(syncHomebrewTap(f.root, '0.1.0', oldChecksum)).toBe('updated');
  } finally { f.cleanup(); }
});

test('stale checkout refreshes the remote version before promoting a release', () => {
  const f = fixture();
  try {
    const other = path.join(f.directory, 'other');
    f.run(f.directory, 'clone', f.remote, other);
    f.run(other, 'config', 'commit.gpgsign', 'false');
    f.run(other, 'config', 'core.hooksPath', path.join(f.directory, 'no-hooks'));
    syncHomebrewTap(other, '0.2.0', newChecksum);
    expect(syncHomebrewTap(f.root, '0.1.0', oldChecksum)).toBe('newer');
    expect(readFileSync(path.join(f.root, 'Casks/treefold.rb'), 'utf8')).toContain('version "0.2.0"');
    expect(f.git('rev-parse', 'HEAD')).toBe(f.run(other, 'rev-parse', 'HEAD'));
  } finally { f.cleanup(); }
});

test('tap sync rejects dirty or unpublished local work without pushing it', () => {
  const f = fixture();
  try {
    const initial = f.git('rev-parse', 'HEAD');
    writeFileSync(path.join(f.root, 'README.md'), 'User changes\n');
    expect(() => syncHomebrewTap(f.root, '0.1.0', newChecksum)).toThrow(/clean/);
    f.git('commit', '--only', '-m', 'Unpublished user changes', '--', 'README.md');
    expect(() => syncHomebrewTap(f.root, '0.1.0', newChecksum)).toThrow(/match origin/);
    expect(f.run(f.directory, '--git-dir', f.remote, 'rev-parse', 'main')).toBe(initial);
    expect(readFileSync(path.join(f.root, 'Casks/treefold.rb'), 'utf8')).toBe(cask);
  } finally { f.cleanup(); }
});

test('tap transformation rejects malformed checksums, versions, or unexpected Cask layouts', () => {
  for (const version of ['v0.1.0', 'latest', '0.1.0+build.1', '0.1.0"\ninjected']) {
    expect(() => updateHomebrewCask(cask, version, newChecksum)).toThrow(/SemVer/);
  }
  expect(() => updateHomebrewCask(cask, '0.1.0', 'bad')).toThrow(/SHA-256/);
  for (const contents of [
    cask.replace('version "0.1.0-alpha.2"', 'version :latest'),
    cask.replace('  sha256', `  sha256 "${oldChecksum}"\n  sha256`),
    cask.replace('github.com/win5do/treefold', 'example.invalid/treefold'),
  ]) expect(() => updateHomebrewCask(contents, '0.1.0', newChecksum)).toThrow(/format/);
});

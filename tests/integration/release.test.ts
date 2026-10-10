import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { release } from '../../scripts/release.ts';
import { releaseVersionFiles } from '../../scripts/release-version.ts';

const repository = path.resolve(import.meta.dirname, '../..');
const version = '0.1.0-alpha.3';
const tag = `v${version}`;

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'treefold-release-test-'));
  const root = path.join(directory, 'checkout');
  const remote = path.join(directory, 'origin.git');
  mkdirSync(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--bare', '--initial-branch=main', remote);
  git('--git-dir', remote, 'config', 'core.hooksPath', path.join(remote, 'hooks'));
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
  const originals = releaseVersionFiles(repository, '0.1.0-alpha.1');
  for (const [file, contents] of originals) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  git('add', '--', ...originals.keys());
  git('commit', '-m', 'Initial fixture');
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');
  const initial = git('rev-parse', 'HEAD');
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  return { root, remote, git, initial, originals, read, cleanup };
}

test('release commits synchronized versions and publishes main and an annotated tag together', () => {
  const f = fixture();
  try {
    release(f.root, version);
    releaseVersionFiles(f.root, version, true);
    assert.equal(f.git('status', '--porcelain'), '');
    assert.equal(f.git('log', '-1', '--format=%s'), `chore: release ${version}`);
    assert.equal(f.git('cat-file', '-t', `refs/tags/${tag}`), 'tag');
    const commit = f.git('rev-parse', 'HEAD');
    assert.notEqual(commit, f.initial);
    assert.equal(f.git('rev-parse', `${tag}^{commit}`), commit);
    assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), commit);
    assert.equal(f.git('--git-dir', f.remote, 'rev-parse', `${tag}^{commit}`), commit);
    const before = JSON.parse(f.originals.get('package-lock.json')!);
    const after = JSON.parse(f.read('package-lock.json'));
    delete before.packages[''];
    delete after.packages[''];
    assert.deepEqual(after.packages, before.packages);
    for (const file of ['src/backend/Cargo.lock', 'src/cli/Cargo.lock']) {
      assert.equal(f.read(file).replace(`version = "${version}"`, 'version = "0.1.0-alpha.1"'), f.originals.get(file));
    }
    const integration = 'src/backend/resources/agent-integration/manifest.json';
    const previous = JSON.parse(f.originals.get(integration)!);
    const updated = JSON.parse(f.read(integration));
    for (const key of ['amux_cli', 'amux_skill', 'treefold_skill']) {
      assert.equal(updated.components[key], previous.components[key]);
    }
  } finally { f.cleanup(); }
});

test('dry run leaves tracked files, commits, tags, and remote unchanged', () => {
  const f = fixture();
  try {
    release(f.root, version, true);
    assert.equal(f.git('status', '--porcelain'), '');
    assert.equal(f.git('rev-parse', 'HEAD'), f.initial);
    assert.equal(f.git('tag', '--list'), '');
    assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), f.initial);
  } finally { f.cleanup(); }
});

for (const scenario of ['invalid version', 'old version', 'dirty index', 'untracked file', 'wrong branch', 'remote tag', 'remote ahead', 'malformed manifest']) {
  test(`release rejects ${scenario} before editing versions or publishing`, () => {
    const f = fixture();
    try {
      let requested = version;
      let expected: RegExp = /./;
      if (scenario === 'invalid version') { requested = 'v0.1.0'; expected = /SemVer/; }
      if (scenario === 'old version') { requested = '0.1.0-alpha.1'; expected = /newer/; }
      if (scenario === 'dirty index' || scenario === 'untracked file') {
        writeFileSync(path.join(f.root, 'unrelated'), 'user work');
        if (scenario === 'dirty index') f.git('add', 'unrelated');
        expected = /clean working tree/;
      }
      if (scenario === 'wrong branch') { f.git('checkout', '-b', 'feature'); expected = /main/; }
      if (scenario === 'remote tag') {
        f.git('tag', tag);
        f.git('push', 'origin', tag);
        f.git('tag', '-d', tag);
        expected = /existing tag/;
      }
      if (scenario === 'remote ahead') {
        f.git('commit', '--allow-empty', '-m', 'Remote change');
        f.git('push', 'origin', 'main');
        f.git('reset', '--hard', f.initial);
      }
      if (scenario === 'malformed manifest') {
        writeFileSync(path.join(f.root, 'src/cli/Cargo.lock'), 'version = 4\n');
        f.git('commit', '--only', '-m', 'Broken fixture', '--', 'src/cli/Cargo.lock');
        expected = /exactly one treefold-cli/;
      }
      const head = f.git('rev-parse', 'HEAD');
      const status = f.git('status', '--porcelain');
      const remote = f.git('ls-remote', 'origin');
      assert.throws(() => release(f.root, requested), expected);
      assert.equal(f.read('package.json'), f.originals.get('package.json'));
      assert.equal(f.git('rev-parse', 'HEAD'), head);
      assert.equal(f.git('status', '--porcelain'), status);
      assert.equal(f.git('ls-remote', 'origin'), remote);
    } finally { f.cleanup(); }
  });
}

test('atomic push rejection publishes neither main nor tag and retains local recovery state', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.remote, 'hooks/update'), '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1 ;; esac\n', { mode: 0o755 });
    assert.throws(() => release(f.root, version));
    assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), f.initial);
    assert.equal(f.git('--git-dir', f.remote, 'tag', '--list'), '');
    assert.equal(f.git('rev-parse', `${tag}^{commit}`), f.git('rev-parse', 'HEAD'));
    releaseVersionFiles(f.root, version, true);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.cleanup(); }
});

test('CI version check detects lockfile drift', () => {
  const f = fixture();
  try {
    releaseVersionFiles(f.root, '0.1.0-alpha.1', true);
    const file = path.join(f.root, 'src/cli/Cargo.lock');
    writeFileSync(file, f.read('src/cli/Cargo.lock').replace('name = "treefold-cli"\nversion = "0.1.0-alpha.1"', `name = "treefold-cli"\nversion = "${version}"`));
    assert.throws(() => releaseVersionFiles(f.root, '0.1.0-alpha.1', true), /Version mismatch in src\/cli\/Cargo.lock/);
  } finally { f.cleanup(); }
});

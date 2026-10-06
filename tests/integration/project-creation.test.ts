import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Backend } from '../../src/main/backend.ts';

const executable = path.resolve(process.env.TREEFOLD_BACKEND_PATH || 'src/backend/target/debug/treefold-backend');

for (const protocol of ['http', 'https']) {
  test(`${protocol} Project creation honors Git URL rewrites and detects a different repository`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'treefold-project-url-'));
    const home = path.join(root, 'home');
    const remote = path.join(root, 'remote.git');
    const config = path.join(root, 'gitconfig');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
    const backend = new Backend({ executable, env: { ...env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' } });
    try {
      await mkdir(remote);
      execFileSync('git', ['init', '--bare', remote], { env, stdio: 'pipe' });
      const prefix = `${protocol}://git.example.test/team/`;
      const localPrefix = `${pathToFileURL(root).href}/`;
      execFileSync('git', ['config', '--file', config, `url.${localPrefix}.insteadOf`, prefix], { env });

      const url = await backend.start();
      const input = { name: 'Cloned Project', source: { kind: 'git_url', url: `${prefix}remote.git` } };
      const post = (route: string) => fetch(`${url}${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      const validation = await post('/api/projects/validate-source');
      assert.equal(validation.status, 200, await validation.text());
      const created = await post('/api/projects');
      const project = await created.json();
      assert.equal(created.status, 201, JSON.stringify(project));
      const detail = await (await fetch(`${url}/api/projects/${project.id}`)).json();
      assert.equal(detail.repositories.length, 1);
      const repository = detail.repositories[0];
      assert.equal(repository.git_status, 'ready');
      assert.equal(repository.source_ownership, 'managed');
      assert.equal(repository.repository_url, pathToFileURL(remote).href);

      execFileSync('git', ['remote', 'set-url', 'origin', `${prefix}different.git`], { cwd: repository.source_root, env });
      const refreshed = await post(`/api/project-repositories/${repository.id}/refresh`);
      assert.equal(refreshed.status, 200);
      assert.equal((await refreshed.json()).git_status, 'mismatch');
    } finally {
      await backend.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
}

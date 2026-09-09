import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Backend } from '../../electron/backend.ts';

const executable = path.resolve(process.env.TREEFOLD_BACKEND_PATH || 'backend/target/debug/treefold-backend');
function service(home) {
  return new Backend({ executable, env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' }, timeout: 15000 });
}
test('Rust API owns its home, preserves settings, and removes discovery state on exit', { timeout: 60000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-backend-'));
  const backend = service(home), duplicate = service(home);
  try {
    const url = await backend.start();
    assert.equal((await readFile(path.join(home, 'runtime/api-url'), 'utf8')).trim(), url);
    await assert.rejects(duplicate.start(), /Another Treefold backend/);
    const updated = await fetch(`${url}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'zh-CN' }) });
    assert.equal(updated.status, 200);
    await backend.stop();
    await assert.rejects(readFile(path.join(home, 'runtime/api-url')), { code: 'ENOENT' });
    const reopened = service(home);
    try {
      const next = await reopened.start();
      const settings = await (await fetch(`${next}/api/settings`)).json();
      assert.equal(settings.language, 'zh-CN');
      // Closing the desktop's control pipe must also clean up an orphaned API.
      reopened.child.stdin.end();
      await Promise.race([reopened.exited, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Parent EOF did not stop backend')), 15000); t.unref(); })]);
      assert.equal(reopened.child.exitCode, 0);
      await assert.rejects(readFile(path.join(home, 'runtime/api-url')), { code: 'ENOENT' });
    } finally { await reopened.stop(); }
  } finally { await duplicate.stop(); await backend.stop(); await rm(home, { recursive: true, force: true }); }
});

test('invalid settings surface the cause without rewriting the file', { timeout: 30000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-invalid-'));
  const backend = service(home);
  try {
    await mkdir(path.join(home, 'config'));
    const contents = 'schema_version = 999\nlanguage = "en"\n';
    await writeFile(path.join(home, 'config/settings.toml'), contents);
    await assert.rejects(backend.start(), /schema|version/i);
    assert.equal(await readFile(path.join(home, 'config/settings.toml'), 'utf8'), contents);
  } finally { await backend.stop(); await rm(home, { recursive: true, force: true }); }
});


test('unexpected backend exit retains recent stderr for diagnosis', { timeout: 30000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-electron-crash-'));
  let report;
  const exited = new Promise(resolve => { report = resolve; });
  const backend = new Backend({ executable, env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_API_ADDR: '127.0.0.1:0' }, onExit: report });
  try {
    await backend.start();
    backend.child.kill('SIGKILL');
    await backend.exited;
    const error = await exited;
    assert.match(error.message, /Rust backend exited \(SIGKILL\)/);
    assert.match(error.message, /Recent backend stderr:/);
    assert.match(error.message, /Treefold backend starting/);
    const backendLog = await readFile(path.join(home, 'logs/treefold_rCURRENT.log'), 'utf8');
    assert.match(backendLog, /\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO \[backend\] Treefold backend starting/);
  } finally { await backend.stop(); await rm(home, { recursive: true, force: true }); }
});


test('request IDs correlate real API failures and mutations and are exposed to browsers', { timeout: 30000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'treefold-request-id-'));
  const backend = service(home);
  try {
    const url = await backend.start();
    const cases = [
      ['/api/settings', 'PATCH', 'mutation-1', JSON.stringify({ language: 'en-US' }), 200],
      ['/api/settings', 'PATCH', 'invalid-json-1', '{', 400],
      ['/missing', 'GET', 'missing-1', undefined, 404],
    ];
    for (const [route, method, id, body, status] of cases) {
      const response = await fetch(`${url}${route}`, { method, headers: { 'x-request-id': id, 'content-type': 'application/json', origin: 'http://localhost:15011' }, body });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('x-request-id'), id);
      assert.match(response.headers.get('access-control-expose-headers'), /x-request-id/i);
    }
    const generated = await fetch(`${url}/api/health`);
    assert.match(generated.headers.get('x-request-id'), /^[a-f0-9]{32}$/);
    const preflight = await fetch(`${url}/api/settings`, { method: 'OPTIONS', headers: { origin: 'http://localhost:15011', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'x-request-id,content-type' } });
    assert.equal(preflight.status, 200);
    assert.ok(preflight.headers.get('x-request-id'));
    await backend.stop();
    const logs = await readFile(path.join(home, 'logs/treefold_rCURRENT.log'), 'utf8');
    for (const [route, method, id, , status] of cases) {
      assert.ok(logs.includes(`request_id=${id} HTTP ${method} ${route} status=${status}`), logs);
    }
  } finally { await backend.stop(); await rm(home, { recursive: true, force: true }); }
});

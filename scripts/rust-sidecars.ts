import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

// Rollup queues changes during builds. Electron-only edits skip Cargo entirely.
export async function rustSidecars(): Promise<Plugin> {
  const root = path.resolve('.');
  const backend = path.join(root, 'src/backend');
  let amux: string;
  let dirty = false;
  async function prepare() {
    const child = execFile('cargo', ['xtask', 'sidecars', 'dev'], { cwd: root, env: process.env, maxBuffer: 16 * 1024 * 1024 });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Rust sidecar build failed (${code})`)));
    });
    const source = JSON.parse(await readFile(path.join(backend, 'bundle-staging/dev-sidecars/amux-source.json'), 'utf8')) as { manifest_path: string };
    amux = path.dirname(source.manifest_path);
  }
  // Fail startup before electron-vite can launch a stale main bundle.
  await prepare();
  return {
    name: 'treefold-rust-sidecars',
    watchChange(id) { if (id.startsWith(backend + path.sep) || id.startsWith(amux + path.sep)) dirty = true; },
    async buildStart() {
      if (dirty) {
        dirty = false;
        try { await prepare(); } catch (error) { dirty = true; throw error; }
      }
      for (const file of ['src', '.sqlx', 'migrations', 'Cargo.toml', 'Cargo.lock', 'build.rs']) {
        this.addWatchFile(path.join(backend, file));
      }
      for (const file of ['src', 'Cargo.toml', 'Cargo.lock']) {
        this.addWatchFile(path.join(amux, file));
      }
    },
  };
}

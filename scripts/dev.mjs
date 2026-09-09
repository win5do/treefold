import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { root, runXtask } from './xtask.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--no-watch')) throw new Error('Usage: npm run dev:desktop -- [--no-watch]');
const uiPort = process.env.TREEFOLD_UI_PORT || '15011';
const apiPort = process.env.TREEFOLD_API_PORT || '0';
for (const port of [uiPort, apiPort]) if (!/^\d+$/.test(port) || Number(port) > 65535) throw new Error(`Invalid port: ${port}`);
const env = { ...process.env, TREEFOLD_HOME: process.env.TREEFOLD_HOME || process.env.TREEFOLD_DEV_HOME || path.join(root, '.treefold-dev'),
  TREEFOLD_API_ADDR: `127.0.0.1:${apiPort}`, TREEFOLD_UI_URL: `http://127.0.0.1:${uiPort}`, TREEFOLD_UI_PORT: uiPort };
delete env.ELECTRON_RUN_AS_NODE;
runXtask(['sidecars', 'dev'], { env });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, env, stdio: 'inherit' });
let desktop, watcher, restartTimer, exiting = false, restarting = false;
function stop() {
  if (exiting) return;
  exiting = true; clearTimeout(restartTimer); watcher?.close();
  desktop?.kill('SIGTERM'); vite.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
vite.on('exit', code => { process.exitCode = code || 0; stop(); });
function launch() {
  desktop = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
  desktop.on('error', error => { console.error(error); process.exitCode = 1; stop(); });
  desktop.on('exit', code => { if (!restarting) { process.exitCode = code || 0; stop(); } });
}
async function restart() {
  if (exiting || restarting) return;
  restarting = true;
  try {
    if (desktop?.exitCode === null) await new Promise(resolve => { desktop.once('exit', resolve); desktop.kill('SIGTERM'); });
    runXtask(['sidecars', 'dev'], { env });
    launch();
  } catch (error) { console.error(error); } finally { restarting = false; }
}
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (!exiting && Date.now() < deadline) {
    try { if ((await fetch(env.TREEFOLD_UI_URL, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Vite did not become ready');
  console.log(`[treefold dev] UI: ${env.TREEFOLD_UI_URL}`);
  launch();
  if (!args.includes('--no-watch')) {
    watcher = watch(root, { recursive: true }, (_event, file) => {
      if (file && /^(backend\/(src\/|migrations\/|Cargo\.toml|Cargo\.lock|build\.rs)|electron\/)/.test(file)) {
        clearTimeout(restartTimer); restartTimer = setTimeout(restart, 350);
      }
    });
  }
} catch (error) { console.error(error); process.exitCode = 1; stop(); }

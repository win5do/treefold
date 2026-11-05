import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function startRenderer(apiUrl: string) {
  const child = fork(fileURLToPath(new URL('./renderer-process.ts', import.meta.url)), [], {
    execArgv: [],
    env: { ...process.env, TREEFOLD_FIXTURE_API_URL: apiUrl },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  async function close() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send('close', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    timer.unref();
    try { await exited; } finally { clearTimeout(timer); }
  }
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => onError(new Error('UI renderer startup timed out')), 30_000);
      const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onExit = () => onError(new Error('UI renderer exited before listening'));
      const onMessage = (message: unknown) => {
        if (!message || typeof message !== 'object') return;
        if ('error' in message) { onError(new Error(String(message.error))); return; }
        if ('port' in message && typeof message.port === 'number') { cleanup(); resolve(message.port); }
      };
      child.on('message', onMessage); child.once('error', onError); child.once('exit', onExit);
    });
    return { baseUrl: `http://127.0.0.1:${port}`, close };
  } catch (error) { await close(); throw error; }
}

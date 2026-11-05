import { createServer } from 'vite';
import path from 'node:path';

// Each fixture owns its compiler process. Vite's cache-busted config modules
// retain plugin/compiler graphs after server.close() in a long-lived worker.
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  // Also bound cleanup after an aborted Playwright worker loses its IPC pipe.
  const timer = setTimeout(() => process.exit(1), 5_000);
  timer.unref();
  try { await server?.close(); }
  finally {
    clearTimeout(timer);
    if (process.connected) process.disconnect();
    process.exit(process.exitCode ?? 0);
  }
}
process.once('disconnect', () => { void close(); });
process.on('message', message => { if (message === 'close') void close(); });
try {
  server = await createServer({
    configFile: path.resolve('vite.config.ts'),
    root: path.resolve('src/renderer'),
    logLevel: 'error',
    define: { 'import.meta.env.VITE_TREEFOLD_API_BASE': JSON.stringify(process.env.TREEFOLD_FIXTURE_API_URL) },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine UI fixture Vite address');
  process.send?.({ port: address.port });
} catch (error) {
  process.send?.({ error: String(error) });
  process.exitCode = 1;
  await close();
}

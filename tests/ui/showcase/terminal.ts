import type { Page } from '@playwright/test';
import { showcaseIds } from './fixture.ts';

// ANSI output travels through the real terminal WebSocket protocol and xterm.
// No live shell, Agent, filesystem, or network service is required.
const devOutput = [
  '\x1b[1;36m❯\x1b[0m npm run dev',
  '',
  '> atlas@1.0.0 dev',
  '> vite --host 127.0.0.1',
  '',
  '  \x1b[1;32mVITE\x1b[0m  ready in \x1b[1m182 ms\x1b[0m',
  '',
  '  \x1b[32m➜\x1b[0m  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m',
  '  \x1b[32m➜\x1b[0m  press \x1b[1mh + enter\x1b[0m to show help',
  '',
  '\x1b[2m09:30:12\x1b[0m \x1b[36m[vite]\x1b[0m page reload src/search.ts',
  '\x1b[2m09:31:04\x1b[0m \x1b[36m[vite]\x1b[0m hmr update /src/SearchPanel.tsx',
  '\x1b[2m09:31:18\x1b[0m \x1b[32m[api] \x1b[0m GET /api/products?q=ceramic       \x1b[32m200\x1b[0m  12 ms',
  '\x1b[2m09:31:24\x1b[0m \x1b[32m[api] \x1b[0m GET /api/products?q=ceramic&page=2 \x1b[32m200\x1b[0m   8 ms',
  '\x1b[2m09:32:05\x1b[0m \x1b[36m[vite]\x1b[0m hmr update /src/SearchFilters.tsx',
  '\x1b[2m09:32:09\x1b[0m \x1b[32m[api] \x1b[0m GET /api/products?category=home   \x1b[32m200\x1b[0m  10 ms',
  '',
].join('\r\n');

export async function installTerminalReplay(page: Page) {
  let delivered = false;
  await page.routeWebSocket(/\/api\/sessions\/[^/]+\/terminal/, socket => {
    socket.send(JSON.stringify({ type: 'output_cursor', sequence: '0' }));
    socket.send(JSON.stringify({ type: 'ownership_state', state: 'controller' }));
    let prepared = false;
    socket.onMessage(value => {
      const message = JSON.parse(value.toString());
      if (message.type !== 'terminal_ready' || prepared) return;
      prepared = true;
      const output = socket.url().includes(showcaseIds.dev) ? devOutput : 'Ready.\r\n';
      const content = Buffer.from(output);
      const frame = Buffer.alloc(8 + content.length);
      frame.writeBigUInt64BE(1n);
      content.copy(frame, 8);
      socket.send(frame);
      if (socket.url().includes(showcaseIds.dev)) delivered = true;
    });
  });
  return { delivered: () => delivered };
}

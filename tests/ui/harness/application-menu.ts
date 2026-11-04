import { ipcMain } from 'electron';

export type ApplicationMenuCalls = { updates: number; quit: number };
export function installApplicationMenuFixture() {
  const calls: ApplicationMenuCalls = { updates: 0, quit: 0 };
  ipcMain.handle('treefold:check-for-updates', () => { calls.updates++; return { status: 'up-to-date' }; });
  // Record the request without closing the fixture or affecting other Apps.
  ipcMain.handle('treefold:quit', () => { calls.quit++; });
  (globalThis as typeof globalThis & { applicationMenuCalls: ApplicationMenuCalls }).applicationMenuCalls = calls;
}

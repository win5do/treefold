import { ipcMain } from 'electron';
import type { OpenInApp } from '../../../src/preload/bridge.d.ts';

export type OpenInRequest = { id: string; directory: string };
export function installOpenInFixture() {
  const requests: OpenInRequest[] = [];
  Object.assign(globalThis, { treefoldOpenInRequests: requests });
  ipcMain.handle('treefold:open-in-apps', (): OpenInApp[] => JSON.parse(process.env.TREEFOLD_TEST_OPEN_IN_APPS ?? '[]'));
  ipcMain.handle('treefold:open-in-app', (_event, id: string, directory: string) => {
    requests.push({ id, directory });
    if (process.env.TREEFOLD_TEST_OPEN_IN_ERROR) throw new Error(process.env.TREEFOLD_TEST_OPEN_IN_ERROR);
  });
}

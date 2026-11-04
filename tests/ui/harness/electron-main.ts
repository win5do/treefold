import { installOpenInFixture } from './open-in.ts';
import { installApplicationMenuFixture } from './application-menu.ts';
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { createProjectOpenRequests } from '../../../src/main/open-project.ts';

// Test-only main process: inert fixture API, real production preload and renderer.
const headed = process.env.TREEFOLD_TEST_HEADED === '1';
// Prevent macOS from activating the test App or adding it to the Dock.
if (process.platform === 'darwin' && !headed) app.setActivationPolicy('prohibited');
app.setPath('userData', process.env.TREEFOLD_TEST_HOME!);
app.whenReady().then(() => {
  installOpenInFixture();
  installApplicationMenuFixture();
  ipcMain.handle('treefold:api-url', () => process.env.TREEFOLD_TEST_API_URL!);
  ipcMain.handle('treefold:app-version', () => '0.1.0-alpha.20261003000000');
  ipcMain.handle('treefold:open-directory', () => null);
  ipcMain.handle('treefold:log', () => {});
  const [width, height] = process.env.TREEFOLD_TEST_WINDOW_SIZE!.split(',').map(Number);
  const window = new BrowserWindow({ width, height, useContentSize: true, show: headed,
    // Hidden Linux compositor surfaces can stall animations after screenshots.
    // Offscreen rendering keeps frames advancing without mapping a desktop window.
    // Keep timers active for input and overlays too.
    webPreferences: { offscreen: process.platform === 'linux' && !headed, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const requests = createProjectOpenRequests(request => window.webContents.send('treefold:open-project', request));
  ipcMain.handle('treefold:pending-open-project', () => requests.pending());
  ipcMain.handle('treefold:acknowledge-open-project', (_event, id) => requests.acknowledge(id));
  (globalThis as typeof globalThis & { treefoldOpenProject: (path: string) => void }).treefoldOpenProject = requests.receive;
  if (process.env.TREEFOLD_TEST_OPEN_PROJECT) requests.receive(process.env.TREEFOLD_TEST_OPEN_PROJECT);
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  void window.loadURL('about:blank');
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());

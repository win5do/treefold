import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, OpenProjectRequest, UpdateNotice } from './bridge';
// Register before the renderer loads so menu clicks survive lazy mounting.
let aboutPending = false;
let aboutListener: (() => void) | undefined;
function deliverAbout() {
  if (!aboutPending || !aboutListener) return;
  aboutPending = false;
  aboutListener();
}
ipcRenderer.on('treefold:open-about', () => { aboutPending = true; deliverAbout(); });
let updatePending: UpdateNotice | undefined;
let updateListener: ((notice: UpdateNotice) => void) | undefined;
function deliverUpdate() {
  if (!updatePending || !updateListener) return;
  const notice = updatePending;
  updatePending = undefined;
  updateListener(notice);
}
ipcRenderer.on('treefold:check-for-updates', (_event, notice: UpdateNotice) => {
  updatePending = notice;
  deliverUpdate();
});
const bridge: DesktopBridge = {
  checkForUpdates: () => ipcRenderer.invoke('treefold:check-for-updates'),
  setUpdateMenuLabel: label => ipcRenderer.send('treefold:update-menu-label', label),
  onCheckForUpdates: listener => {
    updateListener = listener;
    deliverUpdate();
    return () => { if (updateListener === listener) updateListener = undefined; };
  },
  onOpenAbout: listener => {
    aboutListener = listener;
    deliverAbout();
    return () => { if (aboutListener === listener) aboutListener = undefined; };
  },
  pendingOpenProject: () => ipcRenderer.invoke('treefold:pending-open-project'),
  acknowledgeOpenProject: id => ipcRenderer.invoke('treefold:acknowledge-open-project', id),
  onOpenProject: listener => {
    const receive = (_event: Electron.IpcRendererEvent, request: OpenProjectRequest) => listener(request);
    ipcRenderer.on('treefold:open-project', receive);
    return () => ipcRenderer.removeListener('treefold:open-project', receive);
  },

  listOpenInApps: () => ipcRenderer.invoke('treefold:open-in-apps'),
  openInApp: (id, directory) => ipcRenderer.invoke('treefold:open-in-app', id, directory),
  apiUrl: () => ipcRenderer.invoke('treefold:api-url'),
  appVersion: () => ipcRenderer.invoke('treefold:app-version'),
  openDirectory: options => ipcRenderer.invoke('treefold:open-directory', { title: options?.title }),
  log: (level, message) => ipcRenderer.invoke('treefold:log', level, message),
};
contextBridge.exposeInMainWorld('treefoldDesktop', bridge);

import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, OpenProjectRequest } from './bridge';
const bridge: DesktopBridge = {
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

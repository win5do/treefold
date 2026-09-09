import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/lib/desktop';
const bridge: DesktopBridge = {

  apiUrl: () => ipcRenderer.invoke('treefold:api-url'),
  openDirectory: options => ipcRenderer.invoke('treefold:open-directory', { title: options?.title }),
  log: (level, message) => ipcRenderer.invoke('treefold:log', level, message),
};
contextBridge.exposeInMainWorld('treefoldDesktop', bridge);

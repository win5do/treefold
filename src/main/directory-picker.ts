import { dialog, type BrowserWindow } from 'electron';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DirectoryOptions } from '../preload/bridge';

/** Native picker history is application UI state, scoped to this Treefold home. */
export function createDirectoryPicker(userData: string, userHome: string, onError: (message: string) => void) {
  const stateFile = path.join(userData, 'directory-picker.json');
  let lastDirectory: string | undefined;
  async function defaultDirectory() {
    if (lastDirectory === undefined) {
      try {
        const saved: unknown = JSON.parse(await readFile(stateFile, 'utf8'));
        lastDirectory = saved && typeof saved === 'object' && 'lastDirectory' in saved && typeof saved.lastDirectory === 'string'
          ? saved.lastDirectory : '';
      } catch { lastDirectory = ''; }
    }
    if (path.isAbsolute(lastDirectory) && await stat(lastDirectory).then(value => value.isDirectory(), () => false)) return lastDirectory;
    return userHome;
  }
  return async (window: BrowserWindow, options?: DirectoryOptions): Promise<string | null> => {
    const result = await dialog.showOpenDialog(window, {
      title: typeof options?.title === 'string' ? options.title : 'Choose a directory',
      defaultPath: await defaultDirectory(),
      properties: ['openDirectory'],
    });
    const selected = result.canceled ? null : result.filePaths[0] ?? null;
    if (selected) {
      lastDirectory = selected;
      try {
        await writeFile(`${stateFile}.tmp`, JSON.stringify({ lastDirectory }), { mode: 0o600 });
        await rename(`${stateFile}.tmp`, stateFile);
      } catch (error) { onError(`Could not save directory picker history: ${String(error)}`); }
    }
    return selected;
  };
}

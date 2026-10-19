import { app, type BrowserWindow } from 'electron';

export function installWindowCloseBehavior(
  window: BrowserWindow,
  apiUrl: string,
  isQuitting: () => boolean,
  onWarning: (message: string) => void,
) {
  let pending = false;
  window.on('close', event => {
    if (isQuitting()) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void closeWindow().finally(() => { pending = false; });
  });

  async function closeWindow() {
    let quit = false;
    try {
      // Read the backend's effective settings so saved and file edits apply immediately.
      const response = await fetch(`${apiUrl}/api/settings`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const settings = await response.json() as { close_behavior?: unknown };
      quit = settings.close_behavior === 'quit';
    } catch (error) {
      onWarning(`Could not read window close behavior; hiding to tray: ${String(error)}`);
    }
    if (isQuitting() || window.isDestroyed()) return;
    if (quit) app.quit();
    else {
      window.hide();
      app.dock?.hide();
    }
  }
}

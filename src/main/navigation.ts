import type { WebContents } from 'electron';

function documentUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

// URL parsing canonicalizes the trailing slash omitted by electron-vite.
export function installNavigation(contents: WebContents, pageUrl: string, openExternal: (url: string) => Promise<unknown>, onError: (error: unknown) => void) {
  const expected = documentUrl(pageUrl);
  const external = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') void openExternal(url.href).catch(onError);
    } catch (error) { onError(error); }
  };
  contents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => {
    try {
      if (documentUrl(url) === expected) return;
    } catch (error) { onError(error); }
    event.preventDefault();
    external(url);
  });
}

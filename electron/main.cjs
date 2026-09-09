const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync } = require('node:fs');
const { Backend } = require('./backend.cjs');
const { createLog } = require('./log.cjs');

const home = path.resolve(process.env.TREEFOLD_HOME || path.join(app.getPath('home'), '.treefold'));
mkdirSync(path.join(home, 'data', 'electron'), { recursive: true });
app.setPath('userData', path.join(home, 'data', 'electron'));
protocol.registerSchemesAsPrivileged([{ scheme: 'treefold', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const log = createLog(home, { debug: !app.isPackaged });
const root = path.resolve(__dirname, '..');
const devUrl = !app.isPackaged ? process.env.TREEFOLD_UI_URL : undefined;
const pageUrl = devUrl || 'treefold://app/index.html';
let window, tray, backend, apiUrl;
let quitting = false, stopped = false, ready = false;

function showWindow() {
  if (!window || window.isDestroyed()) return;
  app.dock?.show();
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function trusted(event) {
  const url = event.senderFrame?.url;
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !url) {
    throw new Error('Untrusted desktop request');
  }
  const expected = new URL(pageUrl), actual = new URL(url);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host) throw new Error('Untrusted desktop origin');
}
async function external(url) {
  if (['https:', 'http:'].includes(new URL(url).protocol)) await shell.openExternal(url);
}
async function start() {
  const resources = app.isPackaged ? process.resourcesPath : path.join(root, 'backend', 'bundle-staging');
  const bin = app.isPackaged ? path.join(resources, 'bin') : path.join(resources, 'dev-sidecars', 'bin');
  backend = new Backend({
    executable: app.isPackaged ? path.join(bin, 'treefold-backend') : process.env.TREEFOLD_BACKEND_PATH || path.join(root, 'backend/target/debug/treefold-backend'),
    env: { ...process.env, TREEFOLD_HOME: home, TREEFOLD_RESOURCE_DIR: resources, TREEFOLD_BUNDLED_BIN_DIR: bin,
      TREEFOLD_AMUX_SKILL_DIR: app.isPackaged ? path.join(resources, 'agent-integration/skills/amux') : path.join(resources, 'dev-sidecars/skills/amux') },
    log: message => { log('info', message); if (!app.isPackaged) console.error(message); },
    onExit: error => {
      if (!ready || quitting) return;
      log('error', error.message);
      dialog.showErrorBox('Treefold backend stopped', `${error.message}\nReopen Treefold to reconnect. Logs: ${path.join(home, 'logs')}`);
      app.quit();
    },
  });
  apiUrl = await backend.start();
  if (!app.isPackaged) console.info(`[treefold dev] API: ${apiUrl}`);
  const assetRoot = path.join(root, 'dist');
  protocol.handle('treefold', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const file = path.resolve(assetRoot, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(assetRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.handle('treefold:api-url', event => { trusted(event); return apiUrl; });
  ipcMain.handle('treefold:open-directory', async (event, options) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window, { title: typeof options?.title === 'string' ? options.title : 'Choose a directory', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('treefold:log', (event, level, message) => { trusted(event); log(level, message); });
  window = new BrowserWindow({ title: 'Treefold', width: 1440, height: 900, minWidth: 960, minHeight: 640, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (!devUrl) {
    const websocket = apiUrl.replace('http:', 'ws:');
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({
      responseHeaders: { ...details.responseHeaders,
        'Content-Security-Policy': [`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${apiUrl} ${websocket}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'`] },
    }));
  }
  // The renderer needs clipboard writes and loopback access for the Rust API.
  // Its production CSP restricts connections to that exact backend endpoint.
  const permissions = new Set(['clipboard-sanitized-write', 'local-network', 'local-network-access', 'loopback-network']);
  const allowPermission = (contents, permission) => contents === window.webContents && permissions.has(permission);
  window.webContents.session.setPermissionCheckHandler(allowPermission);
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(allowPermission(contents, permission)));
  window.webContents.setWindowOpenHandler(({ url }) => { void external(url).catch(error => log('error', String(error))); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== pageUrl.split('#')[0]) { event.preventDefault(); void external(url).catch(error => log('error', String(error))); } });
  window.webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) Menu.buildFromTemplate([{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]).popup({ window });
  });
  window.webContents.on('render-process-gone', (_event, details) => log('error', `Renderer stopped: ${details.reason}`));
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); app.dock?.hide(); } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Treefold', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ...(process.platform !== 'darwin' ? [{ label: 'File', submenu: [{ role: 'quit' }] }] : []),
  ]));
  const iconPath = app.isPackaged ? path.join(resources, 'icon.png') : path.join(root, 'electron/icons/32x32.png');
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }));
  tray.setToolTip('Treefold');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Treefold', click: showWindow }, { type: 'separator' }, { label: 'Quit Treefold', click: () => app.quit() }]));
  tray.on('double-click', showWindow);
  await window.loadURL(pageUrl);
  ready = true; showWindow();
  log('info', `Treefold ${app.getVersion()} ready; API ${apiUrl}`);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', event => {
    quitting = true;
    if (stopped) return;
    event.preventDefault();
    if (!backend) { stopped = true; app.quit(); return; }
    void backend.stop().finally(() => { stopped = true; app.quit(); });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.quit());
  app.whenReady().then(start).catch(error => {
    log('error', error.stack || String(error));
    dialog.showErrorBox("Treefold couldn't start", `${error.message}\n\nFollow the instructions above, then reopen Treefold.`);
    app.quit();
  });
}

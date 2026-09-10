import { _electron, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type UiElement = Locator;
const sessions = new Map<Page, { app: ElectronApplication; directory: string }>();

export async function createUiSession({ apiUrl, windowSize = '1400,900', sessionName = 'ui' }: { apiUrl: string; windowSize?: string; sessionName?: string }) {
  const directory = await mkdtemp(path.join(tmpdir(), `treefold-${sessionName}-`));
  let app: ElectronApplication | undefined;
  try {
    await build({ configFile: false, logLevel: 'error', build: {
      outDir: directory, emptyOutDir: false, target: 'node24', minify: false,
      lib: { entry: { main: path.resolve('tests/ui/harness/electron-main.ts'), preload: path.resolve('src/preload/index.ts') }, formats: ['cjs'], fileName: (_format, name) => `${name}.cjs` },
      rollupOptions: { external: ['electron', 'node:path'] },
    } });
    const env: NodeJS.ProcessEnv = { ...process.env, TREEFOLD_TEST_HOME: path.join(directory, 'home'), TREEFOLD_TEST_API_URL: apiUrl, TREEFOLD_TEST_WINDOW_SIZE: windowSize };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args: [path.join(directory, 'main.cjs')], env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    sessions.set(page, { app, directory });
    return page;
  } catch (error) {
    try { await app?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    throw error;
  }
}

export async function selectUiOption(_page: Page, element: Locator, value: string) { await element.selectOption(value); }
export async function clickUiElement(page: Page, target: string | Locator) {
  const element = typeof target === 'string' ? page.locator(target) : target;
  // Position the trigger before opening: scrolling an open menu dismisses it.
  if (await element.getAttribute('aria-haspopup') === 'menu') await element.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await element.click();
}
export async function openUiContextMenu(page: Page, target: string | Locator) { await (typeof target === 'string' ? page.locator(target) : target).click({ button: 'right' }); }
export async function moveUiPointerTo(page: Page, target: string | Locator) {
  const element = typeof target === 'string' ? page.locator(target) : target;
  await element.scrollIntoViewIfNeeded();
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error('Pointer target is not visible');
  // Move the real pointer through submenu safe areas before checking its target.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 10 });
  if (await element.getAttribute('aria-haspopup') === 'menu' && await element.getAttribute('aria-expanded') !== 'true') await element.click();
}
export async function pressUiEscape(page: Page) { await page.keyboard.press('Escape'); }
export async function beginUiPointerDrag(page: Page, source: Locator, destination: Locator | { x: number; y: number }) {
  await source.scrollIntoViewIfNeeded();
  const origin = await source.boundingBox();
  if (!origin) throw new Error('Drag source is not visible');
  const start = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 };
  let target;
  if ('boundingBox' in destination) {
    const bounds = await destination.boundingBox();
    if (!bounds) throw new Error('Drag destination is not visible');
    target = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  } else target = { x: start.x + destination.x, y: start.y + destination.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  return () => page.mouse.up();
}

export async function closeUiSession(page: Page | undefined) {
  if (!page) return;
  const session = sessions.get(page);
  if (!session) return;
  sessions.delete(page);
  try { await session.app.close(); } finally { await rm(session.directory, { recursive: true, force: true }); }
}

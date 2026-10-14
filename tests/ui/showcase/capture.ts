import { expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiHarness } from '../ui-harness.ts';
import { closeUiSession, createUiSession } from '../harness/session.ts';
import { configureShowcase, gitStatus, showcaseIds as ids, type Locale } from './fixture.ts';
import { installTerminalReplay } from './terminal.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
process.chdir(root);
const requested = process.argv.slice(2);
const locales: Locale[] = requested.length ? requested.map(value => {
  if (value !== 'en-US' && value !== 'zh-CN') throw new Error(`Unknown locale: ${value}`);
  return value;
}) : ['en-US', 'zh-CN'];
const output = path.join(root, 'docs/images');
await mkdir(output, { recursive: true });

for (const locale of locales) {
  const zh = locale === 'zh-CN';
  const harness = await startUiHarness(fixture => configureShowcase(fixture, locale));
  let page: Page | undefined;
  const errors: string[] = [];
  try {
    // Keep Electron's native viewport and device scale: emulating a viewport
    // after launch can mis-size the terminal's WebGL canvas on Retina displays.
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `showcase-${locale}`, windowSize: '1600,1000' });
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-10-14T09:35:00Z'));
    await page.addInitScript(() => {
      localStorage.setItem('treefold.sidebar.width', '330');
      localStorage.setItem('treefold.git-changes.tree-width', '240');
    });
    await page.route('**/api/*-repositories/*/git-status', route => {
      const url = route.request().url();
      const branch = url.includes(ids.primaryRepository) ? 'main' : url.includes(ids.forkPrimaryLocation) ? 'fork/search-interface' : gitStatus.branch;
      return route.fulfill({ json: { ...gitStatus, branch } });
    });
    const terminal = await installTerminalReplay(page);
    const navigate = async (route: string) => {
      await page!.goto(`${harness.baseUrl}/#/${route}`);
      await expect(page!.getByTestId('workspace-sidebar')).toBeVisible();
      await expect(page!.locator('html')).toHaveClass(/dark/);
    };
    const capture = async (scene: string) => {
      await page!.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await page!.screenshot({ path: path.join(output, `${scene}-${locale}.png`), animations: 'disabled', caret: 'hide' });
      console.log(`Captured ${scene}-${locale}.png`);
    };
    await navigate(`projects/${ids.project}`);
    const repo = page.getByTestId(`project-location-toggle-${ids.primaryRepository}`);
    if (await repo.getAttribute('aria-expanded') === 'false') await repo.click();
    await expect(page.getByTestId('project-worktree-row')).toHaveCount(5);
    await page.getByTestId(`project-repository-directories-${ids.primaryRepository}-toggle`).click();
    await page.getByRole('button', { name: zh ? '展开 Project Atlas' : 'Expand Project Atlas', exact: true }).click();
    await page.mouse.move(800, 40);
    await capture('project');

    await navigate(`workspaces/${ids.workspace}`);
    await expect(page.getByTestId(`fork-list-row-${ids.fork}`)).toBeVisible();
    await expect(page.getByTestId('workspace-sessions-section')).toBeVisible();
    await capture('workspace');

    await page.getByTestId('workspace-sessions-section').getByRole('button', { name: zh ? '新建 Session' : 'New Session', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: zh ? '新建 Session' : 'New Session', exact: true });
    await dialog.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Claude Code', exact: true })).toBeVisible();
    await page.mouse.move(800, 40);
    await capture('agents');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: zh ? '显示右侧边栏' : 'Show right sidebar', exact: true }).click();
    await page.getByRole('tab', { name: zh ? '修改' : 'Changes', exact: true }).click();
    await page.getByRole('button', { name: zh ? '查看修改' : 'Review Changes', exact: true }).click();
    await expect(page.locator('[data-git-changes-view]')).toBeVisible();
    await expect(page.getByTestId('git-diff-content')).toBeVisible();
    await page.getByRole('tab', { name: zh ? 'Git 历史' : 'Git History', exact: true }).click();
    const rows = page.getByTestId('git-history-commit');
    await expect(rows).toHaveCount(6);
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await rows.nth(1).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Squash Commits…', exact: true })).toBeEnabled();
    await capture('git');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: zh ? '隐藏右侧边栏' : 'Hide right sidebar', exact: true }).click();
    await navigate(`workspaces/${ids.fork}/sessions/${ids.dev}`);
    for (const id of ['019a00e712347abcd123456789abc0003', '019a00e712347abcd123456789abc0004', '019a00e712347abcd123456789abc0005', ids.dev, ids.checks]) {
      await expect(page.getByTestId(`sidebar-session-${id}`)).toBeVisible();
    }
    await expect(page.locator('.xterm-helper-textarea')).toBeAttached();
    await expect.poll(terminal.delivered).toBeTruthy();
    // Wait for xterm's asynchronous write and canvas rendering, without altering
    // the application DOM or replacing its terminal with a screenshot mockup.
    await expect(page.locator('.xterm-screen')).toBeVisible();
    await page.waitForTimeout(300);
    await capture('terminal');
    harness.assertNoUnexpectedRequests();
    expect(errors, 'Renderer errors during showcase capture').toEqual([]);
  } catch (error) {
    await page?.screenshot({ path: `/tmp/treefold-showcase-${locale}-failure.png` }).catch(() => {});
    if (page) console.error((await page.locator('body').innerText()).slice(0, 12000));
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
}

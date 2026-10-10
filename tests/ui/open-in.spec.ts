import { test, expect, type Page } from '@playwright/test';
import { startUiHarness } from './ui-harness.ts';
import { createUiSession, closeUiSession, openInRequests, moveUiPointerTo } from './harness/session.ts';
import { FIXTURE_IDS } from './fixtures/sidebar-core.ts';
import { expectAnchoredOverlay } from './overlay-assertions.ts';

const apps = [
  { id: 'finder', label: 'Finder', group: 'fileManager' as const },
  { id: 'vscode', label: 'VS Code', group: 'editor' as const },
  { id: 'goland', label: 'GoLand', group: 'editor' as const },
  { id: 'ghostty', label: 'Ghostty', group: 'terminal' as const },
];
async function openMenu(page: Page, owner: string, directoryId: string = FIXTURE_IDS.primaryDirectory) {
  await page.getByTestId(owner).first().click({ button: 'right' });
  await moveUiPointerTo(page, page.getByTestId('open-in-menu').filter({ visible: true }));
  await moveUiPointerTo(page, page.getByTestId(`open-in-directory-${directoryId}`));
  await expect(page.getByRole('menuitem', { name: 'Finder', exact: true })).toBeVisible();
}

test('Open With sends the selected app and the Project, Workspace or Fork directory through preload', async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, openInApps: apps });
    await page.goto(harness.baseUrl);
    await expect(page.getByTestId('open-settings')).toHaveAccessibleName('Settings', { timeout: 15_000 });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (path: string) => { window.__treefoldCopiedPath = path; } },
      });
    });
    const scenarios = [
      ['sidebar-project-node', 'VS Code', 'vscode', '/tmp/treefold-ui-fixture/repository-with-a-long-readable-path/apps/web', FIXTURE_IDS.monorepoDirectory],
      ['sidebar-workspace-node', 'GoLand', 'goland', '/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture/apps/web', FIXTURE_IDS.monorepoDirectory],
      ['sidebar-fork-node', 'Ghostty', 'ghostty', '/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture/apps/web', FIXTURE_IDS.monorepoDirectory],
      ['sidebar-fork-node', 'Finder', 'finder', '/tmp/treefold-ui-fixture/attached-documentation', FIXTURE_IDS.attachedDirectory],
    ];
    const expected = [];
    for (const [owner, label, id, directory, directoryId] of scenarios) {
      // Sidebar expansion is persistent UI state, so expand only when needed.
      for (const parent of ['sidebar-project-node', 'sidebar-workspace-node']) {
        const toggle = page.getByTestId(parent).first().getByTestId('sidebar-tree-toggle').first();
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      }
      await openMenu(page, owner, directoryId);
      const submenu = page.getByTestId('open-in-submenu').filter({ visible: true });
      const labels = ['Copy Absolute Path', ...apps.map(app => app.label)];
      await expect(submenu.getByRole('menuitem')).toHaveCount(labels.length);
      for (const name of labels) {
        await expect(submenu.getByRole('menuitem', { name, exact: true })).toBeVisible();
      }
      if (expected.length === 0) {
        await page.screenshot({ path: '/tmp/treefold-open-in-directory-selection.png' });
      }
      await submenu.getByRole('menuitem', { name: 'Copy Absolute Path', exact: true }).click();
      await expect.poll(() => page!.evaluate(() => window.__treefoldCopiedPath)).toBe(directory);
      await openMenu(page, owner, directoryId);
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.getByTestId('open-in-submenu').waitFor({ state: 'hidden' });
      await page.getByTestId('directory-session-context-menu').waitFor({ state: 'hidden' });
      expected.push({ id, directory });
      await expect.poll(() => openInRequests(page!)).toEqual(expected);
    }
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: '/tmp/treefold-open-in-failure.png' }).catch(() => {});
    throw error;
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test('Open With keeps directory selection for a single directory and reports a launch error', async () => {
  const harness = await startUiHarness(fixture => {
    fixture.projectDetails[FIXTURE_IDS.project].directories = fixture.projectDetails[FIXTURE_IDS.project].directories.filter(directory => directory.id === FIXTURE_IDS.primaryDirectory);
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, openInApps: apps, openInError: 'Application was removed' });
    await page.goto(harness.baseUrl);
    await expect(page.getByTestId('open-settings')).toHaveAccessibleName('Settings', { timeout: 15_000 });
    await openMenu(page, 'sidebar-project-node');
    await page.getByRole('menuitem', { name: 'Finder', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Application was removed');
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test('Directory menus stay at the clicked row and copy or open that row in Project, Workspace and Fork', async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, openInApps: apps, windowSize: '1100,720' });
    await page.goto(harness.baseUrl);
    await expect(page.getByTestId('open-settings')).toHaveAccessibleName('Settings');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (path: string) => { window.__treefoldCopiedPath = path; } },
      });
    });
    const scenarios = [
      [`/projects/${FIXTURE_IDS.project}`, `project-directory-actions-${FIXTURE_IDS.monorepoDirectory}`, '/tmp/treefold-ui-fixture/repository-with-a-long-readable-path/apps/web'],
      [`/workspaces/${FIXTURE_IDS.workspace}`, `workspace-directory-actions-${FIXTURE_IDS.monorepoDirectory}`, '/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture/apps/web'],
      [`/workspaces/${FIXTURE_IDS.fork}`, `workspace-directory-actions-${FIXTURE_IDS.monorepoDirectory}`, '/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture/apps/web'],
      [`/workspaces/${FIXTURE_IDS.fork}`, `workspace-directory-actions-${FIXTURE_IDS.attachedDirectory}`, '/tmp/treefold-ui-fixture/attached-documentation'],
    ];
    const expected: { id: string; directory: string }[] = [];
    for (const [index, [route, menuId, directory]] of scenarios.entries()) {
      await page.evaluate(route => { window.location.hash = route; }, route);
      const trigger = page.getByTestId(`${menuId}-trigger`);
      // Stress the lower edge without scrolling an already-open menu.
      await trigger.waitFor({ state: 'visible' });
      await trigger.evaluate(node => node.scrollIntoView({ block: 'end' }));
      await trigger.click();
      const menu = page.getByTestId(menuId);
      const openWith = menu.getByRole('menuitem', { name: 'Open With', exact: true });
      if (index === 0) await expectAnchoredOverlay(menu, trigger);
      await openWith.hover();
      const submenu = page.getByTestId('open-in-submenu').filter({ visible: true });
      const finder = submenu.getByRole('menuitem', { name: 'Finder', exact: true });
      await expect(finder).toBeVisible();
      if (index === 0) {
        await expectAnchoredOverlay(submenu, openWith);
        await page.screenshot({ path: '/tmp/treefold-directory-menu-anchored.png' });
      }
      await finder.hover();
      await submenu.getByRole('menuitem', { name: 'Copy Absolute Path', exact: true }).click();
      await expect.poll(() => page!.evaluate(() => window.__treefoldCopiedPath)).toBe(directory);
      await expect(menu).toBeHidden();
      await trigger.click();
      await openWith.hover();
      await finder.click();
      expected.push({ id: 'finder', directory });
      await expect.poll(() => openInRequests(page!)).toEqual(expected);
      await expect(menu).toBeHidden();
      if (index === 0) {
        // The same menu must work from the keyboard and restore trigger focus.
        await trigger.focus();
        await trigger.press('ArrowDown');
        await expect(openWith).toBeFocused();
        await openWith.press('ArrowRight');
        await expect(submenu.getByRole('menuitem', { name: 'Copy Absolute Path', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(submenu).toBeHidden();
        await expect(openWith).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.click();
        await expect(menu).toBeVisible();
        await page.getByRole('heading', { name: 'Repositories', exact: true }).click();
        await expect(menu).toBeHidden();
      }
    }
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: '/tmp/treefold-directory-menu-failure.png' }).catch(() => {});
    throw error;
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

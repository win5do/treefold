import { test, expect, type Page } from '@playwright/test';
import { startUiHarness } from './ui-harness.ts';
import { createUiSession, closeUiSession, openInRequests, moveUiPointerTo } from './harness/session.ts';

const apps = [
  { id: 'finder', label: 'Finder', group: 'fileManager' as const },
  { id: 'vscode', label: 'VS Code', group: 'editor' as const },
  { id: 'goland', label: 'GoLand', group: 'editor' as const },
  { id: 'ghostty', label: 'Ghostty', group: 'terminal' as const },
];
async function openMenu(page: Page, owner: string) {
  await page.getByTestId(owner).first().click({ button: 'right' });
  await moveUiPointerTo(page, page.getByTestId('open-in-menu').filter({ visible: true }));
  await expect(page.getByRole('menuitem', { name: 'Finder', exact: true })).toBeVisible();
}

test('Open With sends the selected app and the Project, Workspace or Fork directory through preload', async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, openInApps: apps });
    await page.goto(harness.baseUrl);
    await expect(page.getByTestId('open-settings')).toHaveAccessibleName('Settings', { timeout: 15_000 });
    const scenarios = [
      ['sidebar-project-node', 'VS Code', 'vscode', '/tmp/treefold-ui-fixture/repository-with-a-long-readable-path'],
      ['sidebar-workspace-node', 'GoLand', 'goland', '/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture'],
      ['sidebar-fork-node', 'Ghostty', 'ghostty', '/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture'],
    ];
    const expected = [];
    for (const [owner, label, id, directory] of scenarios) {
      // Sidebar expansion is persistent UI state, so expand only when needed.
      for (const parent of ['sidebar-project-node', 'sidebar-workspace-node']) {
        const toggle = page.getByTestId(parent).first().getByTestId('sidebar-tree-toggle').first();
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      }
      await openMenu(page, owner);
      await expect(page.getByTestId('open-in-submenu').filter({ visible: true }).getByRole('menuitem')).toHaveText(apps.map(app => app.label));
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

test('Open With reports a desktop launch error', async () => {
  const harness = await startUiHarness();
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

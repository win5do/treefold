import { test, expect, type Page } from '@playwright/test';
import { startUiHarness } from './ui-harness.ts';
import { createUiSession, closeUiSession, openProjectPath } from './harness/session.ts';
import { FIXTURE_IDS } from './fixtures/sidebar-core.ts';

test('opening an unknown directory before renderer startup enters local import and creates only after confirmation', async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const directory = '/tmp/treefold-ui-fixture/new-local';
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, openProjectPath: directory });
    await page.goto(harness.baseUrl);
    const dialog = page.getByRole('dialog', { name: /^New Project/ });
    await expect(dialog.getByRole('textbox', { name: 'Project directory', exact: true })).toHaveValue(directory);
    await expect(dialog.getByRole('textbox', { name: 'Project directory', exact: true })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('new-local');
    expect(harness.projectCreation.createRequests).toEqual([]);
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
    await expect(page).toHaveURL(/#\/projects\/project-created-primary-requirement$/);
    expect(harness.projectCreation.createRequests).toEqual([{ name: 'new-local', locations: [directory], open_path: directory }]);
    await page.reload();
    await expect(page.getByTestId('open-settings')).toBeVisible();
    // A handled request must not replay over the current route on reload.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test('opening an existing directory navigates to its Project and later requests reset the local draft', async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl });
    await page.goto(harness.baseUrl);
    await expect(page.getByTestId('open-settings')).toBeVisible();
    await openProjectPath(page, '/tmp/treefold-ui-fixture/first-new');
    const dialog = page.getByRole('dialog', { name: /^New Project/ });
    await expect(dialog.getByRole('textbox', { name: 'Project directory', exact: true })).toHaveValue('/tmp/treefold-ui-fixture/first-new');
    await openProjectPath(page, '/tmp/treefold-ui-fixture/second-new');
    await expect(dialog.getByRole('textbox', { name: 'Project directory', exact: true })).toHaveValue('/tmp/treefold-ui-fixture/second-new');
    await openProjectPath(page, '/tmp/treefold-ui-fixture/repository-with-a-long-readable-path/src');
    await expect(page).toHaveURL(new RegExp(`#/projects/${FIXTURE_IDS.project}$`));
    await expect(dialog).toHaveCount(0);
    expect(harness.projectCreation.createRequests).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

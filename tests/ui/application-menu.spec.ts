import { test, expect, type Page } from '@playwright/test';
import { startUiHarness } from './ui-harness.ts';
import { createUiSession, closeUiSession, applicationMenuCalls } from './harness/session.ts';
import { expectAnchoredOverlay } from './overlay-assertions.ts';

test('application menu remains reachable, exposes status and opens global actions', async () => {
  const harness = await startUiHarness();
  harness.setAgentIntegrationState('not_installed');
  harness.amuxRecovery.setStatus({ state: 'unresponsive', running: false, recovery_available: true });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, windowSize: '1100,640', sessionName: 'application-menu' });
    await page.goto(harness.baseUrl);
    const trigger = page.getByTestId('application-menu-trigger');
    await expect(trigger).toHaveAccessibleName('Application menu');
    await expect(trigger).toHaveAccessibleDescription('Some application services need attention');
    await expect(page.getByTestId('application-menu-indicator')).toBeVisible();
    await trigger.click();
    const menu = page.getByTestId('application-menu');
    await expectAnchoredOverlay(menu, trigger);
    await expect(menu.getByTestId('open-agent-integration')).toContainText('Not installed');
    await expect(menu.getByTestId('open-resources')).toContainText('Unavailable');
    await page.screenshot({ path: '/tmp/treefold-application-menu.png', animations: 'disabled' });

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    // Opening/closing the menu must not acknowledge unresolved service states.
    await expect(page.getByTestId('application-menu-indicator')).toBeVisible();
    await trigger.press('ArrowDown');
    await expect(menu.getByTestId('open-settings')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await menu.getByRole('menuitem', { name: 'About Treefold', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'About Treefold', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await menu.getByRole('menuitem', { name: 'Check for Updates', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('You’re up to date.');
    expect((await applicationMenuCalls(page)).updates).toBe(1);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Hide left sidebar', exact: true }).click();
    await trigger.click();
    await expectAnchoredOverlay(menu, trigger);

    await page.screenshot({ path: '/tmp/treefold-application-menu-collapsed.png', animations: 'disabled' });
    // Click through the menu's dismiss layer at an underlying content target.
    await page.getByTestId('page-content').click({ force: true });
    await expect(menu).toBeHidden();
    await trigger.click();
    await menu.getByRole('menuitem', { name: 'Quit Treefold', exact: true }).click();
    await expect.poll(async () => (await applicationMenuCalls(page!)).quit).toBe(1);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: '/tmp/treefold-application-menu-failure.png' }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

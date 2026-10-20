import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.ts";
import {
  closeUiSession,
  createUiSession,
  pressUiEscape,
} from "./harness/session.ts";

test("resources", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl,
      windowSize: "1200,800",
      sessionName: "resources",
    });

    await page.goto(harness.baseUrl);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });

    const settingsButton = page.locator('[data-testid="open-settings"]');
    const resourcesButton = page.locator('[data-testid="open-resources"]');
    // Settings (including the fixture language) load asynchronously.
    await expect(settingsButton).toHaveAccessibleName("Settings");
    await expect(resourcesButton).toHaveAccessibleName("Resources");

    await settingsButton.click();
    let dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    const keepAmux = dialog.locator('[data-testid="settings-keep-amux"]');
    assert.equal(await keepAmux.getAttribute("aria-checked"), "false", "Daemon retention must default to off");
    await keepAmux.click();
    await (dialog.locator('[data-testid="settings-save"]')).click();
    const settingsSaveToast = page.locator('[data-slot="toast"][role="status"]');
    await settingsSaveToast.waitFor({ timeout: 3_000, state: 'visible' });
    await pressUiEscape(page);
    await dialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await settingsButton.click();
    dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(await (dialog.locator('[data-testid="settings-keep-amux"]')).getAttribute("aria-checked"), "true", "Daemon retention must persist through Settings PATCH");
    await pressUiEscape(page);
    await dialog.waitFor({ timeout: 3_000, state: 'hidden' });

    await resourcesButton.click();
    const resourcePopover = page.locator('[data-testid="amux-resources-popover"]');
    await resourcePopover.waitFor({ timeout: 3_000, state: 'visible' });
    const resourceTable = resourcePopover.locator('[data-testid="amux-resource-table"]');
    assert.match(await resourceTable.innerText(), /treefold-a8c7fixture/);
    assert.match(await resourceTable.innerText(), /Groups\s*3/);
    assert.match(await resourceTable.innerText(), /Processes\s*8/);

    await (resourcePopover.locator('[data-testid="amux-running-status"]')).click();
    const confirmation = page.locator('[data-testid="stop-amux-dialog"]');
    await confirmation.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await confirmation.innerText(), /3 Groups and 8 child processes/);
    await (confirmation.locator("button:text-is(\"Stop Daemon\")")).click();
    await confirmation.waitFor({ timeout: 3_000, state: 'hidden' });
    await resourcePopover.waitFor({ timeout: 3_000, state: 'visible' });
    await expect.poll(async () => await (resourcePopover.locator('[data-testid="amux-stopped-status"]')).count().then(count => count > 0), {
      timeout: 3_000,
      message: "amux status did not change to Not started after stopping",
    }).toBeTruthy();
    assert.equal(harness.amuxStopRequests.length, 1, "stopping must call the daemon stop endpoint exactly once");

    harness.assertNoUnexpectedRequests();
    console.log("✓ amux resource status, destructive stop confirmation, and exit preference passed");
  } catch (error) {
    await page.screenshot({ path: "/tmp/treefold-resources-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});

test("unavailable runtime requires confirmed recovery and keeps failures actionable", async () => {
  const harness = await startUiHarness();
  let page!: Page;
  try {
    harness.amuxRecovery.setStatus({ state: "unresponsive", running: false, recovery_available: true });
    page = await createUiSession({ apiUrl: harness.apiUrl, windowSize: "1200,800", sessionName: "runtime-recovery" });
    await page.goto(harness.baseUrl);
    const resources = page.getByTestId("open-resources");
    await expect(resources).toHaveAccessibleName("Resources");
    await resources.click();
    const popover = page.getByTestId("amux-resources-popover");
    await expect(popover.getByText("Unavailable", { exact: true })).toBeVisible();
    await popover.getByRole("button", { name: "Retry connection" }).click();
    expect(harness.amuxRecovery.recoverRequests).toHaveLength(0);
    await popover.getByRole("button", { name: "Recover runtime", exact: true }).click();
    const dialog = page.getByTestId("recover-amux-dialog");
    await expect(dialog).toContainText("forcefully terminated");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(harness.amuxRecovery.recoverRequests).toHaveLength(0);
    await expect(dialog).toBeHidden();
    await expect(popover).toBeHidden();
    await resources.click();
    await popover.getByRole("button", { name: "Recover runtime", exact: true }).click();
    harness.amuxRecovery.failNextRecovery("Process identity changed; retry inspection");
    await dialog.getByRole("button", { name: "Recover runtime", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Process identity changed");
    await expect(dialog.getByRole("button", { name: "Recover runtime", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Recover runtime", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(popover.getByTestId("amux-running-status")).toBeVisible();
    expect(harness.amuxRecovery.recoverRequests).toHaveLength(2);
    harness.amuxRecovery.setStatus({ state: "unresponsive", running: false, recovery_available: false });
    await expect(popover.getByRole("button", { name: "Recover runtime", exact: true })).toBeDisabled();
    await expect(popover).toContainText("identity cannot be verified");
    harness.amuxRecovery.setStatus({ state: "legacy", running: false, recovery_available: true });
    await expect(popover).toContainText("previous amux instance is still running");
    await expect(popover.getByRole("button", { name: "Recover runtime", exact: true })).toBeEnabled();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

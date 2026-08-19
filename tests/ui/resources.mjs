import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.mjs";
import {
  closeUiSession,
  createUiSession,
  pressUiEscape,
} from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await createUiSession({
    windowSize: "1200,800",
    sessionName: "resources",
  });

  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });

  const settingsButton = await browser.$('[data-testid="open-settings"]');
  const resourcesButton = await browser.$('[data-testid="open-resources"]');
  assert.equal(await settingsButton.getAttribute("aria-label"), "Settings");
  assert.equal(await resourcesButton.getAttribute("aria-label"), "Resources");

  await settingsButton.click();
  let dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  const keepAmux = await dialog.$('[data-testid="settings-keep-amux"]');
  assert.equal(await keepAmux.getAttribute("aria-checked"), "false", "Daemon retention must default to off");
  await keepAmux.click();
  await (await dialog.$('[data-testid="settings-save"]')).click();
  const settingsSaveToast = await browser.$(
    '[data-slot="toast"][role="status"]',
  );
  await settingsSaveToast.waitForDisplayed({ timeout: 3_000 });
  await pressUiEscape(browser);
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await settingsButton.click();
  dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await dialog.$('[data-testid="settings-keep-amux"]')).getAttribute("aria-checked"), "true", "Daemon retention must persist through Settings PATCH");
  await pressUiEscape(browser);
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await resourcesButton.click();
  const resourcePopover = await browser.$('[data-testid="amux-resources-popover"]');
  await resourcePopover.waitForDisplayed({ timeout: 3_000 });
  const resourceTable = await resourcePopover.$('[data-testid="amux-resource-table"]');
  assert.match(await resourceTable.getText(), /treefold-a8c7fixture/);
  assert.match(await resourceTable.getText(), /Groups\s*3/);
  assert.match(await resourceTable.getText(), /Processes\s*8/);

  await (await resourcePopover.$('[data-testid="amux-running-status"]')).click();
  const confirmation = await browser.$('[data-testid="stop-amux-dialog"]');
  await confirmation.waitForDisplayed({ timeout: 3_000 });
  assert.match(await confirmation.getText(), /3 Groups and 8 child processes/);
  await (await confirmation.$("button=Stop Daemon")).click();
  await confirmation.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await resourcePopover.waitForDisplayed({ timeout: 3_000 });
  await browser.waitUntil(async () => await (await resourcePopover.$('[data-testid="amux-stopped-status"]')).isExisting(), {
    timeout: 3_000,
    timeoutMsg: "amux status did not change to Not started after stopping",
  });
  assert.equal(harness.amuxStopRequests.length, 1, "stopping must call the daemon stop endpoint exactly once");

  harness.assertNoUnexpectedRequests();
  console.log("✓ amux resource status, destructive stop confirmation, and exit preference passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-resources-failure.png").catch(() => {});
  throw error;
} finally {
  await closeUiSession(browser);
  await harness.close();
}

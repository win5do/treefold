import assert from "node:assert/strict";
import { Key, remote } from "webdriverio";
import { startUiHarness } from "./ui-harness.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--window-size=1200,800", "--disable-gpu"],
      },
    },
  });

  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });

  const settingsButton = await browser.$('[data-testid="open-settings"]');
  const resourcesButton = await browser.$('[data-testid="open-resources"]');
  assert.equal(await settingsButton.getAttribute("aria-label"), "Settings");
  assert.equal(await resourcesButton.getAttribute("aria-label"), "Resources");
  assert.match(await (await resourcesButton.$("svg")).getAttribute("class"), /lucide-network/, "Resources must use the Network icon");

  await settingsButton.click();
  let dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  const keepAmux = await dialog.$('[data-testid="settings-keep-amux"]');
  assert.equal(await keepAmux.getAttribute("aria-checked"), "false", "Daemon retention must default to off");
  await keepAmux.click();
  await (await dialog.$('[data-testid="settings-save"]')).click();
  await (await dialog.$('[data-testid="settings-save-status"]')).waitForDisplayed({ timeout: 3_000 });
  await browser.keys(Key.Escape);
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await settingsButton.click();
  dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await dialog.$('[data-testid="settings-keep-amux"]')).getAttribute("aria-checked"), "true", "Daemon retention must persist through Settings PATCH");
  await browser.keys(Key.Escape);
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await resourcesButton.click();
  const resourcePopover = await browser.$('[data-testid="amux-resources-popover"]');
  await resourcePopover.waitForDisplayed({ timeout: 3_000 });
  const triggerLocation = await resourcesButton.getLocation();
  const popoverLocation = await resourcePopover.getLocation();
  const popoverSize = await resourcePopover.getSize();
  assert.ok(popoverLocation.y + popoverSize.height <= triggerLocation.y, "Resources popover must open above its icon");
  assert.ok(popoverLocation.x >= triggerLocation.x - 4, "Resources popover must extend right from its icon");
  assert.ok(popoverSize.width <= 360, "Resources popover must remain compact");
  const card = await resourcePopover.$('[data-testid="amux-resource-card"]');
  assert.match(await card.getText(), /treefold-a8c7fixture/);
  assert.match(await card.getText(), /Groups\s*3/);
  assert.match(await card.getText(), /Processes\s*8/);

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
  const stoppedStatus = await resourcePopover.$('[data-testid="amux-stopped-status"]');
  assert.equal(await stoppedStatus.getTagName(), "span", "Not started status must not be clickable");
  await stoppedStatus.click();
  const lazyStartTooltip = await browser.$('[data-slot="tooltip-content"]');
  await lazyStartTooltip.waitForDisplayed({ timeout: 3_000 });
  assert.match(await lazyStartTooltip.getText(), /starts automatically when a Session needs it/);

  harness.assertNoUnexpectedRequests();
  console.log("✓ amux resource status, destructive stop confirmation, and exit preference passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-resources-failure.png").catch(() => {});
  throw error;
} finally {
  await browser?.deleteSession();
  await harness.close();
}

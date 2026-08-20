import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";

const harness = await startUiHarness();
harness.setAgentIntegrationState("not_installed");
let browser;

try {
  browser = await createUiSession({ windowSize: "1200,800", sessionName: "agent-integration" });
  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });

  const trigger = await browser.$('[data-testid="open-agent-integration"]');
  assert.equal(await trigger.getAttribute("aria-label"), "Agent Integration");
  await (await browser.$('[data-testid="agent-integration-indicator"]')).waitForExist({ timeout: 3_000 });
  await trigger.click();

  const popover = await browser.$('[data-testid="agent-integration-popover"]');
  await popover.waitForDisplayed({ timeout: 3_000 });
  assert.match(await (await popover.$('[data-testid="agent-integration-table"]')).getText(), /treefold CLI[\s\S]*0\.1\.0/);
  assert.match(await popover.getText(), /Not installed/);

  await (await popover.$('[data-testid="sync-agent-integration"]')).click();
  await browser.waitUntil(async () => !(await (await browser.$('[data-testid="agent-integration-indicator"]')).isExisting()), { timeout: 3_000, timeoutMsg: "integration indicator remained after sync" });
  assert.deepEqual(harness.agentIntegrationRequests, ["sync"]);

  await (await popover.$('[data-testid="uninstall-agent-integration"]')).click();
  const confirmation = await browser.$('[data-testid="uninstall-agent-integration-dialog"]');
  await confirmation.waitForDisplayed({ timeout: 3_000 });
  await (await confirmation.$("button=Uninstall")).click();
  await confirmation.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await (await browser.$('[data-testid="agent-integration-indicator"]')).waitForExist({ timeout: 3_000 });
  assert.deepEqual(harness.agentIntegrationRequests, ["sync", "uninstall"]);

  harness.assertNoUnexpectedRequests();
  console.log("✓ Agent Integration check, sync, status indicator, and owned uninstall passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-agent-integration-failure.png").catch(() => {});
  throw error;
} finally {
  await closeUiSession(browser);
  await harness.close();
}

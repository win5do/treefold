import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("agent-integration", async () => {
  const harness = await startUiHarness();
  harness.setAgentIntegrationState("not_installed");
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, windowSize: "1200,800", sessionName: "agent-integration" });
    await page.goto(harness.baseUrl);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });

    const trigger = page.locator('[data-testid="open-agent-integration"]');
    assert.equal(await trigger.getAttribute("aria-label"), "Agent Integration");
    await (page.locator('[data-testid="agent-integration-indicator"]')).waitFor({ timeout: 3_000, state: 'attached' });
    await trigger.click();

    const popover = page.locator('[data-testid="agent-integration-popover"]');
    await popover.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await (popover.locator('[data-testid="agent-integration-table"]')).innerText(), /treefold CLI[\s\S]*0\.1\.0/);
    assert.match(await popover.innerText(), /Not installed/);

    await (popover.locator('[data-testid="sync-agent-integration"]')).click();
    await expect.poll(async () => !(await (page.locator('[data-testid="agent-integration-indicator"]')).count().then(count => count > 0)), { timeout: 3_000, message: "integration indicator remained after sync" }).toBeTruthy();
    assert.deepEqual(harness.agentIntegrationRequests, ["sync"]);

    await (popover.locator('[data-testid="uninstall-agent-integration"]')).click();
    const confirmation = page.locator('[data-testid="uninstall-agent-integration-dialog"]');
    await confirmation.waitFor({ timeout: 3_000, state: 'visible' });
    await (confirmation.locator("button:text-is(\"Uninstall\")")).click();
    await confirmation.waitFor({ timeout: 3_000, state: 'hidden' });
    await (page.locator('[data-testid="agent-integration-indicator"]')).waitFor({ timeout: 3_000, state: 'attached' });
    assert.deepEqual(harness.agentIntegrationRequests, ["sync", "uninstall"]);

    harness.assertNoUnexpectedRequests();
    console.log("✓ Agent Integration check, sync, status indicator, and owned uninstall passed");
  } catch (error) {
    await page.screenshot({ path: "/tmp/treefold-agent-integration-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


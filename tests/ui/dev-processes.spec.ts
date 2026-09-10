import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("dev-processes", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "dev-processes" });
    await page.goto(harness.baseUrl);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });
    await (page.locator('[data-testid="sidebar-project-node"] [data-testid="sidebar-tree-toggle"]')).click();

    const workspace = page.locator('[data-testid="sidebar-workspace-node"]');
    await workspace.waitFor({ timeout: 3_000, state: 'visible' });
    await (workspace.locator('[data-testid="sidebar-tree-toggle"]')).click();

    const devServer = page.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.sessionDevServer}"]`);
    await devServer.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await devServer.innerText(), /web-dev-server.*running/s, "Discovered Commands must render as worktree-level Sessions with their state");
    assert.equal(await (page.locator('[data-testid="sidebar-session-process-session-root-ui-fixture"]')).count().then(count => count > 0), false, "Treefold's own root process must not be duplicated as a Command Session");

    const fork = page.locator('[data-testid="sidebar-fork-node"]');
    await fork.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(await (page.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.forkBackgroundProcess}"]`)).count().then(count => count > 0), false, "Commands must remain contextual to their collapsed worktree owner");
    await (fork.locator('[data-testid="sidebar-tree-toggle"]')).click();
    const forkProcess = page.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.forkBackgroundProcess}"]`);
    await forkProcess.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await forkProcess.innerText(), /typecheck-watch.*exited/s, "An unassociated process must become a Command Session in its matching worktree");

    harness.setProcessState(FIXTURE_IDS.sessionDevServer, "exited");
    await expect.poll(async () => (await devServer.innerText()).includes("exited"), { timeout: 4_000, message: "Command Session state did not refresh from the backend snapshot" }).toBeTruthy();
    harness.removeProcess(FIXTURE_IDS.sessionDevServer);
    await expect.poll(async () => (await devServer.innerText()).includes("stopped"), { timeout: 4_000, message: "Removed Commands must remain visible as stopped Sessions" }).toBeTruthy();
    harness.restartRuntimeInstance();
    harness.setProcessState(FIXTURE_IDS.sessionDevServer, "running");
    await expect.poll(async () => (await devServer.innerText()).includes("running"), { timeout: 4_000, message: "Session state did not refresh after a backend instance switch and revision reset" }).toBeTruthy();

    harness.assertNoUnexpectedRequests();
    console.log("✓ daemon Commands are first-class worktree Sessions and retain lifecycle state");
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await createUiSession({ sessionName: "dev-processes" });
  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });
  await (await browser.$('[data-testid="sidebar-project-node"] [data-testid="sidebar-tree-toggle"]')).click();

  const workspace = await browser.$('[data-testid="sidebar-workspace-node"]');
  await workspace.waitForDisplayed({ timeout: 3_000 });
  await (await workspace.$('[data-testid="sidebar-tree-toggle"]')).click();

  const devServer = await browser.$(`[data-testid="sidebar-session-${FIXTURE_IDS.sessionDevServer}"]`);
  await devServer.waitForDisplayed({ timeout: 3_000 });
  assert.match(await devServer.getText(), /web-dev-server.*running/s, "Discovered Commands must render as worktree-level Sessions with their state");
  assert.equal(await (await browser.$('[data-testid="sidebar-session-process-session-root-ui-fixture"]')).isExisting(), false, "Treefold's own root process must not be duplicated as a Command Session");

  const fork = await browser.$('[data-testid="sidebar-fork-node"]');
  await fork.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await browser.$(`[data-testid="sidebar-session-${FIXTURE_IDS.forkBackgroundProcess}"]`)).isExisting(), false, "Commands must remain contextual to their collapsed worktree owner");
  await (await fork.$('[data-testid="sidebar-tree-toggle"]')).click();
  const forkProcess = await browser.$(`[data-testid="sidebar-session-${FIXTURE_IDS.forkBackgroundProcess}"]`);
  await forkProcess.waitForDisplayed({ timeout: 3_000 });
  assert.match(await forkProcess.getText(), /typecheck-watch.*exited/s, "An unassociated process must become a Command Session in its matching worktree");

  harness.setProcessState(FIXTURE_IDS.sessionDevServer, "exited");
  await browser.waitUntil(async () => (await devServer.getText()).includes("exited"), { timeout: 4_000, timeoutMsg: "Command Session state did not refresh from the backend snapshot" });
  harness.removeProcess(FIXTURE_IDS.sessionDevServer);
  await browser.waitUntil(async () => (await devServer.getText()).includes("stopped"), { timeout: 4_000, timeoutMsg: "Removed Commands must remain visible as stopped Sessions" });

  harness.assertNoUnexpectedRequests();
  console.log("✓ daemon Commands are first-class worktree Sessions and retain lifecycle state");
} finally {
  await closeUiSession(browser);
  await harness.close();
}

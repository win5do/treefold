import assert from "node:assert/strict";
import { remote } from "webdriverio";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": { args: ["--headless=new", "--window-size=1400,900", "--disable-gpu"] },
    },
  });
  await browser.url(harness.baseUrl);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });
  await (await browser.$('[data-testid="sidebar-project-node"] [data-testid="sidebar-tree-toggle"]')).click();

  const workspace = await browser.$('[data-testid="sidebar-workspace-node"]');
  await workspace.waitForDisplayed({ timeout: 3_000 });
  await (await workspace.$('[data-testid="sidebar-tree-toggle"]')).click();

  const devServer = await browser.$(`[data-testid="sidebar-background-process-${FIXTURE_IDS.sessionDevServer}"]`);
  await devServer.waitForDisplayed({ timeout: 3_000 });
  assert.match(await devServer.getText(), /npm run dev -- --host/, "Session descendants must render under their owning Session with a recognizable command");
  assert.match(await devServer.getAttribute("title"), /running$/, "The process row must expose its current state");
  assert.equal(await (await browser.$('[data-testid="sidebar-background-process-process-session-root-ui-fixture"]')).isExisting(), false, "Treefold's own Session process must not be duplicated as a background child");

  const fork = await browser.$('[data-testid="sidebar-fork-node"]');
  await fork.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await browser.$(`[data-testid="sidebar-background-process-${FIXTURE_IDS.forkBackgroundProcess}"]`)).isExisting(), false, "Worktree processes must remain contextual to their collapsed owner");
  await (await fork.$('[data-testid="sidebar-tree-toggle"]')).click();
  const forkProcess = await browser.$(`[data-testid="sidebar-background-process-${FIXTURE_IDS.forkBackgroundProcess}"]`);
  await forkProcess.waitForDisplayed({ timeout: 3_000 });
  assert.match(await forkProcess.getText(), /cargo watch -x check/, "An unassociated process must fall back to its matching worktree");

  harness.setProcessState(FIXTURE_IDS.sessionDevServer, "exited");
  await browser.waitUntil(async () => (await devServer.getAttribute("title"))?.endsWith("exited"), { timeout: 4_000, timeoutMsg: "Process state did not refresh from the backend snapshot" });
  harness.removeProcess(FIXTURE_IDS.sessionDevServer);
  await devServer.waitForExist({ reverse: true, timeout: 4_000 });

  harness.assertNoUnexpectedRequests();
  console.log("✓ daemon snapshot processes attach to Sessions/worktrees and refresh lifecycle state");
} finally {
  if (browser) await browser.deleteSession();
  await harness.close();
}

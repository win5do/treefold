import assert from "node:assert/strict";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";
import {
  closeUiSession,
  createUiSession,
  openUiContextMenu,
} from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;
try {
  browser = await createUiSession({ sessionName: "git-diff" });
  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });
  await browser.$('button[aria-label="Show right sidebar"]').click();
  await browser.$('button[role="tab"][aria-label="Git History"]').click();
  await browser.waitUntil(async () => (await browser.$$('[data-testid="git-history-commit"]')).length === FIXTURE_COMMITS.length, { timeout: 3_000 });
  const commits = await browser.$$('[data-testid="git-history-commit"]');
  await commits[0].click();
  await browser.execute((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })), commits[2]);
  await openUiContextMenu(browser, commits[1]);
  await (await browser.$('[data-testid="view-git-diff-action"]')).click();
  await (await browser.$('h1=Commit Diff')).waitForDisplayed({ timeout: 5_000 });
  assert.equal((await browser.getWindowHandles()).length, 1, "View Diff must remain in the current window");
  assert.match(await browser.getUrl(), /view=git-changes/, "View Diff must switch the Workspace main view");
  assert.deepEqual(harness.compareRequests.at(-1), {
    repositoryId: FIXTURE_IDS.primaryRepository,
    action: "git-diff",
    scope: "commit",
    start_commit: FIXTURE_COMMITS[2].hash,
    end_commit: FIXTURE_COMMITS[0].hash,
    commit_count: 3,
    path: "src/alpha.ts",
  });
  assert.equal(await browser.$('[data-testid="git-diff-content"]').isDisplayed(), true, "inline diff content must be displayed");
  harness.assertNoUnexpectedRequests();
  console.log("✓ Git History opens commit diff in the Workspace main view");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-git-diff-failure.png").catch(() => {});
  throw error;
} finally {
  await closeUiSession(browser);
  await harness.close();
}

import assert from "node:assert/strict";
import { remote } from "webdriverio";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

const harness = await startUiHarness();
let browser;
try {
  browser = await remote({ logLevel: "error", capabilities: { browserName: "chrome", "goog:chromeOptions": { args: ["--headless=new", "--window-size=1400,900", "--disable-gpu"] } } });
  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });
  await browser.$('button[aria-label="Show right sidebar"]').click();
  await browser.$('button[role="tab"][aria-label="Changes"]').click();
  assert.equal((await browser.$$('h1=Git Changes')).length, 0, "Opening Changes must not open the diff view automatically");
  await (await browser.$('button=Review Changes')).waitForDisplayed({ timeout: 5_000 });
  await browser.$('button=Review Changes').click();
  await (await browser.$('h1=Git Changes')).waitForDisplayed({ timeout: 5_000 });
  assert.equal((await browser.getWindowHandles()).length, 1, "Changes must stay in the current window");
  assert.equal((await browser.$$('button=Open Shell')).length, 0, "Changes must not expose an unrelated shell action");
  assert.equal((await browser.$$('[data-testid^="git-change-checkbox-"]')).length, 2, "Changes tree must expose each changed file");
  const stageAll = await browser.$('[aria-label="Stage all changes"]');
  await stageAll.click();
  await browser.waitUntil(() => harness.compareRequests.some((item) => item.action === "git/stage" && item.paths.includes("src/alpha.ts")), { timeout: 3_000 });
  await (await browser.$('[aria-label="Unstage all changes"]')).waitForDisplayed({ timeout: 3_000 });
  const message = await browser.$('textarea[aria-label="Commit message"]');
  await message.setValue("Commit fixture changes");
  const commit = await browser.$('button*=Commit 2');
  await commit.waitForEnabled({ timeout: 3_000 });
  await commit.click();
  await browser.waitUntil(() => harness.compareRequests.some((item) => item.action === "git/commit"), { timeout: 3_000 });
  await (await browser.$('p=No changes')).waitForDisplayed({ timeout: 3_000 });
  assert.equal((await browser.$$('[data-testid="git-diff-content"]')).length, 0, "A clean repository must not render a diff panel");
  assert.equal((await browser.$$('textarea[aria-label="Commit message"]')).length, 0, "A clean repository must hide commit controls");
  harness.assertNoUnexpectedRequests();
  console.log("✓ Git Changes stage and commit flow passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-git-changes-failure.png").catch(() => {});
  throw error;
} finally {
  await browser?.deleteSession();
  await harness.close();
}

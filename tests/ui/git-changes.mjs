import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;
try {
  browser = await createUiSession({ sessionName: "git-changes" });
  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });
  await browser.$('button[aria-label="Show right sidebar"]').click();
  await browser.$('button[role="tab"][aria-label="Changes"]').click();
  assert.equal((await browser.$$('h1=Git Changes')).length, 0, "Opening Changes must not open the diff view automatically");
  await (await browser.$('button=Review Changes')).waitForDisplayed({ timeout: 5_000 });
  const summary = await browser.$('[data-testid="git-change-summary"]');
  assert.ok((await summary.getText()).includes("2 files"), "Changes sidebar must show the changed file count");
  assert.ok((await summary.getText()).includes("+2"), "Changes sidebar must show additions");
  assert.ok((await summary.getText()).includes("−1"), "Changes sidebar must show deletions");
  await browser.$('button=Review Changes').click();
  await (await browser.$('h1=Git Changes')).waitForDisplayed({ timeout: 5_000 });
  assert.equal((await browser.getWindowHandles()).length, 1, "Changes must stay in the current window");
  await (await browser.$('[data-testid="git-changes-refresh"]')).click();
  assert.equal((await browser.$$('button=Open Shell')).length, 0, "Changes must not expose an unrelated shell action");
  await browser.waitUntil(async () => {
    const labels = await browser.execute(() => {
      const host = document.querySelector("file-tree-container");
      return Array.from(
        host?.shadowRoot?.querySelectorAll('[data-item-checkbox]') ??
          [],
      ).map((element) => element.getAttribute("aria-label"));
    });
    return (
      labels.includes("Stage src/alpha.ts") &&
      labels.includes("Unstage README.md")
    );
  }, {
    timeout: 5_000,
    timeoutMsg: "Git Changes file tree checkboxes should render",
  });

  const treeCheckboxLabels = await browser.execute(() => {
    const host = document.querySelector("file-tree-container");
    return Array.from(
      host?.shadowRoot?.querySelectorAll('[data-item-checkbox]') ?? [],
    ).map((element) => element.getAttribute("aria-label"));
  });
  const fileCheckboxes = treeCheckboxLabels.filter((label) =>
    typeof label === "string" &&
    (label.includes("src/alpha.ts") || label.includes("README.md")),
  );
  assert.equal(fileCheckboxes.length, 2, "Changes tree must expose each changed file checkbox");
  const clicked = await browser.execute(() => {
    const host = document.querySelector("file-tree-container");
    const target =
      host?.shadowRoot?.querySelector('[data-item-checkbox][aria-label="Stage src/alpha.ts"]');
    if (!target) return false;
    target.click();
    return true;
  });
  assert.equal(clicked, true, "The first unstaged file checkbox should be clickable");
  await browser.waitUntil(() => harness.compareRequests.some((item) => item.action === "git/stage" && item.paths.includes("src/alpha.ts")), { timeout: 3_000 });
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
  await closeUiSession(browser);
  await harness.close();
}

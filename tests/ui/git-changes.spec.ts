import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { clickUiElement, closeUiSession, createUiSession } from "./harness/session.ts";

test("git-changes", async () => {
  const harness = await startUiHarness();
  let page!: Page;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "git-changes" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });
    await page.locator('button[aria-label="Show right sidebar"]').click();
    await page.locator('button[role="tab"][aria-label="Changes"]').click();
    assert.equal((await page.locator("h1:text-is(\"Git Changes\")").all()).length, 0, "Opening Changes must not open the diff view automatically");
    await (page.locator("button:text-is(\"Review Changes\")")).waitFor({ timeout: 5_000, state: 'visible' });
    const summary = page.locator('[data-testid="git-change-summary"]');
    assert.ok((await summary.innerText()).includes("2 files"), "Changes sidebar must show the changed file count");
    assert.ok((await summary.innerText()).includes("+2"), "Changes sidebar must show additions");
    assert.ok((await summary.innerText()).includes("−1"), "Changes sidebar must show deletions");
    await page.locator("button:text-is(\"Review Changes\")").click();
    await (page.locator("h1:text-is(\"Git Changes\")")).waitFor({ timeout: 5_000, state: 'visible' });
    assert.equal((page.context().pages()).length, 1, "Changes must stay in the current window");
    await (page.locator('[data-testid="git-changes-refresh"]')).click();
    assert.equal((await page.locator("button:text-is(\"Open Shell\")").all()).length, 0, "Changes must not expose an unrelated shell action");
    const alphaCheckbox = page.locator('[data-item-checkbox][aria-label="Stage src/alpha.ts"]');
    await alphaCheckbox.waitFor({ timeout: 5_000, state: 'visible' });
    await (page.locator('[data-item-checkbox][aria-label="Unstage README.md"]')).waitFor({ timeout: 5_000, state: 'visible' });
    assert.equal((await page.locator('[data-item-checkbox][data-file-path]').all()).length, 2, "Changes tree must expose each changed file checkbox");
    await clickUiElement(page, 'button[aria-label="Collapse src"]');
    await page.locator('[data-file-path="src/alpha.ts"]').waitFor({ timeout: 3_000, state: 'hidden' });
    await clickUiElement(page, 'button[aria-label="Expand src"]');
    await (page.locator('[data-item-checkbox][aria-label="Stage src/alpha.ts"]')).waitFor({ timeout: 3_000, state: 'visible' });
    await clickUiElement(page, '[data-item-checkbox][aria-label="Stage src/alpha.ts"]');
    await expect.poll(() => harness.compareRequests.some((item) => item.action === "git/stage" && item.paths?.includes("src/alpha.ts")), { timeout: 3_000 }).toBeTruthy();
    const message = page.locator('textarea[aria-label="Commit message"]');
    await message.fill("Commit fixture changes");
    const commit = page.locator("button:has-text(\"Commit 2\")");
    await expect(commit).toBeEnabled({ timeout: 3_000 });
    await commit.click();
    await expect.poll(() => harness.compareRequests.some((item) => item.action === "git/commit"), { timeout: 3_000 }).toBeTruthy();
    await (page.getByTestId("right-sidebar").getByText("No changes", { exact: true })).waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal((await page.locator('[data-testid="git-diff-content"]').all()).length, 0, "A clean repository must not render a diff panel");
    assert.equal((await page.locator('textarea[aria-label="Commit message"]').all()).length, 0, "A clean repository must hide commit controls");
    harness.assertNoUnexpectedRequests();
    console.log("✓ Git Changes stage and commit flow passed");
  } catch (error) {
    await page.screenshot({ path: "/tmp/treefold-git-changes-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


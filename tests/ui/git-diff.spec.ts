import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import {
  closeUiSession,
  createUiSession,
  openUiContextMenu,
} from "./harness/session.ts";

test("git-diff", async () => {
  const harness = await startUiHarness();
  let page!: Page;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "git-diff" });
    await page.route("**/api/project-repositories/*/git-diff", async (route) => {
      const response = await route.fetch();
      const comparison = await response.json();
      comparison.patch += `diff --git a/src/alpha_test.ts b/src/alpha_test.ts
index 1111111..2222222 100644
--- a/src/alpha_test.ts
+++ b/src/alpha_test.ts
@@ -1 +1 @@
-before
+after
`;
      await route.fulfill({ response, json: comparison });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });
    await page.locator('button[aria-label="Show right sidebar"]').click();
    await page.locator('button[role="tab"][aria-label="Git History"]').click();
    await expect.poll(async () => (await (await page.locator('[data-testid="git-history-commit"]').all()).length) === FIXTURE_COMMITS.length, { timeout: 3_000 }).toBeTruthy();
    const commits = await page.locator('[data-testid="git-history-commit"]').all();
    await commits[0].click();
    await commits[2].click({ modifiers: ["Shift"] });
    await openUiContextMenu(page, commits[1]);
    await (page.locator('[data-testid="view-git-diff-action"]')).click();
    await (page.locator("h1:text-is(\"Commit Diff\")")).waitFor({ timeout: 5_000, state: 'visible' });
    assert.equal((page.context().pages()).length, 1, "View Diff must remain in the current window");
    assert.match(page.url(), /view=git-changes/, "View Diff must switch the Workspace main view");
    assert.deepEqual(harness.compareRequests.at(-1), {
      repositoryId: FIXTURE_IDS.primaryRepository,
      action: "git-diff",
      scope: "commit",
      start_commit: FIXTURE_COMMITS[2].hash,
      end_commit: FIXTURE_COMMITS[0].hash,
      commit_count: 3,
    });
    assert.equal(await page.locator('[data-testid="git-diff-content"]').isVisible(), true, "inline diff content must be displayed");
    const next = page.locator('button[aria-label="Next file"]');
    await expect(next).toBeEnabled({ timeout: 3_000 });
    await next.click();
    await (page.locator('section [title="src/alpha.ts"]')).waitFor({ timeout: 3_000, state: 'visible' });
    await next.click();
    await expect(page.locator('section [title="src/alpha_test.ts"]')).toBeVisible();
    await next.click();
    await expect(page.locator('section [title="README.md"]')).toBeVisible();
    await expect(next).toBeDisabled();
    const previous = page.getByRole("button", { name: "Previous file", exact: true });
    for (const path of ["src/alpha_test.ts", "src/alpha.ts", "assets/logo.png"]) {
      await previous.click();
      await expect(page.locator(`section [title="${path}"]`)).toBeVisible();
    }
    await expect(previous).toBeDisabled();
    harness.assertNoUnexpectedRequests();
    console.log("✓ Git History opens commit diff in the Workspace main view");
  } catch (error) {
    await page.screenshot({ path: "/tmp/treefold-git-diff-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


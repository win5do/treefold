import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("checkout closes Branch on success and refreshes the open History with the new HEAD", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let changed = false;
  let rejectCheckout = true;
  let historyLoads = 0;
  let expectedHead: string | undefined;
  const newHead = "e".repeat(40);
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "checkout-history" });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-history`, async (route) => {
      historyLoads++;
      await route.fulfill({ json: { branch: changed ? "release/ui-fixture" : "main", commits: changed ? [{ ...FIXTURE_COMMITS[0], hash: newHead, subject: "Release branch commit" }, ...FIXTURE_COMMITS.slice(1)] : FIXTURE_COMMITS } });
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/checkout`, async (route) => {
      if (rejectCheckout) {
        await route.fulfill({ status: 409, json: { error: { code: "GIT_STATE_STALE", message: "Checkout blocked by local changes" } } });
        return;
      }
      const response = await route.fetch();
      changed = true;
      await route.fulfill({ response });
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git/squash`, async (route) => {
      expectedHead = route.request().postDataJSON().expected_head;
      await route.fulfill({ json: { preview: { base: FIXTURE_COMMITS[2].hash, branch: "release/ui-fixture", selected_count: 2, replayed_count: 0, shared_branches: [] }, history: null, recovery_id: null } });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    const commits = page.getByTestId("git-history-commit");
    await expect(commits).toHaveCount(FIXTURE_COMMITS.length);
    await commits.nth(0).click();
    await page.getByTestId(`project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger`).click();
    await page.getByTestId(`project-repository-branches-${FIXTURE_IDS.primaryRepository}`).click();
    const dialog = page.getByRole("dialog", { name: "Branch", exact: true });
    const switchBranch = async () => {
      await page!.getByTestId("branch-local-release/ui-fixture").click();
      await page!.getByTestId("branch-actions-local-release/ui-fixture").getByRole("button", { name: "Switch", exact: true }).click();
    };
    await switchBranch();
    await expect(page.getByText("Checkout blocked by local changes", { exact: false })).toBeVisible();
    await expect(dialog).toBeVisible();
    rejectCheckout = false;
    await switchBranch();
    await expect(dialog).toBeHidden();
    await expect(commits.first()).toContainText("Release branch commit");
    await expect(commits.first()).toHaveAttribute("aria-selected", "false");
    expect(historyLoads).toBeGreaterThanOrEqual(2);
    await commits.first().click();
    await commits.nth(1).click({ modifiers: ["Shift"] });
    await commits.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Squash Commits…" }).click();
    await expect(page.getByRole("dialog", { name: "Squash commits", exact: true }).getByRole("button", { name: "Squash commits", exact: true })).toBeEnabled();
    expect(expectedHead).toBe(newHead);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-checkout-history-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

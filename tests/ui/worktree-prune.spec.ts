import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("repository prune previews, retries changed registrations, and refreshes after confirmation", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "worktree-prune" });
    let previewReads = 0;
    let projectReads = 0;
    const submissions: unknown[] = [];
    const preview = {
      report: "Removing worktrees/stale: gitdir file points to non-existent location",
      entries: [{ path: "/fixture/stale-worktree", reason: "gitdir file points to non-existent location", workspaces: ["Previous Workspace"] }],
    };
    await page.route(`**/api/projects/${FIXTURE_IDS.project}`, async route => {
      projectReads += 1;
      await route.continue();
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/worktrees/prune`, async route => {
      if (route.request().method() === "GET") {
        previewReads += 1;
        await route.fulfill({ json: submissions.length >= 2 ? { report: "", entries: [] } : preview });
      } else {
        submissions.push(route.request().postDataJSON());
        await route.fulfill(submissions.length === 1
          ? { status: 409, json: { error: { code: "WORKTREE_PRUNE_CHANGED", message: "Registrations changed; review again" } } }
          : { status: 204, body: "" });
      }
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const openDialog = async () => {
      await page!.getByTestId(`project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger`).click();
      await page!.getByRole("menuitem", { name: "Prune stale worktree registrations…", exact: true }).click();
      return page!.getByTestId("prune-worktrees-dialog");
    };
    let dialog = await openDialog();
    await expect(dialog.getByText("/fixture/stale-worktree", { exact: true })).toBeVisible();
    await expect(dialog).toContainText("Previous Workspace");
    expect(submissions).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(submissions).toEqual([]);
    dialog = await openDialog();
    await dialog.getByRole("button", { name: "Prune registrations", exact: true }).click();
    await expect(dialog).toContainText("Worktree registrations changed. Check again and review the new preview.");
    await expect(dialog.getByRole("button", { name: "Prune registrations", exact: true })).toBeDisabled();
    const beforeRecheck = previewReads;
    await dialog.getByRole("button", { name: "Check again", exact: true }).click();
    await expect.poll(() => previewReads).toBeGreaterThan(beforeRecheck);
    const beforePrune = projectReads;
    await dialog.getByRole("button", { name: "Prune registrations", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => projectReads).toBeGreaterThan(beforePrune);
    expect(submissions).toEqual([preview, preview]);
    dialog = await openDialog();
    await expect(dialog).toContainText("No stale worktree registrations to prune.");
    await expect(dialog.getByRole("button", { name: "Prune registrations", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-worktree-prune-failure.png" });
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

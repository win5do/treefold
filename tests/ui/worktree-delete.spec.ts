import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("worktree-delete", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "worktree-delete" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const repository = page.locator(`[data-testid="project-location-${FIXTURE_IDS.primaryRepository}"]`);
    await repository.waitFor({ timeout: 3_000, state: 'visible' });
    const worktreesToggle = repository.locator(`[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}-toggle"]`);
    if ((await worktreesToggle.getAttribute("aria-expanded")) !== "true")
      await worktreesToggle.click();
    const unmanaged = repository.locator('[data-testid="project-worktree-row"]:has(button[data-worktree-delete-state="available"])');
    const deleteButton = unmanaged.locator('button[data-worktree-delete-state="available"]');

    const blocked = repository.locator('button[data-worktree-delete-state="blocked"]').first();
    await expect(blocked).toHaveAttribute("aria-disabled", "true");
    await blocked.click({ force: true });
    await expect(page.getByRole("status")).toContainText("belongs to active Workspace");
    expect(harness.deleteRequests).toEqual([]);

    harness.setWorktreeDeletePrecheck({
      status: "blocked",
      blockers: [
        "worktree has uncommitted changes; commit, stash, or discard them before deleting it",
      ],
      tracked_changes: 0,
      untracked_files: 1,
    });
    await deleteButton.click();
    const dialog = page.locator('[data-testid="delete-worktree-dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    const action = dialog.locator("button:text-is(\"Delete worktree\")");
    await (dialog.locator('[data-testid="worktree-delete-blocked"]')).waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(await action.isEnabled(), false, "dirty worktrees must be blocked");

    harness.setWorktreeDeletePrecheck({
      status: "ready",
      blockers: [],
      untracked_files: 0,
    });
    await (dialog.locator("button:text-is(\"Check again\")")).click();
    await (dialog.locator('[data-testid="worktree-delete-ready"]')).waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(await action.isEnabled(), true, "clean worktrees must be deletable");
    await action.click();
    await dialog.waitFor({ timeout: 3_000, state: 'hidden' });
    const deletingRow = repository.locator('[data-testid="project-worktree-row"]:has(button[data-worktree-delete-state="deleting"])');
    await deletingRow.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await deletingRow.innerText(), /Deleting/);
    assert.equal(
      await (
        deletingRow.locator('button[data-worktree-delete-state="deleting"]')
      ).isEnabled(),
      false,
      "deleting worktrees must disable repeated deletion",
    );
    assert.equal(
      harness.deleteRequests.some(
        (request) => request.kind === "worktree" && request.path?.includes("unmanaged-worktree"),
      ),
      true,
      "worktree deletion must reach the API",
    );
    await deletingRow.waitFor({ timeout: 5_000, state: 'hidden' });
    harness.assertNoUnexpectedRequests();
    console.log("✓ worktree deletion precheck, blocking, retry, and removal passed");
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


import { test, expect, type Page } from "@playwright/test";
import type { GitWorktree } from "../../src/renderer/src/domain/types.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

const cleanStatus: NonNullable<GitWorktree["status"]> = {
  prunable_reason: null, locked_reason: null, detached: false,
  available: true, dirty: false, conflicted: false,
  comparison: "same", target_branch: "main", ahead: 0, behind: 0,
  has_ignored_files: false, operation_in_progress: false, cleanup_candidate: false,
};

test("Workspace and Fork show only their current repository worktree and refresh its status", async () => {
  let current: GitWorktree;
  const harness = await startUiHarness((fixture) => {
    const items = fixture.projectDetails[FIXTURE_IDS.project].worktrees;
    current = items.find((item) => item.workspace_id === FIXTURE_IDS.workspace)!;
    current.status = { ...cleanStatus, dirty: true, comparison: "uncontained", ahead: 3, behind: 2 };
    const fork = items.find((item) => item.workspace_id === FIXTURE_IDS.fork)!;
    fork.status = { ...cleanStatus, conflicted: true, dirty: true };
    // Neither the same branch at another path nor the same path under another
    // repository may supply this card's status.
    items.unshift(
      { ...current, path: "/tmp/other-checkout", status: { ...cleanStatus, locked_reason: "another checkout" } },
      { ...current, project_repository_id: FIXTURE_IDS.secondaryRepository, status: { ...cleanStatus, locked_reason: "another repository" } },
    );
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-worktrees" });
    const projectRequests: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname === `/api/projects/${FIXTURE_IDS.project}`) projectRequests.push(request.url());
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const card = page.getByTestId(`workspace-location-${FIXTURE_IDS.workspacePrimaryLocation}`);
    await expect(card.getByText("Uncommitted changes", { exact: true })).toBeVisible();
    await expect(card.getByText("Ahead 3 · Behind 2", { exact: true })).toBeVisible();
    await expect(card.getByText("Diverged", { exact: true })).toBeVisible();
    await expect(card.getByText("Locked", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Conflicts", { exact: true })).toHaveCount(0);
    await expect(card.getByTestId(`workspace-worktree-${FIXTURE_IDS.workspacePrimaryLocation}`)).toHaveCount(1);
    // An incomplete repository has no checkout; never fall back to its source root.
    const failed = page.getByTestId(`workspace-location-${FIXTURE_IDS.workspaceSecondaryLocation}`);
    await expect(failed.getByText("Locked", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId(`workspace-location-error-${FIXTURE_IDS.workspaceSecondaryLocation}`)).toContainText("simulated fixture failure");

    current!.status = { ...cleanStatus };
    await page.getByRole("button", { name: "Refresh Workspace", exact: true }).click();
    await expect(card.getByText("Same as main", { exact: true })).toBeVisible();
    await expect(card.getByText("Uncommitted changes", { exact: true })).toHaveCount(0);

    await page.getByTestId(`fork-list-row-${FIXTURE_IDS.fork}`).getByRole("button").first().click();
    const forkCard = page.getByTestId(`workspace-location-${FIXTURE_IDS.forkPrimaryLocation}`);
    await expect(forkCard.getByText("Conflicts", { exact: true })).toBeVisible();
    await expect(forkCard.getByText("Locked", { exact: true })).toHaveCount(0);
    await expect(forkCard.getByText("Ahead 3 · Behind 2", { exact: true })).toHaveCount(0);
    expect(projectRequests).toHaveLength(0);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-workspace-worktrees-failure.png" });
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("worktree status failure can be retried without hiding repository directories", async () => {
  const harness = await startUiHarness((fixture) => {
    fixture.projectDetails[FIXTURE_IDS.project].worktrees
      .find((item) => item.workspace_id === FIXTURE_IDS.workspace)!.status = { ...cleanStatus };
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "worktree-status-retry" });
    let fail = true;
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/worktrees`, async (route) => {
      if (!fail) return route.continue();
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Fixture unavailable" } }) });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const section = page.getByTestId("workspace-repositories-section");
    await expect(section.getByRole("alert").filter({ hasText: "Unable to load worktree status." })).toBeVisible({ timeout: 15_000 });
    await expect(section.getByTestId(`workspace-directory-actions-${FIXTURE_IDS.primaryDirectory}-trigger`)).toBeVisible();
    fail = false;
    await section.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(section.getByText("Same as main", { exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-worktree-status-retry-failure.png" });
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("background worktree refresh does not keep Workspace actions busy", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-refresh-busy" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const create = page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true });
    await expect(create).toBeEnabled();
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/worktrees`, async route => {
      pending = true;
      await gate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Refresh Workspace", exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByRole("dialog", { name: "New Session", exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    release();
    try { await page?.unrouteAll({ behavior: "wait" }); }
    finally { try { await closeUiSession(page); } finally { await harness.close(); } }
  }
});

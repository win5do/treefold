import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, clickUiElement } from "./harness/session.ts";

for (const choice of ["cleanup", "keep-branches", "keep-all"] as const) {
  test(`Delete from parent list: ${choice}`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    const kind = choice === "keep-all" ? "fork" : "workspace";
    const id = kind === "fork" ? FIXTURE_IDS.archivedFork : FIXTURE_IDS.archivedWorkspace;
    const parent = kind === "fork" ? `workspaces/${FIXTURE_IDS.workspace}` : `projects/${FIXTURE_IDS.project}`;
    const requests: URLSearchParams[] = [];
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-deletion" });
      await page.route(`**/api/workspaces/${id}?*`, async route => {
        requests.push(new URL(route.request().url()).searchParams);
        expect(route.request().method()).toBe("DELETE");
        await route.continue();
      });
      await page.goto(`${harness.baseUrl}/#/${parent}`);
      const row = page.getByTestId(`${kind}-list-row-${id}`);
      await clickUiElement(page, row.getByTestId(`${kind}-actions-trigger`));
      await page.getByTestId(`delete-${kind}-action`).click();
      const dialog = page.getByTestId("delete-record-dialog");
      const keepWorktrees = dialog.getByRole("checkbox", { name: "Keep working directories", exact: true });
      const keepBranches = dialog.getByRole("checkbox", { name: "Keep local branches", exact: true });
      await expect(keepWorktrees).not.toBeChecked();
      await expect(keepBranches).not.toBeChecked();
      if (choice === "keep-all") {
        await keepWorktrees.check();
        await expect(keepBranches).toBeChecked();
        await expect(keepBranches).toBeDisabled();
      } else if (choice === "keep-branches") {
        await keepBranches.check();
      }
      await dialog.getByRole("button", { name: "Permanently delete", exact: true }).click();
      await expect(row).toHaveCount(0);
      expect(requests).toHaveLength(1);
      expect(requests[0].get("delete_worktrees")).toBe(String(choice !== "keep-all"));
      expect(requests[0].get("delete_branches")).toBe(String(choice === "cleanup"));
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-delete-${choice}-failure.png` });
      throw error;
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

for (const kind of ["workspace", "fork"] as const) {
  test(`active ${kind} explains its deletion blocker without sending a delete`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    const id = kind === "fork" ? FIXTURE_IDS.fork : FIXTURE_IDS.workspace;
    const parent = kind === "fork" ? `workspaces/${FIXTURE_IDS.workspace}` : `projects/${FIXTURE_IDS.project}`;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "active-delete" });
      await page.goto(`${harness.baseUrl}/#/${parent}`);
      await clickUiElement(page, page.getByTestId(`${kind}-list-row-${id}`).getByTestId(`${kind}-actions-trigger`));
      const action = page.getByTestId(`delete-${kind}-action`);
      await expect(action).toHaveAttribute("data-blocked", "true");
      await action.click();
      await expect(page.getByRole("status")).toContainText(kind === "fork" ? "Finish Fork" : "Finish Workspace");
      await expect(page.getByTestId("delete-record-dialog")).toHaveCount(0);
      expect(harness.deleteRequests).toEqual([]);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

const undeliveredBranches = [
  { workspace_name: "Archived workspace", repository_name: "backend", branch: "feature/undelivered-commits", head: "a".repeat(40), commit_count: 3 },
  { workspace_name: "Archived child Fork", repository_name: "frontend", branch: "feature/child-with-undelivered-commits-and-a-long-branch-name-to-review", head: "b".repeat(40), commit_count: 1 },
];

async function openArchivedDeletion(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  const row = page.getByTestId(`workspace-list-row-${FIXTURE_IDS.archivedWorkspace}`);
  await clickUiElement(page, row.getByTestId("workspace-actions-trigger"));
  await page.getByTestId("delete-workspace-action").click();
  return { row, dialog: page.getByTestId("delete-record-dialog") };
}

for (const choice of ["keep", "discard"] as const) {
  test(`undelivered branches require explicit consent or retention: ${choice}`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    const requests: URLSearchParams[] = [];
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "undelivered-deletion" });
      await page.setViewportSize({ width: 960, height: 720 });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.archivedWorkspace}/delete-precheck?*`, async route => {
        const keep = new URL(route.request().url()).searchParams.get("delete_branches") === "false";
        await route.fulfill({ json: { undelivered_branches: keep ? [] : undeliveredBranches, discard_token: keep ? null : "confirmed-heads" } });
      });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.archivedWorkspace}?*`, async route => {
        requests.push(new URL(route.request().url()).searchParams);
        await route.continue();
      });
      const { dialog, row } = await openArchivedDeletion(page, harness.baseUrl);
      await expect(dialog.getByText("Archived child Fork / frontend", { exact: true })).toBeVisible();
      const consent = dialog.getByRole("checkbox", { name: "I understand and want to discard these undelivered commits", exact: true });
      const discardButton = dialog.getByRole("button", { name: "Discard commits and delete", exact: true });
      await expect(consent).not.toBeChecked();
      await expect(discardButton).toBeDisabled();
      expect(requests).toHaveLength(0);
      if (choice === "keep") {
        await dialog.getByRole("checkbox", { name: "Keep local branches", exact: true }).check();
        await dialog.getByRole("button", { name: "Permanently delete", exact: true }).click();
      } else {
        await consent.check();
        // Explicit approval is tied to the current selection, not retained after changing it.
        const keep = dialog.getByRole("checkbox", { name: "Keep local branches", exact: true });
        await keep.check();
        await expect(dialog.getByRole("button", { name: "Permanently delete", exact: true })).toBeEnabled();
        await keep.uncheck();
        await expect(consent).not.toBeChecked();
        await expect(discardButton).toBeDisabled();
        await page.screenshot({ path: "/tmp/treefold-delete-undelivered.png" });
        await consent.check();
        await discardButton.click();
      }
      await expect(row).toHaveCount(0);
      expect(requests).toHaveLength(1);
      expect(requests[0].get("delete_branches")).toBe(String(choice === "discard"));
      expect(requests[0].get("discard_token")).toBe(choice === "discard" ? "confirmed-heads" : null);
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-delete-undelivered-${choice}-failure.png` });
      throw error;
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("changed branch heads refresh the preview and require new consent", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let generation = 1;
  const tokens: (string | null)[] = [];
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "stale-deletion" });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.archivedWorkspace}/delete-precheck?*`, async route => {
      await route.fulfill({ json: { undelivered_branches: undeliveredBranches, discard_token: `heads-${generation}` } });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.archivedWorkspace}?*`, async route => {
      tokens.push(new URL(route.request().url()).searchParams.get("discard_token"));
      if (generation++ === 1) {
        await route.fulfill({ status: 409, json: { error: { code: "WORKSPACE_DELETE_CHANGED", message: "raw backend message" } } });
      } else await route.continue();
    });
    const { dialog, row } = await openArchivedDeletion(page, harness.baseUrl);
    const consent = dialog.getByRole("checkbox", { name: "I understand and want to discard these undelivered commits", exact: true });
    await consent.check();
    await dialog.getByRole("button", { name: "Discard commits and delete", exact: true }).click();
    await expect(dialog.getByText("Branches changed after confirmation. Review the updated list and confirm again.", { exact: true })).toBeVisible();
    await expect(consent).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Discard commits and delete", exact: true })).toBeDisabled();
    await expect(row).toHaveCount(1);
    expect(tokens).toEqual(["heads-1"]);
    await consent.check();
    await dialog.getByRole("button", { name: "Discard commits and delete", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(tokens).toEqual(["heads-1", "heads-2"]);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("failed precheck blocks cleanup and can be retried", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let attempts = 0;
  let blocked = true;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "deletion-precheck-retry" });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.archivedWorkspace}/delete-precheck?*`, async route => {
      attempts += 1;
      if (blocked) {
        await route.fulfill({ status: 409, json: { error: { code: "FINISH_SESSION_ACTIVE", message: "raw backend message" } } });
      } else await route.continue();
    });
    const { dialog, row } = await openArchivedDeletion(page, harness.baseUrl);
    await expect(dialog.getByText("Stop running Sessions and conflict resolvers before deleting.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Permanently delete", exact: true })).toBeDisabled();
    expect(harness.deleteRequests).toHaveLength(0);
    const previousAttempts = attempts;
    blocked = false;
    await dialog.getByRole("button", { name: "Check again", exact: true }).click();
    await dialog.getByRole("button", { name: "Permanently delete", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(attempts).toBeGreaterThan(previousAttempts);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

for (const scope of ["project", "workspace"] as const) {
  test(`clean archived children from ${scope} list and refresh results`, async () => {
    const harness = await startUiHarness(fixture => {
      if (scope === "project") {
        const workspaces = fixture.projectDetails[FIXTURE_IDS.project].workspaces;
        const fork = workspaces.find(item => item.id === FIXTURE_IDS.archivedFork)!;
        workspaces.push({ ...fork, id: "archived-workspace-child", parent_workspace_id: FIXTURE_IDS.archivedWorkspace });
      }
    });
    let page: Page | undefined;
    const parentId = scope === "project" ? FIXTURE_IDS.project : FIXTURE_IDS.workspace;
    const kind = scope === "project" ? "workspace" : "fork";
    const archivedId = scope === "project" ? FIXTURE_IDS.archivedWorkspace : FIXTURE_IDS.archivedFork;
    const activeId = scope === "project" ? FIXTURE_IDS.workspace : FIXTURE_IDS.fork;
    let requests = 0;
    let blocked = scope === "workspace";
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "archived-cleanup" });
      await page.route(`**/api/${scope}s/${parentId}/${kind}s/cleanup-archived`, async route => {
        requests += 1;
        expect(route.request().method()).toBe("POST");
        if (blocked) {
          await route.fulfill({ json: { deleted_ids: [], skipped: [{ id: archivedId, name: "Unmerged Fork", reason: "unmerged", message: "raw backend message" }] } });
        } else await route.continue();
      });
      await page.goto(`${harness.baseUrl}/#/${scope}s/${parentId}`);
      const trigger = page.getByRole("button", { name: scope === "project" ? "Workspace list actions" : "Fork list actions", exact: true });
      const action = page.getByRole("menuitem", { name: "Clean up archived items", exact: true });
      await clickUiElement(page, trigger);
      await action.click();
      if (blocked) {
        const result = page.getByRole("dialog", { name: "Cleanup results" });
        await expect(result).toContainText("Cleaned up 0; skipped 1.");
        await expect(result).toContainText("Contains unmerged commits; kept the item and its files.");
        await expect(page.getByTestId(`${kind}-list-row-${archivedId}`)).toBeVisible();
        await page.keyboard.press("Escape");
        blocked = false;
        await clickUiElement(page, trigger);
        await action.click();
      }
      await expect(page.getByTestId(`${kind}-list-row-${archivedId}`)).toHaveCount(0);
      await expect(page.getByTestId(`${kind}-list-row-${activeId}`)).toBeVisible();
      expect(requests).toBe(scope === "project" ? 1 : 2);
      await clickUiElement(page, trigger);
      await expect(action).toBeDisabled();
      if (scope === "project") {
        await expect(page.getByRole("status")).toContainText("Cleaned up 2; skipped 0.");
        await page.keyboard.press("Escape");
        await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
        await expect(page.getByTestId(`fork-list-row-${FIXTURE_IDS.fork}`)).toBeVisible();
        await expect(page.getByTestId(`fork-list-row-${FIXTURE_IDS.archivedFork}`)).toBeVisible();
      }
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-archived-cleanup-${scope}-failure.png` });
      throw error;
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("Project cleanup skips archived Forks under active Workspaces", async () => {
  const harness = await startUiHarness(fixture => {
    const project = fixture.projectDetails[FIXTURE_IDS.project];
    project.workspaces = project.workspaces.filter(item => item.id !== FIXTURE_IDS.archivedWorkspace);
    delete fixture.workspaceDetails[FIXTURE_IDS.archivedWorkspace];
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "recursive-archived-cleanup" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const trigger = page.getByRole("button", { name: "Workspace list actions", exact: true });
    const action = page.getByRole("menuitem", { name: "Clean up archived items", exact: true });
    await clickUiElement(page, trigger);
    await expect(action).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await expect(page.getByTestId(`fork-list-row-${FIXTURE_IDS.fork}`)).toBeVisible();
    await expect(page.getByTestId(`fork-list-row-${FIXTURE_IDS.archivedFork}`)).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-recursive-archived-cleanup-failure.png" });
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

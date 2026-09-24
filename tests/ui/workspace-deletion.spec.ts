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

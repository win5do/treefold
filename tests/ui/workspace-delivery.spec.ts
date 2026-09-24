import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";
import type { FinishBatch, FinishPlanItem } from "../../src/renderer/src/domain/types.ts";

test("Workspace intermediate push uses one strategy and keeps the current route", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let batch: FinishBatch | null = null;
  let submitted: { continue_work: boolean; repositories: FinishPlanItem[] } | undefined;
  let missingRemote = true;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-delivery" });
    await page.setViewportSize({ width: 1000, height: 740 });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, async route => {
      const response = await route.fetch(); const data = await response.json();
      for (const repo of data.repositories) { repo.delivery_status = "active"; repo.git_status = "ready"; }
      await route.fulfill({ response, json: data });
    });
    await page.route("**/api/workspace-repositories/*/delivery-preflight", async route => {
      const id = route.request().url().split("/").at(-2)!;
      const code_action = route.request().postDataJSON().code_action;
      await route.fulfill({ json: { id: `${id}-${code_action}`, code_action, target_branch: "feature/ui-fixture", ahead: 1, behind: 0, changed_files: [], warnings: [], blockers: missingRemote && code_action === "push_branch" ? ["Configure the upstream before pushing"] : [] } });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`, async route => {
      if (route.request().method() === "POST") {
        submitted = route.request().postDataJSON();
        batch = { workspace_id: FIXTURE_IDS.workspace, continue_work: true, status: "completed", items: submitted!.repositories.map(plan => ({ ...plan, repository_name: plan.repository_id, status: "completed", delivered: true, cleaned: true })) };
      }
      await route.fulfill({ json: batch, contentType: "application/json" });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
    await page.getByTestId("finish-workspace-action").click();
    const dialog = page.getByRole("dialog", { name: "Deliver Workspace", exact: true });
    await dialog.getByRole("radio", { name: "Intermediate delivery", exact: true }).check();
    await dialog.getByRole("radio", { name: "Push feature branch", exact: true }).check();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    await expect(dialog.getByText("Configure the upstream before pushing", { exact: true })).toBeVisible();
    missingRemote = false;
    await dialog.getByRole("button", { name: "Recheck", exact: true }).click();
    await dialog.getByTestId("finish-confirm-action").click();
    await expect.poll(() => Boolean(submitted)).toBe(true);
    expect(submitted!.continue_work).toBe(true);
    expect(submitted!.repositories).toHaveLength(2);
    expect(submitted!.repositories.every(plan => plan.code_action === "push_branch" && !plan.delete_worktree && !plan.delete_branch)).toBe(true);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/#/workspaces/${FIXTURE_IDS.workspace}$`));
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test("Archived Workspace can reopen its retained checkout without starting Sessions", async () => {
  const harness = await startUiHarness(); let page: Page | undefined; let reopened = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-reopen" });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, async route => {
      const response = await route.fetch(); const data = await response.json(); data.status = reopened ? "active" : "archived";
      await route.fulfill({ response, json: data });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/reopen?*`, async route => {
      reopened = true; await route.fulfill({ json: { id: FIXTURE_IDS.workspace, status: "active" } });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByRole("button", { name: "Reopen Workspace", exact: true }).click();
    await expect(page.getByRole("button", { name: "New Session", exact: true })).toBeVisible();
    expect(reopened).toBe(true);
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

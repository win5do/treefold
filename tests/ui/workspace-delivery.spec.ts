import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { clickUiElement, closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";
import type { FinishBatch, FinishPlanItem } from "../../src/renderer/src/domain/types.ts";

test("Workspace intermediate push uses one strategy and keeps the current route", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let batch: FinishBatch | null = null;
  let submitted: { continue_work: boolean; repositories: FinishPlanItem[] } | undefined;
  let missingRemote = true;
  let processChecks = 0;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-delivery" });
    await page.setViewportSize({ width: 1000, height: 740 });
    page.on("request", request => { if (request.url().endsWith("/finish-processes")) processChecks++; });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, async route => {
      const response = await route.fetch(); const data = await response.json();
      data.default_delivery = "push_branch";
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
    await expect(dialog.getByRole("radio", { name: "Push feature branch", exact: true })).toBeChecked();
    expect(submitted).toBeUndefined();
    await dialog.getByRole("radio", { name: "Intermediate delivery", exact: true }).check();
    await expect(dialog.getByRole("radio", { name: "Push feature branch", exact: true })).toBeChecked();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    await expect(dialog.getByText("Configure the upstream before pushing", { exact: true })).toHaveCount(2);
    missingRemote = false;
    await dialog.getByRole("button", { name: "Recheck", exact: true }).click();
    await dialog.getByTestId("finish-confirm-action").click();
    await expect.poll(() => Boolean(submitted)).toBe(true);
    expect(submitted!.continue_work).toBe(true);
    expect(processChecks).toBe(0);
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

test("Delivery keeps its draft through Workspace upstream settings without remembering a cancelled choice", async () => {
  const repositoryId = FIXTURE_IDS.workspaceSecondaryLocation;
  const harness = await startUiHarness(fixture => {
    const detail = fixture.workspaceDetails[FIXTURE_IDS.workspace];
    detail.default_delivery = "local_merge";
    for (const repository of detail.repositories) {
      repository.delivery_status = "active";
      repository.git_status = "ready";
      if (repository.id === repositoryId) {
        repository.remote_name = undefined;
        repository.remote_branch = undefined;
      }
    }
  });
  let page: Page | undefined;
  let checks = 0;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "delivery-upstream-settings" });
    await page.setViewportSize({ width: 1000, height: 740 });
    await page.route("**/api/workspace-repositories/*/delivery-preflight", async route => {
      checks++;
      const id = route.request().url().split("/").at(-2)!;
      const code_action = route.request().postDataJSON().code_action;
      if (id === repositoryId && code_action === "push_branch" && !harness.workspaceLocationUpdates.length) {
        await route.fulfill({ status: 400, json: { error: "Workspace Repository has no remote configured" } });
      } else {
        await route.fulfill({ json: { id: `${id}-${code_action}`, code_action, target_branch: "feature/ui-fixture", ahead: 1, behind: 0, changed_files: [], warnings: [], blockers: [] } });
      }
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const openDelivery = async () => {
      await openUiContextMenu(page!, page!.getByTestId("sidebar-workspace-node"));
      await page!.getByTestId("finish-workspace-action").click();
    };
    await openDelivery();
    const dialog = page.getByRole("dialog", { name: "Deliver Workspace", exact: true });
    const push = dialog.getByRole("radio", { name: "Push feature branch", exact: true });
    await expect(dialog.getByRole("radio", { name: "Merge into Project", exact: true })).toBeChecked();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
    await dialog.getByRole("radio", { name: "Intermediate delivery", exact: true }).check();
    await expect(push).toBeEnabled();
    await push.check();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    await expect(dialog.getByRole("alert")).toContainText("No upstream is configured");
    const previousChecks = checks;
    await dialog.getByRole("button", { name: "Go to Workspace settings", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
    const repository = page.getByTestId(`workspace-location-${repositoryId}`);
    await expect(repository).toBeFocused();
    await clickUiElement(page, page.getByTestId(`workspace-location-actions-${repositoryId}-trigger`));
    await page.getByTestId(`workspace-location-upstream-${repositoryId}`).click();
    const upstream = page.getByRole("dialog", { name: "Set upstream", exact: true });
    await upstream.getByRole("combobox", { name: "Remote", exact: true }).selectOption("origin");
    await upstream.getByRole("button", { name: "Save upstream", exact: true }).click();
    await expect(upstream).toHaveCount(0);
    await expect(repository).toContainText("origin/");
    await openDelivery();
    await expect(push).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Intermediate delivery", exact: true })).toBeChecked();
    await expect.poll(() => checks).toBeGreaterThan(previousChecks);
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await openDelivery();
    await expect(dialog.getByRole("radio", { name: "Merge into Project", exact: true })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Finish and archive", exact: true })).toBeChecked();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

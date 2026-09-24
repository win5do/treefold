import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";
import type { FinishPlanItem } from "../../src/renderer/src/domain/types.ts";

for (const result of ["merge", "squash-reopen", "squash-new"] as const) {
test(`Fork Finish and reopen: ${result}`, async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let archived = false;
  let reopened = 0;
  let plans: FinishPlanItem[] = [];
  const sessionStarts: string[] = [];
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "fork-reopen" });
    page.on("request", request => {
      if (request.method() === "POST" && /\/sessions(?:\/|$)/.test(new URL(request.url()).pathname)) sessionStarts.push(request.url());
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.fork}`, async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.status = archived ? "archived" : "active";
      data.repositories = data.repositories.filter((r: { access_mode: string }) => r.access_mode === "read_write");
      for (const repository of data.repositories) {
        repository.git_status = "ready";
        repository.delivery_status = archived ? "delivered" : "active";
      }
      data.sessions = data.sessions.map((session: object) => ({ ...session, status: "stopped" }));
      await route.fulfill({ response, json: data });
    });
    await page.route("**/api/workspace-repositories/*/delivery-preflight", async route => {
      const id = route.request().url().split("/").at(-2)!;
      await route.fulfill({ json: { id: `preflight-${id}`, workspace_repository_id: id,
        code_action: route.request().postDataJSON().code_action, target_branch: "main",
        ahead: 1, behind: 0, changed_files: [], blockers: [], warnings: [], source_dirty: false } });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.fork}/finish-batch`, async route => {
      if (route.request().method() === "POST") {
        plans = route.request().postDataJSON().repositories;
        archived = true;
      }
      await route.fulfill({ contentType: "application/json", json: archived ? { workspace_id: FIXTURE_IDS.fork, status: "completed", error: null,
        items: plans.map(plan => ({ ...plan, repository_name: plan.repository_id, status: "completed", delivered: true, cleaned: true })) } : null });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.fork}/reopen?*`, async route => {
      expect(route.request().method()).toBe("POST");
      if (result !== "merge" && new URL(route.request().url()).searchParams.get("confirm_squash") !== "true") {
        await route.fulfill({ status: 409, json: { error: { code: "FORK_REOPEN_SQUASH_CONFIRMATION_REQUIRED", message: "Confirm squash history" } } });
        return;
      }
      reopened++;
      archived = false;
      await route.fulfill({ json: { id: FIXTURE_IDS.fork, status: "active" } });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-fork-node"));
    await page.getByTestId("finish-workspace-action").click();
    const dialog = page.getByRole("dialog", { name: "Deliver Fork", exact: true });
    if (result !== "merge") await dialog.getByRole("checkbox", { name: "Squash into one commit", exact: true }).check();
    await dialog.getByRole("button", { name: "Confirm and execute", exact: true }).click();
    await expect.poll(() => plans.length).toBe(2);
    expect(plans.every(plan => !plan.delete_worktree && !plan.delete_branch && plan.code_action === (result === "merge" ? "local_merge" : "squash_merge"))).toBe(true);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await page.getByRole("button", { name: "Reopen Fork", exact: true }).click();
    if (result !== "merge") {
      const confirm = page.getByRole("alertdialog", { name: "Reopen this Fork?", exact: true });
      await expect(confirm).toBeVisible();
      expect(reopened).toBe(0);
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(reopened).toBe(0);
      await page.getByRole("button", { name: "Reopen Fork", exact: true }).click();
      await confirm.getByRole("button", { name: result === "squash-new" ? "New Fork from parent" : "Reopen anyway", exact: true }).click();
    }
    if (result === "squash-new") {
      await expect(page.getByRole("dialog", { name: "Fork work", exact: true })).toBeVisible();
      expect(reopened).toBe(0);
    } else {
      await expect.poll(() => reopened).toBe(1);
      await expect(page.getByRole("button", { name: "New Session", exact: true })).toBeVisible();
    }
    expect(sessionStarts).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-fork-reopen-failure.png" });
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

}

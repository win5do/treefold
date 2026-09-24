import { test, expect, type Page } from "@playwright/test";
import type { FinishBatch, FinishPlanItem } from "../../src/renderer/src/domain/types.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

for (const mode of ["continue", "abandon"] as const) {
  test(`Fork-wide delivery: ${mode}`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    let batch: FinishBatch | null = null;
    const submissions: { repositories: FinishPlanItem[]; continue_work: boolean }[] = [];
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "fork-delivery" });
      await page.setViewportSize({ width: 1000, height: 740 });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.fork}`, async route => {
        const response = await route.fetch();
        const data = await response.json();
        data.repositories = data.repositories.filter((r: { access_mode: string }) => r.access_mode === "read_write");
        for (const repository of data.repositories) { repository.delivery_status = "active"; repository.git_status = "ready"; }
        await route.fulfill({ response, json: data });
      });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.fork}/finish-batch`, async route => {
        if (route.request().method() === "POST") {
          const input = route.request().postDataJSON();
          submissions.push(input);
          batch = { workspace_id: FIXTURE_IDS.fork, status: "completed", continue_work: input.continue_work,
            items: input.repositories.map((plan: FinishPlanItem) => ({ ...plan, repository_name: plan.repository_id, status: "completed", cleaned: true, delivered: true })) };
        }
        await route.fulfill({ json: batch, contentType: "application/json" });
      });
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
      const open = async () => {
        await openUiContextMenu(page!, page!.getByTestId("sidebar-fork-node"));
        await page!.getByTestId("finish-workspace-action").click();
      };
      await open();
      const dialog = page.getByRole("dialog", { name: "Deliver Fork", exact: true });
      const squash = dialog.getByRole("checkbox", { name: "Squash into one commit", exact: true });
      await expect(squash).not.toBeChecked();
      await squash.check();
      await expect(dialog.getByRole("alert")).toContainText("original commits");
      if (mode === "continue") {
        await dialog.getByRole("radio", { name: "Finish and archive", exact: true }).focus();
        await page.keyboard.press("ArrowDown");
        await expect(dialog.getByRole("radio", { name: "Intermediate delivery", exact: true })).toBeChecked();
        await expect(dialog.getByRole("radio", { name: "Merge into parent", exact: true })).toBeChecked();
        // Intermediate delivery cannot retain a previously chosen Squash option.
        await expect(squash).toHaveCount(0);
      } else {
        await dialog.getByRole("radio", { name: "Abandon delivery", exact: true }).check();
      }
      await dialog.getByTestId("finish-confirm-action").click();
      await expect.poll(() => submissions.length).toBe(1);
      expect(submissions[0].continue_work).toBe(mode === "continue");
      expect(submissions[0].repositories).toHaveLength(2);
      expect(submissions[0].repositories.every(plan => plan.code_action === (mode === "continue" ? "local_merge" : "keep") && !plan.delete_worktree && !plan.delete_branch)).toBe(true);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      if (mode === "continue") {
        await expect(page).toHaveURL(new RegExp(`/#/workspaces/${FIXTURE_IDS.fork}$`));
        await open();
        await expect(dialog.getByRole("radio", { name: "Finish and archive", exact: true })).toBeChecked();
        await dialog.getByTestId("finish-confirm-action").click();
        await expect.poll(() => submissions.length).toBe(2);
        expect(submissions[1].continue_work).toBe(false);
      }
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-fork-delivery-${mode}.png` });
      throw error;
    } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
  });
}

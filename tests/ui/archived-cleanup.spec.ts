import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import type { ArchivedCleanupTask } from "../../src/renderer/src/domain/types.ts";
import type { SidebarFixture } from "./fixtures/types.ts";

for (const events of [true, false]) {
  test(`cleanup survives navigation and shares incremental progress via ${events ? "events" : "polling"}`, async () => {
    let fixture!: SidebarFixture;
    const harness = await startUiHarness(value => { fixture = value; });
    let page: Page | undefined;
    let task: ArchivedCleanupTask | undefined;
    let starts = 0;
    let reads = 0;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "cleanup-navigation" });
      await page.route("**/api/archived-cleanup", async route => {
        reads++;
        await route.fulfill({ json: task ? [task] : [] });
      });
      await page.route(`**/api/projects/${FIXTURE_IDS.project}/workspaces/cleanup-archived`, async route => {
        starts++;
        task = { id: "shared-cleanup", scope: "project", scope_id: FIXTURE_IDS.project,
          scope_name: "Cleanup test", status: "running", total: 2, completed: 0,
          deleted_ids: [], orphan_paths: [], skipped: [], error: null };
        await route.fulfill({ status: 202, json: task });
      });
      await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
      const trigger = page.getByRole("button", { name: "Workspace list actions", exact: true });
      await expect.poll(() => reads).toBeGreaterThan(0);
      await trigger.click();
      await page.getByRole("menuitem", { name: "Clean up archived items", exact: true }).click();
      await expect(trigger).toHaveAttribute("aria-busy", "true");
      await expect(trigger).toBeDisabled();
      // Client-side navigation unmounts the Project, but keeps the global observer alive.
      await page.evaluate(id => { window.location.hash = `/workspaces/${id}`; }, FIXTURE_IDS.workspace);
      await expect(page.getByTestId(`fork-list-row-${FIXTURE_IDS.fork}`)).toBeVisible();
      task!.completed = 1;
      task!.deleted_ids = [FIXTURE_IDS.archivedWorkspace];
      fixture.projectDetails[FIXTURE_IDS.project].workspaces = fixture.projectDetails[FIXTURE_IDS.project].workspaces
        .filter(item => item.id !== FIXTURE_IDS.archivedWorkspace);
      if (events) harness.setProcessState(FIXTURE_IDS.workspaceShell, "exited");
      await expect.poll(async () => page!.evaluate(async () => {
        const { queryClient } = await import("/src/features/app/queryClient.ts");
        return queryClient.getQueryData<Array<{ completed: number }>>(["archived-cleanup"])?.[0]?.completed;
      })).toBe(1);
      await page.evaluate(id => { window.location.hash = `/projects/${id}`; }, FIXTURE_IDS.project);
      await expect(trigger).toHaveAttribute("aria-busy", "true");
      await expect(page.getByTestId(`workspace-list-row-${FIXTURE_IDS.archivedWorkspace}`)).toHaveCount(0);
      expect(starts).toBe(1);
      // Completion is notified even when the owning page is not mounted.
      await page.evaluate(id => { window.location.hash = `/workspaces/${id}`; }, FIXTURE_IDS.workspace);
      await expect(page.getByTestId(`fork-list-row-${FIXTURE_IDS.fork}`)).toBeVisible();
      task!.completed = 2;
      task!.status = "completed";
      if (events) harness.setProcessState(FIXTURE_IDS.workspaceShell, "running");
      const toast = page.getByRole("status").filter({ hasText: "Cleanup test: Cleaned up 1; skipped 0." });
      await expect(toast).toHaveCount(1);
      await page.evaluate(id => { window.location.hash = `/projects/${id}`; }, FIXTURE_IDS.project);
      await expect(trigger).toBeEnabled();
      await expect(trigger).toHaveAttribute("aria-busy", "false");
      await expect(toast).toHaveCount(1);
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-cleanup-navigation-${events}.png` }).catch(() => {});
      throw error;
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

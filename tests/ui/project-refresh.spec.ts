import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("Project archive state and subsequent events update while worktree checks are pending", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  const failures: string[] = [];
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-refresh" });
    let streamOpen = false;
    page.on("console", message => { if (message.text().includes("Stream open /api/events")) streamOpen = true; });
    page.on("requestfailed", request => {
      if (request.url().endsWith(`/projects/${FIXTURE_IDS.project}/worktrees`)) failures.push(request.failure()?.errorText ?? "failed");
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const row = page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    await expect.poll(() => streamOpen).toBe(true);
    failures.length = 0;
    await page.route(`**/api/projects/${FIXTURE_IDS.project}/worktrees`, async route => {
      const index = requests++;
      const response = await route.fetch();
      if (index === 0) await gate;
      await route.fulfill({ response });
    });
    await page.evaluate(async id => {
      const { queryClient } = await import("/src/features/app/queryClient.ts");
      void queryClient.refetchQueries({ queryKey: ["project-worktrees", id] });
    }, FIXTURE_IDS.project);
    await expect.poll(() => requests).toBe(1);

    harness.archiveAllStreams();
    const refresh = page.getByRole("button", { name: "Refresh Workspace", exact: true });
    await refresh.click();
    await expect(row.getByText("archived", { exact: true })).toBeVisible();

    // Further runtime events must not wait for the outstanding worktree read.
    harness.restoreActiveStreams();
    harness.setProcessState(FIXTURE_IDS.workspaceShell, "exited");
    await expect(row.getByText("archived", { exact: true })).toHaveCount(0);
    harness.archiveAllStreams();
    harness.setProcessState(FIXTURE_IDS.workspaceShell, "running");
    await expect(row.getByText("archived", { exact: true })).toBeVisible();
    expect(requests).toBe(1);
    expect(failures).toEqual([]);

    release();
    await expect(refresh).toBeEnabled();
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    await expect.poll(() => requests).toBe(2);
    expect(failures).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-project-refresh-failure.png" }).catch(() => {});
    throw error;
  } finally {
    release();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("failed worktree checks leave Project records available and can be retried", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let failing = true;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-status-error" });
    await page.route(`**/api/projects/${FIXTURE_IDS.project}/worktrees`, async route => {
      if (failing) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Worktree check unavailable" } }) });
      else await route.continue();
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`)).toBeVisible();
    const alert = page.getByRole("alert").filter({ hasText: "Unable to load worktree status" });
    await expect(alert).toBeVisible();
    failing = false;
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

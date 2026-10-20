import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import type { SidebarFixture } from "./fixtures/types.ts";

for (const kind of ["workspace", "fork"] as const) {
  test(`a ${kind} 404 returns to its parent before evicting cached data`, async () => {
    const id = FIXTURE_IDS[kind];
    let fixture!: SidebarFixture;
    const harness = await startUiHarness(value => { fixture = value; });
    let page: Page | undefined;
    let deleted = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `missing-${kind}` });
      await page.route(`**/api/workspaces/${id}`, async route => {
        if (!deleted) { await route.fulfill({ json: fixture.workspaceDetails[id] }); return; }
        await gate;
        await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Workspace not found" } } });
      });
      await page.goto(`${harness.baseUrl}/#/workspaces/${id}`);
      const card = page.getByTestId(`workspace-location-${kind === "workspace" ? FIXTURE_IDS.workspacePrimaryLocation : FIXTURE_IDS.forkPrimaryLocation}`);
      await expect(card).toBeVisible();
      const repositoryId = fixture.workspaceDetails[id].repositories[0].id;
      await page.evaluate(async ({ id, repositoryId }) => {
        const { queryClient } = await import("/src/features/app/queryClient.ts");
        queryClient.setQueryData(["agent-review", id], { review_prompt: "stale", repositories: [] });
        queryClient.setQueryData(["git-history", "workspace", repositoryId], { commits: [] });
      }, { id, repositoryId });
      deleted = true;
      const request = page.waitForRequest(request => request.url().endsWith(`/workspaces/${id}`));
      await page.getByRole("button", { name: "Refresh Workspace", exact: true }).click();
      await request;
      // Until the server confirms absence, preserve the current page and data.
      await expect(card).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#/workspaces/${id}$`));
      release();
      const parent = kind === "fork" ? `/workspaces/${FIXTURE_IDS.workspace}` : `/projects/${FIXTURE_IDS.project}`;
      await expect(page).toHaveURL(new RegExp(`#${parent}$`));
      await expect(page.getByRole("status").filter({ hasText: "This item has been deleted." })).toHaveCount(1);
      await expect.poll(() => page!.evaluate(async ({ id, repositoryId }) => {
        const { queryClient } = await import("/src/features/app/queryClient.ts");
        return [["workspace", id], ["agent-review", id], ["git-history", "workspace", repositoryId]]
          .every(key => queryClient.getQueryData(key) === undefined);
      }, { id, repositoryId })).toBe(true);
      harness.assertNoUnexpectedRequests();
    } finally {
      release();
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("a missing Fork falls back through a missing parent to its Project", async () => {
  let fixture!: SidebarFixture;
  const harness = await startUiHarness(value => { fixture = value; });
  let page: Page | undefined;
  let deleted = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "missing-parent" });
    for (const id of [FIXTURE_IDS.fork, FIXTURE_IDS.workspace]) {
      await page.route(`**/api/workspaces/${id}`, route => route.fulfill(deleted
        ? { status: 404, json: { error: { code: "NOT_FOUND", message: "Workspace not found" } } }
        : { json: fixture.workspaceDetails[id] }));
    }
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await expect(page.getByTestId(`workspace-location-${FIXTURE_IDS.forkPrimaryLocation}`)).toBeVisible();
    deleted = true;
    await page.getByRole("button", { name: "Refresh Workspace", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${FIXTURE_IDS.project}$`));
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test("a temporary Workspace failure preserves the route and cached page for retry", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-retry" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const card = page.getByTestId(`workspace-location-${FIXTURE_IDS.workspacePrimaryLocation}`);
    await expect(card).toBeVisible();
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, route => route.fulfill({
      status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Temporary failure" } },
    }));
    const refresh = page.getByRole("button", { name: "Refresh Workspace", exact: true });
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`#/workspaces/${FIXTURE_IDS.workspace}$`));
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Close toast", exact: true }).click();
    await page.unroute(`**/api/workspaces/${FIXTURE_IDS.workspace}`);
    const request = page.waitForResponse(response => response.url().endsWith(`/workspaces/${FIXTURE_IDS.workspace}`) && response.status() === 200);
    await refresh.click();
    await request;
    await expect(card).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

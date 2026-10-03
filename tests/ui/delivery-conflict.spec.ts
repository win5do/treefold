import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

test("AI conflict resolution opens its Session and preserves delivery for manual return", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "delivery-conflict" });
    const response = await page.request.post(`${harness.apiUrl}/api/workspace-repositories/${FIXTURE_IDS.workspacePrimaryLocation}/parent-operation?direction=update`, { data: { strategy: "merge" } });
    expect(response.ok()).toBe(true);
    const operation = await response.json();
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`, route => route.fulfill({ json: {
      workspace_id: FIXTURE_IDS.workspace, status: "paused", continue_work: false,
      items: [{ repository_id: FIXTURE_IDS.workspacePrimaryLocation, repository_name: "fixture-repository", code_action: "local_merge", preflight_id: "conflict-preflight", delete_worktree: false, delete_branch: false, status: "blocked", delivered: false, cleaned: false, operation_id: operation.id }],
    } }));
    const openDelivery = async () => {
      await page!.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      await openUiContextMenu(page!, page!.getByTestId("sidebar-workspace-node"));
      await page!.getByTestId("finish-workspace-action").click();
    };
    await openDelivery();
    const dialog = page.getByRole("dialog", { name: "Deliver Workspace", exact: true });
    await dialog.getByRole("button", { name: "Resolve with AI", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}/sessions/parent-resolver-session-ui-fixture$`));
    await expect(dialog).not.toBeVisible();
    await openDelivery();
    await expect(dialog.getByRole("button", { name: "Open Session", exact: true })).toBeVisible();
    expect(harness.parentOperationRequests.filter(request => request.endsWith(":resolve-with-agent"))).toHaveLength(1);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

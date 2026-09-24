import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { beginUiPointerDrag, closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

test("Session rename and drag order persist in their owning Workspace", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-sessions" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`);
    const children = page.getByTestId("sidebar-workspace-children");
    const shell = children.getByTestId(`sidebar-session-${FIXTURE_IDS.workspaceShell}`);
    const agent = children.getByTestId(`sidebar-session-${FIXTURE_IDS.workspaceCodex}`);
    await openUiContextMenu(page, shell);
    await page.getByTestId("session-context-menu").getByTestId("rename-session-action").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("Renamed Shell");
    await dialog.getByTestId("rename-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(shell).toContainText("Renamed Shell");
    expect(harness.renameRequests.at(-1)).toEqual({ kind: "session", id: FIXTURE_IDS.workspaceShell, name: "Renamed Shell" });
    for (const session_ids of [
      [FIXTURE_IDS.workspaceCodex, FIXTURE_IDS.workspaceShell, FIXTURE_IDS.sessionDevServer],
      [FIXTURE_IDS.workspaceShell, FIXTURE_IDS.workspaceCodex, FIXTURE_IDS.sessionDevServer],
    ]) {
      const release = await beginUiPointerDrag(page, agent, shell);
      await release();
      await expect.poll(() => harness.sessionOrderRequests.at(-1)).toEqual({ workspaceId: FIXTURE_IDS.workspace, session_ids });
      const response = await page.request.get(`${harness.apiUrl}/api/workspaces/${FIXTURE_IDS.workspace}`);
      expect((await response.json()).sessions.map((session: { id: string }) => session.id)).toEqual(session_ids);
    }
    await page.reload();
    await expect(shell).toContainText("Renamed Shell");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Workspace rename saves its name and description and refreshes navigation", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-rename" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const node = page.getByTestId("sidebar-workspace-node");
    await openUiContextMenu(page, node);
    await page.getByTestId("rename-node-action").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("Renamed Workspace");
    await dialog.locator('textarea[name="description"]').fill("Updated description");
    await dialog.getByTestId("rename-submit").click();
    await expect(dialog).toHaveCount(0);
    await expect(node.getByTestId("sidebar-node-name")).toHaveText("Renamed Workspace");
    expect(harness.renameRequests.at(-1)).toEqual({ kind: "workspace", id: FIXTURE_IDS.workspace, name: "Renamed Workspace", description: "Updated description" });
    await page.reload();
    await expect(page.getByTestId("breadcrumb-workspace")).toHaveText("Renamed Workspace");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

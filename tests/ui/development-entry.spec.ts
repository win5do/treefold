import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("development pages open creation flows in their owning scope", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "development-entry" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByTestId("project-workspaces-section").getByRole("button", { name: "New Workspace", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "New Workspace", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByTestId("workspace-forks-section").getByRole("button", { name: "New Fork", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    for (const id of [FIXTURE_IDS.workspace, FIXTURE_IDS.fork]) {
      await page.goto(`${harness.baseUrl}/#/workspaces/${id}`);
      await page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
      await expect(dialog.getByRole("button", { name: "Shell", exact: true })).toBeFocused();
      await expect(dialog.getByRole("button", { name: "Create Session", exact: true })).toBeEnabled();
      const request = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/workspaces/${id}/sessions`));
      await dialog.getByRole("button", { name: "Create Session", exact: true }).click();
      expect((await request).postDataJSON()).toMatchObject({ kind: "shell" });
      await expect(page).toHaveURL(new RegExp(`/workspaces/${id}/sessions/`));
    }
    harness.archiveAllStreams();
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.reload();
    await expect(page.getByTestId("workspace-sessions-section")).toBeVisible();
    await expect(page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("workspace-forks-section").getByRole("button", { name: "New Fork", exact: true })).toHaveCount(0);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS, FIXTURE_NAMES } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";
import { expectAnchoredOverlay } from "./overlay-assertions.ts";

test("sidebar New Session opens the chooser and enforces directory permissions", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-creation", windowSize: "1000,420" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const trigger = page.getByTestId("sidebar-project-action");
    const menu = page.getByTestId("sidebar-session-menu");
    await trigger.click();
    await page.getByTestId("page-content").click();
    await expect(menu).toHaveCount(0);
    await trigger.focus();
    await trigger.press("Enter");
    await expectAnchoredOverlay(menu, trigger);
    await page.screenshot({ path: "/tmp/treefold-sidebar-creation-menu.png", animations: "disabled" });
    const newSession = menu.getByRole("menuitem", { name: "New Session", exact: true });
    await newSession.focus();
    await newSession.press("Enter");
    const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
    await expect(dialog.getByRole("button", { name: "Shell", exact: true })).toBeFocused();
    await expect(menu).toHaveCount(0);
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /fixture-documentation/ })).toBeDisabled();
    await dialog.getByRole("button", { name: "Shell", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /fixture-documentation/ })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await newSession.click();
    await dialog.getByRole("button", { name: /fixture-api-repository/ }).click();
    const created = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/projects/${FIXTURE_IDS.project}/sessions`));
    await dialog.getByRole("button", { name: "Create Session", exact: true }).click();
    expect((await created).postDataJSON()).toEqual({ kind: "shell", project_directory_id: FIXTURE_IDS.secondaryDirectory });
    await expect(page).toHaveURL(new RegExp(`/projects/${FIXTURE_IDS.project}/sessions/`));
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-sidebar-creation-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

for (const owner of ["workspace", "fork"] as const) {
  for (const entry of ["plus", "context"] as const) {
    test(`sidebar ${entry} creates a Session in the clicked ${owner}`, async () => {
      const harness = await startUiHarness();
      let page: Page | undefined;
      try {
        page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `sidebar-${owner}-${entry}` });
        // Keep the current route on the Project to catch accidental shortcut-scope reuse.
        await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
        await page.getByRole("button", { name: `Expand Project ${FIXTURE_NAMES.project}`, exact: true }).click();
        if (owner === "fork") {
          await page.getByRole("button", { name: `Expand Workspace ${FIXTURE_NAMES.workspace}`, exact: true }).click();
        }
        const node = page.getByTestId(`sidebar-${owner}-node`);
        if (entry === "context") await openUiContextMenu(page, node);
        else await node.getByTestId("sidebar-node-action").click();
        await page.getByRole("menuitem", { name: "New Session", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
        await expect(dialog).toContainText(FIXTURE_NAMES[owner]);
        await dialog.getByRole("button", { name: /fixture-api-repository/ }).click();
        const created = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/workspaces/${FIXTURE_IDS[owner]}/sessions`));
        await dialog.getByRole("button", { name: "Create Session", exact: true }).click();
        expect((await created).postDataJSON()).toEqual({ kind: "shell", project_directory_id: FIXTURE_IDS.secondaryDirectory });
        await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS[owner]}/sessions/`));
        harness.assertNoUnexpectedRequests();
      } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
    });
  }
}

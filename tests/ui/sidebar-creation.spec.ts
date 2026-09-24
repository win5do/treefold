import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, moveUiPointerTo } from "./harness/session.ts";
import { expectAnchoredOverlay } from "./overlay-assertions.ts";

test("sidebar creation submenu is reachable and enforces directory permissions", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-creation", windowSize: "1000,420" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const trigger = page.getByTestId("sidebar-project-action");
    const menu = page.getByTestId("sidebar-session-menu");
    const submenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await trigger.click();
    await moveUiPointerTo(page, menu.getByTestId("session-kind-codex"));
    await expect(submenu.getByTestId(`session-directory-${FIXTURE_IDS.attachedDirectory}`)).toBeDisabled();
    await page.getByTestId("page-content").click();
    await expect(menu).toHaveCount(0);
    // The same menu must be usable from the keyboard after an outside dismissal.
    await trigger.focus();
    await trigger.press("Enter");
    const shell = menu.getByTestId("session-kind-shell");
    await shell.focus();
    await expect(submenu).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await moveUiPointerTo(page, shell);
    await expectAnchoredOverlay(submenu, shell);
    await page.screenshot({ path: "/tmp/treefold-sidebar-creation-submenu.png", animations: "disabled" });
    const directory = submenu.getByTestId(`session-directory-${FIXTURE_IDS.primaryDirectory}`);
    await moveUiPointerTo(page, directory);
    const created = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/projects/${FIXTURE_IDS.project}/sessions`));
    await directory.click();
    expect((await created).postDataJSON()).toEqual({ kind: "shell", project_directory_id: FIXTURE_IDS.primaryDirectory });
    await expect(page).toHaveURL(new RegExp(`/projects/${FIXTURE_IDS.project}/sessions/`));
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-sidebar-creation-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

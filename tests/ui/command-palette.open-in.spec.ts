import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession, openInRequests } from "./harness/session.ts";
import { expectAnchoredOverlay, expectReachableOverlay } from "./overlay-assertions.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

const apps = [
  { id: "finder", label: "Finder", group: "fileManager" as const },
  { id: "vscode", label: "VS Code", group: "editor" as const },
];

test("palette hands Open With to an independent keyboard menu and Escape restores focus", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-open", openInApps: apps, windowSize: "640,480" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await expect(page.getByTestId("page-content")).toBeVisible();
    const settings = page.getByTestId("open-settings");
    await settings.focus();
    await page.keyboard.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
    const search = palette.getByRole("combobox");
    await search.fill("directory.open.with");
    await search.press("ArrowLeft");
    expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe("directory.open.with".length - 1);
    await search.press("ArrowRight");
    expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe("directory.open.with".length);
    await search.press("Enter");
    // Closing the Palette transfers keyboard ownership to the independent menu.
    await expect(palette).toHaveCount(0);
    const menu = page.getByRole("menu", { name: "Open With", exact: true });
    await expect(menu.getByRole("menuitem", { name: "fixture-repository · .", exact: true })).toBeFocused();
    await expectReachableOverlay(menu);
    await page.keyboard.press("ArrowDown");
    const directory = menu.getByRole("menuitem", { name: "fixture-repository · apps/web", exact: true });
    await expect(directory).toBeFocused();
    await page.keyboard.press("Enter");
    const appsMenu = page.getByRole("menu", { name: "fixture-repository · apps/web", exact: true });
    await expect(appsMenu.getByRole("menuitem", { name: "Finder", exact: true })).toBeFocused();
    await expectAnchoredOverlay(appsMenu, directory);
    await page.screenshot({ path: "/tmp/treefold-palette-independent-menu.png", animations: "disabled" });
    await page.keyboard.press("ArrowDown");
    await expect(appsMenu.getByRole("menuitem", { name: "VS Code", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(appsMenu.getByRole("menuitem", { name: "Finder", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(appsMenu).toBeHidden();
    await expect(directory).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(appsMenu.getByRole("menuitem", { name: "Finder", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(appsMenu).toHaveCount(0);
    await expect(settings).toBeFocused();
    // Reopening uses a fresh menu, and clicking outside cancels without executing.
    await page.keyboard.press("Meta+Shift+p");
    await palette.getByRole("option", { name: "Open With", exact: true }).click();
    await expect(menu).toBeVisible();
    // The modal menu backdrop receives this physical click over the page heading.
    await page.getByRole("heading", { level: 1 }).click({ force: true });
    await expect(menu).toHaveCount(0);
    expect(await openInRequests(page)).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-palette-independent-menu-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

for (const owner of [
  { name: "Project", path: `projects/${FIXTURE_IDS.project}`, directory: "/tmp/treefold-ui-fixture/repository-with-a-long-readable-path/apps/web" },
  { name: "Workspace", path: `workspaces/${FIXTURE_IDS.workspace}`, directory: "/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture/apps/web" },
  { name: "Fork", path: `workspaces/${FIXTURE_IDS.fork}`, directory: "/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture/apps/web" },
]) {
  test(`palette opens the selected ${owner.name} directory in the chosen app after navigation`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-open-target", openInApps: apps });
      await page.goto(`${harness.baseUrl}/#/${owner.path}`);
      await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
      await palette.getByRole("option", { name: "Open With", exact: true }).click();
      await expect(palette).toHaveCount(0);
      await page.getByRole("menuitem", { name: "fixture-repository · apps/web", exact: true }).click();
      const app = page.getByRole("menuitem", { name: "VS Code", exact: true });
      await expect(app).toBeVisible();
      await page.keyboard.press("v");
      await expect(app).toBeFocused();
      await page.evaluate(() => { window.location.hash = "#/projects"; });
      await expect(page).toHaveURL(/#\/projects$/);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect.poll(() => openInRequests(page!)).toEqual([{ id: "vscode", directory: owner.directory }]);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("palette skips a single directory and reports application launch failures", async () => {
  const harness = await startUiHarness((fixture) => {
    const project = fixture.projectDetails[FIXTURE_IDS.project];
    project.directories = [project.directories[0]];
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-open-single", openInApps: apps, openInError: "Application was removed" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId("page-content")).toBeVisible();
    await page.keyboard.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
    await palette.getByRole("option", { name: "Open With", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Finder", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await expect.poll(() => openInRequests(page!)).toEqual([{ id: "finder", directory: "/tmp/treefold-ui-fixture/repository-with-a-long-readable-path" }]);
    await expect(page.getByRole("alert")).toContainText("Application was removed");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

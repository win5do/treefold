import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession, openInRequests } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

const apps = [
  { id: "finder", label: "Finder", group: "fileManager" as const },
  { id: "vscode", label: "VS Code", group: "editor" as const },
];

test("palette navigates directory and app choices, restores the parent, and closes on Escape", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-open", openInApps: apps });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const settings = page.getByTestId("open-settings");
    await settings.focus();
    await page.keyboard.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
    const search = palette.getByRole("combobox");
    await palette.getByRole("option", { name: "Open With", exact: true }).click();
    await search.press("ArrowLeft");
    await expect(search).toHaveValue("");
    await expect(palette.getByRole("option", { name: "Open With", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.fill("directory.open.with");
    await search.press("ArrowRight");
    await expect(palette.getByRole("listbox", { name: "Open With", exact: true })).toBeVisible();
    await search.fill("apps/web");
    const directory = palette.getByRole("option", { name: "fixture-repository · apps/web", exact: true });
    await expect(directory).toHaveAttribute("aria-selected", "true");
    await search.press("Enter");
    await expect(directory).toBeVisible();
    await search.press("ArrowRight");
    await expect(palette.getByRole("option", { name: "Finder", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowDown");
    await expect(palette.getByRole("option", { name: "VS Code", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowUp");
    await expect(palette.getByRole("option", { name: "Finder", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowLeft");
    await expect(search).toHaveValue("apps/web");
    await expect(directory).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowRight");
    await expect(palette.getByRole("option", { name: "Finder", exact: true })).toBeVisible();
    await search.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(settings).toBeFocused();
    expect(await openInRequests(page)).toEqual([]);
    harness.assertNoUnexpectedRequests();
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
      await palette.getByRole("option", { name: "fixture-repository · apps/web", exact: true }).click();
      await palette.getByRole("combobox").fill("VS Code");
      await expect(palette.getByRole("option", { name: "VS Code", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.evaluate(() => { window.location.hash = "#/projects"; });
      await expect(page).toHaveURL(/#\/projects$/);
      await palette.getByRole("combobox").press("Enter");
      await expect(palette).toHaveCount(0);
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
    await palette.getByRole("option", { name: "Finder", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await expect.poll(() => openInRequests(page!)).toEqual([{ id: "finder", directory: "/tmp/treefold-ui-fixture/repository-with-a-long-readable-path" }]);
    await expect(page.getByRole("alert")).toContainText("Application was removed");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

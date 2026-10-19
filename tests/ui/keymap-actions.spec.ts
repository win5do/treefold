import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession, openInRequests } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("Keymap exposes unbound actions and their recorded shortcuts execute in context", async () => {
  const harness = await startUiHarness((fixture) => { fixture.settings.language = "zh-CN"; });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "keymap-actions", openInApps: [
      { id: "finder", label: "Finder", group: "fileManager" },
    ] });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByTestId("open-settings").click();
    await page.getByRole("button", { name: "快捷键", exact: true }).click();
    for (const id of ["app.settings.open", "app.projects.open", "app.leftSidebar.toggle", "app.rightSidebar.toggle", "git.sync.push", "git.sync.pull", "directory.open.with", "workspace.review.open"]) {
      await expect(page.getByTestId(`keymap-${id}`)).toContainText("未绑定");
    }
    for (const [id, name, key] of [
      ["directory.open.with", "打开方式", "o"],
      ["git.sync.push", "推送", "p"],
      ["git.sync.pull", "拉取", "l"],
      ["app.projects.open", "打开 Project 列表", "g"],
    ]) {
      await page.getByRole("button", { name: `录入 ${name}`, exact: true }).click();
      await page.getByRole("textbox", { name: `录入 ${name}`, exact: true }).press(`Control+${key}`);
      await expect(page.getByTestId(`keymap-${id}`)).toContainText(`ctrl ${key.toUpperCase()}`);
    }
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("page-content")).toBeVisible();
    await page.keyboard.press("Control+o");
    const open = page.getByRole("menu", { name: "打开方式", exact: true });
    await expect(open.getByRole("menuitem", { name: "fixture-repository · .", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Finder", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => openInRequests(page!)).toEqual([{ id: "finder", directory: "/tmp/treefold-ui-fixture/repository-with-a-long-readable-path" }]);
    for (const [key, name, operation] of [["p", "推送", "push"], ["l", "拉取", "pull"]]) {
      await page.keyboard.press(`Control+${key}`);
      const menu = page.getByRole("menu", { name, exact: true });
      await expect(menu.getByRole("menuitem").first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect.poll(() => harness.syncRequests.at(-1)).toBe(`/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git/${operation}`);
      await expect(menu).toHaveCount(0);
    }
    await page.keyboard.press("Control+g");
    await expect(page).toHaveURL(/#\/projects$/);
    // The hash updates before React replaces the previous route's page-content.
    await expect(page.getByTestId("page-content").getByRole("heading", { name: "概览", exact: true })).toBeVisible();
    // Contextual bindings must stay inactive outside a Project or Workspace.
    await page.keyboard.press("Control+o");
    await page.keyboard.press("Control+p");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(harness.syncRequests).toHaveLength(2);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

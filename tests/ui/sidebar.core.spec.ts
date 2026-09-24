import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS, FIXTURE_NAMES } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { beginUiPointerDrag, closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

test("sidebar navigation preserves hierarchy and excludes archived records", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-navigation" });
    await page.goto(harness.baseUrl);
    const sidebar = page.getByTestId("workspace-sidebar");
    await expect(page.getByTestId("breadcrumb-projects")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sidebar-projects-link")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Show right sidebar", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: `Expand Project ${FIXTURE_NAMES.project}`, exact: true }).click();
    await page.getByRole("button", { name: `Expand Workspace ${FIXTURE_NAMES.workspace}`, exact: true }).click();
    await expect(sidebar.getByTestId("sidebar-fork-node")).toBeVisible();
    await expect(sidebar).not.toContainText(FIXTURE_NAMES.archivedWorkspace);
    await expect(sidebar).not.toContainText(FIXTURE_NAMES.archivedFork);
    await sidebar.getByRole("button", { name: FIXTURE_NAMES.workspace, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
    await expect(page.getByTestId("breadcrumb-workspace")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("breadcrumb-project")).toHaveText(FIXTURE_NAMES.project);
    await expect(page.getByTestId("sidebar-projects-link")).not.toHaveAttribute("aria-current", "page");

    await openUiContextMenu(page, sidebar.getByTestId("sidebar-workspace-node"));
    const menu = page.getByTestId("directory-session-context-menu");
    await expect(menu.getByTestId("archive-project-action")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await sidebar.getByRole("button", { name: FIXTURE_NAMES.fork, exact: true }).click();
    await expect(page.getByTestId("breadcrumb-fork")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("breadcrumb-workspace")).toHaveText(FIXTURE_NAMES.workspace);
    await openUiContextMenu(page, sidebar.getByTestId("sidebar-fork-node"));
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("sidebar-pull-menu")).toHaveCount(0);
    await expect(menu.getByTestId("archive-project-action")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("breadcrumb-workspace").click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
    await page.getByRole("button", { name: `Collapse Workspace ${FIXTURE_NAMES.workspace}`, exact: true }).click();
    await expect(sidebar.getByTestId("sidebar-fork-node")).toHaveCount(0);
    await page.getByRole("button", { name: `Expand Workspace ${FIXTURE_NAMES.workspace}`, exact: true }).click();
    await expect(sidebar.getByTestId("sidebar-fork-node")).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("sidebar width respects the keyboard limit and persists pointer resizing", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-resize" });
    await page.goto(harness.baseUrl);
    const handle = page.getByTestId("sidebar-resize-handle");
    await handle.click();
    for (let index = 0; index < 20; index++) await page.keyboard.press("ArrowLeft");
    const savedWidth = () => page!.evaluate(() => Number(localStorage.getItem("treefold.sidebar.width")));
    await expect.poll(savedWidth).toBe(240);
    const release = await beginUiPointerDrag(page, handle, { x: 80, y: 0 });
    await release();
    await expect.poll(savedWidth).toBeGreaterThanOrEqual(300);
    const width = await savedWidth();
    await page.reload();
    await expect(handle).toBeVisible();
    expect(await savedWidth()).toBe(width);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

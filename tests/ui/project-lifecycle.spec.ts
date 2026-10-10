import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu, openProjectPath } from "./harness/session.ts";

test("Project creation imports only the selected discovered locations", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-create" });
    await page.goto(harness.baseUrl);
    await page.getByTestId("new-project-action").click();
    const dialog = page.getByRole("dialog", { name: /^New Project/ });
    await dialog.getByRole("option", { name: "Local path", exact: true }).click();
    await dialog.locator('input[name="name"]').fill("Multi repo fixture");
    await dialog.locator("#project-path").fill("/tmp/treefold-ui-fixture/multi-repo");
    await expect(dialog.getByRole("checkbox", { name: /backend/ })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /docs/ })).toBeChecked();
    await dialog.getByRole("radio", { name: /frontend/ }).check();
    await dialog.getByRole("checkbox", { name: /frontend/ }).uncheck();
    await expect(dialog.getByRole("radio", { name: /backend/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    expect(harness.locationRequests).toEqual([]);
    await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(harness.locationRequests.map(({ path, isGit }) => ({ path, isGit }))).toEqual([
      { path: "/tmp/treefold-ui-fixture/multi-repo/backend", isGit: true },
      { path: "/tmp/treefold-ui-fixture/multi-repo/docs", isGit: false },
    ]);
    expect(harness.projectCreation.createRequests[0]).toMatchObject({ open_path: "/tmp/treefold-ui-fixture/multi-repo" });
    await page.goto(harness.baseUrl);
    await page.getByTestId("open-settings").waitFor();
    await openProjectPath(page, "/tmp/treefold-ui-fixture/multi-repo");
    await expect(page).toHaveURL(/#\/projects\/project-created-primary-requirement$/);
    expect(harness.projectCreation.createRequests).toHaveLength(1);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Project archive waits for active children and restore re-enables editing", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-archive" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const project = page.getByTestId("sidebar-project-link");
    await openUiContextMenu(page, project);
    await page.getByTestId("archive-project-action").click();
    await expect(page.getByRole("alert")).toContainText("Finish active Workspaces and Forks");
    await expect(project).toBeVisible();
    harness.archiveAllStreams();
    await page.keyboard.press("Escape");
    await openUiContextMenu(page, project);
    await page.getByTestId("archive-project-action").click();
    await expect(project).toHaveCount(0);
    const row = page.getByTestId("project-overview-row");
    await expect(row).toHaveAttribute("data-project-status", "archived");
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId("page-content")).toContainText(/archived · read-only/i);
    await expect(page.getByTestId("project-add-location")).toHaveCount(0);
    for (const id of [`project-directory-actions-${FIXTURE_IDS.primaryDirectory}`, `project-location-actions-${FIXTURE_IDS.attachedDirectory}`]) {
      await page.getByTestId(`${id}-trigger`).click();
      await expect(page.getByTestId(id).getByRole("menuitem")).toHaveText(["Open With"]);
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("breadcrumb-projects").click();
    await row.getByTestId("project-actions-trigger").click();
    await page.getByTestId("restore-project-action").click();
    await expect(project).toBeVisible();
    await expect(row).toHaveAttribute("data-project-status", "active");
    await row.getByTestId("project-actions-trigger").click();
    await expect(page.getByTestId("delete-project-action")).toHaveAttribute("data-blocked", "true");
    await page.getByTestId("delete-project-action").click();
    await expect(page.getByRole("status", { name: /Archive Project/i })).toContainText(/Archive Project/i);
    expect(harness.deleteRequests).toEqual([]);
    await page.keyboard.press("Escape");
    await project.click();
    await expect(page.getByTestId("project-add-location")).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

for (const cleanupManaged of [true, false]) {
  test(`Project deletion ${cleanupManaged ? "cleans managed" : "preserves local"} files only after confirmation`, async () => {
    const harness = await startUiHarness();
    harness.setProjectStatus(FIXTURE_IDS.project, "archived");
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-delete" });
      await page.goto(harness.baseUrl);
      const row = page.getByTestId("project-overview-row");
      await row.getByTestId("project-actions-trigger").click();
      await page.getByTestId("delete-project-action").click();
      const dialog = page.getByTestId("delete-record-dialog");
      await expect(dialog.getByTestId("delete-project-cleanup-ready")).toContainText(/1 managed source.*1 managed worktree/i);
      expect(harness.deleteRequests).toEqual([]);
      if (!cleanupManaged) await dialog.getByTestId("delete-project-preserve").click();
      await dialog.getByRole("button", { name: "Permanently delete", exact: true }).click();
      await expect(row).toHaveCount(0);
      expect(harness.deleteRequests).toEqual([{ kind: "project", id: FIXTURE_IDS.project, cleanupManaged }]);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

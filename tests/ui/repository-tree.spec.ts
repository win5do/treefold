import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { clickUiElement, closeUiSession, createUiSession } from "./harness/session.ts";

test("repository groups collapse independently and directory edits preserve ownership", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "repository-tree" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const id = FIXTURE_IDS.primaryRepository;
    const repository = page.getByTestId(`project-location-${id}`);
    const directories = repository.getByTestId(`project-repository-directories-${id}`);
    const worktrees = repository.getByTestId(`project-repository-worktrees-${id}`);
    await expect(directories.getByTestId(`project-directory-${FIXTURE_IDS.primaryDirectory}`)).toBeVisible();
    await expect(directories.getByTestId(`project-directory-${FIXTURE_IDS.monorepoDirectory}`)).toBeVisible();
    await repository.getByTestId(`project-repository-directories-${id}-toggle`).click();
    await expect(directories).toHaveCount(0);
    await expect(worktrees).toBeVisible();
    await repository.getByTestId(`project-repository-directories-${id}-toggle`).click();
    await repository.getByTestId(`project-repository-worktrees-${id}-toggle`).click();
    await expect(worktrees).toHaveCount(0);
    await expect(directories).toBeVisible();
    await repository.getByTestId(`project-location-toggle-${id}`).click();
    await expect(directories).toHaveCount(0);
    await expect(repository.getByTestId(`project-location-toggle-${id}`)).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId(`project-location-toggle-${FIXTURE_IDS.secondaryRepository}`).click();
    const directory = page.getByTestId(`project-directory-${FIXTURE_IDS.secondaryDirectory}`);
    await clickUiElement(page, directory.getByTestId(`project-directory-actions-${FIXTURE_IDS.secondaryDirectory}-trigger`));
    await page.getByTestId(`project-directory-edit-${FIXTURE_IDS.secondaryDirectory}`).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("renamed source scope");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(directory).toContainText("renamed source scope");
    const response = await page.request.get(`${harness.apiUrl}/api/projects/${FIXTURE_IDS.project}`);
    expect((await response.json()).directories.find((item: { id: string }) => item.id === FIXTURE_IDS.secondaryDirectory))
      .toMatchObject({ name: "renamed source scope", repository_id: FIXTURE_IDS.secondaryRepository });
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("adding locations attaches only the confirmed Git and context directories", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-locations" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByTestId("project-add-location").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#project-location-path").fill("/tmp/treefold-ui-fixture/additional-locations");
    await expect(dialog.getByRole("checkbox", { name: /new-api-repository/ })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /reference-context/ })).toBeChecked();
    await dialog.getByRole("checkbox", { name: /unused-repository/ }).uncheck();
    await dialog.getByRole("button", { name: "Add 2 locations", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(harness.locationRequests).toEqual([
      { projectId: FIXTURE_IDS.project, path: "/tmp/treefold-ui-fixture/new-api-repository", isGit: true },
      { projectId: FIXTURE_IDS.project, path: "/tmp/treefold-ui-fixture/reference-context", isGit: false },
    ]);
    await expect(page.getByTestId("page-content")).toContainText("new-api-repository");
    await expect(page.getByTestId("page-content")).toContainText("reference-context");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { clickUiElement, closeUiSession, createUiSession, moveUiPointerTo } from "./harness/session.ts";

for (const scope of [
  { name: "Project", route: `projects/${FIXTURE_IDS.project}`, node: "sidebar-project-node", repository: FIXTURE_IDS.primaryRepository, api: "project-repositories" },
  { name: "Workspace", route: `workspaces/${FIXTURE_IDS.workspace}`, node: "sidebar-workspace-node", repository: FIXTURE_IDS.workspacePrimaryLocation, api: "workspace-repositories" },
]) {
  test(`${scope.name} sync scopes repository actions and reports bulk failures`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "repository-sync" });
      await page.goto(`${harness.baseUrl}/#/${scope.route}`);
      const trigger = page.getByTestId(scope.node).getByTestId("sidebar-node-menu-trigger");
      await moveUiPointerTo(page, page.getByTestId(scope.node));
      await trigger.click();
      await moveUiPointerTo(page, page.getByTestId("sidebar-push-menu"));
      await page.getByTestId(`sidebar-push-${scope.repository}`).click();
      await expect.poll(() => harness.syncRequests.at(-1)).toBe(`/api/${scope.api}/${scope.repository}/git/push`);
      await expect(page.getByRole("status")).toContainText("Push succeeded");
      await page.keyboard.press("Escape");
      harness.setNextBulkSyncResults([{ project_repository_id: FIXTURE_IDS.primaryRepository, repository_name: "fixture-repository", status: "failed", error: "remote rejected the update" }]);
      await moveUiPointerTo(page, page.getByTestId(scope.node));
      await trigger.click();
      await moveUiPointerTo(page, page.getByTestId("sidebar-pull-menu"));
      await page.getByTestId("sidebar-pull-all").click();
      await expect.poll(() => harness.syncRequests.at(-1)).toBe(`/api/${scope.route}/git/pull-all`);
      await expect(page.getByRole("alert").filter({ hasText: "remote rejected the update" })).toContainText("fixture-repository: remote rejected the update");
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("Workspace upstream edits and clearing update the selected repository", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-upstream" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const id = FIXTURE_IDS.workspacePrimaryLocation;
    const repository = page.getByTestId(`workspace-location-${id}`);
    await clickUiElement(page, page.getByTestId(`workspace-location-actions-${id}-trigger`));
    await page.getByTestId(`workspace-location-upstream-${id}`).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="remote_branch"]').fill("feature/updated-fixture");
    await dialog.getByRole("button", { name: "Save upstream", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(repository).toContainText("origin/feature/updated-fixture");
    expect(harness.workspaceLocationUpdates.at(-1)).toEqual({ id, remote_name: "origin", remote_branch: "feature/updated-fixture" });
    await clickUiElement(page, page.getByTestId(`workspace-location-actions-${id}-trigger`));
    await page.getByTestId(`workspace-location-clear-upstream-${id}`).click();
    await expect.poll(() => harness.workspaceLocationUpdates.at(-1)).toEqual({ id, remote_name: undefined, remote_branch: undefined });
    await expect(repository).not.toContainText("origin/feature/updated-fixture");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Repository settings persist setup commands and the selected delivery remote", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "repository-settings" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const id = FIXTURE_IDS.primaryRepository;
    await page.getByTestId(`project-location-actions-${id}-trigger`).click();
    await page.getByTestId(`project-repository-edit-${id}`).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Worktree setup command", exact: true }).fill("npm install && npm run prepare");
    await dialog.locator('select[name="base_remote"]').selectOption("origin");
    await dialog.getByRole("button", { name: "Save repository", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(harness.repositoryUpdateRequests.at(-1)).toMatchObject({ id, setup_command: "npm install && npm run prepare", preferred_remote_name: "origin" });
    await page.reload();
    await page.getByTestId(`project-location-actions-${id}-trigger`).click();
    await page.getByTestId(`project-repository-edit-${id}`).click();
    await expect(dialog.getByRole("textbox", { name: "Worktree setup command", exact: true })).toHaveValue("npm install && npm run prepare");
    await expect(dialog.locator('select[name="base_remote"]')).toHaveValue("origin");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

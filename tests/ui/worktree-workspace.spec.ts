import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("worktree opens its Workspace or creates one from its exact path", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "worktree-workspace" });
    const requests: { path: string }[] = [];
    let reject = true;
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/worktrees/workspace`, async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: reject ? 400 : 200,
        contentType: "application/json",
        body: JSON.stringify(reject
          ? { error: { code: "BAD_REQUEST", message: "Fixture worktree unavailable" } }
          : { id: FIXTURE_IDS.workspace }),
      });
    });
    const openProject = async () => {
      await page!.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
      const toggle = page!.getByTestId(`project-repository-worktrees-${FIXTURE_IDS.primaryRepository}-toggle`);
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      return page!.getByTestId(`project-location-${FIXTURE_IDS.primaryRepository}`);
    };
    let repository = await openProject();
    const mainCheckout = repository.getByTestId("project-worktree-row").filter({ hasText: "Main checkout" });
    await expect(mainCheckout).toHaveCount(1);
    await expect(mainCheckout.getByRole("button", { name: /^Open or create Workspace for / })).toHaveCount(0);
    await repository.getByRole("button", { name: /^Open Workspace for / }).first().click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
    expect(requests).toEqual([]);

    repository = await openProject();
    const row = repository.getByTestId("project-worktree-row").filter({ hasText: "unmanaged-worktree" });
    const path = await row.locator("code").textContent();
    const create = row.getByRole("button", { name: /^Open or create Workspace for / });
    await create.click();
    await expect(page.getByRole("alert")).toContainText("Fixture worktree unavailable");
    await expect(create).toBeEnabled();
    expect(requests).toEqual([{ path }]);
    reject = false;
    await create.click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
    expect(requests).toEqual([{ path }, { path }]);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-worktree-workspace-failure.png" });
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

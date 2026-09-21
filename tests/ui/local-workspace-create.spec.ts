import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const scenario of ["local", "mixed", "keep"] as const) {
  test(`Workspace setup supports ${scenario} repositories`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `workspace-${scenario}` });
      await page.route(`**/api/projects/${FIXTURE_IDS.project}`, async route => {
        const response = await route.fetch();
        const data = await response.json();
        for (const repository of data.repositories) {
          repository.base_branch = null;
          repository.preferred_remote_name = null;
          repository.delivery_mode = scenario === "keep" ? "keep" : "push_branch";
        }
        await route.fulfill({ response, json: data });
      });
      await page.route("**/api/project-repositories/*/branches", async route => {
        const remote = scenario === "mixed" && route.request().url().includes(FIXTURE_IDS.secondaryRepository);
        await route.fulfill({ json: { current: "main", local: ["main"], remotes: remote ? [{ name: "origin", branches: ["main"] }] : [] } });
      });
      let workspaceRequest: Record<string, unknown> | undefined;
      await page.route(`**/api/projects/${FIXTURE_IDS.project}/workspaces`, async route => {
        workspaceRequest = route.request().postDataJSON();
        const response = await page!.request.get(`${harness.apiUrl}/api/workspaces/${FIXTURE_IDS.workspace}`);
        await route.fulfill({ status: 201, json: await response.json() });
      });
      await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
      await page.getByTestId("project-workspaces-section").getByRole("button", { name: "New Workspace", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New Workspace", exact: true });
      const mode = (id: string) => dialog.locator(`select[name="delivery_mode:${id}"]`);
      await expect(mode(FIXTURE_IDS.primaryRepository)).toHaveValue(scenario === "keep" ? "keep" : "local_merge");
      await expect(mode(FIXTURE_IDS.secondaryRepository)).toHaveValue(scenario === "mixed" ? "push_branch" : scenario === "keep" ? "keep" : "local_merge");
      await expect(dialog.getByRole("button", { name: "Create Workspace", exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: "Create Workspace", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
      expect(workspaceRequest).toMatchObject({ remote_name: null, remote_branch: null });
      for (const id of [FIXTURE_IDS.primaryRepository, FIXTURE_IDS.secondaryRepository]) {
        const remote = scenario === "mixed" && id === FIXTURE_IDS.secondaryRepository;
        expect(harness.repositoryBaseRequests).toContainEqual({ id, branch: "main", remote: remote ? "origin" : null });
        expect(harness.repositoryUpdateRequests).toContainEqual({ id, base_branch: "main", delivery_mode: remote ? "push_branch" : scenario === "keep" ? "keep" : "local_merge" });
      }
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

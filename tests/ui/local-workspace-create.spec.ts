import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const scenario of ["local", "mixed", "default", "preferred", "unset"] as const) {
  test(`Workspace setup supports ${scenario} repositories`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `workspace-${scenario}` });
      await page.route(url => url.pathname === `/api/projects/${FIXTURE_IDS.project}`, async route => {
        const response = await route.fetch();
        const data = await response.json();
        for (const repository of data.repositories) {
          repository.preferred_remote_name = scenario === "preferred" ? "upstream" : null;
        }
        await route.fulfill({ response, json: data });
      });
      await page.route("**/api/project-repositories/*/branches", async route => {
        const remote = scenario !== "local" && route.request().url().includes(FIXTURE_IDS.secondaryRepository);
        await route.fulfill({ json: { current_remote: scenario === "mixed" && remote ? "origin" : null, current: "main", local: ["main"], remotes: remote ? [{ name: "origin", branches: ["main"] }, { name: "upstream", branches: ["main"] }] : [] } });
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
      const remote = (id: string) => dialog.locator(`select[name="remote:${id}"]`);
      await expect(remote(FIXTURE_IDS.primaryRepository)).toHaveValue("");
      await expect(remote(FIXTURE_IDS.primaryRepository).getByRole("option")).toHaveCount(1);
      await expect(remote(FIXTURE_IDS.primaryRepository).getByRole("option", { name: "Not set", exact: true })).toHaveAttribute("value", "");
      await expect(remote(FIXTURE_IDS.secondaryRepository)).toHaveValue(scenario === "local" ? "" : scenario === "preferred" ? "upstream" : "origin");
      if (scenario === "unset") await remote(FIXTURE_IDS.secondaryRepository).selectOption("");
      await dialog.getByRole("button", { name: "Create Workspace", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}$`));
      const submitted = workspaceRequest as { repositories: { repository_id: string; checkout: { mode: string; branch: string; base: { kind: string; branch: string } }; upstream: { remote: string; branch: string } | null }[] };
      expect(submitted.repositories).toHaveLength(2);
      const first = submitted.repositories.find(repo => repo.repository_id === FIXTURE_IDS.primaryRepository)!;
      const second = submitted.repositories.find(repo => repo.repository_id === FIXTURE_IDS.secondaryRepository)!;
      expect(first.checkout).toEqual({ mode: "new", branch: expect.stringMatching(/^treefold\//), base: { kind: "local", branch: "main" } });
      expect(second.checkout).toEqual(first.checkout);
      expect(first.upstream).toBeNull();
      expect(second.upstream).toEqual(scenario === "local" || scenario === "unset" ? null : { remote: scenario === "preferred" ? "upstream" : "origin", branch: second.checkout.branch });
      // Creating a Workspace must not overwrite Project repository settings.
      expect(harness.repositoryUpdateRequests).toEqual([]);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await page?.unrouteAll({ behavior: "wait" }); }
      finally { try { await closeUiSession(page); } finally { await harness.close(); } }
    }
  });
}

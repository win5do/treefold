import { expectReachableOverlay } from "./overlay-assertions.ts";
import { chooseSelectOption } from "./select-options.ts";
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
      const remote = (id: string) => dialog.getByTestId(`workspace-create-repository-${id}`).getByRole("combobox", { name: "Remote", exact: true });
      await expect(remote(FIXTURE_IDS.primaryRepository)).toHaveText("Not set");
      await remote(FIXTURE_IDS.primaryRepository).click();
      await expect(page.getByRole("option")).toHaveCount(1);
      await page.getByRole("option", { name: "Not set", exact: true }).click();
      await expect(remote(FIXTURE_IDS.secondaryRepository)).toHaveText(scenario === "local" ? "Not set" : scenario === "preferred" ? "upstream" : "origin");
      if (scenario === "unset") {
        await page.setViewportSize({ width: 800, height: 640 });
        const trigger = remote(FIXTURE_IDS.secondaryRepository);
        const popup = page.locator('[data-slot="select-content"]').filter({ has: page.getByRole("option", { name: "upstream", exact: true }) });
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        await expectReachableOverlay(popup, trigger);
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveClass(/dark/);
        await page.screenshot({ path: "/tmp/treefold-select-dark.png", animations: "disabled" });
        await page.emulateMedia({ colorScheme: "light" });
        await expect(page.locator("html")).not.toHaveClass(/dark/);
        await page.screenshot({ path: "/tmp/treefold-select-light.png", animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await expect(dialog).toBeVisible();
        await trigger.click();
        await dialog.getByRole("heading", { name: "New Workspace", exact: true }).click();
        await expect(popup).toBeHidden();
        await chooseSelectOption(page, trigger, "upstream");
        await expect(trigger).toHaveText("upstream");
        await trigger.press("ArrowDown");
        await expect(popup).toBeVisible();
        await page.getByRole("option", { name: "upstream", exact: true }).press("Home");
        await expect(page.getByRole("option", { name: "Not set", exact: true })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(trigger).toHaveText("Not set");
      }
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

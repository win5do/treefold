import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const source of ["creation", "runtime"] as const) {
  test(`${source} refreshes cached parent lists and Fork summaries use lifecycle status`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    let changed = false;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `hierarchy-${source}` });
      await page.route(`**/api/projects/${FIXTURE_IDS.project}`, async route => {
        const response = await route.fetch();
        const data = await response.json();
        if (changed) data.workspaces.push({ ...data.workspaces.find((item: { id: string }) => item.id === FIXTURE_IDS.workspace), id: "new-workspace", name: "New feature" });
        await route.fulfill({ response, json: data });
      });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, async route => {
        const response = await route.fetch();
        const data = await response.json();
        for (const fork of data.forks) delete fork.delivery_status;
        if (changed) data.forks.push({ ...data.forks[0], id: "new-fork", name: "New subtask", status: "active" });
        await route.fulfill({ response, json: data });
      });
      await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
      await expect(page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`)).toBeVisible();
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      const forks = page.getByTestId("workspace-forks-section");
      await expect(forks.getByTestId(`fork-list-row-${FIXTURE_IDS.fork}`).getByText("active", { exact: true })).toBeVisible();
      await expect(forks.getByTestId(`fork-list-row-${FIXTURE_IDS.archivedFork}`).getByText("archived", { exact: true })).toBeVisible();
      if (source === "creation") {
        await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/forks`, async route => {
          changed = true;
          const response = await page!.request.get(`${harness.apiUrl}/api/workspaces/${FIXTURE_IDS.fork}`);
          await route.fulfill({ status: 201, json: await response.json() });
        });
        await forks.getByRole("button", { name: "New Fork", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Create Fork", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.fork}$`));
      } else {
        changed = true;
        harness.setProcessState(FIXTURE_IDS.workspaceShell, "exited");
        await expect(forks.getByTestId("fork-list-row-new-fork")).toBeVisible();
        await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
      }
      await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
      await expect(page.getByTestId("workspace-list-row-new-workspace")).toBeVisible();
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      await expect(page.getByTestId("fork-list-row-new-fork")).toBeVisible();
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

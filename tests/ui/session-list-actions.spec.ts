import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { withSession } from "./fixtures/sessions.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const owner of ["project", "workspace", "fork"] as const) {
  test(`${owner} Session list separates viewing retained output from resuming`, async () => {
    const id = owner === "project" ? FIXTURE_IDS.projectCodex : owner === "workspace" ? FIXTURE_IDS.workspaceCodex : FIXTURE_IDS.forkBackgroundProcess;
    const path = owner === "project" ? `/projects/${FIXTURE_IDS.project}` : `/workspaces/${owner === "workspace" ? FIXTURE_IDS.workspace : FIXTURE_IDS.fork}`;
    const harness = await startUiHarness(withSession(id, { status: "exited", visibility: "hidden", exit_code: 0, io_mode: "tty" }));
    const actions: string[] = [];
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-list-actions" });
      await page.route(`**/api/sessions/${id}/*`, async route => {
        if (route.request().method() === "POST") actions.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
        await route.continue();
      });
      await page.goto(`${harness.baseUrl}/#${path}`);
      const row = page.getByTestId(`${owner === "project" ? "project" : "workspace"}-session-${id}`);
      await row.getByRole("button", { name: "View", exact: true }).click();
      await expect(page.getByTestId("session-terminal-state")).toBeVisible();
      await expect(page.getByLabel("Recent output", { exact: true })).not.toBeEmpty();
      expect(actions).toEqual(["open"]);
      await page.goto(`${harness.baseUrl}/#${path}`);
      if (owner === "workspace") {
        // Inspect the wider sticky action column alongside a long Session name.
        await page.setViewportSize({ width: 1100, height: 720 });
        await row.getByRole("button", { name: "Resume", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/tmp/treefold-session-list-actions.png" });
      }
      await row.getByRole("button", { name: "Resume", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}/sessions/${id}$`));
      await expect(page.getByTestId("session-workspace").locator(".xterm-helper-textarea")).toBeAttached();
      expect(actions).toEqual(["open", "restart"]);
      await page.goto(`${harness.baseUrl}/#${path}`);
      await expect(row.getByRole("button", { name: "View", exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-session-list-${owner}-failure.png` }).catch(() => {});
      throw error;
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("resuming hidden history starts it directly and restores sidebar visibility", async () => {
  const id = FIXTURE_IDS.workspaceCodex;
  const harness = await startUiHarness(withSession(id, { status: "stopped", visibility: "hidden" }));
  const actions: string[] = [];
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "resume-hidden-history" });
    await page.route(`**/api/sessions/${id}/*`, async route => {
      if (route.request().method() === "POST") actions.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
      await route.continue();
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByTestId(`workspace-session-${id}`).getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByTestId("session-workspace").locator(".xterm-helper-textarea")).toBeAttached();
    await expect(page.getByTestId(`sidebar-session-${id}`).getByText("running", { exact: true })).toBeVisible();
    expect(actions).toEqual(["restart", "open"]);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

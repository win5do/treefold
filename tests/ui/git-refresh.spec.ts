import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("manual refresh reloads fresh History, shared status and the selected diff", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let revision = 0;
  let diffLoads = 0;
  let sidebarLoads = 0;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "git-refresh" });
    await page.route("**/api/sidebar", async (route) => { sidebarLoads++; await route.continue(); });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-history`, async (route) => {
      await route.fulfill({ json: { branch: "main", commits: [{ ...FIXTURE_COMMITS[0], subject: `External commit ${revision}` }] } });
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-status`, async (route) => {
      const response = await route.fetch();
      const status = await response.json();
      status.files[0].additions = 10 + revision;
      await route.fulfill({ response, json: status });
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-diff`, async (route) => {
      diffLoads++;
      await route.continue();
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    await expect(page.getByTestId("git-history-commit")).toContainText("External commit 0");
    // Freeze query time so every manual refresh must bypass a still-fresh cache.
    const frozenTime = Date.now();
    await page.clock.setFixedTime(new Date(frozenTime));
    const refresh = page.getByRole("button", { name: "Refresh Workspace", exact: true });
    for (revision = 1; revision <= 2; revision++) {
      await refresh.click();
      await expect(page.getByTestId("git-history-commit")).toContainText(`External commit ${revision}`);
      await expect(refresh).toBeEnabled();
    }
    revision = 4;
    await page.clock.setFixedTime(new Date(frozenTime + 4_000));
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByTestId("git-history-commit")).toContainText("External commit 4");
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await page.getByRole("button", { name: "Review Changes", exact: true }).click();
    await expect.poll(() => diffLoads).toBeGreaterThan(0);
    const beforeDiff = diffLoads;
    const beforeSidebar = sidebarLoads;
    revision = 8;
    await refresh.click();
    await expect(page.getByTestId("git-change-summary")).toContainText("+19");
    await expect.poll(() => diffLoads).toBeGreaterThan(beforeDiff);
    await expect.poll(() => sidebarLoads).toBeGreaterThan(beforeSidebar);
    await expect(refresh).toBeEnabled();
    const beforeLocalRefresh = diffLoads;
    revision = 9;
    await page.getByTestId("git-changes-refresh").click();
    await expect(page.getByTestId("git-change-summary")).toContainText("+20");
    await expect.poll(() => diffLoads).toBeGreaterThan(beforeLocalRefresh);
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    await expect(page.getByTestId("git-history-commit")).toContainText("External commit 9");
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-git-refresh-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("committing invalidates History even when its cached query is fresh and hidden", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let committed = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "commit-refresh" });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-history`, async (route) => {
      await route.fulfill({ json: { branch: "main", commits: [{ ...FIXTURE_COMMITS[0], subject: committed ? "New local commit" : "Previous commit" }] } });
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git/commit`, async (route) => {
      const response = await route.fetch();
      committed = response.ok();
      await route.fulfill({ response });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    await expect(page.getByTestId("git-history-commit")).toContainText("Previous commit");
    await page.clock.setFixedTime(new Date());
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await page.getByRole("textbox", { name: "Commit message", exact: true }).fill("New local commit");
    const commit = page.getByRole("button", { name: "Commit 1", exact: true });
    await commit.click();
    await expect.poll(() => committed).toBe(true);
    await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveValue("");
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    await expect(page.getByTestId("git-history-commit")).toContainText("New local commit");
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-commit-refresh-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

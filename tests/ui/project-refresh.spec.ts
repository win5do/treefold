import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("Project archive state and subsequent events update while worktree checks are pending", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  const failures: string[] = [];
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-refresh" });
    let streamOpen = false;
    page.on("console", message => { if (message.text().includes("Stream open /api/events")) streamOpen = true; });
    page.on("requestfailed", request => {
      if (request.url().endsWith(`/project-repositories/${FIXTURE_IDS.primaryRepository}/worktrees`)) failures.push(request.failure()?.errorText ?? "failed");
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const row = page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    await expect.poll(() => streamOpen).toBe(true);
    failures.length = 0;
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/worktrees`, async route => {
      const index = requests++;
      const response = await route.fetch();
      if (index === 0) await gate;
      await route.fulfill({ response });
    });
    await page.evaluate(async id => {
      const { queryClient } = await import("/src/features/app/queryClient.ts");
      void queryClient.refetchQueries({ queryKey: ["project-worktrees", id] });
    }, FIXTURE_IDS.project);
    await expect.poll(() => requests).toBe(1);

    harness.archiveAllStreams();
    const refresh = page.getByRole("button", { name: "Refresh Workspace", exact: true });
    await refresh.click();
    await expect(row.getByText("archived", { exact: true })).toBeVisible();

    // Further runtime events must not wait for the outstanding worktree read.
    harness.restoreActiveStreams();
    harness.setProcessState(FIXTURE_IDS.workspaceShell, "exited");
    await expect(row.getByText("archived", { exact: true })).toHaveCount(0);
    harness.archiveAllStreams();
    harness.setProcessState(FIXTURE_IDS.workspaceShell, "running");
    await expect(row.getByText("archived", { exact: true })).toBeVisible();
    expect(requests).toBe(1);
    expect(failures).toEqual([]);

    release();
    await expect(refresh).toBeEnabled();
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    await expect.poll(() => requests).toBe(2);
    expect(failures).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-project-refresh-failure.png" }).catch(() => {});
    throw error;
  } finally {
    release();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("failed worktree checks leave Project records available and can be retried", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let failing = true;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-status-error" });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/worktrees`, async route => {
      if (failing) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Worktree check unavailable" } }) });
      else await route.continue();
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`)).toBeVisible();
    const primary = page.getByTestId(`project-location-${FIXTURE_IDS.primaryRepository}`);
    const secondary = page.getByTestId(`project-location-${FIXTURE_IDS.secondaryRepository}`);
    await secondary.getByTestId(`project-location-toggle-${FIXTURE_IDS.secondaryRepository}`).click();
    await expect(secondary.getByTestId("project-worktree-row").first()).toBeVisible();
    const alert = primary.getByRole("alert").filter({ hasText: "Unable to load worktree status" });
    await expect(alert).toBeVisible();
    failing = false;
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(primary.getByTestId("project-worktree-row").first()).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});


test("repositories load worktrees independently with loading and empty states inside each list", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "repository-worktrees" });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/worktrees`, async route => {
      pending = true;
      await gate;
      await route.fulfill({ json: [] });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const primary = page.getByTestId(`project-repository-worktrees-${FIXTURE_IDS.primaryRepository}`);
    const secondary = page.getByTestId(`project-location-${FIXTURE_IDS.secondaryRepository}`);
    await expect.poll(() => pending).toBe(true);
    await expect(primary.getByRole("status").filter({ hasText: "Loading worktree status" })).toBeVisible();
    await expect(primary.getByText("No worktrees found for this repository.", { exact: true })).toHaveCount(0);
    await secondary.getByTestId(`project-location-toggle-${FIXTURE_IDS.secondaryRepository}`).click();
    await expect(secondary.getByTestId("project-worktree-row").first()).toBeVisible();
    // The second repository has completed while the first still awaits its response.
    await expect(primary.getByRole("status").filter({ hasText: "Loading worktree status" })).toBeVisible();
    release();
    await expect(primary.getByRole("status")).toHaveCount(0);
    await expect(primary.getByText("No worktrees found for this repository.", { exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-repository-worktrees-failure.png" }).catch(() => {});
    throw error;
  } finally {
    release();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("global refresh checks repositories independently without blocking page actions", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const checked: string[] = [];
  let secondaryFinished = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "independent-refresh" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    await page.route(url => url.pathname === `/api/projects/${FIXTURE_IDS.project}`, async route => {
      const response = await route.fetch();
      const data = await response.json();
      if (secondaryFinished) {
        data.repositories.find((repository: { id: string }) => repository.id === FIXTURE_IDS.secondaryRepository).name = "Refreshed repository";
      }
      await route.fulfill({ response, json: data });
    });
    await page.route("**/api/project-repositories/*/refresh", async route => {
      const id = route.request().url().split("/").at(-2)!;
      checked.push(id);
      if (id === FIXTURE_IDS.primaryRepository) {
        await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Primary repository check failed" } } });
      } else {
        await gate;
        secondaryFinished = true;
        await route.continue();
      }
    });
    harness.archiveAllStreams();
    const refresh = page.getByRole("button", { name: "Refresh Workspace", exact: true });
    await refresh.click();
    await expect.poll(() => checked.sort()).toEqual([FIXTURE_IDS.primaryRepository, FIXTURE_IDS.secondaryRepository].sort());
    await expect(page.getByText("Primary repository check failed", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`).getByText("archived", { exact: true })).toBeVisible();
    await expect(refresh).toBeDisabled();
    await expect(page.getByTestId("project-add-location")).toBeEnabled();
    await expect(page.getByRole("button", { name: "New Workspace", exact: true }).last()).toBeEnabled();
    await expect(page.getByTestId("project-worktree-row").first()).toBeVisible();
    release();
    await expect(page.getByTestId(`project-location-${FIXTURE_IDS.secondaryRepository}`)).toContainText("Refreshed repository");
    await expect(refresh).toBeEnabled();
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-independent-refresh-failure.png" }).catch(() => {});
    throw error;
  } finally {
    release();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("global refresh keeps archived Projects observational", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let checks = 0;
  let reads = 0;
  try {
    harness.setProjectStatus(FIXTURE_IDS.project, "archived");
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "archived-refresh" });
    await page.route("**/api/project-repositories/*/refresh", async route => {
      checks++;
      await route.continue();
    });
    await page.route(url => url.pathname === `/api/projects/${FIXTURE_IDS.project}`, async route => {
      reads++;
      await route.continue();
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId(`project-location-${FIXTURE_IDS.primaryRepository}`)).toBeVisible();
    const before = reads;
    const refresh = page.getByRole("button", { name: "Refresh Workspace", exact: true });
    await refresh.click();
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(refresh).toBeEnabled();
    expect(checks).toBe(0);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

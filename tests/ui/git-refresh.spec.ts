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

test("inspector tabs refresh their own fresh cache and show loading on every click", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const reads = { changes: 0, history: 0, info: 0 };
  let revision = 0;
  let blocked: keyof typeof reads | undefined;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "inspector-refresh" });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-status`, async route => {
      reads.changes++;
      if (blocked === "changes") await gate;
      const response = await route.fetch();
      const status = await response.json();
      if (revision === 0) { status.files = []; status.staged_count = 0; }
      else status.files[0].additions = revision * 10;
      await route.fulfill({ response, json: status });
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-history`, async route => {
      reads.history++;
      if (blocked === "history") await gate;
      await route.fulfill({ json: { branch: "main", commits: [{ ...FIXTURE_COMMITS[0], subject: `Revision ${revision}` }] } });
    });
    await page.route(`**/api/projects/${FIXTURE_IDS.project}?*`, async route => {
      reads.info++;
      if (blocked === "info") await gate;
      const response = await route.fetch();
      const detail = await response.json();
      detail.description = `Description ${revision}`;
      await route.fulfill({ response, json: detail });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.clock.setFixedTime(new Date());
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    const sidebar = page.getByTestId("right-sidebar");
    const content = sidebar.locator("[aria-busy]");
    await expect(sidebar.getByText("No changes", { exact: true })).toBeVisible();
    await expect(content).toHaveAttribute("aria-busy", "false");
    // External reset while closed: reopening must bypass even a fresh clean cache.
    await page.getByRole("button", { name: "Hide right sidebar", exact: true }).click();
    revision = 1;
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await expect(sidebar.getByTestId("git-change-summary")).toContainText("+11");
    await expect(content).toHaveAttribute("aria-busy", "false");
    await sidebar.getByRole("textbox", { name: "Commit message", exact: true }).fill("Keep my draft");

    for (const [tab, name] of [["changes", "Changes"], ["history", "Git History"], ["info", "Repository Info"]] as const) {
      for (let click = 0; click < 2; click++) {
        const before = { ...reads };
        revision++;
        blocked = tab;
        gate = new Promise<void>(resolve => { release = resolve; });
        await sidebar.getByRole("tab", { name, exact: true }).click();
        await expect.poll(() => reads[tab]).toBeGreaterThan(before[tab]);
        await expect(content).toHaveAttribute("aria-busy", "true");
        await expect(sidebar.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
        if (tab === "changes") await expect(sidebar.getByRole("button", { name: "Commit 1", exact: true })).toBeDisabled();
        blocked = undefined;
        release?.();
        await expect(content).toHaveAttribute("aria-busy", "false");
        if (tab === "changes") {
          await expect(sidebar.getByTestId("git-change-summary")).toContainText(`+${revision * 10 + 1}`);
          await expect(sidebar.getByRole("textbox", { name: "Commit message", exact: true })).toHaveValue("Keep my draft");
        } else if (tab === "history") {
          await expect(sidebar.getByTestId("git-history-commit")).toContainText(`Revision ${revision}`);
        } else {
          await expect(sidebar).toContainText(`Description ${revision}`);
        }
        for (const other of ["changes", "history", "info"] as const) {
          if (other !== tab) expect(reads[other]).toBe(before[other]);
        }
      }
    }
    harness.assertNoUnexpectedRequests();
  } finally {
    release?.();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("visible inspector polls without loading and serializes manual refresh with an in-flight poll", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let reads = 0;
  let historyReads = 0;
  let infoReads = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  let revision = 0;
  let hold = false;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "inspector-poll" });
    // Install before the app registers timers. Use a fixed future pause point
    // instead of comparing wall clocks across the runner and Electron processes.
    await page.clock.install({ time: new Date("2026-01-01T08:00:00Z") });
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path === `/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-history`) historyReads++;
      if (path === `/api/projects/${FIXTURE_IDS.project}`) infoReads++;
    });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git-status`, async route => {
      reads++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const observedRevision = revision;
      if (hold) await gate;
      const response = await route.fetch();
      const status = await response.json();
      status.files[0].additions = observedRevision * 10;
      await route.fulfill({ response, json: status });
      concurrent--;
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    const sidebar = page.getByTestId("right-sidebar");
    const content = sidebar.locator("[aria-busy]");
    await expect(sidebar.getByTestId("git-change-summary")).toContainText("+1");
    await expect(content).toHaveAttribute("aria-busy", "false");
    await sidebar.getByRole("textbox", { name: "Commit message", exact: true }).fill("Polling preserves this draft");
    await page.clock.pauseAt(new Date("2026-01-01T10:00:00Z"));
    await expect.poll(() => concurrent).toBe(0);
    const before = reads;
    revision = 1;
    hold = true;
    gate = new Promise<void>(resolve => { release = resolve; });
    await page.clock.runFor(2_100);
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(content).toHaveAttribute("aria-busy", "false");
    const pollingReads = reads;
    await page.clock.runFor(6_000);
    expect(reads).toBe(pollingReads);
    // A manual request during the slow poll must wait, then read the newer state.
    revision = 2;
    await sidebar.getByRole("tab", { name: "Changes", exact: true }).click();
    await expect(content).toHaveAttribute("aria-busy", "true");
    await page.clock.runFor(4_000);
    expect(reads).toBe(pollingReads);
    hold = false;
    release?.();
    await expect(sidebar.getByTestId("git-change-summary")).toContainText("+21");
    await expect(content).toHaveAttribute("aria-busy", "false");
    expect(maxConcurrent).toBe(1);
    await expect(sidebar.getByRole("textbox", { name: "Commit message", exact: true })).toHaveValue("Polling preserves this draft");
    const settled = reads;
    await sidebar.getByRole("tab", { name: "Repository Info", exact: true }).click();
    await expect(content).toHaveAttribute("aria-busy", "false");
    const infoBefore = infoReads;
    await page.clock.runFor(4_000);
    await expect.poll(() => infoReads).toBeGreaterThan(infoBefore);
    expect(reads).toBe(settled);
    const infoSettled = infoReads;
    await sidebar.getByRole("tab", { name: "Git History", exact: true }).click();
    await expect(content).toHaveAttribute("aria-busy", "false");
    const historyBefore = historyReads;
    await page.clock.runFor(4_000);
    await expect.poll(() => historyReads).toBeGreaterThan(historyBefore);
    expect(infoReads).toBe(infoSettled);
    expect(reads).toBe(settled);
    await page.getByRole("button", { name: "Hide right sidebar", exact: true }).click();
    const historySettled = historyReads;
    await page.clock.runFor(4_000);
    expect(reads).toBe(settled);
    expect(historyReads).toBe(historySettled);
    expect(infoReads).toBe(infoSettled);
    harness.assertNoUnexpectedRequests();
  } finally {
    hold = false;
    release?.();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

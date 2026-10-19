import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

async function openBranches(page: Page) {
  await page.getByTestId(`project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger`).click();
  await page.getByTestId(`project-repository-branches-${FIXTURE_IDS.primaryRepository}`).click();
  return page.getByRole("dialog", { name: "Branch", exact: true });
}

test("branch search filters local and remote refs, clears, and preserves checkout targets", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "branch-search" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const dialog = await openBranches(page);
    const search = dialog.getByRole("textbox", { name: "Search branches…", exact: true });
    const local = dialog.getByRole("button", { name: "Local", exact: true });
    const remote = dialog.getByRole("button", { name: "Remote", exact: true });
    await expect(dialog.getByTestId("branch-local-main")).toBeVisible();
    await local.click();
    await remote.click();

    await search.fill("  UI-FIXTURE  ");
    await expect(dialog.getByTestId("branch-local-release/ui-fixture")).toBeVisible();
    await expect(dialog.getByTestId("branch-remote-origin/feature/ui-fixture")).toBeVisible();
    await expect(dialog.getByTestId("branch-local-main")).toHaveCount(0);
    await expect(dialog.getByTestId("branch-remote-origin/main")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(local).toHaveAttribute("aria-expanded", "false");
    await expect(remote).toHaveAttribute("aria-expanded", "false");
    await local.click();
    await expect(dialog.getByTestId("branch-local-main")).toBeVisible();

    await search.fill("no-matching-branch");
    await expect(dialog.getByRole("status")).toHaveText("No matching branches");
    await search.fill("ORIGIN/FEATURE");
    await expect(local).toHaveCount(0);
    await dialog.getByTestId("branch-remote-origin/feature/ui-fixture").click();
    const checkout = page.waitForRequest((request) => request.url().endsWith("/checkout") && request.method() === "POST");
    await page.getByTestId("branch-actions-remote-origin/feature/ui-fixture")
      .getByRole("button", { name: "Switch", exact: true }).click();
    expect((await checkout).postDataJSON()).toEqual({ branch: "feature/ui-fixture", kind: "remote", remote: "origin" });
    await expect(dialog).toBeHidden();
    await openBranches(page);
    await expect(search).toHaveValue("");
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-branch-search-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("branch refresh reloads both lists, keeps the filter, and supports retry after failure", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let loads = 0;
  let releaseRefresh: (() => void) | undefined;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "branch-refresh" });
    await page.route(`**/api/project-repositories/${FIXTURE_IDS.primaryRepository}/branches`, async (route) => {
      loads++;
      if (loads === 2) await refreshGate;
      if (loads === 3) {
        await route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Branch refresh failed" } } });
        return;
      }
      await route.fulfill({ json: {
        current: "main",
        local: loads === 1 ? ["main", "release/old"] : ["main", "release/new"],
        remotes: [{ name: "origin", branches: loads === 1 ? ["release/old"] : ["release/new"] }],
      } });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const dialog = await openBranches(page);
    const search = dialog.getByRole("textbox", { name: "Search branches…", exact: true });
    const refresh = dialog.getByRole("button", { name: "Refresh branches", exact: true });
    await search.fill("release");
    await expect(dialog.getByTestId("branch-local-release/old")).toBeVisible();
    await expect(dialog.getByTestId("branch-remote-origin/release/old")).toBeVisible();
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(dialog.getByTestId("branch-local-release/old")).toBeDisabled();
    releaseRefresh!();
    await expect(dialog.getByTestId("branch-local-release/new")).toBeVisible();
    await expect(dialog.getByTestId("branch-remote-origin/release/new")).toBeVisible();
    await expect(dialog.getByTestId("branch-local-release/old")).toHaveCount(0);
    await expect(dialog.getByTestId("branch-remote-origin/release/old")).toHaveCount(0);
    await expect(search).toHaveValue("release");
    await expect(refresh).toBeEnabled();

    await refresh.click();
    await expect(dialog.getByRole("alert")).toContainText("Branch refresh failed");
    await expect(dialog.getByTestId("branch-local-release/new")).toBeVisible();
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(refresh).toBeEnabled();
    expect(loads).toBe(4);
    await expect(search).toHaveValue("release");
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-branch-refresh-failure.png" }).catch(() => {});
    throw error;
  } finally {
    releaseRefresh?.();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

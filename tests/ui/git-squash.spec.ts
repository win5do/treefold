import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

test("History squash submits a consecutive range, honors preflight blockers, and supports Undo", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const requests: Record<string, unknown>[] = [];
  let blocked = true;
  const newHead = "f".repeat(40);
  const rewritten = { ...FIXTURE_COMMITS[0], hash: newHead, subject: "Combined work" };
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "git-squash" });
    await page.route("**/api/project-repositories/*/git/squash", async (route) => {
      const input = route.request().postDataJSON(); requests.push(input);
      if (input.action === "preview") {
        if (blocked) {
          await route.fulfill({ status: 409, json: { error: { code: "SQUASH_BLOCKED", message: "The selection or later history contains a merge commit" } } });
        } else {
          await route.fulfill({ json: { preview: { base: FIXTURE_COMMITS.at(-1)!.hash, branch: "main", selected_count: 2, replayed_count: 1, shared_branches: [] }, history: null, recovery_id: null } });
        }
      } else {
        await route.fulfill({ json: { preview: null, history: { branch: "main", commits: input.action === "undo" ? FIXTURE_COMMITS : [rewritten, ...FIXTURE_COMMITS.slice(2)] }, recovery_id: input.action === "undo" ? null : "1".repeat(32) } });
      }
    });
    await page.setViewportSize({ width: 1000, height: 740 });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    const commits = page.getByTestId("git-history-commit");
    await expect(commits).toHaveCount(FIXTURE_COMMITS.length);
    await commits.nth(1).click();
    await openUiContextMenu(page, commits.nth(1));
    await expect(page.getByRole("menuitem", { name: "Squash Commits…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await commits.nth(2).click({ modifiers: ["Shift"] });
    const open = async () => {
      await openUiContextMenu(page!, commits.nth(1));
      await page!.getByRole("menuitem", { name: "Squash Commits…" }).click();
    };
    await open();
    const dialog = page.getByRole("dialog", { name: "Squash commits", exact: true });
    await expect(dialog.getByRole("alert")).toContainText("merge commit");
    await expect(dialog.getByRole("button", { name: "Squash commits", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    blocked = false;
    await open();
    await expect(dialog.getByRole("button", { name: "Squash commits", exact: true })).toBeEnabled();
    await dialog.getByLabel("Commit message", { exact: true }).fill("Combined work");
    await page.screenshot({ path: "/tmp/treefold-squash-dialog.png", animations: "disabled" });
    await dialog.getByRole("button", { name: "Squash commits", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests.find((request) => request.action === "apply")).toEqual({ action: "apply", commits: [FIXTURE_COMMITS[2].hash, FIXTURE_COMMITS[1].hash], expected_head: FIXTURE_COMMITS[0].hash, message: "Combined work" });
    await page.getByRole("button", { name: "Undo squash", exact: true }).click();
    await expect(commits).toHaveCount(FIXTURE_COMMITS.length);
    expect(requests.at(-1)).toEqual({ action: "undo", recovery_id: "1".repeat(32), expected_head: newHead });
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-squash-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

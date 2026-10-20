import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

test("Edit HEAD message previews full text and requires an explicit shared-commit confirmation", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const requests: Record<string, unknown>[] = [];
  const refs = ["refs/remotes/origin/main"];
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "git-reword" });
    await page.route("**/api/project-repositories/*/git/reword", async route => {
      const input = route.request().postDataJSON(); requests.push(input);
      if (input.action === "preview") {
        await route.fulfill({ json: { preview: { head: FIXTURE_COMMITS[0].hash, branch: "refs/heads/main", message: "Original title\n\nOriginal body", shared_refs: refs }, history: null } });
      } else {
        await route.fulfill({ json: { preview: null, history: { branch: "main", commits: [{ ...FIXTURE_COMMITS[0], hash: "f".repeat(40), subject: "Edited title" }, ...FIXTURE_COMMITS.slice(1)] } } });
      }
    });
    await page.setViewportSize({ width: 1000, height: 740 });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    const commits = page.getByTestId("git-history-commit");
    await expect(commits).toHaveCount(FIXTURE_COMMITS.length);
    await openUiContextMenu(page, commits.nth(1));
    await expect(page.getByRole("menuitem", { name: "Edit Commit Message…", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await openUiContextMenu(page, commits.first());
    await page.getByRole("menuitem", { name: "Edit Commit Message…", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit commit message", exact: true });
    await expect(editor.getByLabel("Commit message", { exact: true })).toHaveValue("Original title\n\nOriginal body");
    await editor.getByLabel("Commit message", { exact: true }).fill("");
    await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await editor.getByLabel("Commit message", { exact: true }).fill("Edited title\n\nEdited body");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const warning = page.getByRole("alertdialog", { name: "Rewrite a shared commit?", exact: true });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(warning).toBeHidden();
    expect(requests.filter(request => request.action === "apply")).toHaveLength(0);
    await expect(editor.getByLabel("Commit message", { exact: true })).toHaveValue("Edited title\n\nEdited body");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await page.screenshot({ path: "/tmp/treefold-reword-warning.png", animations: "disabled" });
    await warning.getByRole("button", { name: "Continue and save", exact: true }).click();
    await expect(editor).toBeHidden();
    expect(requests.at(-1)).toEqual({ action: "apply", expected_head: FIXTURE_COMMITS[0].hash, expected_branch: "refs/heads/main", message: "Edited title\n\nEdited body", confirmed_refs: refs });
    await expect(commits.first()).toContainText("Edited title");
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-reword-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Edit message keeps the draft on stale HEAD and asks again for newly shared refs", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let attempts = 0;
  const preview = { head: FIXTURE_COMMITS[0].hash, branch: "refs/heads/main", message: "Original", shared_refs: [] as string[] };
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "git-reword-stale" });
    await page.route("**/api/project-repositories/*/git/reword", async route => {
      const input = route.request().postDataJSON();
      if (input.action === "preview") await route.fulfill({ json: { preview, history: null } });
      else if (++attempts === 1) await route.fulfill({ json: { preview: { ...preview, shared_refs: ["refs/remotes/origin/main"] }, history: null } });
      else await route.fulfill({ status: 409, json: { error: { code: "REWORD_STALE", message: "HEAD changed" } } });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "Show right sidebar", exact: true }).click();
    await page.getByRole("tab", { name: "Git History", exact: true }).click();
    await openUiContextMenu(page, page.getByTestId("git-history-commit").first());
    await page.getByRole("menuitem", { name: "Edit Commit Message…", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit commit message", exact: true });
    await expect(editor.getByLabel("Commit message", { exact: true })).toHaveValue("Original");
    await editor.getByLabel("Commit message", { exact: true }).fill("Draft to preserve");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    const warning = page.getByRole("alertdialog", { name: "Rewrite a shared commit?", exact: true });
    await expect(warning).toBeVisible();
    await warning.getByRole("button", { name: "Continue and save", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("HEAD changed");
    await expect(editor.getByLabel("Commit message", { exact: true })).toHaveValue("Draft to preserve");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

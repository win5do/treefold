import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS, FIXTURE_NAMES } from "./fixtures/sidebar-core.ts";

for (const owner of [
  { name: "Workspace", id: FIXTURE_IDS.workspace, session: undefined },
  { name: "Fork", id: FIXTURE_IDS.fork, session: undefined },
  { name: "Workspace Session", id: FIXTURE_IDS.workspace, session: FIXTURE_IDS.workspaceShell },
  { name: "Fork Session", id: FIXTURE_IDS.fork, session: FIXTURE_IDS.forkShell },
]) {
  test(`palette Review keeps the invoking ${owner.name} owner through navigation`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "review-palette-context" });
      const path = `workspaces/${owner.id}${owner.session ? `/sessions/${owner.session}` : ""}`;
      await page.goto(`${harness.baseUrl}/#/${path}`);
      if (owner.session) await expect(page.locator(`[data-session-id="${owner.session}"] .xterm-helper-textarea`)).toBeAttached();
      else await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
      const search = palette.getByRole("combobox");
      for (const query of ["AI Review", "workspace.review.open"]) {
        await search.fill(query);
        await expect(palette.getByRole("option", { name: "AI Review", exact: true })).toBeVisible();
      }
      // Neither a background route change nor the Session's directory retargets Review.
      await page.evaluate(() => { window.location.hash = "#/projects"; });
      await expect(page).toHaveURL(/#\/projects$/);
      await search.press("Enter");
      await expect(palette).toBeHidden();
      const review = page.getByRole("dialog", { name: "AI Review", exact: true });
      await expect(review).toContainText(owner.id === FIXTURE_IDS.fork ? FIXTURE_NAMES.fork : FIXTURE_NAMES.workspace);
      await expect(review).toContainText(`Compare against: ${owner.id === FIXTURE_IDS.fork ? "feature/parent" : "main"}`);
      const creation = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/workspaces/${owner.id}/agent-review`));
      await review.getByRole("button", { name: "Start Review", exact: true }).click();
      await creation;
      await expect(page).toHaveURL(new RegExp(`/workspaces/${owner.id}/sessions/review-session-1$`));
      harness.assertNoUnexpectedRequests();
    } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
  });
}

test("palette hides Review outside eligible Workspace and Fork contexts", async () => {
  const harness = await startUiHarness(fixture => {
    const template = fixture.workspaceDetails[FIXTURE_IDS.workspace];
    fixture.workspaceDetails[FIXTURE_IDS.archivedWorkspace] = { ...template, id: FIXTURE_IDS.archivedWorkspace, status: "archived", sessions: [] };
    fixture.workspaceDetails["review-pending"] = { ...template, id: "review-pending", sessions: [] };
    fixture.workspaceDetails["review-creating"] = { ...template, id: "review-creating", sessions: [],
      repositories: template.repositories.map(repository => ({ ...repository, git_status: "creating" })) };
    fixture.workspaceDetails["review-readonly"] = { ...template, id: "review-readonly", sessions: [],
      repositories: template.repositories.map(repository => ({ ...repository, access_mode: "read_only" })) };
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "review-palette-availability" });
    await page.route("**/api/workspaces/review-pending", async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.finish_batch = { workspace_id: "review-pending", status: "paused", items: [] };
      await route.fulfill({ response, json: data });
    });
    for (const path of ["projects", `projects/${FIXTURE_IDS.project}`, `projects/${FIXTURE_IDS.project}/sessions/${FIXTURE_IDS.projectCodex}`,
      ...[FIXTURE_IDS.archivedWorkspace, "review-pending", "review-creating", "review-readonly"].map(id => `workspaces/${id}`)]) {
      await page.goto(`${harness.baseUrl}/#/${path}`);
      if (path.includes("/sessions/")) await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      else await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("option", { name: "AI Review", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

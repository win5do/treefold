import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { fixtureSessions } from "./fixtures/sessions.ts";
import type { FixtureSession, SidebarFixture } from "./fixtures/types.ts";

for (const outcome of ["running", "failed"] as const) {
  test(`new Agent Session opens its tab while initializing, then becomes ${outcome}`, async () => {
    let fixture!: SidebarFixture;
    let created!: FixtureSession;
    const harness = await startUiHarness(value => { fixture = value; });
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-initialization" });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/sessions`, async route => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        created = fixtureSessions(fixture).find(session => session.id === body.id)!;
        Object.assign(created, { initializing: true, status: "stopped", agent_session_id: undefined });
        await route.fulfill({ response, json: created });
      });
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      await page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
      await dialog.getByRole("button", { name: "Agent", exact: true }).click();
      await dialog.getByRole("button", { name: "Create Session", exact: true }).click();
      await expect(page.getByTestId("session-initializing")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/sessions/${created.id}$`));
      const tab = page.getByTestId(`sidebar-session-${created.id}`);
      await expect(tab).toBeVisible();
      await tab.hover();
      await expect(tab.getByRole("button", { name: "Remove from sidebar", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
      Object.assign(created, { initializing: false, status: outcome, initialization_error: outcome === "failed" ? "Fixture startup failed" : undefined });
      if (outcome === "running") {
        await expect(page.getByTestId("session-workspace").locator(".xterm-helper-textarea")).toBeAttached();
      } else {
        await expect(page.getByRole("alert")).toContainText("Fixture startup failed");
        await expect(page.getByRole("button", { name: "Retry startup", exact: true })).toBeEnabled();
      }
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

for (const kind of ["workspace", "fork"] as const) {
  test(`${kind} exposes preparing repositories and enables creation when ready`, async () => {
    let fixture!: SidebarFixture;
    const id = kind === "workspace" ? FIXTURE_IDS.workspace : FIXTURE_IDS.fork;
    const harness = await startUiHarness(value => {
      fixture = value;
      for (const repository of value.workspaceDetails[id].repositories) repository.git_status = "creating";
    });
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `${kind}-initialization` });
      await page.goto(`${harness.baseUrl}/#/workspaces/${id}`);
      await expect(page.getByTestId("workspace-initializing")).toBeVisible();
      const create = page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true });
      await expect(create).toBeDisabled();
      for (const repository of fixture.workspaceDetails[id].repositories) repository.git_status = "ready";
      await expect(create).toBeEnabled();
      await expect(page.getByTestId("workspace-initializing")).toHaveCount(0);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

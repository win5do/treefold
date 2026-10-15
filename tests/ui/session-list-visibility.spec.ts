import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import type { FixtureSession, SidebarFixture } from "./fixtures/types.ts";

const agentKinds = ["codex", "claude_code", "opencode", "pi"] as const;

for (const owner of ["project", "workspace", "fork"] as const) {
  const id = owner === "project" ? FIXTURE_IDS.project : owner === "workspace" ? FIXTURE_IDS.workspace : FIXTURE_IDS.fork;
  const prefix = owner === "project" ? "project" : "workspace";
  const path = `/${owner === "project" ? "projects" : "workspaces"}/${id}`;
  const detail = (fixture: SidebarFixture) => owner === "project" ? fixture.projectDetails[id] : fixture.workspaceDetails[id];

  test(`${owner} Session list hides Agent history without an ID and keeps live and resumable Sessions`, async () => {
    const listed: string[] = [];
    const hidden: string[] = [];
    const harness = await startUiHarness(fixture => {
      const target = detail(fixture);
      const template = target.sessions[0];
      target.sessions = [];
      const add = (overrides: Partial<FixtureSession>, visible: boolean) => {
        const sessionId = `visibility-${target.sessions.length}`;
        target.sessions.push({ ...template, id: sessionId, name: sessionId, ...overrides });
        (visible ? listed : hidden).push(sessionId);
      };
      for (const kind of agentKinds) {
        for (const status of ["stopped", "exited", "failed"] as const) {
          for (const agent_session_id of [undefined, "", "   "]) {
            add({ kind, status, agent_session_id, visibility: "hidden" }, false);
          }
          add({ kind, status, agent_session_id: undefined, visibility: "visible" }, false);
          add({ kind, status, agent_session_id: `native-${kind}-${status}`, visibility: "hidden" }, true);
        }
        add({ kind, status: "running", agent_session_id: undefined, visibility: "visible" }, true);
        add({ kind, status: "running", agent_session_id: undefined, visibility: "hidden" }, true);
      }
      for (const kind of ["shell", "command"] as const) {
        add({ kind, status: "exited", agent_session_id: undefined, visibility: "hidden" }, true);
      }
    });
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-list-visibility" });
      await page.goto(`${harness.baseUrl}/#${path}`);
      const section = page.getByTestId(`${prefix}-sessions-section`);
      for (const sessionId of listed) await expect(section.getByTestId(`${prefix}-session-${sessionId}`)).toBeVisible();
      for (const sessionId of hidden) await expect(section.getByTestId(`${prefix}-session-${sessionId}`)).toHaveCount(0);
      if (owner !== "project") {
        await section.getByRole("button", { name: "Agent", exact: true }).click();
        await expect(section.locator('[data-testid^="workspace-session-"]')).toHaveCount(listed.length - 2);
      }
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });

  test(`${owner} Session list uses the empty state when all history lacks Agent IDs`, async () => {
    const harness = await startUiHarness(fixture => {
      const target = detail(fixture);
      target.sessions = [{ ...target.sessions[0], kind: "codex", status: "stopped", visibility: "hidden", agent_session_id: undefined }];
    });
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-list-empty" });
      await page.goto(`${harness.baseUrl}/#${path}`);
      const section = page.getByTestId(`${prefix}-sessions-section`);
      if (owner === "project") await expect(section.getByText("No Sessions", { exact: true })).toBeVisible();
      else await expect(section.locator('[data-slot="empty"]')).toBeVisible();
      await expect(section.locator(`[data-testid^="${prefix}-session-"]`)).toHaveCount(0);
      if (owner !== "project") await expect(section.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

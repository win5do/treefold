import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const owner of ["project", "workspace"] as const) {
  test(`${owner} Codex history without an identity can be removed from Treefold`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    const id = owner === "project" ? FIXTURE_IDS.projectCodex : FIXTURE_IDS.workspaceCodex;
    let removed = false;
    let failRemoval = true;
    const deletes: string[] = [];
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-removal" });
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "DELETE" && path === `/api/sessions/${id}`) {
          deletes.push(id);
          if (failRemoval) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Removal failed" }) });
          removed = true;
          return route.fulfill({ status: 204 });
        }
        if (request.method() !== "GET" || path === "/api/events") return route.continue();
        const response = await route.fetch();
        if (!response.headers()["content-type"]?.includes("application/json")) return route.fulfill({ response });
        const body = await response.json();
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) {
            for (let i = value.length - 1; i >= 0; i--) {
              if (removed && value[i]?.id === id) value.splice(i, 1);
              else visit(value[i]);
            }
          } else if (value && typeof value === "object") {
            const record = value as Record<string, unknown>;
            if (record.id === id) {
              record.visibility = "hidden";
              record.status = "stopped";
              record.agent_session_id = null;
            }
            Object.values(record).forEach(visit);
          }
        };
        visit(body);
        await route.fulfill({ response, json: body });
      });
      await page.goto(`${harness.baseUrl}/#/${owner === "project" ? "projects" : "workspaces"}/${owner === "project" ? FIXTURE_IDS.project : FIXTURE_IDS.workspace}`);
      const row = page.getByTestId(`${owner}-session-${id}`);
      // The action remains available even when Resume has no conversation ID.
      await row.getByRole("button", { name: "Remove from Treefold", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("Session history saved by the CLI is kept.");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(deletes).toEqual([]);
      await row.getByRole("button", { name: "Remove from Treefold", exact: true }).click();
      await dialog.getByRole("button", { name: "Remove", exact: true }).click();
      await expect.poll(() => deletes).toEqual([id]);
      await expect(dialog.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
      await expect(row).toBeVisible();
      failRemoval = false;
      await dialog.getByRole("button", { name: "Remove", exact: true }).click();
      await expect.poll(() => deletes).toEqual([id, id]);
      await expect(row).toHaveCount(0);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

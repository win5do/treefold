import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("pipe Command Session replays logs, follows new output, and keeps logs after exit", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let status = "running";
  let restartRequests = 0;
  const cursors: string[] = [];
  const record = (sequence: number, text: string) => JSON.stringify({
    sequence, execution: 1, stream: "stdout", data: { encoding: "utf8", text },
  }) + "\n";
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "pipe-logs" });
    await page.addInitScript(() => {
      const opened: string[] = [];
      Object.defineProperty(window, "__openedUrls", { value: opened });
      window.open = ((url: string | URL | undefined) => {
        opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/sessions/${FIXTURE_IDS.workspaceShell}/logs`) {
        const after = url.searchParams.get("after") ?? "0";
        cursors.push(after);
        const body = after === "0"
          ? record(1, "\u001b[32mbackend listening\u001b[0m\nhttp://127.0.0.1:3001/api/status\n") + record(2, "GET /api/status\n")
          : after === "2" ? record(3, "POST /api/visits\n") : "";
        await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
        return;
      }
      if (url.pathname === `/api/sessions/${FIXTURE_IDS.workspaceShell}/restart` && route.request().method() === "POST") {
        restartRequests += 1;
      }
      if (route.request().method() !== "GET" || url.pathname === "/api/events") return route.continue();
      const response = await route.fetch();
      if (!response.headers()["content-type"]?.includes("application/json")) return route.fulfill({ response });
      const body = await response.json();
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        const item = value as Record<string, unknown>;
        if (item.id === FIXTURE_IDS.workspaceShell) {
          item.kind = "command";
          item.io_mode = "pipe";
          item.status = status;
          item.argv = ["cargo", "run"];
        }
        Object.values(item).forEach(visit);
      };
      visit(body);
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`);
    const logs = page.getByRole("log", { name: "Process output" });
    await expect(logs).toContainText("backend listening\nhttp://127.0.0.1:3001/api/status\nGET /api/status\nPOST /api/visits");
    expect(cursors).toContain("2");
    await expect(logs).not.toContainText("\u001b");
    const link = logs.getByRole("link", { name: "http://127.0.0.1:3001/api/status" });
    await link.click();
    expect(await page.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual([]);
    await link.click({ modifiers: ["Control"] });
    expect(await page.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(["http://127.0.0.1:3001/api/status"]);
    await link.click({ modifiers: ["Meta"] });
    expect(await page.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual([
      "http://127.0.0.1:3001/api/status", "http://127.0.0.1:3001/api/status",
    ]);

    status = "exited";
    await page.reload();
    await expect(logs).toContainText("backend listening\nhttp://127.0.0.1:3001/api/status\nGET /api/status");
    await page.getByTestId("session-pipe-logs").getByRole("button", { name: /Resume/i }).click();
    expect(restartRequests).toBe(1);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

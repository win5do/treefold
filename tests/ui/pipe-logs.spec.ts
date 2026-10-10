import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { withSession } from "./fixtures/sessions.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("TTY Command Session opens from the sidebar and forwards Ctrl+C", async () => {
  const harness = await startUiHarness(withSession(FIXTURE_IDS.sessionDevServer, { io_mode: "tty" }));
  let page: Page | undefined;
  const inputs: string[] = [];
  let terminalReady = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "command-terminal" });
    await page.routeWebSocket(`**/api/sessions/${FIXTURE_IDS.sessionDevServer}/terminal?*`, socket => {
      socket.onMessage(data => {
        const message = JSON.parse(String(data));
        if (message.type === "terminal_ready") terminalReady = true;
        if (message.type === "input") inputs.push(Buffer.from(message.data, "base64").toString());
      });
      socket.send(JSON.stringify({ type: "ownership_state", state: "controller" }));
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByRole("button", { name: "web-dev-server running", exact: true }).click();
    await expect.poll(() => terminalReady).toBe(true);
    const input = page.getByTestId("session-workspace").locator(".xterm-helper-textarea");
    await expect(input).toBeAttached();
    await input.press("Control+c");
    await expect.poll(() => inputs.join("")).toBe("\x03");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("pipe Command Session replays logs, follows new output, and keeps logs after exit", async () => {
  const harness = await startUiHarness(withSession(FIXTURE_IDS.workspaceShell, {
    kind: "command", io_mode: "pipe", argv: ["cargo", "run"],
  }));
  let page: Page | undefined;
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
    await page.route(`**/api/sessions/${FIXTURE_IDS.workspaceShell}/logs?*`, async (route) => {
      const url = new URL(route.request().url());
      const after = url.searchParams.get("after") ?? "0";
      cursors.push(after);
      const body = after === "0"
        ? record(1, "\u001b[32mbackend listening\u001b[0m\nhttp://127.0.0.1:3001/api/status\n") + record(2, "GET /api/status\n")
        : after === "2" ? record(3, "POST /api/visits\n") : "";
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
    });
    await page.route(`**/api/sessions/${FIXTURE_IDS.workspaceShell}/restart`, async route => {
      if (route.request().method() === "POST") restartRequests += 1;
      await route.continue();
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`);
    const logs = page.getByRole("log", { name: "Process output" });
    await expect(logs).toContainText("backend listening\nhttp://127.0.0.1:3001/api/status\nGET /api/status\nPOST /api/visits");
    expect(cursors).toContain("2");
    await expect(logs).not.toContainText("\u001b");
    const link = logs.getByRole("link", { name: "http://127.0.0.1:3001/api/status" });
    await link.click();
    expect(await page.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(["http://127.0.0.1:3001/api/status"]);
    await link.click({ modifiers: ["Control"] });
    expect(await page.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(Array(2).fill("http://127.0.0.1:3001/api/status"));
    await link.click({ modifiers: ["Meta"] });
    expect(await page.evaluate(() => (window as typeof window & { __openedUrls: string[] }).__openedUrls)).toEqual(Array(3).fill("http://127.0.0.1:3001/api/status"));

    harness.setProcessState(FIXTURE_IDS.workspaceShell, "exited");
    await page.reload();
    await expect(logs).toContainText("backend listening\nhttp://127.0.0.1:3001/api/status\nGET /api/status");
    await page.getByTestId("session-pipe-logs").getByRole("button", { name: /Resume/i }).click();
    expect(restartRequests).toBe(1);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

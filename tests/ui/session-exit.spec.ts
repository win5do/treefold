import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { withSession } from "./fixtures/sessions.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("exited TTY Session retains parsed startup errors after reopening", async () => {
  const id = FIXTURE_IDS.workspaceCodex;
  const harness = await startUiHarness(withSession(id, { status: "exited", exit_code: 1 }));
  let page: Page | undefined;
  const message = "Error: account/read failed: workspace routing discovery timed out (code -32603)";
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-exit" });
    await page.route(`**/api/sessions/${id}/logs?*`, async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("follow")).toBe("false");
      const records = [
        "\x1b]0;private terminal title\x1b", "\\\x1b[31", "mResuming session…\r\n\x1b[0m",
        ...Array.from({ length: 250 }, (_, i) => `loading ${i}\r\n`),
        `${message}\r\n`,
      ];
      await route.fulfill({ contentType: "application/x-ndjson", body: records.map((text, i) => JSON.stringify({
        sequence: i + 1, execution: 1, stream: "tty", data: { encoding: "utf8", text },
      })).join("\n") + "\n" });
    });
    const open = () => page!.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${id}`);
    await open();
    const output = page.getByLabel("Recent output", { exact: true });
    await expect(output).toContainText(message);
    await expect(output).not.toContainText("private terminal title");
    await expect(output).not.toContainText("\x1b");
    const state = page.getByTestId("session-terminal-state");
    await expect(state.getByRole("definition").filter({ hasText: /^1$/ })).toBeVisible();
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await open();
    await expect(output).toContainText(message);
    // Diagnostic screenshot only: long retained output must not hide Resume
    // or prevent scrolling to the command and working directory.
    await page.setViewportSize({ width: 1000, height: 680 });
    await state.getByRole("button", { name: "Resume", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/treefold-session-exit.png" });
    await state.getByLabel("Command", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/treefold-session-exit-details.png" });
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-session-exit-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("signal exits keep Resume available when retained logs cannot be read", async () => {
  const id = FIXTURE_IDS.workspaceCodex;
  const harness = await startUiHarness(withSession(id, { status: "exited", exit_code: undefined, exit_signal: "TERM" }));
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "session-exit-signal" });
    await page.route(`**/api/sessions/${id}/logs?*`, route => route.fulfill({ status: 404 }));
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${id}`);
    const state = page.getByTestId("session-terminal-state");
    await expect(state.getByRole("definition").filter({ hasText: /^Unknown$/ })).toBeVisible();
    await expect(state.getByText("TERM", { exact: true })).toBeVisible();
    await expect(state.getByRole("status")).toHaveText("Log stream unavailable: HTTP 404");
    await state.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByTestId(`sidebar-session-${id}`).getByText("running", { exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

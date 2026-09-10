import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("keymap records, disables, resets, and protects modal keyboard input", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "keymap",
    });
    await page.addInitScript(() => {
      window.__keymapInputs = [];
      class TerminalSocket {
        static OPEN = 1;
        readyState = 0;
        bufferedAmount = 0;
        binaryType = "arraybuffer";
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        constructor() {
          setTimeout(() => {
            if (this.readyState !== 0) return;
            this.readyState = 1;
            this.onopen?.(new Event("open"));
            this.onmessage?.(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "ownership_state",
                  state: "controller",
                }),
              }),
            );
          }, 0);
        }
        send(raw: string) {
          const message = JSON.parse(raw);
          if (message.type === "input") {
            window.__keymapInputs.push(atob(message.data));
            this.onmessage?.(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "input_ack",
                  client_id: message.client_id,
                  sequence: message.sequence,
                }),
              }),
            );
          }
        }
        close() {
          this.readyState = 3;
          this.onclose?.(new CloseEvent("close"));
        }
      }
      window.WebSocket = TerminalSocket as unknown as typeof WebSocket;
    });
    await page.goto(
      `${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`,
    );
    await expect(page.locator(".xterm-helper-textarea")).toHaveCount(1);
    await page.getByTestId("open-settings").click();
    await page.getByRole("button", { name: "Keymap", exact: true }).click();
    const close = page.getByTestId("keymap-session.close");
    await close
      .getByRole("button", { name: "录入 Close Session", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "录入 Close Session", exact: true })
      .press("Control+w");
    await expect(close).toContainText("ctrl+w");
    await expect(close).toContainText("自定义");
    await expect(page).toHaveURL(new RegExp(FIXTURE_IDS.workspaceShell + "$"));
    await page
      .getByRole("button", { name: "录入 New Session", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "录入 New Session", exact: true })
      .press("Control+w");
    await expect(page.getByRole("alert")).toContainText("conflicts");
    await page.keyboard.press("Escape");
    await close
      .getByRole("button", { name: "禁用 Close Session", exact: true })
      .click();
    await expect(close).toContainText("已禁用");
    await page.screenshot({ path: "/tmp/treefold-keymap-settings.png" });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".xterm-helper-textarea").press("Control+w");
    await expect
      .poll(() => page!.evaluate(() => window.__keymapInputs))
      .toEqual(["\x17"]);
    await expect(page).toHaveURL(new RegExp(FIXTURE_IDS.workspaceShell + "$"));
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("keymap-session.close")).toContainText(
      "已禁用",
    );
    await page
      .getByRole("button", { name: "恢复默认 Close Session", exact: true })
      .click();
    await expect(page.getByTestId("keymap-session.close")).toContainText(
      "super+w",
    );
    await page.keyboard.press("Meta+w");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".xterm-helper-textarea").press("Meta+w");
    await expect(page).toHaveURL(
      new RegExp(`#\/workspaces\/${FIXTURE_IDS.workspace}$`),
    );
    harness.assertNoUnexpectedRequests();
  } finally {
    if (page)
      await page
        .screenshot({ path: "/tmp/treefold-keymap-last.png" })
        .catch(() => {});
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

test("Session shortcuts cycle in scope and create in the chosen directory", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "session-shortcuts",
    });
    await page.goto(
      `${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`,
    );
    await expect(page.locator(".xterm-helper-textarea")).toHaveCount(1);
    await page.locator(".xterm-helper-textarea").press("Control+Tab");
    await expect(page).toHaveURL(
      new RegExp(FIXTURE_IDS.sessionDevServer + "$"),
    );
    await page.locator(".xterm-helper-textarea").press("Control+Shift+Tab");
    await expect(page).toHaveURL(new RegExp(FIXTURE_IDS.workspaceShell + "$"));
    await page.locator(".xterm-helper-textarea").press("Meta+t");
    const dialog = page.getByRole("dialog", { name: "新建 Session" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Shell", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("目录", { exact: true }).fill("fixture-api");
    await page.screenshot({ path: "/tmp/treefold-new-session.png" });
    const creation = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request
          .url()
          .endsWith(`/api/workspaces/${FIXTURE_IDS.workspace}/sessions`),
    );
    await dialog.getByLabel("目录", { exact: true }).press("Enter");
    const request = await creation;
    expect(request.postDataJSON()).toEqual({
      kind: "shell",
      project_directory_id: FIXTURE_IDS.secondaryDirectory,
    });
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(
      new RegExp(FIXTURE_IDS.workspaceShell + "$"),
    );
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

test("settings Save sends only edited fields and supports resetting overrides", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "sparse-settings",
    });
    await page.goto(harness.baseUrl);
    await page.getByTestId("open-settings").click();
    const theme = page.getByTestId("settings-theme");
    await theme.selectOption("dark");
    const saved = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" && request.url().endsWith("/api/settings"),
    );
    await page.getByTestId("settings-save").click();
    expect((await saved).postDataJSON()).toEqual({ theme: "dark" });
    await expect(page.getByTestId("settings-save")).toBeEnabled();
    await page
      .getByRole("button", { name: "恢复默认设置", exact: true })
      .click();
    await expect(theme).toHaveValue("system");
    await page.screenshot({ path: "/tmp/treefold-preferences.png" });
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

for (const owner of [
  { name: "Project", path: `projects/${FIXTURE_IDS.project}` },
  { name: "Fork", path: `workspaces/${FIXTURE_IDS.fork}` },
]) {
  test(`new Session shortcut targets the current ${owner.name}`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({
        apiUrl: harness.apiUrl,
        sessionName: "shortcut-scope",
      });
      await page.goto(`${harness.baseUrl}/#/${owner.path}`);
      await expect(page.getByTestId("page-content")).toBeVisible();
      // Keymap is fetched independently of the owner detail.
      await expect
        .poll(async () =>
          (await page!.request.get(`${harness.apiUrl}/api/keymap`)).ok(),
        )
        .toBeTruthy();
      await page.keyboard.press("Meta+t");
      const dialog = page.getByRole("dialog", { name: "新建 Session" });
      await dialog.getByRole("button", { name: "Shell", exact: true }).click();
      const request = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`/api/${owner.path}/sessions`),
      );
      await dialog
        .getByRole("button", { name: "创建 Session", exact: true })
        .click();
      expect((await request).postDataJSON()).toEqual({
        kind: "shell",
        project_directory_id: FIXTURE_IDS.primaryDirectory,
      });
      await expect(page).toHaveURL(new RegExp(`#/${owner.path}/sessions/`));
      harness.assertNoUnexpectedRequests();
    } finally {
      try {
        await closeUiSession(page);
      } finally {
        await harness.close();
      }
    }
  });
}

declare global {
  interface Window {
    __keymapInputs: string[];
  }
}

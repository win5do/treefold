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
    await expect(close).toContainText("ctrl W");
    await expect(page).toHaveURL(new RegExp(FIXTURE_IDS.workspaceShell + "$"));
    await page
      .getByRole("button", { name: "录入 New Session", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "录入 New Session", exact: true })
      .press("Control+w");
    await expect(page.getByRole("alert")).toContainText("conflicts");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Close Session 操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "禁用快捷键", exact: true })
      .click();
    await expect(close).toContainText("未绑定");
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
      "未绑定",
    );
    await page
      .getByRole("button", { name: "Close Session 操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "恢复默认", exact: true }).click();
    await expect(page.getByTestId("keymap-session.close")).toContainText("⌘ W");
    await close
      .getByRole("button", { name: "录入 Close Session", exact: true })
      .click();
    const recorded = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith("/api/keymap"),
    );
    await page
      .getByRole("textbox", { name: "录入 Close Session", exact: true })
      .press("Meta+w");
    expect((await recorded).postDataJSON()).toEqual({
      bindings: { "session.close": "cmd+w" },
    });
    await expect(close).toContainText("⌘ W");
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
    // Hash changes precede the Session query and terminal mount. Target the
    // committed Session, so keys cannot reach the previous terminal mid-navigation.
    const terminal = (id: string) => page!.locator(`[data-testid="session-workspace"][data-session-id="${id}"] .xterm-helper-textarea`);
    await expect(terminal(FIXTURE_IDS.workspaceShell)).toBeAttached();
    await terminal(FIXTURE_IDS.workspaceShell).press("Control+Tab");
    await expect(page).toHaveURL(
      new RegExp(FIXTURE_IDS.sessionDevServer + "$"),
    );
    await expect(terminal(FIXTURE_IDS.sessionDevServer)).toBeAttached();
    await terminal(FIXTURE_IDS.sessionDevServer).press("Control+Shift+Tab");
    await expect(page).toHaveURL(new RegExp(FIXTURE_IDS.workspaceShell + "$"));
    await expect(terminal(FIXTURE_IDS.workspaceShell)).toBeAttached();
    await terminal(FIXTURE_IDS.workspaceShell).press("Meta+t");
    const dialog = page.getByRole("dialog", { name: "新建 Session" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Shell", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const directoryInput = dialog.getByLabel("目录", { exact: true });
    await expect(directoryInput).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("button", { name: "Agent", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("button", { name: "Shell", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "Shell", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("button", { name: "Agent", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("button", { name: "Shell", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("目录", { exact: true }).fill("fixture-api");
    await directoryInput.press("ArrowLeft");
    await expect(dialog.getByRole("button", { name: "Shell", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
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
    const confirmation = page.getByRole("alertdialog", {
      name: "恢复默认设置？",
    });
    await expect(confirmation).toBeVisible();
    await expect(theme).toHaveValue("dark");
    await page.screenshot({
      path: "/tmp/treefold-settings-reset-confirm.png",
      animations: "disabled",
    });
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    const persisted = await page.request.get(`${harness.apiUrl}/api/settings`);
    expect((await persisted.json()).theme).toBe("dark");
    await page
      .getByRole("button", { name: "恢复默认设置", exact: true })
      .click();
    const reset = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" && request.url().endsWith("/api/settings"),
    );
    await confirmation
      .getByRole("button", { name: "确认恢复", exact: true })
      .click();
    expect((await reset).postDataJSON()).toEqual({
      reset: [
        "language",
        "theme",
        "agents.codex.extra_args",
        "amux.keep_daemon_running_on_exit",
      ],
    });
    await expect(confirmation).toHaveCount(0);
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

test("Keymap resets all bindings only after confirmation, including filtered commands", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "keymap-reset-all",
    });
    await page.goto(harness.baseUrl);
    await page.request.patch(`${harness.apiUrl}/api/keymap`, {
      data: { bindings: { "session.close": false, "session.new": "ctrl+n" } },
    });
    await page.getByTestId("open-settings").click();
    await page.getByRole("button", { name: "Keymap", exact: true }).click();
    await expect(page.getByTestId("keymap-session.close")).toContainText(
      "未绑定",
    );
    await page.screenshot({
      path: "/tmp/treefold-keymap-layout.png",
      animations: "disabled",
    });
    await page.getByPlaceholder("搜索命令或快捷键").fill("New Session");
    const openReset = async () => {
      await page!
        .getByRole("button", { name: "Keymap 操作", exact: true })
        .click();
      await page!
        .getByRole("menuitem", { name: "恢复全部默认快捷键", exact: true })
        .click();
    };
    await openReset();
    const dialog = page.getByRole("alertdialog", {
      name: "恢复全部默认快捷键？",
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("keymap-session.new")).toContainText(
      "ctrl N",
    );
    await openReset();
    const reset = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith("/api/keymap"),
    );
    await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
    expect((await reset).postDataJSON()).toEqual({
      bindings: {
        "session.new": null,
        "session.close": null,
        "session.next": null,
        "session.previous": null,
        "app.palette.open": null,
      },
    });
    await expect(dialog).toHaveCount(0);
    await page.getByPlaceholder("搜索命令或快捷键").fill("");
    await expect(page.getByTestId("keymap-session.new")).toContainText("⌘ T");
    await expect(page.getByTestId("keymap-session.close")).toContainText("⌘ W");
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

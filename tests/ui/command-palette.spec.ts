import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

for (const owner of [
  { name: "Project", path: `projects/${FIXTURE_IDS.project}` },
  { name: "Workspace", path: `workspaces/${FIXTURE_IDS.workspace}` },
  { name: "Fork", path: `workspaces/${FIXTURE_IDS.fork}` },
]) {
  test(`palette keeps ${owner.name} context through focus and route changes`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    try {
      page = await createUiSession({
        apiUrl: harness.apiUrl,
        sessionName: "palette-context",
      });
      await page.goto(`${harness.baseUrl}/#/${owner.path}`);
      await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      const palette = page.getByRole("dialog", {
        name: "Command Palette",
        exact: true,
      });
      await expect(palette.getByRole("combobox")).toBeFocused();
      await expect(
        palette.getByRole("option", { name: /New Session/ }),
      ).toContainText("⌘ T");
      if (owner.name === "Workspace")
        await page.screenshot({
          path: "/tmp/treefold-command-palette.png",
          animations: "disabled",
        });
      // A background route transition must not retarget the captured invocation.
      await page.evaluate(() => {
        window.location.hash = "#/projects";
      });
      await expect(page).toHaveURL(/#\/projects$/);
      await palette.getByRole("combobox").fill("session.create.new");
      await palette.getByRole("combobox").press("Enter");
      const dialog = page.getByRole("dialog", { name: "新建 Session" });
      await expect(dialog.getByLabel("目录", { exact: true })).toBeFocused();
      await dialog.getByRole("button", { name: "Shell", exact: true }).click();
      const creation = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`/api/${owner.path}/sessions`),
      );
      await dialog
        .getByRole("button", { name: "创建 Session", exact: true })
        .click();
      expect((await creation).postDataJSON()).toEqual({
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

test("palette searches global actions, restores focus, and honors keymap overrides", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "palette-global",
    });
    await page.goto(harness.baseUrl);
    const settings = page.getByTestId("open-settings");
    await settings.focus();
    await page.keyboard.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", {
      name: "Command Palette",
      exact: true,
    });
    await expect(palette).toBeVisible();
    await expect(
      palette.getByRole("option", { name: /New Session/ }),
    ).toHaveCount(0);
    await palette.getByRole("combobox").fill("no-matching-action");
    await expect(palette).toContainText("No actions found.");
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await page.request.patch(`${harness.apiUrl}/api/keymap`, {
      data: { bindings: { "app.palette.open": "ctrl+p" } },
    });
    await expect(async () => {
      await page!.keyboard.press("Control+p");
      await expect(palette).toBeVisible();
    }).toPass();
    await palette.getByRole("combobox").fill("Open Settings");
    await palette.getByRole("combobox").press("Enter");
    await expect(
      page.getByRole("button", { name: "Keymap", exact: true }),
    ).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

test("palette uses the invoking Session after navigation and includes actions with disabled shortcuts", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    await fetch(`${harness.apiUrl}/api/keymap`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bindings: { "session.next": false } }),
    });
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "palette-session",
    });
    await page.goto(
      `${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.workspaceShell}`,
    );
    const terminal = page.locator(
      `[data-session-id="${FIXTURE_IDS.workspaceShell}"] .xterm-helper-textarea`,
    );
    await expect(terminal).toBeAttached();
    await terminal.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", {
      name: "Command Palette",
      exact: true,
    });
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.evaluate(() => {
      window.location.hash = "#/projects";
    });
    await palette.getByRole("combobox").fill("Next Session");
    await palette
      .getByRole("option", { name: "Next Session", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `${FIXTURE_IDS.workspace}/sessions/${FIXTURE_IDS.sessionDevServer}$`,
      ),
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

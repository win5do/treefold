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
      // A background route transition must not retarget the captured invocation.
      await page.evaluate(() => {
        window.location.hash = "#/projects";
      });
      await expect(page).toHaveURL(/#\/projects$/);
      await palette.getByRole("combobox").fill("session.create.new");
      await palette.getByRole("combobox").press("Enter");
      const dialog = page.getByRole("dialog", { name: "New Session" });
      await dialog.getByRole("button", { name: "Shell", exact: true }).click();
      const creation = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`/api/${owner.path}/sessions`),
      );
      await dialog
        .getByRole("button", { name: "Create Session", exact: true })
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
    await expect(palette.getByRole("option", { name: "Toggle Right Sidebar", exact: true })).toHaveCount(0);
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

test("palette toggles left and right sidebars independently", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-sidebars" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const right = page.getByTestId("right-sidebar");
    await expect(right).toHaveAttribute("aria-hidden", "true");
    async function toggle(name: string) {
      await page!.keyboard.press("Meta+Shift+p");
      const palette = page!.getByRole("dialog", { name: "Command Palette", exact: true });
      await palette.getByRole("option", { name, exact: true }).click();
      await expect(palette).toHaveCount(0);
    }
    await toggle("Toggle Left Sidebar");
    await expect(page.getByRole("button", { name: "Show left sidebar", exact: true })).toBeVisible();
    await expect(right).toHaveAttribute("aria-hidden", "true");
    await toggle("Toggle Right Sidebar");
    await expect(right).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByRole("button", { name: "Show left sidebar", exact: true })).toBeVisible();
    await toggle("Toggle Left Sidebar");
    await expect(page.getByRole("button", { name: "Hide left sidebar", exact: true })).toBeVisible();
    await expect(right).toHaveAttribute("aria-hidden", "false");
    await toggle("Toggle Right Sidebar");
    await expect(right).toHaveAttribute("aria-hidden", "true");
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
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

for (const owner of [
  { name: "Project", path: `projects/${FIXTURE_IDS.project}`, repository: FIXTURE_IDS.primaryRepository, api: "project-repositories" },
  { name: "Workspace", path: `workspaces/${FIXTURE_IDS.workspace}`, repository: FIXTURE_IDS.workspacePrimaryLocation, api: "workspace-repositories" },
]) {
  test(`palette opens an independent ${owner.name} sync menu and submits the captured target`, async () => {
    const harness = await startUiHarness((fixture) => {
      const repositories = fixture.workspaceDetails[FIXTURE_IDS.workspace].repositories;
      repositories.push({
        ...repositories[0],
        id: FIXTURE_IDS.workspaceReadonlyLocation,
        repository_name: "Read-only repository",
        access_mode: "read_only",
      });
    });
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-sync" });
      await page.goto(`${harness.baseUrl}/#/${owner.path}`);
      await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
      const search = palette.getByRole("combobox");
      await search.fill("push");
      await expect(palette.getByRole("option", { name: "Push", exact: true })).toHaveAttribute("aria-selected", "true");
      await search.press("Enter");
      await expect(palette).toHaveCount(0);
      expect(harness.syncRequests).toEqual([]);
      const menu = page.getByRole("menu", { name: "Push", exact: true });
      await expect(menu.getByRole("menuitem", { name: "Push All", exact: true })).toBeFocused();
      // Failed and read-only Workspace repositories must not become sync targets.
      await expect(menu.getByRole("menuitem")).toHaveCount(owner.name === "Project" ? 3 : 2);
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "fixture-repository", exact: true })).toBeFocused();
      await page.evaluate(() => { window.location.hash = "#/projects"; });
      await expect(page).toHaveURL(/#\/projects$/);
      await page.keyboard.press("Enter");
      await expect(menu).toHaveCount(0);
      await expect.poll(() => harness.syncRequests).toEqual([`/api/${owner.api}/${owner.repository}/git/push`]);
      await expect(page.getByRole("status")).toContainText("Push succeeded");

      await page.goto(`${harness.baseUrl}/#/${owner.path}`);
      await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      await palette.getByRole("option", { name: "Pull", exact: true }).click();
      await expect(palette).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Pull All", exact: true }).click();
      await expect.poll(() => harness.syncRequests.at(-1)).toBe(`/api/${owner.path}/git/pull-all`);
      harness.assertNoUnexpectedRequests();
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

test("palette searches IDs and both languages while keeping contextual actions first", async () => {
  const harness = await startUiHarness((fixture) => { fixture.settings.language = "zh-CN"; });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-search" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await expect(page.getByTestId("open-settings")).toHaveAccessibleName("设置");
    await expect(page.getByTestId("page-content")).toBeVisible();
    await page.keyboard.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
    const search = palette.getByRole("combobox");
    await expect(palette.getByRole("option", { name: "新建 Session", exact: true })).toHaveAttribute("aria-selected", "true");
    for (const query of ["SESSION.CREATE.NEW", "New Session", "新建 Session", "scrnew"]) {
      await search.fill(query);
      await expect(palette.getByRole("option", { name: "新建 Session", exact: true })).toHaveAttribute("aria-selected", "true");
    }
    await search.fill("open");
    await expect(palette.getByRole("option", { name: "打开方式", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowDown");
    await expect(palette.getByRole("option", { name: "AI Review", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowDown");
    await expect(palette.getByRole("option", { name: "打开设置", exact: true })).toHaveAttribute("aria-selected", "true");
    await search.fill("⌘ T");
    await expect(palette.getByRole("option")).toHaveCount(0);
    await search.fill("app.settings.open");
    await search.press("Enter");
    await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("palette hides sync actions in Fork and archived contexts", async () => {
  const harness = await startUiHarness((fixture) => {
    fixture.workspaceDetails[FIXTURE_IDS.archivedWorkspace] = {
      ...fixture.workspaceDetails[FIXTURE_IDS.workspace],
      id: FIXTURE_IDS.archivedWorkspace,
      status: "archived",
      sessions: [],
    };
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "palette-availability" });
    for (const id of [FIXTURE_IDS.fork, FIXTURE_IDS.archivedWorkspace]) {
      await page.goto(`${harness.baseUrl}/#/workspaces/${id}`);
      await expect(page.getByTestId("page-content")).toBeVisible();
      await page.keyboard.press("Meta+Shift+p");
      const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
      await expect(palette.getByRole("option", { name: "Push", exact: true })).toHaveCount(0);
      await expect(palette.getByRole("option", { name: "Pull", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

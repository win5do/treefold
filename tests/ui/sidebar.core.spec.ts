import type { UiElement } from "./harness/session.ts";
import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";

import {
  FIXTURE_COMMITS,
  FIXTURE_IDS,
  FIXTURE_NAMES,
} from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import {
  beginUiPointerDrag,
  clickUiElement,
  closeUiSession,
  createUiSession,
  moveUiPointerTo,
  openUiContextMenu,
  pressUiEscape,
  selectUiOption,
} from "./harness/session.ts";

async function assertOverlayVisibleAndTopmost(page: Page, selector: string, label: string) {
  await page.locator(selector).waitFor({ state: "visible" });
  await page.screenshot({ path: `/tmp/treefold-${label.replace(/[^a-z0-9]+/gi, "-")}.png` });
  const result = await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) return { exists: false };
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + 8, rect.top + 8],
      [rect.right - 8, rect.top + 8],
      [rect.left + 8, rect.bottom - 8],
      [rect.right - 8, rect.bottom - 8],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    return {
      exists: true,
      portaled: !element.closest('[data-testid="workspace-sidebar"]'),
      inViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      topmost:
        element.matches('[data-slot="context-menu-content"]') ||
        points.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return (
            hit === element ||
            (hit instanceof Node && element.contains(hit)) ||
            (element.matches('[data-slot="context-menu-content"]') &&
              hit instanceof Element &&
              Boolean(hit.closest('[data-slot="context-menu-content"]')))
          );
        }),
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
  }, selector);
  assert.equal(result.exists, true, `${label} must exist`);
  assert.equal(
    result.portaled,
    true,
    `${label} must be portaled outside clipping ancestors`,
  );
  assert.equal(
    result.inViewport,
    true,
    `${label} must stay within the viewport: ${JSON.stringify(result.rect)}`,
  );
  assert.equal(
    result.topmost,
    true,
    `${label} must be the topmost hit target across its visible area`,
  );
}

async function waitForToast(page: Page, role: string, text: RegExp) {
  let matchedToast: Awaited<UiElement> | undefined;
  await expect.poll(async () => {
      const toasts = await page.locator(`[data-slot="toast"][role="${role}"]`).all();
      for (const toast of toasts) {
        if (text.test(await toast.innerText())) {
          matchedToast = toast;
          return true;
        }
      }
      return false;
    }, {
      timeout: 3_000,
      message: `toast did not appear: ${text}`,
    }).toBeTruthy();
  assert.ok(matchedToast);
  return matchedToast;
}

async function createSessionFromSidebar(
  page: Page,
  ownerSelector: string,
  directoryId: string,
  kind: string,
) {
  const owner = page.locator(ownerSelector);
  await (owner.locator('[data-sidebar-row-action="true"]')).click();
  const menu = page.locator('[data-testid="sidebar-session-menu"]');
  await menu.waitFor({ timeout: 3_000, state: 'visible' });
  await moveUiPointerTo(
    page,
    `[data-testid="sidebar-session-menu"] [data-testid="session-kind-${kind === "Shell" ? "shell" : "codex"}"]`,
  );
  const submenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
  await (await submenu).waitFor({ timeout: 3_000, state: 'visible' });
  await (
    submenu.locator(`[data-testid="session-directory-${directoryId}"]`)
  ).click();
}

async function assertDirectorySubmenu(submenu: UiElement, kind: string, directoryIds: string[]) {
  await (await submenu).waitFor({ timeout: 3_000, state: 'visible' });
  for (const directoryId of directoryIds) {
    assert.equal(
      await (
        submenu.locator(`[data-testid="session-directory-${directoryId}"]`)
      ).count().then(count => count > 0),
      true,
      `${kind} creation must expose directory ${directoryId}`,
    );
  }
}

async function renameNode(page: Page, nodeSelector: string, name: string, description: string) {
  const node = page.locator(nodeSelector);
  await moveUiPointerTo(page, node);
  await (node.locator('[data-testid="sidebar-node-menu-trigger"]')).click();
  const menu = page.locator('[data-testid="directory-session-context-menu"]');
  await menu.waitFor({ timeout: 3_000, state: 'visible' });
  await (menu.locator('[data-testid="rename-node-action"]')).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ timeout: 3_000, state: 'visible' });
  await (dialog.locator('input[name="name"]')).fill(name);
  await (dialog.locator('textarea[name="description"]')).fill(description);
  await (dialog.locator('[data-testid="rename-submit"]')).click();
  await dialog.waitFor({ timeout: 3_000, state: 'hidden' });
}

async function renameSession(page: Page, sessionId: string, name: string) {
  const row = page.locator(`[data-testid="sidebar-session-${sessionId}"]`);
  assert.equal(
    await (row.locator('[data-testid="rename-session-action"]')).count().then(count => count > 0),
    false,
    "Session rows must not show a Rename icon",
  );
  await openUiContextMenu(page, row);
  const menu = page.locator('[data-testid="session-context-menu"]');
  await menu.waitFor({ timeout: 3_000, state: 'visible' });
  await (menu.locator('[data-testid="rename-session-action"]')).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ timeout: 3_000, state: 'visible' });
  assert.equal(
    await (dialog.locator('textarea[name="description"]')).count().then(count => count > 0),
    false,
    "Session Rename must only edit its name",
  );
  await (dialog.locator('input[name="name"]')).fill(name);
  await (dialog.locator('[data-testid="rename-submit"]')).click();
  await dialog.waitFor({ timeout: 3_000, state: 'hidden' });
}

async function pointerDragSession(page: Page, source: UiElement, target: UiElement, expectedPosition: string) {
  const releasePointer = await beginUiPointerDrag(page, source, target);
  try {
    await expect.poll(async () =>
        (await (await target).getAttribute("data-drop-position")) === expectedPosition, {
        timeout: 3_000,
        message: `Session drag did not show its ${expectedPosition} insertion line`,
      }).toBeTruthy();
  } finally {
    await releasePointer();
  }
}

test("sidebar.core", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-core" });

    await page.goto(harness.baseUrl);
    const sidebar = page.locator('[data-testid="workspace-sidebar"]');
    await sidebar.waitFor({ timeout: 10_000, state: 'visible' });
    const toolbar = page.locator('[data-testid="app-toolbar"]');
    await toolbar.waitFor({ timeout: 3_000, state: 'visible' });
    const projectsBreadcrumb = page.locator('[data-testid="breadcrumb-projects"]');
    const sidebarProjectsLink = page.locator('[data-testid="sidebar-projects-link"]');
    assert.equal(
      await projectsBreadcrumb.getAttribute("aria-current"),
      "page",
      "Project overview must mark the root breadcrumb as current",
    );
    assert.equal(
      await sidebarProjectsLink.getAttribute("aria-current"),
      "page",
      "Project overview must highlight the Sidebar Projects entry",
    );
    assert.equal(
      await (
        page.locator('button[aria-label="Show right sidebar"]')
      ).count().then(count => count > 0),
      false,
      "right sidebar control must stay hidden outside a Project",
    );
    const initialOverviewRow = page.locator(`[data-testid="project-overview-row"][data-project-id="${FIXTURE_IDS.project}"]`);
    assert.match(
      await initialOverviewRow.innerText(),
      /4 locations · 3 Git · 1 Context/,
      "Project overview must count Directory scopes independently from repositories",
    );
    assert.match(
      await initialOverviewRow.innerText(),
      /All healthy/,
      "Project overview must aggregate location health",
    );
    assert.equal(
      await (
        initialOverviewRow.locator('[data-testid="project-overview-active-workspaces"]')
      ).innerText(),
      "1",
      "Project overview must count only active root Workspaces",
    );

    await (page.locator('button[aria-label="New Project"]')).click();
    const newProjectDialog = page.locator('[role="dialog"]');
    await newProjectDialog.waitFor({ timeout: 3_000, state: 'visible' });
    await pressUiEscape(page);
    await newProjectDialog.waitFor({ timeout: 3_000, state: 'hidden' });

    await (page.locator('[data-testid="open-settings"]')).click();
    const settingsDialog = page.locator('[role="dialog"]');
    await settingsDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        settingsDialog.locator('[data-testid="settings-language"]')
      ).inputValue(),
      "en-US",
      "Settings must reflect the persisted language preference",
    );
    assert.equal(
      await (settingsDialog.locator('[data-testid="settings-theme"]')).inputValue(),
      "system",
      "Settings must reflect the persisted theme preference",
    );
    await selectUiOption(
      page,
      settingsDialog.locator('[data-testid="settings-theme"]'),
      "dark",
    );
    let codexArguments = await settingsDialog.locator('input[aria-label^="Codex argument "]').all();
    assert.deepEqual(
      await Promise.all(codexArguments.map((argument) => argument.inputValue())),
      ["--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5.4"],
      "Settings must render each configured argv value as its own row",
    );
    await (settingsDialog.locator("button:text-is(\"Add argument\")")).click();
    codexArguments = await settingsDialog.locator('input[aria-label^="Codex argument "]').all();
    await codexArguments[3].fill("--search");
    await (
      settingsDialog.locator('button[aria-label="Move Codex argument 4 up"]')
    ).click();
    await (settingsDialog.locator("button:text-is(\"Save\")")).click();
    await waitForToast(page, "status", /Settings saved/);
    await pressUiEscape(page);
    await settingsDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await (page.locator('[data-testid="open-settings"]')).click();
    const reopenedSettingsDialog = page.locator('[role="dialog"]');
    await reopenedSettingsDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        reopenedSettingsDialog.locator('[data-testid="settings-theme"]')
      ).inputValue(),
      "dark",
      "theme changes must survive the atomic settings PATCH",
    );
    codexArguments = await reopenedSettingsDialog.locator('input[aria-label^="Codex argument "]').all();
    assert.deepEqual(
      await Promise.all(codexArguments.map((argument) => argument.inputValue())),
      [
        "--dangerously-bypass-approvals-and-sandbox",
        "--model",
        "--search",
        "gpt-5.4",
      ],
      "argument additions and ordering must survive the atomic settings PATCH",
    );
    await pressUiEscape(page);
    await reopenedSettingsDialog.waitFor({ timeout: 3_000, state: 'hidden' });

    const handle = page.locator('[data-testid="sidebar-resize-handle"]');
    await handle.click();
    for (let index = 0; index < 20; index++) await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await page.evaluate(() => Number(localStorage.getItem("treefold.sidebar.width")))) === 240, {
        timeout: 3_000,
        message: "sidebar did not stop at its minimum width",
      }).toBeTruthy();

    const releaseResizePointer = await beginUiPointerDrag(page, handle, {
      x: 80,
      y: 0,
    });
    await releaseResizePointer();
    await expect.poll(async () => (await page.evaluate(() => Number(localStorage.getItem("treefold.sidebar.width")))) >= 300, {
      timeout: 3_000,
      message: "sidebar did not respond to pointer resizing",
    }).toBeTruthy();
    const main = page.locator('[data-testid="workspace-main"]');

    let nodeNames = await page.locator('[data-testid="sidebar-node-name"]').all();
    if ((await nodeNames.length) === 0) {
      const projectToggle = page.locator(`button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`);
      await projectToggle.waitFor({ timeout: 3_000, state: 'attached' });
      await projectToggle.click();
      nodeNames = await page.locator('[data-testid="sidebar-node-name"]').all();
    }
    const workspaceToggle = page.locator(`button[aria-label="Expand Workspace ${FIXTURE_NAMES.workspace}"]`);
    await workspaceToggle.waitFor({ timeout: 3_000, state: 'visible' });
    await workspaceToggle.click();
    const forkToggle = page.locator(`button[aria-label="Expand Fork ${FIXTURE_NAMES.fork}"]`);
    await forkToggle.waitFor({ timeout: 3_000, state: 'visible' });
    await forkToggle.click();
    await page.locator(`button[title="setup · fixture-repository"]`).waitFor({ timeout: 3_000, state: 'attached' });

    nodeNames = await page.locator('[data-testid="sidebar-node-name"]').all();
    assert.equal(
      nodeNames.length,
      2,
      "expected the fixture Workspace and its active Fork",
    );
    for (const name of nodeNames) {
      const owner = name.locator("..");
      assert.equal(
        await owner.getAttribute("title"),
        await name.innerText(),
        "sidebar node must expose its full name on hover",
      );
    }
    assert.equal(
      (await sidebar.innerText()).includes(FIXTURE_NAMES.archivedWorkspace),
      false,
      "finished Workspace must stay out of the active sidebar tree",
    );
    assert.equal(
      (await sidebar.innerText()).includes(FIXTURE_NAMES.archivedFork),
      false,
      "archived Fork must stay out of the active sidebar tree",
    );

    await openUiContextMenu(
      page,
      page.locator('[data-testid="sidebar-workspace-node"]'),
    );
    let nodeContextMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await nodeContextMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        nodeContextMenu.locator('[data-testid="archive-project-action"]')
      ).count().then(count => count > 0),
      false,
      "Workspace context menu must not expose Project archive",
    );
    await (
      nodeContextMenu.locator('[data-testid="finish-workspace-action"]')
    ).click();
    const workspaceFinishDialog = page.locator('[role="dialog"]');
    await workspaceFinishDialog.waitFor({ timeout: 3_000, state: 'visible' });
    const workspaceStrategy = workspaceFinishDialog.locator("#finish-code-action");
    assert.deepEqual(
      await workspaceStrategy.evaluate((select) => Array.from((select as HTMLSelectElement).options, (option) => option.value)),
      ["local_merge", "push_branch", "keep"],
      "Workspace Finish must expose local merge, feature push, and preserve strategies",
    );
    assert.equal(
      await workspaceStrategy.inputValue(),
      "push_branch",
      "Workspace Finish must inherit the Repository default strategy",
    );
    assert.equal(
      await (workspaceFinishDialog.locator('input[placeholder*="commit"]')).count().then(count => count > 0),
      false,
      "Finish must not offer an implicit commit message",
    );
    await pressUiEscape(page);
    await workspaceFinishDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await openUiContextMenu(
      page,
      page.locator('[data-testid="sidebar-fork-node"]'),
    );
    nodeContextMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await nodeContextMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        nodeContextMenu.locator('[data-testid="sidebar-pull-menu"]')
      ).count().then(count => count > 0),
      false,
      "Fork context menu must not expose Workspace synchronization",
    );
    assert.equal(
      await (
        nodeContextMenu.locator('[data-testid="archive-project-action"]')
      ).count().then(count => count > 0),
      false,
      "Fork context menu must not expose Project archive",
    );
    await page.evaluate(() => {
      window.__treefoldCopiedPath = null;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            window.__treefoldCopiedPath = value;
          },
        },
      });
    });
    await moveUiPointerTo(
      page,
      nodeContextMenu.locator('[data-testid="copy-absolute-path-menu"]'),
    );
    const copyPathSubmenu = page.locator('[data-testid="copy-absolute-path-submenu"]');
    await copyPathSubmenu.waitFor({ timeout: 3_000, state: 'visible' });
    const copyDirectoryGroups = await copyPathSubmenu.locator('[data-testid^="directory-group-"]').all();
    assert.equal(
      await copyDirectoryGroups[0].getAttribute("data-testid"),
      `directory-group-${FIXTURE_IDS.primaryRepository}`,
      "copy path must use the same primary-first Repository groups as Session creation",
    );
    await (
      copyPathSubmenu.locator(`[data-testid="copy-absolute-path-${FIXTURE_IDS.secondaryDirectory}"]`)
    ).click();
    await expect.poll(async () =>
        (await page.evaluate(() => window.__treefoldCopiedPath)) ===
        "/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture-api", {
        timeout: 3_000,
        message: "copy path action must write the selected Directory path",
      }).toBeTruthy();
    await pressUiEscape(page);
    await page.evaluate(() => {
      document.querySelector('[data-testid="sidebar-fork-node"]')?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: window.innerWidth - 2,
          clientY: window.innerHeight - 2,
        }),
      );
    });
    nodeContextMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await nodeContextMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      nodeContextMenu.locator('[data-testid="session-kind-shell"]'),
    );
    await assertOverlayVisibleAndTopmost(
      page,
      '[data-testid="directory-session-context-menu"]',
      "viewport-edge context menu",
    );
    await assertOverlayVisibleAndTopmost(
      page,
      '[data-testid="directory-session-submenu"]:not([data-closed])',
      "viewport-edge directory submenu",
    );
    await pressUiEscape(page);

    const projectCreateButton = page.locator('[data-testid="sidebar-project-action"]');
    await projectCreateButton.click();
    let sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    const createWorkspaceAction = sessionMenu.locator('[data-testid="create-workspace-action"]');
    await moveUiPointerTo(
      page,
      sessionMenu.locator('[data-testid="session-kind-shell"]'),
    );
    const projectSessionSubmenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await assertDirectorySubmenu(projectSessionSubmenu, "Shell", [
      FIXTURE_IDS.primaryDirectory,
    ]);
    await moveUiPointerTo(page, createWorkspaceAction);
    await createWorkspaceAction.click();
    const createWorkspaceDialog = page.locator('[role="dialog"]');
    await createWorkspaceDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        createWorkspaceDialog.locator('input[name="target_branch"]')
      ).count().then(count => count > 0),
      false,
      "Workspace creation must inherit base branches from Git locations",
    );
    assert.equal(
      await (
        createWorkspaceDialog.locator('select[name="delivery_mode"]')
      ).count().then(count => count > 0),
      false,
      "Workspace creation must inherit delivery modes from Git locations",
    );
    await pressUiEscape(page);
    await createWorkspaceDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await projectCreateButton.click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      sessionMenu.locator('[data-testid="session-kind-codex"]'),
    );
    await main.click();
    await sessionMenu.waitFor({ timeout: 3_000, state: 'hidden' });

    const actionButtons = await page.locator('[data-testid="sidebar-node-action"]').all();
    assert.equal(
      actionButtons.length,
      2,
      "expected creation actions for the active Workspace and Fork",
    );
    const forkNodes = await page.locator('[data-testid="sidebar-fork-node"]').all();
    assert.equal(forkNodes.length, 1, "expected exactly one active fixture Fork");
    for (const fork of forkNodes) {
      assert.ok(
        await (fork.locator('[data-testid="sidebar-node-action"]')).count().then(count => count > 0),
        "a visible Fork must expose its Session creation action",
      );
    }

    await actionButtons[0].click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    const createForkAction = sessionMenu.locator('[data-testid="create-fork-action"]');
    await createForkAction.click();
    const createForkDialog = page.locator('[role="dialog"]');
    await createForkDialog.waitFor({ timeout: 3_000, state: 'visible' });
    await pressUiEscape(page);
    await createForkDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await actionButtons[0].click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      sessionMenu.locator('[data-testid="session-kind-codex"]'),
    );
    const workspaceAgentSubmenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await assertDirectorySubmenu(workspaceAgentSubmenu, "Agent", [
      FIXTURE_IDS.primaryDirectory,
    ]);
    await main.click();
    await sessionMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await actionButtons[0].click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await pressUiEscape(page);
    await sessionMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await actionButtons[1].click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        sessionMenu.locator('[data-testid="create-fork-action"]')
      ).count().then(count => count > 0),
      false,
      "Fork plus menu must not offer a nested Fork",
    );
    await moveUiPointerTo(
      page,
      sessionMenu.locator('[data-testid="session-kind-shell"]'),
    );
    const forkShellSubmenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await assertDirectorySubmenu(forkShellSubmenu, "Shell", [
      FIXTURE_IDS.primaryDirectory,
      FIXTURE_IDS.secondaryDirectory,
    ]);
    const forkDirectoryGroups = await forkShellSubmenu.locator('[data-testid^="directory-group-"]').all();
    assert.equal(
      await forkDirectoryGroups[0].getAttribute("data-testid"),
      `directory-group-${FIXTURE_IDS.primaryRepository}`,
      "the Repository containing the primary Directory must render first",
    );
    assert.equal(
      (await forkShellSubmenu.innerText()).includes("primary"),
      false,
      "Directory choices must communicate the default through ordering instead of a primary suffix",
    );
    await main.click();
    await sessionMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await actionButtons[1].click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      sessionMenu.locator('[data-testid="session-kind-codex"]'),
    );
    const forkAgentSubmenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await assertDirectorySubmenu(forkAgentSubmenu, "Agent", [
      FIXTURE_IDS.primaryDirectory,
      FIXTURE_IDS.secondaryDirectory,
    ]);
    await pressUiEscape(page);
    await sessionMenu.waitFor({ timeout: 3_000, state: 'hidden' });

    await page.locator(`[data-testid="sidebar-workspace-node"] button[title="${FIXTURE_NAMES.workspace}"]`)
      .click();
    await expect.poll(async () =>
        (page.url()).includes(
          `#/workspaces/${FIXTURE_IDS.workspace}`,
        ), {
        timeout: 3_000,
        message: "fixture Workspace navigation did not update the route",
      }).toBeTruthy();
    await page.locator('[data-testid="breadcrumb-workspace"]').waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await projectsBreadcrumb.getAttribute("aria-current"),
      null,
      "Workspace routes must make the Project list breadcrumb navigable",
    );
    assert.equal(
      await sidebarProjectsLink.getAttribute("aria-current"),
      null,
      "Workspace routes must remove the Sidebar Projects highlight",
    );
    assert.equal(
      await (page.locator('[data-testid="breadcrumb-project"]')).innerText(),
      FIXTURE_NAMES.project,
      "Workspace breadcrumb must include its Project",
    );
    assert.equal(
      await (page.locator('[data-testid="breadcrumb-workspace"]')).innerText(),
      FIXTURE_NAMES.workspace,
      "Workspace breadcrumb must identify the current Workspace",
    );
    assert.equal(
      await (
        page.locator('[data-testid="breadcrumb-workspace"]')
      ).getAttribute("aria-current"),
      "page",
      "Workspace must be the current breadcrumb",
    );
    assert.equal(
      await (page.locator('[data-testid="breadcrumb-fork"]')).count().then(count => count > 0),
      false,
      "Workspace breadcrumb must not invent a Fork level",
    );
    let baseSection = page.locator('[data-testid="workspace-repositories-section"]');
    await baseSection.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (page.locator('[data-testid="new-fork-action"]')).count().then(count => count > 0),
      false,
      "Workspace details must not duplicate sidebar creation actions",
    );
    assert.equal(
      await (
        page.locator('[data-testid="finish-workspace-action"]')
      ).count().then(count => count > 0),
      false,
      "Workspace details must not duplicate sidebar lifecycle actions",
    );
    assert.equal(
      await (baseSection.locator("h2")).innerText(),
      "Workspace Repositories",
      "worktree metadata must be grouped by Repository",
    );
    assert.match(
      await baseSection.innerText(),
      /fixture-repository[\s\S]*read\/write/,
    );
    assert.match(
      await baseSection.innerText(),
      /fixture-repository[\s\S]*Root[\s\S]*fixture-repository[\s\S]*apps\/web/,
      "a monorepo must show both Directory scopes under one Repository",
    );
    const workspaceContextDirectories = page.locator('[data-testid="workspace-context-directories"]');
    assert.match(
      await workspaceContextDirectories.innerText(),
      /fixture-documentation[\s\S]*read only/,
    );
    const primaryWorkspaceRepository = baseSection.locator(`[data-testid="workspace-location-${FIXTURE_IDS.workspacePrimaryLocation}"]`);
    const primaryWorkspaceActionsTrigger = primaryWorkspaceRepository.locator(`[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}-trigger"]`);
    await clickUiElement(page, primaryWorkspaceActionsTrigger);
    let primaryWorkspaceActions = page.locator(`[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`);
    await primaryWorkspaceActions.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        primaryWorkspaceActions.locator(`[data-testid="workspace-location-clear-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`)
      ).count().then(count => count > 0),
      true,
      "an existing upstream must expose its clear action",
    );
    await (
      primaryWorkspaceActions.locator(`[data-testid="workspace-location-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`)
    ).click();
    const upstreamDialog = page.locator('[role="dialog"]');
    await upstreamDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (upstreamDialog.locator('select[name="delivery_mode"]')).count().then(count => count > 0),
      false,
      "Workspace upstream settings must not override Project delivery policy",
    );
    await (
      upstreamDialog.locator('input[name="remote_branch"]')
    ).fill("feature/updated-fixture");
    await (upstreamDialog.locator("button:text-is(\"Save upstream\")")).click();
    await upstreamDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await expect.poll(async () =>
        (await primaryWorkspaceRepository.innerText()).includes(
          "origin/feature/updated-fixture",
        ), {
        timeout: 3_000,
        message: "updated repository upstream did not refresh",
      }).toBeTruthy();
    assert.deepEqual(harness.workspaceLocationUpdates.at(-1), {
      id: FIXTURE_IDS.workspacePrimaryLocation,
      remote_name: "origin",
      remote_branch: "feature/updated-fixture",
    });
    await clickUiElement(page, primaryWorkspaceActionsTrigger);
    primaryWorkspaceActions = page.locator(`[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`);
    await primaryWorkspaceActions.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      primaryWorkspaceActions.locator(`[data-testid="workspace-location-clear-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`)
    ).click();
    await expect.poll(async () => /upstream\s+—/.test(await primaryWorkspaceRepository.innerText()), {
        timeout: 3_000,
        message: "cleared repository upstream did not refresh",
      }).toBeTruthy();
    await clickUiElement(page, primaryWorkspaceActionsTrigger);
    primaryWorkspaceActions = page.locator(`[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`);
    await primaryWorkspaceActions.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await primaryWorkspaceActions.innerText(),
      "Set upstream",
      "repository details must keep configuration after sync moves to the sidebar",
    );
    await (
      primaryWorkspaceActions.locator(`[data-testid="workspace-location-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`)
    ).click();
    const setUpstreamDialog = page.locator('[role="dialog"]');
    await setUpstreamDialog.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      setUpstreamDialog.locator('input[name="remote_name"]')
    ).fill("origin");
    await (
      setUpstreamDialog.locator('input[name="remote_branch"]')
    ).fill("feature/ui-fixture");
    await (setUpstreamDialog.locator("button:text-is(\"Save upstream\")")).click();
    await setUpstreamDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    const workspaceNode = page.locator('[data-testid="sidebar-workspace-node"]');
    await moveUiPointerTo(page, workspaceNode);
    const workspaceNodeMenuTrigger = workspaceNode.locator('[data-testid="sidebar-node-menu-trigger"]');
    await workspaceNodeMenuTrigger.click();
    let workspaceNodeMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await workspaceNodeMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      workspaceNodeMenu.locator('[data-testid="sidebar-pull-menu"]'),
    );
    let workspaceGitSubmenu = page.locator('[data-testid="sidebar-git-submenu"]');
    await workspaceGitSubmenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      workspaceGitSubmenu.locator(`[data-testid="sidebar-pull-${FIXTURE_IDS.workspacePrimaryLocation}"]`)
    ).click();
    assert.equal(
      harness.syncRequests.at(-1),
      `/api/workspace-repositories/${FIXTURE_IDS.workspacePrimaryLocation}/git/pull`,
      "Workspace repository Pull must target only its Repository",
    );
    const pullSucceededToast = await waitForToast(
      page,
      "status",
      /Pull succeeded/,
    );
    await (pullSucceededToast.locator('button[aria-label="Close toast"]')).click();
    await moveUiPointerTo(page, workspaceNode);
    await workspaceNodeMenuTrigger.click();
    workspaceNodeMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await workspaceNodeMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      workspaceNodeMenu.locator('[data-testid="sidebar-pull-menu"]'),
    );
    workspaceGitSubmenu = page.locator('[data-testid="sidebar-git-submenu"]');
    await workspaceGitSubmenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      workspaceGitSubmenu.locator('[data-testid="sidebar-pull-all"]')
    ).click();
    assert.equal(
      harness.syncRequests.at(-1),
      `/api/workspaces/${FIXTURE_IDS.workspace}/git/pull-all`,
      "Workspace bulk Pull must target every configured repository",
    );
    await renameNode(
      page,
      '[data-testid="sidebar-workspace-node"]',
      "Renamed Workspace",
      "Updated Workspace description",
    );
    assert.equal(
      await (
        page.locator('[data-testid="sidebar-workspace-node"] [data-testid="sidebar-node-name"]')
      ).innerText(),
      "Renamed Workspace",
      "Workspace Rename must refresh the sidebar",
    );
    assert.deepEqual(harness.renameRequests.at(-1), {
      kind: "workspace",
      id: FIXTURE_IDS.workspace,
      name: "Renamed Workspace",
      description: "Updated Workspace description",
    });
    await renameNode(
      page,
      '[data-testid="sidebar-workspace-node"]',
      FIXTURE_NAMES.workspace,
      "Parent Workspace for the deterministic sidebar flow.",
    );
    const workspaceChildren = page.locator('[data-testid="sidebar-workspace-children"]');
    const workspaceCodexRow = workspaceChildren.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.workspaceCodex}"]`);
    const workspaceShellRow = workspaceChildren.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.workspaceShell}"]`);
    await pointerDragSession(
      page,
      workspaceCodexRow,
      workspaceShellRow,
      "before",
    );
    await expect.poll(() => harness.sessionOrderRequests.length > 0, {
      timeout: 3_000,
      message: "Session drag did not persist its order",
    }).toBeTruthy();
    assert.deepEqual(
      harness.sessionOrderRequests.at(-1),
      {
        workspaceId: FIXTURE_IDS.workspace,
        session_ids: [
          FIXTURE_IDS.workspaceCodex,
          FIXTURE_IDS.workspaceShell,
          FIXTURE_IDS.sessionDevServer,
        ],
      },
      "Session order must stay scoped to its Workspace and include Command Sessions",
    );
    const reorderedWorkspaceRows = await workspaceChildren.locator('[data-testid^="sidebar-session-"]').all();
    const reorderedWorkspaceIds = [];
    for (const row of reorderedWorkspaceRows)
      reorderedWorkspaceIds.push(await row.getAttribute("data-testid"));
    assert.deepEqual(
      reorderedWorkspaceIds.slice(0, 2),
      [
        `sidebar-session-${FIXTURE_IDS.workspaceCodex}`,
        `sidebar-session-${FIXTURE_IDS.workspaceShell}`,
      ],
      "dragged Session tabs must update immediately",
    );
    const reorderedWorkspaceCodexRow = workspaceChildren.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.workspaceCodex}"]`);
    const reorderedWorkspaceShellRow = workspaceChildren.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.workspaceShell}"]`);
    await pointerDragSession(
      page,
      reorderedWorkspaceCodexRow,
      reorderedWorkspaceShellRow,
      "after",
    );
    await expect.poll(() => harness.sessionOrderRequests.length > 1, {
      timeout: 3_000,
      message: "Downward Session drag did not persist its order",
    }).toBeTruthy();
    assert.deepEqual(
      harness.sessionOrderRequests.at(-1),
      {
        workspaceId: FIXTURE_IDS.workspace,
        session_ids: [
          FIXTURE_IDS.workspaceShell,
          FIXTURE_IDS.workspaceCodex,
          FIXTURE_IDS.sessionDevServer,
        ],
      },
      "Session drag must support moving a tab downward",
    );
    const restoredWorkspaceRows = await workspaceChildren.locator('[data-testid^="sidebar-session-"]').all();
    const restoredWorkspaceIds = [];
    for (const row of restoredWorkspaceRows)
      restoredWorkspaceIds.push(await row.getAttribute("data-testid"));
    assert.deepEqual(
      restoredWorkspaceIds.slice(0, 2),
      [
        `sidebar-session-${FIXTURE_IDS.workspaceShell}`,
        `sidebar-session-${FIXTURE_IDS.workspaceCodex}`,
      ],
      "downward Session drag must update immediately",
    );
    assert.equal(
      await workspaceContextDirectories.locator('[data-testid^="workspace-location-actions-"]').count().then(count => count > 0),
      false,
      "read-only context Directories must not expose Repository Git actions",
    );
    assert.equal(
      await (page.locator("button:text-is(\"New Shell\")")).count().then(count => count > 0),
      false,
      "Workspace details must rely on the sidebar plus menu for Shell creation",
    );
    assert.equal(
      await (page.locator("button:text-is(\"New Codex\")")).count().then(count => count > 0),
      false,
      "Workspace details must rely on the sidebar plus menu for Codex creation",
    );
    const creationError = baseSection.locator(`[data-testid="workspace-location-error-${FIXTURE_IDS.workspaceSecondaryLocation}"]`);
    assert.equal(
      await creationError.getAttribute("role"),
      "alert",
      "worktree creation failures must be announced",
    );
    assert.match(
      await creationError.innerText(),
      /simulated fixture failure/,
      "worktree creation failure details must remain visible",
    );
    await createSessionFromSidebar(
      page,
      '[data-testid="sidebar-workspace-node"]',
      FIXTURE_IDS.primaryDirectory,
      "Agent",
    );
    await expect.poll(async () =>
        (page.url()).includes(
          `#/workspaces/${FIXTURE_IDS.workspace}/sessions/session-created-codex-ui-fixture`,
        ), {
        timeout: 1_000,
        message:
          "Codex creation did not navigate directly to the created Session",
      }).toBeTruthy();
    const workspaceSessionBreadcrumb = page.locator('[data-testid="header-breadcrumb"]');
    assert.match(
      await workspaceSessionBreadcrumb.innerText(),
      new RegExp(`${FIXTURE_NAMES.project}[\\s\\S]*${FIXTURE_NAMES.workspace}`),
      "Workspace Session must retain its owning breadcrumb hierarchy",
    );
    assert.equal(
      (await workspaceSessionBreadcrumb.innerText()).includes("codex"),
      false,
      "Session names must stay out of the breadcrumb hierarchy",
    );
    assert.equal(
      await (
        workspaceSessionBreadcrumb.locator('[data-testid="breadcrumb-workspace"]')
      ).getAttribute("aria-current"),
      "page",
      "Workspace must remain the current breadcrumb inside a Session",
    );
    assert.equal(
      await (page.locator('[role="dialog"]')).count().then(count => count > 0),
      false,
      "Codex creation must not open a setup dialog",
    );
    await expect(main.getByTestId("session-workspace")).toHaveAttribute(
      "data-session-id",
      "session-created-codex-ui-fixture",
    );
    await (page.locator('button[aria-label="Show right sidebar"]')).click();
    const codexInspector = page.locator('[data-testid="right-sidebar"]');
    await expect.poll(async () => (await codexInspector.getAttribute("aria-hidden")) === "false", {
        timeout: 3_000,
        message: "Codex Session inspector did not open",
      }).toBeTruthy();
    await codexInspector.locator('button[role="tab"][aria-label="Git History"]').click();
    const singleRepositoryHistorySelect = codexInspector.locator('[data-testid="git-repository"]');
    await singleRepositoryHistorySelect.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await singleRepositoryHistorySelect.inputValue(),
      FIXTURE_IDS.workspacePrimaryLocation,
      "Workspace Git History must use its primary repository id",
    );
    assert.equal(
      await singleRepositoryHistorySelect.isEnabled(),
      false,
      "Git History repository selection must be disabled when only one repository is available",
    );
    await (page.locator('button[aria-label="Hide right sidebar"]')).click();
    const createdCodexSidebarRow = page.locator('[data-testid="sidebar-session-session-created-codex-ui-fixture"]');
    await moveUiPointerTo(page, createdCodexSidebarRow);
    await renameSession(
      page,
      "session-created-codex-ui-fixture",
      "Renamed Agent Session",
    );
    assert.equal(
      await (
        page.locator('[data-testid="sidebar-session-session-created-codex-ui-fixture"]')
      ).innerText()
        .then((text) => text.includes("Renamed Agent Session")),
      true,
      "Agent Rename must refresh the sidebar",
    );
    assert.deepEqual(harness.renameRequests.at(-1), {
      kind: "session",
      id: "session-created-codex-ui-fixture",
      name: "Renamed Agent Session",
    });
    const renamedCodexSidebarRow = page.locator('[data-testid="sidebar-session-session-created-codex-ui-fixture"]');
    await moveUiPointerTo(page, renamedCodexSidebarRow);
    const createdCodexClose = renamedCodexSidebarRow.locator('button[aria-label="Remove from sidebar"]');
    assert.equal(
      await createdCodexClose.isEnabled(),
      true,
      "Codex must remain closable while its resumable Session ID is being captured",
    );
    await createdCodexClose.click();
    await expect.poll(async () =>
        (page.url()).endsWith(
          `#/workspaces/${FIXTURE_IDS.workspace}`,
        ), {
        timeout: 3_000,
        message:
          "closing a newly created Codex did not return to the Workspace",
      }).toBeTruthy();
    await createdCodexSidebarRow.waitFor({ timeout: 3_000, state: 'detached' });
    baseSection = page.locator('[data-testid="workspace-repositories-section"]');
    await baseSection.waitFor({ timeout: 3_000, state: 'visible' });

    await createSessionFromSidebar(
      page,
      '[data-testid="sidebar-workspace-node"]',
      FIXTURE_IDS.primaryDirectory,
      "Shell",
    );
    await expect.poll(async () =>
        (page.url()).includes(
          `#/workspaces/${FIXTURE_IDS.workspace}/sessions/session-created-shell-ui-fixture`,
        ), {
        timeout: 1_000,
        message:
          "Shell creation waited for the intentionally slow full Workspace refresh",
      }).toBeTruthy();
    await expect(main.getByTestId("session-workspace")).toHaveAttribute(
      "data-session-id",
      "session-created-shell-ui-fixture",
    );
    await renameSession(
      page,
      "session-created-shell-ui-fixture",
      "Renamed Shell Session",
    );
    assert.equal(
      (
        await (
          page.locator('[data-testid="sidebar-session-session-created-shell-ui-fixture"]')
        ).innerText()
      ).includes("Renamed Shell Session"),
      true,
      "Shell Rename must refresh the sidebar",
    );
    assert.deepEqual(harness.renameRequests.at(-1), {
      kind: "session",
      id: "session-created-shell-ui-fixture",
      name: "Renamed Shell Session",
    });
    const createdShellRow = page.getByTestId("sidebar-session-session-created-shell-ui-fixture");
    await createdShellRow.hover();
    await createdShellRow.getByRole("button", { name: "Close Session", exact: true }).click();
    await expect.poll(async () =>
        (page.url()).endsWith(
          `#/workspaces/${FIXTURE_IDS.workspace}`,
        ), {
        timeout: 3_000,
        message: "closing a Workspace Shell did not return to the Workspace",
      }).toBeTruthy();
    baseSection = page.locator('[data-testid="workspace-repositories-section"]');
    await baseSection.waitFor({ timeout: 3_000, state: 'visible' });
    await expect.poll(async () =>
        !(await (
          page.locator('[data-testid="workspace-session-session-created-shell-ui-fixture"]')
        ).count().then(count => count > 0)), {
        timeout: 3_000,
        message: "closed Workspace Shell remained in Session history",
      }).toBeTruthy();
    const activeForkRow = page.locator(`[data-testid="fork-list-row-${FIXTURE_IDS.fork}"]`);
    const activeForkActions = activeForkRow.locator('[data-testid="fork-actions-trigger"]');
    assert.equal(
      await activeForkActions.count().then(count => count > 0),
      true,
      "active Fork must keep its list action menu visible",
    );
    await clickUiElement(
      page,
      `[data-testid="fork-list-row-${FIXTURE_IDS.fork}"] [data-testid="fork-actions-trigger"]`,
    );
    const activeForkMenu = page.locator('[data-testid="fork-actions"]');
    await activeForkMenu.waitFor({ timeout: 3_000, state: 'visible' });
    const blockedForkDelete = activeForkMenu.locator('[data-testid="delete-fork-action"]');
    assert.equal(
      await blockedForkDelete.getAttribute("data-blocked"),
      "true",
      "active Fork deletion must appear unavailable",
    );
    await blockedForkDelete.click();
    let deleteBlockedAlert = await waitForToast(page, "status", /Finish Fork/i);
    await (
      deleteBlockedAlert.locator('button[aria-label="Close toast"]')
    ).click();
    await pressUiEscape(page);
    await activeForkMenu.waitFor({ timeout: 3_000, state: 'hidden' });

    const archivedForkRow = page.locator(`[data-testid="fork-list-row-${FIXTURE_IDS.archivedFork}"]`);
    await clickUiElement(
      page,
      `[data-testid="fork-list-row-${FIXTURE_IDS.archivedFork}"] [data-testid="fork-actions-trigger"]`,
    );
    const archivedForkMenu = page.locator('[data-testid="fork-actions"]');
    await archivedForkMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      archivedForkMenu.locator('[data-testid="delete-fork-action"]')
    ).click();
    const deleteForkDialog = page.locator('[data-testid="delete-record-dialog"]');
    await deleteForkDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await deleteForkDialog.innerText(),
      /Permanently delete fork/i,
      "archived Fork deletion must require explicit confirmation",
    );
    await (deleteForkDialog.locator("button:text-is(\"Permanently delete\")")).click();
    await archivedForkRow.waitFor({ timeout: 3_000, state: 'detached' });
    assert.deepEqual(
      harness.deleteRequests.at(-1),
      { kind: "fork", id: FIXTURE_IDS.archivedFork },
      "Fork deletion must stay scoped to its parent Workspace list",
    );

    await page.locator('button[aria-label="Hide left sidebar"]').click();
    const showSidebar = page.locator('button[aria-label="Show left sidebar"]');
    await showSidebar.waitFor({ timeout: 3_000, state: 'visible' });
    await showSidebar.click();

    const projectLink = page.locator('[data-testid="sidebar-project-link"]');
    await projectLink.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await projectLink.innerText(),
      FIXTURE_NAMES.project,
      "test must navigate through the deterministic fixture Project",
    );
    await renameNode(
      page,
      '[data-testid="sidebar-project-node"]',
      "Renamed Project",
      "Updated Project description",
    );
    assert.equal(
      await (page.locator('[data-testid="sidebar-project-link"]')).innerText(),
      "Renamed Project",
      "Project Rename must refresh the sidebar",
    );
    assert.deepEqual(harness.renameRequests.at(-1), {
      kind: "project",
      id: FIXTURE_IDS.project,
      name: "Renamed Project",
      description: "Updated Project description",
    });
    await renameNode(
      page,
      '[data-testid="sidebar-project-node"]',
      FIXTURE_NAMES.project,
      "Deterministic data used only by the Treefold UI core test.",
    );
    const renamedBackProjectLink = page.locator('[data-testid="sidebar-project-link"]');
    await openUiContextMenu(page, renamedBackProjectLink);
    const directoryMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await directoryMenu.waitFor({ timeout: 3_000, state: 'visible' });
    const shellSessionItem = directoryMenu.locator('[data-testid="session-kind-shell"]');
    const agentSessionItem = directoryMenu.locator('[data-testid="session-kind-codex"]');
    await moveUiPointerTo(page, shellSessionItem);
    let directorySubmenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await assertDirectorySubmenu(directorySubmenu, "Shell", [
      FIXTURE_IDS.primaryDirectory,
      FIXTURE_IDS.attachedDirectory,
    ]);
    await moveUiPointerTo(page, agentSessionItem);
    await expect.poll(async () =>
        (await (
          (
            page.locator('[data-testid="directory-session-submenu"]:not([data-closed])')
          ).locator(`[data-testid="session-directory-${FIXTURE_IDS.attachedDirectory}"]`)
        ).getAttribute("data-disabled")) !== null, {
        timeout: 3_000,
        message: "Agent Session submenu did not become active",
      }).toBeTruthy();
    directorySubmenu = page.locator('[data-testid="directory-session-submenu"]:not([data-closed])');
    await assertDirectorySubmenu(directorySubmenu, "Agent", [
      FIXTURE_IDS.primaryDirectory,
      FIXTURE_IDS.attachedDirectory,
    ]);
    assert.notEqual(
      await (
        directorySubmenu.locator(`[data-testid="session-directory-${FIXTURE_IDS.attachedDirectory}"]`)
      ).getAttribute("data-disabled"),
      null,
      "non-Git locations must remain read-only Agent context",
    );
    const archiveProject = directoryMenu.locator('[data-testid="archive-project-action"]');
    await moveUiPointerTo(page, archiveProject);
    await archiveProject.click();
    const archiveBlockedAlert = await waitForToast(
      page,
      "alert",
      /Finish active Workspaces and Forks/i,
    );
    harness.archiveAllStreams();
    await (
      archiveBlockedAlert.locator('button[aria-label="Close toast"]')
    ).click();
    await pressUiEscape(page);
    await directoryMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await openUiContextMenu(page, renamedBackProjectLink);
    const archiveReadyMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await archiveReadyMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      archiveReadyMenu.locator('[data-testid="archive-project-action"]')
    ).click();
    await expect.poll(async () =>
        !(await (
          page.locator('[data-testid="sidebar-project-link"]')
        ).count().then(count => count > 0)), {
        timeout: 3_000,
        message: "archived Project remained in the sidebar",
      }).toBeTruthy();
    await expect.poll(async () => (page.url()).endsWith("/"), {
      timeout: 3_000,
      message: "archiving the selected Project did not return to Overview",
    }).toBeTruthy();
    let overviewRow = page.locator('[data-testid="project-overview-row"]');
    assert.equal(
      await overviewRow.getAttribute("data-project-status"),
      "archived",
      "archived Project must remain visible on Overview",
    );
    await page.evaluate((projectId) => {
      window.location.hash = `#/projects/${projectId}`;
    }, FIXTURE_IDS.project);
    const archivedProjectPage = page.locator('[data-testid="page-content"]');
    await archivedProjectPage.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await archivedProjectPage.innerText(),
      /archived · read-only/i,
      "archived Project details must identify their read-only state",
    );
    assert.equal(
      await (
        archivedProjectPage.locator('[data-testid="project-add-location"]')
      ).count().then(count => count > 0),
      false,
      "archived Project details must not expose location creation",
    );
    assert.equal(
      await (
        archivedProjectPage.locator('[data-testid^="project-location-actions-"]')
      ).count().then(count => count > 0),
      false,
      "archived Project details must not expose location edits",
    );
    assert.equal(
      await archivedProjectPage.locator('[data-testid^="project-session-"]').getByRole("button", { name: "Open", exact: true }).count().then(count => count > 0),
      false,
      "archived Project details must not open Sessions",
    );
    await (page.locator('[data-testid="breadcrumb-projects"]')).click();
    overviewRow = page.locator('[data-testid="project-overview-row"]');
    await overviewRow.waitFor({ timeout: 3_000, state: 'visible' });
    const archivedProjectActions = overviewRow.locator('[data-testid="project-actions-trigger"]');
    assert.equal(
      await archivedProjectActions.count().then(count => count > 0),
      true,
      "archived Project must expose lifecycle actions from its list row",
    );
    await clickUiElement(
      page,
      '[data-testid="project-overview-row"] [data-testid="project-actions-trigger"]',
    );
    const archivedProjectMenu = page.locator('[data-testid="project-actions"]');
    await archivedProjectMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        archivedProjectMenu.locator('[data-testid="restore-project-action"]')
      ).count().then(count => count > 0),
      true,
      "archived Project must expose Restore to sidebar",
    );
    assert.equal(
      await (
        archivedProjectMenu.locator('[data-testid="delete-project-action"]')
      ).count().then(count => count > 0),
      true,
      "archived Project must expose permanent deletion",
    );
    harness.restoreActiveStreams();
    await (
      archivedProjectMenu.locator('[data-testid="restore-project-action"]')
    ).click();
    const restoredProjectLink = page.locator('[data-testid="sidebar-project-link"]');
    await restoredProjectLink.waitFor({ timeout: 3_000, state: 'visible' });
    await page.locator(`button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`)
      .click();
    assert.equal(
      (await sidebar.innerText()).includes("Parent Shell Session"),
      false,
      "the explicitly closed Shell must remain deleted after restore",
    );
    assert.match(
      await sidebar.innerText(),
      /Parent Codex Session.*stopped/s,
      "archiving must retain Codex Sessions as stopped",
    );
    overviewRow = page.locator('[data-testid="project-overview-row"]');
    assert.equal(
      await overviewRow.getAttribute("data-project-status"),
      "active",
      "restored Project must become active on Overview",
    );
    assert.equal(
      await (
        overviewRow.locator('[data-testid="restore-project-action"]')
      ).count().then(count => count > 0),
      false,
      "active Project must not expose Restore to sidebar",
    );
    const activeProjectActions = overviewRow.locator('[data-testid="project-actions-trigger"]');
    assert.equal(
      await activeProjectActions.count().then(count => count > 0),
      true,
      "active Project must keep its list action menu visible",
    );
    await clickUiElement(
      page,
      '[data-testid="project-overview-row"] [data-testid="project-actions-trigger"]',
    );
    const activeProjectMenu = page.locator('[data-testid="project-actions"]');
    await activeProjectMenu.waitFor({ timeout: 3_000, state: 'visible' });
    const blockedProjectDelete = activeProjectMenu.locator('[data-testid="delete-project-action"]');
    assert.equal(
      await blockedProjectDelete.getAttribute("data-blocked"),
      "true",
      "active Project deletion must appear unavailable",
    );
    await blockedProjectDelete.click();
    deleteBlockedAlert = await waitForToast(page, "status", /Archive Project/i);
    await (
      deleteBlockedAlert.locator('button[aria-label="Close toast"]')
    ).click();
    await restoredProjectLink.click();
    await expect.poll(async () =>
        (page.url()).includes(`#/projects/${FIXTURE_IDS.project}`), {
        timeout: 3_000,
        message: "fixture Project navigation did not update the route",
      }).toBeTruthy();
    const projectContent = page.locator('[data-testid="page-content"]');
    await expect.poll(async () => (await projectContent.innerText()).includes("fixture-documentation"), {
        timeout: 3_000,
        message: "Project detail content did not finish rendering after navigation",
      }).toBeTruthy();
    assert.match(
      await projectContent.innerText(),
      /fixture-documentation/,
      "attached Directory must remain visible on the Project page",
    );
    const activeWorkspaceRow = page.locator(`[data-testid="workspace-list-row-${FIXTURE_IDS.workspace}"]`);
    const activeWorkspaceActions = activeWorkspaceRow.locator('[data-testid="workspace-actions-trigger"]');
    assert.equal(
      await activeWorkspaceActions.count().then(count => count > 0),
      true,
      "active Workspace must keep its list action menu visible",
    );
    await clickUiElement(page, activeWorkspaceActions);
    const activeWorkspaceMenu = page.locator('[data-testid="workspace-actions"]');
    await activeWorkspaceMenu.waitFor({ timeout: 3_000, state: 'visible' });
    const blockedWorkspaceDelete = activeWorkspaceMenu.locator('[data-testid="delete-workspace-action"]');
    assert.equal(
      await blockedWorkspaceDelete.getAttribute("data-blocked"),
      "true",
      "active Workspace deletion must appear unavailable",
    );
    await blockedWorkspaceDelete.click();
    deleteBlockedAlert = await waitForToast(page, "status", /Finish Workspace/i);
    await (
      deleteBlockedAlert.locator('button[aria-label="Close toast"]')
    ).click();
    await pressUiEscape(page);
    await activeWorkspaceMenu.waitFor({ timeout: 3_000, state: 'hidden' });

    const archivedWorkspaceRow = page.locator(`[data-testid="workspace-list-row-${FIXTURE_IDS.archivedWorkspace}"]`);
    const archivedWorkspaceActions = archivedWorkspaceRow.locator('[data-testid="workspace-actions-trigger"]');
    await clickUiElement(page, archivedWorkspaceActions);
    const archivedWorkspaceMenu = page.locator('[data-testid="workspace-actions"]');
    await archivedWorkspaceMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      archivedWorkspaceMenu.locator('[data-testid="delete-workspace-action"]')
    ).click();
    const deleteWorkspaceDialog = page.locator('[data-testid="delete-record-dialog"]');
    await deleteWorkspaceDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await deleteWorkspaceDialog.innerText(),
      /Permanently delete workspace/i,
      "archived Workspace deletion must require explicit confirmation",
    );
    await (deleteWorkspaceDialog.locator("button:text-is(\"Permanently delete\")")).click();
    await archivedWorkspaceRow.waitFor({ timeout: 3_000, state: 'detached' });
    assert.deepEqual(
      harness.deleteRequests.at(-1),
      { kind: "workspace", id: FIXTURE_IDS.archivedWorkspace },
      "Workspace deletion must stay scoped to its archived list record",
    );
    const projectSessionsSection = page.locator('[data-testid="project-sessions-section"]');
    assert.match(
      await projectSessionsSection.innerText(),
      /Saved Project Codex Session/,
      "saved Project Codex history must remain available after archiving and restoring",
    );
    assert.equal(
      await (page.locator("button:text-is(\"New Shell\")")).count().then(count => count > 0),
      false,
      "Project details must rely on the sidebar plus menu for Shell creation",
    );
    assert.equal(
      await (page.locator("button:text-is(\"New Codex\")")).count().then(count => count > 0),
      false,
      "Project details must rely on the sidebar plus menu for Codex creation",
    );
    await createSessionFromSidebar(
      page,
      '[data-testid="sidebar-project-node"]',
      FIXTURE_IDS.primaryDirectory,
      "Shell",
    );
    await expect.poll(async () =>
        (page.url()).includes(
          `#/projects/${FIXTURE_IDS.project}/sessions/session-created-project-shell-ui-fixture`,
        ), {
        timeout: 1_000,
        message: "Project Shell did not open in the managed Web terminal",
      }).toBeTruthy();
    const expandRestoredProject = page.getByTestId("sidebar-project-node").getByTestId("sidebar-tree-toggle");
    if (await expandRestoredProject.getAttribute("aria-expanded") === "false") await expandRestoredProject.click();
    const projectShellRow = page.getByTestId("sidebar-session-session-created-project-shell-ui-fixture");
    await projectShellRow.hover();
    const closeProjectShell = projectShellRow.getByRole("button", { name: "Close Session", exact: true });
    await closeProjectShell.waitFor({ timeout: 3_000, state: 'visible' });
    await closeProjectShell.click();
    await expect.poll(async () =>
        (page.url()).endsWith(`#/projects/${FIXTURE_IDS.project}`), {
        timeout: 3_000,
        message: "closing a Project Shell did not return to the Project",
      }).toBeTruthy();
    await expect.poll(async () =>
        !(await (
          page.locator('[data-testid="project-session-session-created-project-shell-ui-fixture"]')
        ).count().then(count => count > 0)), {
        timeout: 3_000,
        message: "closed Project Shell remained beside saved Codex history",
      }).toBeTruthy();
    await createSessionFromSidebar(
      page,
      '[data-testid="sidebar-project-node"]',
      FIXTURE_IDS.primaryDirectory,
      "Agent",
    );
    await expect.poll(async () =>
        (page.url()).includes(
          `#/projects/${FIXTURE_IDS.project}/sessions/session-created-project-codex-ui-fixture`,
        ), {
        timeout: 1_000,
        message:
          "Project Codex creation did not navigate directly to the managed Session",
      }).toBeTruthy();
    assert.equal(
      await (page.locator('[role="dialog"]')).count().then(count => count > 0),
      false,
      "Project Codex creation must not open a setup dialog",
    );
    await expect(main.getByTestId("session-workspace")).toHaveAttribute(
      "data-session-id",
      "session-created-project-codex-ui-fixture",
    );
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    const restoredProjectSessionsSection = page.locator('[data-testid="project-sessions-section"]');
    await restoredProjectSessionsSection.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        page.locator('[data-testid="project-repositories-menu-trigger"]')
      ).count().then(count => count > 0),
      false,
      "Project details must not duplicate sidebar synchronization actions",
    );
    const orderedLocationNames = await page.locator('[data-testid^="project-location-"] h3').all();
    assert.equal(
      await orderedLocationNames[0].innerText(),
      "fixture-repository",
      "primary location must render before attached locations",
    );
    const primaryLocation = page.locator(`[data-testid="project-location-${FIXTURE_IDS.primaryRepository}"]`);
    const primaryRepositoryToggle = primaryLocation.locator(`[data-testid="project-location-toggle-${FIXTURE_IDS.primaryRepository}"]`);
    assert.equal(
      await primaryRepositoryToggle.getAttribute("aria-expanded"),
      "true",
      "primary repository children must be expanded by default",
    );
    assert.match(
      await primaryLocation.innerText(),
      /base\s+main[\s\S]*current\s+main/,
      "repository rows must show the base branch before the current branch",
    );
    const primaryRefresh = primaryLocation.locator(`[data-testid="project-location-refresh-${FIXTURE_IDS.primaryRepository}"]`);
    assert.equal(
      await primaryRefresh.getAttribute("aria-label"),
      "Refresh fixture-repository",
    );
    const primaryActionsTrigger = primaryLocation.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger"]`);
    await clickUiElement(page, primaryActionsTrigger);
    let primaryActionsMenu = page.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`);
    await primaryActionsMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await primaryActionsMenu.locator(`[data-testid="project-location-make-default-${FIXTURE_IDS.primaryRepository}"]`).count().then(count => count > 0),
      false,
      "primary repository menu must not expose Make default",
    );
    await primaryActionsMenu.locator(`[data-testid="project-repository-branches-${FIXTURE_IDS.primaryRepository}"]`)
      .click();
    const branchesDialog = page.locator('[data-testid="repository-branches"]');
    await branchesDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await branchesDialog.innerText(),
      /Local[\s\S]*main[\s\S]*release\/ui-fixture[\s\S]*Remote[\s\S]*origin/,
      "Branch must show local branches and remotes as a hierarchy",
    );
    await branchesDialog.locator("button:text-is(\"origin\")").click();
    const remoteBranch = branchesDialog.locator('[data-testid="branch-remote-origin/feature/ui-fixture"]');
    await remoteBranch.click();
    const branchActions = page.locator('[data-testid="branch-actions-remote-origin/feature/ui-fixture"]');
    await branchActions.waitFor({ timeout: 3_000, state: 'visible' });
    await pressUiEscape(page);
    await pressUiEscape(page);
    await branchesDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await pressUiEscape(page);
    await primaryActionsMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await clickUiElement(page, primaryActionsTrigger);
    primaryActionsMenu = page.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`);
    await primaryActionsMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await clickUiElement(page, page.getByRole("heading", { name: "Repositories", exact: true }));
    await primaryActionsMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    let primaryDirectories = primaryLocation.locator(`[data-testid="project-repository-directories-${FIXTURE_IDS.primaryRepository}"]`);
    assert.equal(
      await primaryDirectories.locator(`[data-testid="project-directory-${FIXTURE_IDS.primaryDirectory}"]`).count().then(count => count > 0),
      true,
      "repository rows must expose directory children",
    );
    assert.match(
      await primaryDirectories.locator(`[data-testid="project-directory-${FIXTURE_IDS.primaryDirectory}"]`).innerText(),
      /Root/,
      "repository-root directories must use a user-facing Root label",
    );
    assert.equal(
      await primaryDirectories.locator(`[data-testid="project-directory-${FIXTURE_IDS.monorepoDirectory}"]`).count().then(count => count > 0),
      true,
      "multiple directories must remain grouped under their repository",
    );
    let primaryWorktrees = primaryLocation.locator(`[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}"]`);
    assert.equal(
      (await primaryWorktrees.locator('[data-testid="project-worktree-row"]').all()).length,
      4,
      "repository worktrees must render once as peers of its directories",
    );
    assert.equal(
      await primaryDirectories.locator(`[data-testid="project-directory-toggle-${FIXTURE_IDS.primaryDirectory}"]`).count().then(count => count > 0),
      false,
      "directories must not own nested worktree toggles",
    );
    assert.equal(
      await primaryWorktrees.locator('[data-testid="project-worktree-row"][data-project-directory-id]').count().then(count => count > 0),
      false,
      "worktree rows must not be attributed to a directory",
    );
    const primaryDirectoriesToggle = primaryLocation.locator(`[data-testid="project-repository-directories-${FIXTURE_IDS.primaryRepository}-toggle"]`);
    const primaryWorktreesToggle = primaryLocation.locator(`[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}-toggle"]`);
    assert.equal(
      await primaryDirectoriesToggle.getAttribute("aria-expanded"),
      "true",
      "Directories must be an expanded second-level group by default",
    );
    assert.equal(
      await primaryWorktreesToggle.getAttribute("aria-expanded"),
      "true",
      "Worktrees must be an expanded second-level group by default",
    );
    await primaryDirectoriesToggle.click();
    await primaryDirectories.waitFor({ timeout: 3_000, state: 'detached' });
    assert.equal(
      await primaryWorktrees.isVisible(),
      true,
      "Directories must collapse independently from its peer Worktrees group",
    );
    await primaryDirectoriesToggle.click();
    primaryDirectories = primaryLocation.locator(`[data-testid="project-repository-directories-${FIXTURE_IDS.primaryRepository}"]`);
    await primaryDirectories.waitFor({ timeout: 3_000, state: 'visible' });
    await primaryWorktreesToggle.click();
    await primaryWorktrees.waitFor({ timeout: 3_000, state: 'detached' });
    assert.equal(
      await primaryDirectories.isVisible(),
      true,
      "Worktrees must collapse independently from its peer Directories group",
    );
    await primaryWorktreesToggle.click();
    primaryWorktrees = primaryLocation.locator(`[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}"]`);
    await primaryWorktrees.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await primaryWorktrees.innerText(),
      /Main checkout[\s\S]*Workspace with an intentionally long name/,
    );

    const secondaryLocation = page.locator(`[data-testid="project-location-${FIXTURE_IDS.secondaryRepository}"]`);
    const secondaryRepositoryToggle = secondaryLocation.locator(`[data-testid="project-location-toggle-${FIXTURE_IDS.secondaryRepository}"]`);
    assert.equal(
      await secondaryRepositoryToggle.getAttribute("aria-expanded"),
      "false",
      "attached repositories must be collapsed by default",
    );
    assert.match(
      await secondaryLocation.innerText(),
      /base\s+develop[\s\S]*current\s+release\/api-fixture/,
      "each repository must show its own branch metadata",
    );
    assert.equal(
      await secondaryLocation.locator(`[data-testid="project-repository-directories-${FIXTURE_IDS.secondaryRepository}"]`).count().then(count => count > 0),
      false,
      "collapsed repositories must hide their directories and worktrees",
    );
    const secondaryActionsTrigger = secondaryLocation.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}-trigger"]`);
    await secondaryActionsTrigger.scrollIntoViewIfNeeded();
    await clickUiElement(page, secondaryActionsTrigger);
    let secondaryActionsMenu = page.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`);
    await secondaryActionsMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await secondaryActionsMenu.locator(`[data-testid="project-location-make-default-${FIXTURE_IDS.secondaryRepository}"]`).count().then(count => count > 0),
      false,
      "Make default must not be exposed on a repository",
    );
    await assertOverlayVisibleAndTopmost(
      page,
      `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`,
      "viewport-edge repository actions menu",
    );
    await pressUiEscape(page);
    await secondaryActionsMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await page.keyboard.press("ArrowDown");
    secondaryActionsMenu = page.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`);
    await secondaryActionsMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid")),
      `project-repository-branches-${FIXTURE_IDS.secondaryRepository}`,
      "ArrowDown must open the repository menu and focus its Branch action",
    );
    await pressUiEscape(page);
    await secondaryActionsMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    const contextLocation = page.locator(`[data-testid="project-location-${FIXTURE_IDS.attachedDirectory}"]`);
    assert.equal(
      await contextLocation.locator(`[data-testid="project-location-toggle-${FIXTURE_IDS.attachedDirectory}"]`).count().then(count => count > 0),
      false,
      "non-Git context locations must not expose a worktree toggle",
    );
    await clickUiElement(
      page,
      contextLocation.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.attachedDirectory}-trigger"]`),
    );
    const contextActionsMenu = page.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.attachedDirectory}"]`);
    await contextActionsMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await contextActionsMenu.locator(`[data-testid="project-location-edit-${FIXTURE_IDS.attachedDirectory}"]`).isVisible(),
      true,
      "non-Git context locations must retain their edit action",
    );
    await pressUiEscape(page);
    await contextActionsMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    assert.equal(
      await page.locator("h2:text-is(\"Git Worktrees\")").count().then(count => count > 0),
      false,
      "Project pages must not render a separate cross-repository worktree list",
    );

    await primaryRepositoryToggle.click();
    await primaryWorktrees.waitFor({ timeout: 3_000, state: 'detached' });
    assert.equal(
      await primaryRepositoryToggle.getAttribute("aria-expanded"),
      "false",
      "repository children must collapse together",
    );
    await secondaryRepositoryToggle.click();
    const secondaryDirectory = secondaryLocation.locator(`[data-testid="project-directory-${FIXTURE_IDS.secondaryDirectory}"]`);
    await clickUiElement(
      page,
      `[data-testid="project-directory-actions-${FIXTURE_IDS.secondaryDirectory}-trigger"]`,
    );
    const secondaryDirectoryActions = page.locator(`[data-testid="project-directory-actions-${FIXTURE_IDS.secondaryDirectory}"]`);
    await secondaryDirectoryActions.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        secondaryDirectoryActions.locator(`[data-testid="project-directory-make-default-${FIXTURE_IDS.secondaryDirectory}"]`)
      ).count().then(count => count > 0),
      true,
      "a non-default directory must expose Make default",
    );
    await (
      secondaryDirectoryActions.locator(`[data-testid="project-directory-edit-${FIXTURE_IDS.secondaryDirectory}"]`)
    ).click();
    const editDirectoryDialog = page.locator('[role="dialog"]');
    await editDirectoryDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await editDirectoryDialog.locator('input[name="base_branch"]').count().then(count => count > 0),
      false,
      "directory editing must not expose repository branch settings",
    );
    assert.equal(
      await editDirectoryDialog.locator('select[name="delivery_mode"]').count().then(count => count > 0),
      false,
      "directory editing must not expose repository delivery settings",
    );
    const directoryNameInput = editDirectoryDialog.locator('input[name="name"]');
    assert.equal(
      await directoryNameInput.count().then(count => count > 0),
      true,
      "directory editing must expose its Treefold display name",
    );
    await directoryNameInput.fill("renamed source scope");
    await (editDirectoryDialog.locator("button:text-is(\"Save\")")).click();
    await editDirectoryDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await expect.poll(async () => (await secondaryDirectory.innerText()).includes("renamed source scope"), { timeout: 3_000, message: "renamed directory must refresh in its row" }).toBeTruthy();
    const secondaryWorktrees = secondaryLocation.locator(`[data-testid="project-repository-worktrees-${FIXTURE_IDS.secondaryRepository}"]`);
    await secondaryWorktrees.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      (await secondaryWorktrees.locator('[data-testid="project-worktree-row"]').all())
        .length,
      2,
      "secondary worktrees must remain scoped to the secondary repository",
    );
    assert.equal(
      (
        await secondaryWorktrees.locator(`[data-testid="project-worktree-row"][data-project-location-id="${FIXTURE_IDS.secondaryRepository}"]`).all()
      ).length,
      2,
      "worktree rows must retain their repository identity",
    );
    assert.equal(
      await secondaryDirectory.locator(`[data-testid="project-directory-toggle-${FIXTURE_IDS.secondaryDirectory}"]`).count().then(count => count > 0),
      false,
      "directory rows must remain leaves beside worktree rows",
    );
    await secondaryRepositoryToggle.click();
    await secondaryWorktrees.waitFor({ timeout: 3_000, state: 'detached' });
    await primaryRepositoryToggle.click();
    primaryWorktrees = primaryLocation.locator(`[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}"]`);
    await primaryWorktrees.waitFor({ timeout: 3_000, state: 'visible' });
    const addLocationButton = page.locator('[data-testid="project-add-location"]');
    await addLocationButton.click();
    const addDirectoryDialog = page.locator('[role="dialog"]');
    await addDirectoryDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (addDirectoryDialog.locator('input[name="name"]')).count().then(count => count > 0),
      false,
      "Location rows must derive names from dirname",
    );
    let locationRows = await addDirectoryDialog.locator('[data-testid="location-draft-row"]').all();
    assert.equal(
      locationRows.length,
      1,
      "Location dialog must start with one row",
    );
    await (
      locationRows[0].locator('input[aria-label="Location 1 path"]')
    ).fill("/tmp/treefold-ui-fixture/new-api-repository");
    await (locationRows[0].locator("button:text-is(\"Check\")")).click();
    assert.equal(
      await locationRows[0].locator('input[aria-label="Location 1 base branch"]').count().then(count => count > 0),
      false,
      "adding a Git location must defer base branch configuration",
    );
    await (addDirectoryDialog.locator("button:text-is(\"Add another\")")).click();
    locationRows = await addDirectoryDialog.locator('[data-testid="location-draft-row"]').all();
    assert.equal(
      locationRows.length,
      2,
      "Add another must append a location row in the same dialog",
    );
    await (
      locationRows[1].locator('input[aria-label="Location 2 path"]')
    ).fill("/tmp/treefold-ui-fixture/reference-context");
    await (locationRows[1].locator("button:text-is(\"Check\")")).click();
    await expect.poll(async () =>
        (await locationRows[1].innerText()).includes("Read-only Workspace context"), {
        timeout: 3_000,
        message: "non-Git location did not become read-only context",
      }).toBeTruthy();
    assert.equal(
      (await addDirectoryDialog.locator('input[aria-label$="base branch"]').all()).length,
      0,
      "location creation must not expose base branch configuration",
    );
    assert.equal(
      (await addDirectoryDialog.locator('select[aria-label$="delivery mode"]').all()).length,
      0,
      "location creation must not expose delivery configuration",
    );
    await (addDirectoryDialog.locator("button:text-is(\"Add 2 locations\")")).click();
    await addDirectoryDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    await expect.poll(async () =>
        (
          await (page.locator('[data-testid="page-content"]')).innerText()
        ).includes("new-api-repository"), {
        timeout: 3_000,
        message: "batch-added locations did not refresh the Project",
      }).toBeTruthy();
    await projectCreateButton.click();
    sessionMenu = page.locator('[data-testid="sidebar-session-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      sessionMenu.locator('[data-testid="create-workspace-action"]')
    ).click();
    const deferredSetupDialog = page.locator('[role="dialog"]');
    await deferredSetupDialog.waitFor({ timeout: 3_000, state: 'visible' });
    const deferredBaseBranch = deferredSetupDialog.locator('select[name^="base_branch:"]');
    await expect(deferredBaseBranch).toBeEnabled({ timeout: 3_000 });
    assert.match(
      await deferredBaseBranch.innerText(),
      /main[\s\S]*release\/ui-fixture/,
      "deferred base selection must list only local branches",
    );
    assert.equal(
      await (
        deferredSetupDialog.locator('select[name^="delivery_mode:"]')
      ).isVisible(),
      true,
      "Workspace creation must collect missing Project delivery settings",
    );
    assert.match(
      await (
        deferredSetupDialog.locator('select[name^="base_remote:"]')
      ).innerText(),
      /origin/,
      "push delivery must select from repository remotes",
    );
    const sharedWorkspaceBranch = deferredSetupDialog.getByRole("textbox", { name: "Shared local branch", exact: true });
    const remoteWorkspaceBranch = deferredSetupDialog.locator('input[name="remote_branch"]');
    await sharedWorkspaceBranch.fill("feature/local-name");
    assert.equal(
      await remoteWorkspaceBranch.inputValue(),
      "feature/local-name",
      "remote branch must default to the local Workspace branch name",
    );
    await remoteWorkspaceBranch.fill("feature/custom-remote-name");
    assert.equal(
      await remoteWorkspaceBranch.inputValue(),
      "feature/custom-remote-name",
      "remote branch must remain editable",
    );
    await pressUiEscape(page);
    await deferredSetupDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    const blockedWorktreeDeletes = await page.locator('button[data-worktree-delete-state="blocked"]').all();
    const availableWorktreeDeletes = await page.locator('button[data-worktree-delete-state="available"]').all();
    assert.equal(
      blockedWorktreeDeletes.length,
      2,
      "expanded active Workspace worktrees must expose blocked delete controls",
    );
    assert.equal(
      availableWorktreeDeletes.length,
      1,
      "unmanaged worktrees must expose an available delete control",
    );
    assert.equal(
      await blockedWorktreeDeletes[0].getAttribute("aria-disabled"),
      "true",
      "active Workspace delete controls must announce their unavailable state",
    );
    // aria-disabled communicates unavailability, while clicking explains the blocker.
    await blockedWorktreeDeletes[0].click({ force: true });
    const blockedWorktreeAlert = await waitForToast(
      page,
      "status",
      /belongs to active Workspace/,
    );
    await (
      blockedWorktreeAlert.locator('button[aria-label="Close toast"]')
    ).click();
    const projectNode = page.locator('[data-testid="sidebar-project-node"]');
    await moveUiPointerTo(page, projectNode);
    const projectNodeMenuTrigger = projectNode.locator('[data-testid="sidebar-node-menu-trigger"]');
    await projectNodeMenuTrigger.click();
    let projectNodeMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await projectNodeMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      projectNodeMenu.locator('[data-testid="sidebar-pull-menu"]'),
    );
    let projectGitSubmenu = page.locator('[data-testid="sidebar-git-submenu"]');
    await projectGitSubmenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        projectGitSubmenu.locator(`[data-testid="sidebar-pull-${FIXTURE_IDS.secondaryRepository}"]`)
      ).count().then(count => count > 0),
      true,
      "Project Pull must expose every configured repository",
    );
    harness.setNextBulkSyncResults([
      {
        project_repository_id: FIXTURE_IDS.primaryRepository,
        repository_name: "fixture-repository",
        status: "failed",
        error: "remote rejected the update",
      },
    ]);
    await (projectGitSubmenu.locator('[data-testid="sidebar-pull-all"]')).click();
    assert.equal(
      harness.syncRequests.at(-1),
      `/api/projects/${FIXTURE_IDS.project}/git/pull-all`,
      "bulk Pull must target every Project repository",
    );
    const pullFailedToast = await waitForToast(
      page,
      "alert",
      /fixture-repository: remote rejected the update/,
    );
    await (pullFailedToast.locator('button[aria-label="Close toast"]')).click();
    await pressUiEscape(page);
    await projectNodeMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await moveUiPointerTo(page, projectNode);
    await projectNodeMenuTrigger.click();
    projectNodeMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await projectNodeMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await moveUiPointerTo(
      page,
      projectNodeMenu.locator('[data-testid="sidebar-push-menu"]'),
    );
    projectGitSubmenu = page.locator('[data-testid="sidebar-git-submenu"]');
    await projectGitSubmenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      projectGitSubmenu.locator(`[data-testid="sidebar-push-${FIXTURE_IDS.primaryRepository}"]`)
    ).click();
    assert.equal(
      harness.syncRequests.at(-1),
      `/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git/push`,
      "Project repository Push must target only its Repository",
    );
    await pressUiEscape(page);
    await projectNodeMenu.waitFor({ timeout: 3_000, state: 'hidden' });
    await clickUiElement(
      page,
      `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger"]`,
    );
    primaryActionsMenu = page.locator(`[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`);
    await primaryActionsMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      primaryActionsMenu.locator(`[data-testid="project-repository-edit-${FIXTURE_IDS.primaryRepository}"]`)
    ).click();
    const setupCommand = page.locator('textarea[aria-label="Worktree setup command"]');
    await setupCommand.waitFor({ timeout: 3_000, state: 'visible' });
    const baseBranchSelect = page.locator('select[name="base_branch"]');
    await expect(baseBranchSelect).toBeEnabled({ timeout: 3_000 });
    assert.equal(
      await baseBranchSelect.isVisible(),
      true,
      "base branch must be selected from repository settings",
    );
    assert.match(
      await baseBranchSelect.innerText(),
      /main[\s\S]*release\/ui-fixture/,
      "base branch options must come from local branches",
    );
    const baseRemoteSelect = page.locator('select[name="base_remote"]');
    assert.equal(
      await baseRemoteSelect.isVisible(),
      true,
      "Pull and Push remote must be selected from repository settings",
    );
    assert.match(
      await baseRemoteSelect.innerText(),
      /None[\s\S]*origin/,
      "remote options must list configured Git remotes",
    );
    assert.equal(
      await (page.locator('select[name="delivery_mode"]')).isVisible(),
      true,
      "delivery mode must be edited from repository settings",
    );
    await setupCommand.fill("npm install && npm run prepare");
    await page.locator("button:text-is(\"Save repository\")").click();
    await expect.poll(async () => !(await setupCommand.count().then(count => count > 0)), {
      timeout: 3_000,
      message:
        "Repository details did not close after saving repository settings",
    }).toBeTruthy();
    assert.equal(
      harness.repositoryUpdateRequests.at(-1)!.id,
      FIXTURE_IDS.primaryRepository,
      "repository settings must PATCH the repository resource",
    );
    assert.deepEqual(
      harness.repositoryBaseRequests.at(-1),
      {
        id: FIXTURE_IDS.primaryRepository,
        branch: "main",
        remote: "origin",
      },
      "repository settings must persist the local base branch and sync remote",
    );
    assert.match(
      await (page.locator('[data-testid="page-content"]')).innerText(),
      /Setup/,
      "Repository must show when Worktree setup is configured",
    );
    const showRightSidebar = page.locator('button[aria-label="Show right sidebar"]');
    await showRightSidebar.waitFor({ timeout: 5_000, state: 'visible' });
    await showRightSidebar.click();
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await rightSidebar.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await toolbar.isVisible(),
      true,
      "toolbar must remain visible with the right sidebar open",
    );
    await page.locator('button[role="tab"][aria-label="Git History"]').click();
    const historyRepository = page.locator('[data-testid="git-repository"]');
    await historyRepository.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await historyRepository.inputValue(),
      FIXTURE_IDS.primaryRepository,
      "Git History must default to the Project primary repository",
    );
    assert.equal(
      await historyRepository.isEnabled(),
      true,
      "Git History repository selection must be available for multiple repositories",
    );
    await expect.poll(async () =>
        (await (await page.locator('[data-testid="git-history-commit"]').all()).length) ===
        FIXTURE_COMMITS.length, {
        timeout: 3_000,
        message: "Git History tab did not render fixture commits",
      }).toBeTruthy();
    await selectUiOption(page, historyRepository, FIXTURE_IDS.secondaryRepository);
    await expect.poll(async () => (await rightSidebar.innerText()).includes("develop"), {
      timeout: 3_000,
      message: "Git History did not load the selected repository",
    }).toBeTruthy();
    await page.locator('button[aria-label="Hide right sidebar"]').click();
    await expect.poll(async () => (await rightSidebar.getAttribute("aria-hidden")) === "true", {
        timeout: 3_000,
        message: "right sidebar did not enter its hidden state",
      }).toBeTruthy();

    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await page.locator('[data-testid="workspace-repositories-section"]').waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (page.locator('[data-testid="breadcrumb-project"]')).innerText(),
      FIXTURE_NAMES.project,
      "Fork breadcrumb must retain its Project",
    );
    assert.equal(
      await (page.locator('[data-testid="breadcrumb-workspace"]')).innerText(),
      FIXTURE_NAMES.workspace,
      "Fork breadcrumb must include its parent Workspace",
    );
    assert.equal(
      await (
        page.locator('[data-testid="breadcrumb-workspace"]')
      ).getAttribute("aria-current"),
      null,
      "parent Workspace breadcrumb must remain navigable from a Fork",
    );
    assert.equal(
      await (page.locator('[data-testid="breadcrumb-fork"]')).innerText(),
      FIXTURE_NAMES.fork,
      "Fork breadcrumb must identify the current Fork",
    );
    assert.equal(
      await (
        page.locator('[data-testid="breadcrumb-fork"]')
      ).getAttribute("aria-current"),
      "page",
      "Fork must be the current breadcrumb",
    );
    assert.equal(
      await (page.locator('[data-testid="new-fork-action"]')).count().then(count => count > 0),
      false,
      "Fork details must not offer nested Fork creation",
    );
    assert.equal(
      await (
        page.locator('[data-testid="finish-workspace-action"]')
      ).count().then(count => count > 0),
      false,
      "Fork details must not duplicate sidebar lifecycle actions",
    );
    assert.equal(
      await (page.locator("button:text-is(\"New Shell\")")).count().then(count => count > 0),
      false,
      "Fork details must rely on the sidebar plus menu for Shell creation",
    );
    assert.equal(
      await (page.locator("button:text-is(\"New Codex\")")).count().then(count => count > 0),
      false,
      "Fork details must rely on the sidebar plus menu for Codex creation",
    );
    assert.match(
      await (
        page.locator(`[data-testid="workspace-directory-${FIXTURE_IDS.primaryDirectory}"]`)
      ).innerText(),
      /Root/,
      "Fork repository-root directories must use the shared Root label",
    );
    assert.equal(
      await (
        page.locator('[data-testid="workspace-repositories-menu-trigger"]')
      ).count().then(count => count > 0),
      false,
      "Fork must not expose Workspace repository synchronization",
    );
    assert.equal(
      (
        await page.locator('[data-testid^="workspace-location-actions-"][data-testid$="-trigger"]').all()
      ).length,
      0,
      "Fork locations must not expose upstream actions",
    );
    const forkNode = page.locator('[data-testid="sidebar-fork-node"]');
    await moveUiPointerTo(page, forkNode);
    await (forkNode.locator('[data-testid="sidebar-node-menu-trigger"]')).click();
    const forkNodeMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await forkNodeMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(
      await (
        forkNodeMenu.locator('[data-testid="sidebar-pull-menu"]')
      ).count().then(count => count > 0),
      false,
      "Fork menu must not inherit Workspace synchronization",
    );
    await pressUiEscape(page);
    await renameNode(
      page,
      '[data-testid="sidebar-fork-node"]',
      "Renamed Fork",
      "Updated Fork description",
    );
    assert.equal(
      await (
        page.locator('[data-testid="sidebar-fork-node"] [data-testid="sidebar-node-name"]')
      ).innerText(),
      "Renamed Fork",
      "Fork Rename must refresh the sidebar",
    );
    assert.deepEqual(harness.renameRequests.at(-1), {
      kind: "fork",
      id: FIXTURE_IDS.fork,
      name: "Renamed Fork",
      description: "Updated Fork description",
    });
    await renameNode(
      page,
      '[data-testid="sidebar-fork-node"]',
      FIXTURE_NAMES.fork,
      "Active Fork with a long label.",
    );
    const renamedForkNode = page.locator('[data-testid="sidebar-fork-node"]');
    await moveUiPointerTo(page, renamedForkNode);
    const renamedForkNodeMenuTrigger = renamedForkNode.locator('[data-testid="sidebar-node-menu-trigger"]');
    await renamedForkNodeMenuTrigger.click();
    const restoredForkNodeMenu = page.locator('[data-testid="directory-session-context-menu"]');
    await restoredForkNodeMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      restoredForkNodeMenu.locator('[data-testid="finish-workspace-action"]')
    ).click();
    const finishForkDialog = page.locator('[role="dialog"]');
    await finishForkDialog.waitFor({ timeout: 3_000, state: 'visible' });
    const preflight = finishForkDialog.locator('[data-testid="delivery-preflight"]');
    await preflight.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await preflight.innerText(), /2 ahead/);
    assert.match(await preflight.innerText(), /2 files/);
    assert.match(await preflight.innerText(), /source is 1 commit/);
    assert.equal(
      await (finishForkDialog.locator("button:has-text(\"Finish fixture-repository\")")).isEnabled(),
      true,
      "a ready preflight must unlock Finish",
    );
    const forkStrategy = finishForkDialog.locator("#finish-code-action");
    assert.deepEqual(
      await forkStrategy.evaluate((select) => Array.from((select as HTMLSelectElement).options, (option) => option.value)),
      ["local_merge", "keep"],
      "Fork Finish must expose only parent merge and preserve strategies",
    );
    const removeWorktree = finishForkDialog.locator("#finish-delete-worktree");
    const deleteBranch = finishForkDialog.locator("#finish-delete-branch");
    assert.equal(await removeWorktree.isChecked(), true);
    assert.equal(await deleteBranch.isChecked(), true);
    await selectUiOption(page, forkStrategy, "keep");
    assert.equal(await removeWorktree.isChecked(), false);
    assert.equal(await deleteBranch.isChecked(), false);
    assert.equal(await removeWorktree.isEnabled(), true);
    assert.equal(await deleteBranch.isEnabled(), false);
    await (
      finishForkDialog.locator('label[for="finish-delete-worktree"]')
    ).click();
    assert.equal(await removeWorktree.isChecked(), true);
    assert.equal(await deleteBranch.isEnabled(), true);
    await (
      finishForkDialog.locator('label[for="finish-delete-branch"]')
    ).click();
    assert.equal(await deleteBranch.isChecked(), true);
    await pressUiEscape(page);
    await finishForkDialog.waitFor({ timeout: 3_000, state: 'hidden' });

    await page.goto(harness.baseUrl);
    await (page.locator("h1:text-is(\"Overview\")")).waitFor({ timeout: 3_000, state: 'visible' });
    await clickUiElement(page, '[data-testid="new-project-action"]');
    const primaryProjectDialog = page.getByRole("dialog", { name: "New Project", exact: true });
    await primaryProjectDialog.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      primaryProjectDialog.locator('input[name="name"]')
    ).fill("Primary requirement fixture");
    await (primaryProjectDialog.locator("button:text-is(\"Create Project\")")).click();
    await primaryProjectDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    const primaryLocationDialog = page.getByRole("dialog", { name: "Add project locations", exact: true });
    await primaryLocationDialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await (
        primaryLocationDialog.locator('[data-testid="primary-git-location-requirement"]')
      ).innerText(),
      /at least one Git repository/,
      "an empty Project must explain its primary Git requirement",
    );
    let primaryLocationRows = await primaryLocationDialog.locator('[data-testid="location-draft-row"]').all();
    await (
      primaryLocationRows[0].locator('input[aria-label="Location 1 path"]')
    ).fill("/tmp/treefold-ui-fixture/first-reference-context");
    await (primaryLocationRows[0].locator("button:text-is(\"Check\")")).click();
    const addPrimaryLocations = primaryLocationDialog.locator("button:text-is(\"Add 1 location\")");
    assert.equal(
      await addPrimaryLocations.isEnabled(),
      false,
      "a non-Git-only first batch must not be submittable",
    );
    await (primaryLocationDialog.locator("button:text-is(\"Add another\")")).click();
    primaryLocationRows = await primaryLocationDialog.locator('[data-testid="location-draft-row"]').all();
    await (
      primaryLocationRows[1].locator('input[aria-label="Location 2 path"]')
    ).fill("/tmp/treefold-ui-fixture/primary-repository");
    await (primaryLocationRows[1].locator("button:text-is(\"Check\")")).click();
    const addMixedLocations = primaryLocationDialog.locator("button:text-is(\"Add 2 locations\")");
    await expect.poll(() => addMixedLocations.isEnabled(), {
      timeout: 3_000,
      message: "a mixed first batch did not become submittable",
    }).toBeTruthy();
    await addMixedLocations.click();
    await primaryLocationDialog.waitFor({ timeout: 3_000, state: 'hidden' });
    assert.deepEqual(
      harness.locationRequests
        .slice(-2)
        .map((request) => ({ path: request.path, isGit: request.isGit })),
      [
        { path: "/tmp/treefold-ui-fixture/primary-repository", isGit: true },
        {
          path: "/tmp/treefold-ui-fixture/first-reference-context",
          isGit: false,
        },
      ],
      "a mixed first batch must create its primary Git repository before context locations",
    );
    await page.goto(harness.baseUrl);
    await expect.poll(async () =>
        (await (await page.locator('[data-testid="project-overview-row"]').all()).length) === 2, {
        timeout: 3_000,
        message: "Project summaries did not load after returning to the overview",
      }).toBeTruthy();
    harness.setProjectStatus(FIXTURE_IDS.project, "archived");
    await page.reload();
    const deletableProjectRow = page.locator(`[data-testid="project-overview-row"][data-project-id="${FIXTURE_IDS.project}"]`);
    await deletableProjectRow.waitFor({ timeout: 3_000, state: 'visible' });
    await clickUiElement(
      page,
      `[data-testid="project-overview-row"][data-project-id="${FIXTURE_IDS.project}"] [data-testid="project-actions-trigger"]`,
    );
    const deletableProjectMenu = page.locator('[data-testid="project-actions"]');
    await deletableProjectMenu.waitFor({ timeout: 3_000, state: 'visible' });
    await (
      deletableProjectMenu.locator('[data-testid="delete-project-action"]')
    ).click();
    const deleteProjectDialog = page.locator('[data-testid="delete-record-dialog"]');
    await deleteProjectDialog.waitFor({ timeout: 3_000, state: 'visible' });
    const cleanupReady = deleteProjectDialog.locator('[data-testid="delete-project-cleanup-ready"]');
    await cleanupReady.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(
      await cleanupReady.innerText(),
      /1 managed source.*1 managed worktree/i,
      "Project deletion must summarize Treefold-owned local files",
    );
    const preserveProjectFiles = deleteProjectDialog.locator('[data-testid="delete-project-preserve"]');
    await preserveProjectFiles.click();
    assert.equal(
      await preserveProjectFiles.getAttribute("aria-pressed"),
      "true",
      "Project deletion must allow preserving all local files",
    );
    await (
      deleteProjectDialog.locator('[data-testid="delete-project-cleanup"]')
    ).click();
    await (deleteProjectDialog.locator("button:text-is(\"Permanently delete\")")).click();
    await deletableProjectRow.waitFor({ timeout: 3_000, state: 'detached' });
    assert.deepEqual(
      harness.deleteRequests.at(-1),
      { kind: "project", id: FIXTURE_IDS.project, cleanupManaged: true },
      "Project deletion must request managed file cleanup by default",
    );
    harness.assertNoUnexpectedRequests();

    console.log(
      "✓ deterministic fixture, Directory setup, sidebar flows, Project lifecycle, inspector, and settlement preflight passed",
    );
  } catch (error) {
    await page.screenshot({ path: "/tmp/treefold-sidebar-core-failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});

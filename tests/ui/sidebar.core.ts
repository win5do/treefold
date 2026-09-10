import type { UiElement } from "./harness/session.ts";
import type { Browser } from "webdriverio";
import assert from "node:assert/strict";
import { Key } from "webdriverio";
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

async function assertOverlayVisibleAndTopmost(browser: Browser, selector: string, label: string) {
  const result = await browser.execute((targetSelector) => {
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

async function waitForToast(browser: Browser, role: string, text: RegExp) {
  let matchedToast: Awaited<UiElement> | undefined;
  await browser.waitUntil(
    async () => {
      const toasts = await browser.$$(`[data-slot="toast"][role="${role}"]`);
      for (const toast of toasts) {
        if (text.test(await toast.getText())) {
          matchedToast = toast;
          return true;
        }
      }
      return false;
    },
    {
      timeout: 3_000,
      timeoutMsg: `toast did not appear: ${text}`,
    },
  );
  assert.ok(matchedToast);
  return matchedToast;
}

async function createSessionFromSidebar(
  browser: Browser,
  ownerSelector: string,
  directoryId: string,
  kind: string,
) {
  const owner = await browser.$(ownerSelector);
  await (await owner.$('[data-sidebar-row-action="true"]')).click();
  const menu = await browser.$('[data-testid="sidebar-session-menu"]');
  await menu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    `[data-testid="sidebar-session-menu"] [data-testid="session-kind-${kind === "Shell" ? "shell" : "codex"}"]`,
  );
  const submenu = await browser.$('[data-testid="directory-session-submenu"]');
  await (await submenu.getElement()).waitForDisplayed({ timeout: 3_000 });
  await (
    await submenu.$(`[data-testid="session-directory-${directoryId}"]`)
  ).click();
}

async function assertDirectorySubmenu(submenu: UiElement, kind: string, directoryIds: string[]) {
  await (await submenu.getElement()).waitForDisplayed({ timeout: 3_000 });
  for (const directoryId of directoryIds) {
    assert.equal(
      await (
        await submenu.$(`[data-testid="session-directory-${directoryId}"]`)
      ).isExisting(),
      true,
      `${kind} creation must expose directory ${directoryId}`,
    );
  }
}

async function renameNode(browser: Browser, nodeSelector: string, name: string, description: string) {
  const node = await browser.$(nodeSelector);
  await moveUiPointerTo(browser, node);
  await (await node.$('[data-testid="sidebar-node-menu-trigger"]')).click();
  const menu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await menu.waitForDisplayed({ timeout: 3_000 });
  await (await menu.$('[data-testid="rename-node-action"]')).click();
  const dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  await (await dialog.$('input[name="name"]')).setValue(name);
  await (await dialog.$('textarea[name="description"]')).setValue(description);
  await (await dialog.$('[data-testid="rename-submit"]')).click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
}

async function renameSession(browser: Browser, sessionId: string, name: string) {
  const row = await browser.$(`[data-testid="sidebar-session-${sessionId}"]`);
  assert.equal(
    await (await row.$('[data-testid="rename-session-action"]')).isExisting(),
    false,
    "Session rows must not show a Rename icon",
  );
  await openUiContextMenu(browser, row);
  const menu = await browser.$('[data-testid="session-context-menu"]');
  await menu.waitForDisplayed({ timeout: 3_000 });
  await (await menu.$('[data-testid="rename-session-action"]')).click();
  const dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (await dialog.$('textarea[name="description"]')).isExisting(),
    false,
    "Session Rename must only edit its name",
  );
  await (await dialog.$('input[name="name"]')).setValue(name);
  await (await dialog.$('[data-testid="rename-submit"]')).click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
}

async function pointerDragSession(browser: Browser, source: UiElement, target: UiElement, expectedPosition: string) {
  const releasePointer = await beginUiPointerDrag(browser, source, target);
  try {
    await browser.waitUntil(
      async () =>
        (await (await target.getElement()).getAttribute("data-drop-position")) === expectedPosition,
      {
        timeout: 3_000,
        timeoutMsg: `Session drag did not show its ${expectedPosition} insertion line`,
      },
    );
  } finally {
    await releasePointer();
  }
}

const harness = await startUiHarness();
let browser!: Browser;

try {
  browser = await createUiSession({ sessionName: "sidebar-core" });

  await browser.url(harness.baseUrl);
  const sidebar = await browser.$('[data-testid="workspace-sidebar"]');
  await sidebar.waitForDisplayed({ timeout: 10_000 });
  const toolbar = await browser.$('[data-testid="app-toolbar"]');
  await toolbar.waitForDisplayed({ timeout: 3_000 });
  const projectsBreadcrumb = await browser.$(
    '[data-testid="breadcrumb-projects"]',
  );
  const sidebarProjectsLink = await browser.$(
    '[data-testid="sidebar-projects-link"]',
  );
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
      await browser.$('button[aria-label="Show right sidebar"]')
    ).isExisting(),
    false,
    "right sidebar control must stay hidden outside a Project",
  );
  const initialOverviewRow = await browser.$(
    `[data-testid="project-overview-row"][data-project-id="${FIXTURE_IDS.project}"]`,
  );
  assert.match(
    await initialOverviewRow.getText(),
    /4 locations · 3 Git · 1 Context/,
    "Project overview must count Directory scopes independently from repositories",
  );
  assert.match(
    await initialOverviewRow.getText(),
    /All healthy/,
    "Project overview must aggregate location health",
  );
  assert.equal(
    await (
      await initialOverviewRow.$(
        '[data-testid="project-overview-active-workspaces"]',
      )
    ).getText(),
    "1",
    "Project overview must count only active root Workspaces",
  );

  await (await browser.$('button[aria-label="New Project"]')).click();
  const newProjectDialog = await browser.$('[role="dialog"]');
  await newProjectDialog.waitForDisplayed({ timeout: 3_000 });
  await pressUiEscape(browser);
  await newProjectDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await (await browser.$('[data-testid="open-settings"]')).click();
  const settingsDialog = await browser.$('[role="dialog"]');
  await settingsDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await settingsDialog.$('[data-testid="settings-language"]')
    ).getValue(),
    "en-US",
    "Settings must reflect the persisted language preference",
  );
  assert.equal(
    await (await settingsDialog.$('[data-testid="settings-theme"]')).getValue(),
    "system",
    "Settings must reflect the persisted theme preference",
  );
  assert.match(
    await (
      await settingsDialog.$('[data-testid="settings-runtime-treefold-home"]')
    ).getText(),
    /Treefold Home[\s\S]*\/tmp\/treefold-ui-fixture/,
    "Runtime must expose the effective Treefold Home",
  );
  for (const label of ["Treefold Home", "Platform", "Codex"]) {
    assert.equal(
      await settingsDialog.$(`button[aria-label="Copy ${label}"]`).isExisting(),
      true,
      `Runtime ${label} must be copyable`,
    );
  }
  await selectUiOption(
    browser,
    await settingsDialog.$('[data-testid="settings-theme"]'),
    "dark",
  );
  let codexArguments = await settingsDialog.$$(
    'input[aria-label^="Codex argument "]',
  );
  assert.deepEqual(
    await codexArguments.map((argument) => argument.getValue()),
    ["--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5.4"],
    "Settings must render each configured argv value as its own row",
  );
  await (await settingsDialog.$("button=Add argument")).click();
  codexArguments = await settingsDialog.$$(
    'input[aria-label^="Codex argument "]',
  );
  await codexArguments[3].setValue("--search");
  await (
    await settingsDialog.$('button[aria-label="Move Codex argument 4 up"]')
  ).click();
  await (await settingsDialog.$("button=Save")).click();
  await waitForToast(browser, "status", /Settings saved/);
  await pressUiEscape(browser);
  await settingsDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await (await browser.$('[data-testid="open-settings"]')).click();
  const reopenedSettingsDialog = await browser.$('[role="dialog"]');
  await reopenedSettingsDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await reopenedSettingsDialog.$('[data-testid="settings-theme"]')
    ).getValue(),
    "dark",
    "theme changes must survive the atomic settings PATCH",
  );
  codexArguments = await reopenedSettingsDialog.$$(
    'input[aria-label^="Codex argument "]',
  );
  assert.deepEqual(
    await codexArguments.map((argument) => argument.getValue()),
    [
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "--search",
      "gpt-5.4",
    ],
    "argument additions and ordering must survive the atomic settings PATCH",
  );
  await pressUiEscape(browser);
  await reopenedSettingsDialog.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });

  const handle = await browser.$('[data-testid="sidebar-resize-handle"]');
  await handle.click();
  await browser.keys(Array(20).fill(Key.ArrowLeft));
  await browser.waitUntil(
    async () => (await sidebar.getSize("width")) === 240,
    {
      timeout: 3_000,
      timeoutMsg: "sidebar did not stop at its minimum width",
    },
  );

  const releaseResizePointer = await beginUiPointerDrag(browser, handle, {
    x: 80,
    y: 0,
  });
  await releaseResizePointer();
  await browser.waitUntil(async () => (await sidebar.getSize("width")) >= 300, {
    timeout: 3_000,
    timeoutMsg: "sidebar did not respond to pointer resizing",
  });
  const resizedWidth = await sidebar.getSize("width");
  assert.equal(
    await browser.execute(() =>
      Number(window.localStorage.getItem("treefold.sidebar.width")),
    ),
    resizedWidth,
    "resized sidebar width must be persisted",
  );
  const main = await browser.$('[data-testid="workspace-main"]');

  let nodeNames = await browser.$$('[data-testid="sidebar-node-name"]');
  if ((await nodeNames.length) === 0) {
    const projectToggle = await browser.$(
      `button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`,
    );
    await projectToggle.waitForExist({ timeout: 3_000 });
    await projectToggle.click();
    nodeNames = await browser.$$('[data-testid="sidebar-node-name"]');
  }
  const workspaceToggle = await browser.$(
    `button[aria-label="Expand Workspace ${FIXTURE_NAMES.workspace}"]`,
  );
  await workspaceToggle.waitForDisplayed({ timeout: 3_000 });
  await workspaceToggle.click();
  const forkToggle = await browser.$(
    `button[aria-label="Expand Fork ${FIXTURE_NAMES.fork}"]`,
  );
  await forkToggle.waitForDisplayed({ timeout: 3_000 });
  await forkToggle.click();
  await browser
    .$(`button[title="setup · fixture-repository"]`)
    .waitForExist({ timeout: 3_000 });

  nodeNames = await browser.$$('[data-testid="sidebar-node-name"]');
  assert.equal(
    nodeNames.length,
    2,
    "expected the fixture Workspace and its active Fork",
  );
  for (const name of nodeNames) {
    const owner = await name.$("..");
    assert.equal(
      await owner.getAttribute("title"),
      await name.getText(),
      "sidebar node must expose its full name on hover",
    );
  }
  assert.equal(
    (await sidebar.getText()).includes(FIXTURE_NAMES.archivedWorkspace),
    false,
    "finished Workspace must stay out of the active sidebar tree",
  );
  assert.equal(
    (await sidebar.getText()).includes(FIXTURE_NAMES.archivedFork),
    false,
    "archived Fork must stay out of the active sidebar tree",
  );

  await openUiContextMenu(
    browser,
    await browser.$('[data-testid="sidebar-workspace-node"]'),
  );
  let nodeContextMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await nodeContextMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await nodeContextMenu.$('[data-testid="archive-project-action"]')
    ).isExisting(),
    false,
    "Workspace context menu must not expose Project archive",
  );
  await (
    await nodeContextMenu.$('[data-testid="finish-workspace-action"]')
  ).click();
  const workspaceFinishDialog = await browser.$('[role="dialog"]');
  await workspaceFinishDialog.waitForDisplayed({ timeout: 3_000 });
  const workspaceStrategy = await workspaceFinishDialog.$(
    "#finish-code-action",
  );
  assert.deepEqual(
    await browser.execute(
      (select) => Array.from((select as HTMLSelectElement).options, (option) => option.value),
      workspaceStrategy,
    ),
    ["local_merge", "push_branch", "keep"],
    "Workspace Finish must expose local merge, feature push, and preserve strategies",
  );
  assert.equal(
    await workspaceStrategy.getValue(),
    "push_branch",
    "Workspace Finish must inherit the Repository default strategy",
  );
  assert.equal(
    await (await workspaceFinishDialog.$('input[placeholder*="commit"]')).isExisting(),
    false,
    "Finish must not offer an implicit commit message",
  );
  await pressUiEscape(browser);
  await workspaceFinishDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await openUiContextMenu(
    browser,
    await browser.$('[data-testid="sidebar-fork-node"]'),
  );
  nodeContextMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await nodeContextMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await nodeContextMenu.$('[data-testid="sidebar-pull-menu"]')
    ).isExisting(),
    false,
    "Fork context menu must not expose Workspace synchronization",
  );
  assert.equal(
    await (
      await nodeContextMenu.$('[data-testid="archive-project-action"]')
    ).isExisting(),
    false,
    "Fork context menu must not expose Project archive",
  );
  await browser.execute(() => {
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
    browser,
    await nodeContextMenu.$('[data-testid="copy-absolute-path-menu"]'),
  );
  const copyPathSubmenu = await browser.$(
    '[data-testid="copy-absolute-path-submenu"]',
  );
  await copyPathSubmenu.waitForDisplayed({ timeout: 3_000 });
  const copyDirectoryGroups = await copyPathSubmenu.$$(
    '[data-testid^="directory-group-"]',
  );
  assert.equal(
    await copyDirectoryGroups[0].getAttribute("data-testid"),
    `directory-group-${FIXTURE_IDS.primaryRepository}`,
    "copy path must use the same primary-first Repository groups as Session creation",
  );
  await (
    await copyPathSubmenu.$(
      `[data-testid="copy-absolute-path-${FIXTURE_IDS.secondaryDirectory}"]`,
    )
  ).click();
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => window.__treefoldCopiedPath)) ===
      "/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture-api",
    {
      timeout: 3_000,
      timeoutMsg: "copy path action must write the selected Directory path",
    },
  );
  await pressUiEscape(browser);
  await browser.execute(() => {
    document.querySelector('[data-testid="sidebar-fork-node"]')?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth - 2,
        clientY: window.innerHeight - 2,
      }),
    );
  });
  nodeContextMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await nodeContextMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await nodeContextMenu.$('[data-testid="session-kind-shell"]'),
  );
  await assertOverlayVisibleAndTopmost(
    browser,
    '[data-testid="directory-session-context-menu"]',
    "viewport-edge context menu",
  );
  await assertOverlayVisibleAndTopmost(
    browser,
    '[data-testid="directory-session-submenu"]',
    "viewport-edge directory submenu",
  );
  await pressUiEscape(browser);

  const projectCreateButton = await browser.$(
    '[data-testid="sidebar-project-action"]',
  );
  await projectCreateButton.click();
  let sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  const createWorkspaceAction = await sessionMenu.$(
    '[data-testid="create-workspace-action"]',
  );
  await moveUiPointerTo(
    browser,
    await sessionMenu.$('[data-testid="session-kind-shell"]'),
  );
  const projectSessionSubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await assertDirectorySubmenu(projectSessionSubmenu, "Shell", [
    FIXTURE_IDS.primaryDirectory,
  ]);
  await moveUiPointerTo(browser, createWorkspaceAction);
  await createWorkspaceAction.click();
  const createWorkspaceDialog = await browser.$('[role="dialog"]');
  await createWorkspaceDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await createWorkspaceDialog.$('input[name="target_branch"]')
    ).isExisting(),
    false,
    "Workspace creation must inherit base branches from Git locations",
  );
  assert.equal(
    await (
      await createWorkspaceDialog.$('select[name="delivery_mode"]')
    ).isExisting(),
    false,
    "Workspace creation must inherit delivery modes from Git locations",
  );
  await pressUiEscape(browser);
  await createWorkspaceDialog.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });
  await projectCreateButton.click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await sessionMenu.$('[data-testid="session-kind-codex"]'),
  );
  await main.click();
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });

  const actionButtons = await browser.$$('[data-testid="sidebar-node-action"]');
  assert.equal(
    actionButtons.length,
    2,
    "expected creation actions for the active Workspace and Fork",
  );
  const forkNodes = await browser.$$('[data-testid="sidebar-fork-node"]');
  assert.equal(forkNodes.length, 1, "expected exactly one active fixture Fork");
  for (const fork of forkNodes) {
    assert.ok(
      await (await fork.$('[data-testid="sidebar-node-action"]')).isExisting(),
      "a visible Fork must expose its Session creation action",
    );
  }

  await actionButtons[0].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  const createForkAction = await sessionMenu.$(
    '[data-testid="create-fork-action"]',
  );
  await createForkAction.click();
  const createForkDialog = await browser.$('[role="dialog"]');
  await createForkDialog.waitForDisplayed({ timeout: 3_000 });
  await pressUiEscape(browser);
  await createForkDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[0].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await sessionMenu.$('[data-testid="session-kind-codex"]'),
  );
  const workspaceAgentSubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await assertDirectorySubmenu(workspaceAgentSubmenu, "Agent", [
    FIXTURE_IDS.primaryDirectory,
  ]);
  await main.click();
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[0].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await pressUiEscape(browser);
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[1].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await sessionMenu.$('[data-testid="create-fork-action"]')
    ).isExisting(),
    false,
    "Fork plus menu must not offer a nested Fork",
  );
  await moveUiPointerTo(
    browser,
    await sessionMenu.$('[data-testid="session-kind-shell"]'),
  );
  const forkShellSubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await assertDirectorySubmenu(forkShellSubmenu, "Shell", [
    FIXTURE_IDS.primaryDirectory,
    FIXTURE_IDS.secondaryDirectory,
  ]);
  const forkDirectoryGroups = await forkShellSubmenu.$$(
    '[data-testid^="directory-group-"]',
  );
  assert.equal(
    await forkDirectoryGroups[0].getAttribute("data-testid"),
    `directory-group-${FIXTURE_IDS.primaryRepository}`,
    "the Repository containing the primary Directory must render first",
  );
  assert.equal(
    (await forkShellSubmenu.getText()).includes("primary"),
    false,
    "Directory choices must communicate the default through ordering instead of a primary suffix",
  );
  await main.click();
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[1].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await sessionMenu.$('[data-testid="session-kind-codex"]'),
  );
  const forkAgentSubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await assertDirectorySubmenu(forkAgentSubmenu, "Agent", [
    FIXTURE_IDS.primaryDirectory,
    FIXTURE_IDS.secondaryDirectory,
  ]);
  await pressUiEscape(browser);
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await browser
    .$(
      `[data-testid="sidebar-workspace-node"] button[title="${FIXTURE_NAMES.workspace}"]`,
    )
    .click();
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(
        `#/workspaces/${FIXTURE_IDS.workspace}`,
      ),
    {
      timeout: 3_000,
      timeoutMsg: "fixture Workspace navigation did not update the route",
    },
  );
  await browser
    .$('[data-testid="breadcrumb-workspace"]')
    .waitForDisplayed({ timeout: 3_000 });
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
    await (await browser.$('[data-testid="breadcrumb-project"]')).getText(),
    FIXTURE_NAMES.project,
    "Workspace breadcrumb must include its Project",
  );
  assert.equal(
    await (await browser.$('[data-testid="breadcrumb-workspace"]')).getText(),
    FIXTURE_NAMES.workspace,
    "Workspace breadcrumb must identify the current Workspace",
  );
  assert.equal(
    await (
      await browser.$('[data-testid="breadcrumb-workspace"]')
    ).getAttribute("aria-current"),
    "page",
    "Workspace must be the current breadcrumb",
  );
  assert.equal(
    await (await browser.$('[data-testid="breadcrumb-fork"]')).isExisting(),
    false,
    "Workspace breadcrumb must not invent a Fork level",
  );
  let baseSection = await browser.$(
    '[data-testid="workspace-repositories-section"]',
  );
  await baseSection.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (await browser.$('[data-testid="new-fork-action"]')).isExisting(),
    false,
    "Workspace details must not duplicate sidebar creation actions",
  );
  assert.equal(
    await (
      await browser.$('[data-testid="finish-workspace-action"]')
    ).isExisting(),
    false,
    "Workspace details must not duplicate sidebar lifecycle actions",
  );
  assert.equal(
    await (await baseSection.$("h2")).getText(),
    "Workspace Repositories",
    "worktree metadata must be grouped by Repository",
  );
  assert.match(
    await baseSection.getText(),
    /fixture-repository[\s\S]*read_write/,
  );
  assert.match(
    await baseSection.getText(),
    /fixture-repository[\s\S]*Root[\s\S]*fixture-repository[\s\S]*apps\/web/,
    "a monorepo must show both Directory scopes under one Repository",
  );
  const workspaceContextDirectories = await browser.$(
    '[data-testid="workspace-context-directories"]',
  );
  assert.match(
    await workspaceContextDirectories.getText(),
    /fixture-documentation[\s\S]*read only/,
  );
  const primaryWorkspaceRepository = await baseSection.$(
    `[data-testid="workspace-location-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
  );
  const primaryWorkspaceActionsTrigger = await primaryWorkspaceRepository.$(
    `[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}-trigger"]`,
  );
  await clickUiElement(browser, primaryWorkspaceActionsTrigger);
  let primaryWorkspaceActions = await browser.$(
    `[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
  );
  await primaryWorkspaceActions.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await primaryWorkspaceActions.$(
        `[data-testid="workspace-location-clear-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
      )
    ).isExisting(),
    true,
    "an existing upstream must expose its clear action",
  );
  await (
    await primaryWorkspaceActions.$(
      `[data-testid="workspace-location-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
    )
  ).click();
  const upstreamDialog = await browser.$('[role="dialog"]');
  await upstreamDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (await upstreamDialog.$('select[name="delivery_mode"]')).isExisting(),
    false,
    "Workspace upstream settings must not override Project delivery policy",
  );
  await (
    await upstreamDialog.$('input[name="remote_branch"]')
  ).setValue("feature/updated-fixture");
  await (await upstreamDialog.$("button=Save upstream")).click();
  await upstreamDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await browser.waitUntil(
    async () =>
      (await primaryWorkspaceRepository.getText()).includes(
        "origin/feature/updated-fixture",
      ),
    {
      timeout: 3_000,
      timeoutMsg: "updated repository upstream did not refresh",
    },
  );
  assert.deepEqual(harness.workspaceLocationUpdates.at(-1), {
    id: FIXTURE_IDS.workspacePrimaryLocation,
    remote_name: "origin",
    remote_branch: "feature/updated-fixture",
  });
  await clickUiElement(browser, primaryWorkspaceActionsTrigger);
  primaryWorkspaceActions = await browser.$(
    `[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
  );
  await primaryWorkspaceActions.waitForDisplayed({ timeout: 3_000 });
  await (
    await primaryWorkspaceActions.$(
      `[data-testid="workspace-location-clear-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
    )
  ).click();
  await browser.waitUntil(
    async () => /upstream\s+—/.test(await primaryWorkspaceRepository.getText()),
    {
      timeout: 3_000,
      timeoutMsg: "cleared repository upstream did not refresh",
    },
  );
  await clickUiElement(browser, primaryWorkspaceActionsTrigger);
  primaryWorkspaceActions = await browser.$(
    `[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
  );
  await primaryWorkspaceActions.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await primaryWorkspaceActions.getText(),
    "Set upstream",
    "repository details must keep configuration after sync moves to the sidebar",
  );
  await (
    await primaryWorkspaceActions.$(
      `[data-testid="workspace-location-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
    )
  ).click();
  const setUpstreamDialog = await browser.$('[role="dialog"]');
  await setUpstreamDialog.waitForDisplayed({ timeout: 3_000 });
  await (
    await setUpstreamDialog.$('input[name="remote_name"]')
  ).setValue("origin");
  await (
    await setUpstreamDialog.$('input[name="remote_branch"]')
  ).setValue("feature/ui-fixture");
  await (await setUpstreamDialog.$("button=Save upstream")).click();
  await setUpstreamDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  const workspaceNode = await browser.$(
    '[data-testid="sidebar-workspace-node"]',
  );
  await moveUiPointerTo(browser, workspaceNode);
  const workspaceNodeMenuTrigger = await workspaceNode.$(
    '[data-testid="sidebar-node-menu-trigger"]',
  );
  await workspaceNodeMenuTrigger.click();
  let workspaceNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await workspaceNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await workspaceNodeMenu.$('[data-testid="sidebar-pull-menu"]'),
  );
  let workspaceGitSubmenu = await browser.$(
    '[data-testid="sidebar-git-submenu"]',
  );
  await workspaceGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await workspaceGitSubmenu.$(
      `[data-testid="sidebar-pull-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
    )
  ).click();
  assert.equal(
    harness.syncRequests.at(-1),
    `/api/workspace-repositories/${FIXTURE_IDS.workspacePrimaryLocation}/git/pull`,
    "Workspace repository Pull must target only its Repository",
  );
  const pullSucceededToast = await waitForToast(
    browser,
    "status",
    /Pull succeeded/,
  );
  await (await pullSucceededToast.$('button[aria-label="Close toast"]')).click();
  await moveUiPointerTo(browser, workspaceNode);
  await workspaceNodeMenuTrigger.click();
  workspaceNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await workspaceNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await workspaceNodeMenu.$('[data-testid="sidebar-pull-menu"]'),
  );
  workspaceGitSubmenu = await browser.$('[data-testid="sidebar-git-submenu"]');
  await workspaceGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await workspaceGitSubmenu.$('[data-testid="sidebar-pull-all"]')
  ).click();
  assert.equal(
    harness.syncRequests.at(-1),
    `/api/workspaces/${FIXTURE_IDS.workspace}/git/pull-all`,
    "Workspace bulk Pull must target every configured repository",
  );
  await renameNode(
    browser,
    '[data-testid="sidebar-workspace-node"]',
    "Renamed Workspace",
    "Updated Workspace description",
  );
  assert.equal(
    await (
      await browser.$(
        '[data-testid="sidebar-workspace-node"] [data-testid="sidebar-node-name"]',
      )
    ).getText(),
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
    browser,
    '[data-testid="sidebar-workspace-node"]',
    FIXTURE_NAMES.workspace,
    "Parent Workspace for the deterministic sidebar flow.",
  );
  const workspaceChildren = await browser.$(
    '[data-testid="sidebar-workspace-children"]',
  );
  const workspaceCodexRow = await workspaceChildren.$(
    `[data-testid="sidebar-session-${FIXTURE_IDS.workspaceCodex}"]`,
  );
  const workspaceShellRow = await workspaceChildren.$(
    `[data-testid="sidebar-session-${FIXTURE_IDS.workspaceShell}"]`,
  );
  await pointerDragSession(
    browser,
    workspaceCodexRow,
    workspaceShellRow,
    "before",
  );
  await browser.waitUntil(() => harness.sessionOrderRequests.length > 0, {
    timeout: 3_000,
    timeoutMsg: "Session drag did not persist its order",
  });
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
  const reorderedWorkspaceRows = await workspaceChildren.$$(
    '[data-testid^="sidebar-session-"]',
  );
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
  const reorderedWorkspaceCodexRow = await workspaceChildren.$(
    `[data-testid="sidebar-session-${FIXTURE_IDS.workspaceCodex}"]`,
  );
  const reorderedWorkspaceShellRow = await workspaceChildren.$(
    `[data-testid="sidebar-session-${FIXTURE_IDS.workspaceShell}"]`,
  );
  await pointerDragSession(
    browser,
    reorderedWorkspaceCodexRow,
    reorderedWorkspaceShellRow,
    "after",
  );
  await browser.waitUntil(() => harness.sessionOrderRequests.length > 1, {
    timeout: 3_000,
    timeoutMsg: "Downward Session drag did not persist its order",
  });
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
  const restoredWorkspaceRows = await workspaceChildren.$$(
    '[data-testid^="sidebar-session-"]',
  );
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
    await workspaceContextDirectories
      .$('[data-testid^="workspace-location-actions-"]')
      .isExisting(),
    false,
    "read-only context Directories must not expose Repository Git actions",
  );
  assert.equal(
    await (await browser.$("button=New Shell")).isExisting(),
    false,
    "Workspace details must rely on the sidebar plus menu for Shell creation",
  );
  assert.equal(
    await (await browser.$("button=New Codex")).isExisting(),
    false,
    "Workspace details must rely on the sidebar plus menu for Codex creation",
  );
  const creationError = await baseSection.$(
    `[data-testid="workspace-location-error-${FIXTURE_IDS.workspaceSecondaryLocation}"]`,
  );
  assert.equal(
    await creationError.getAttribute("role"),
    "alert",
    "worktree creation failures must be announced",
  );
  assert.match(
    await creationError.getText(),
    /simulated fixture failure/,
    "worktree creation failure details must remain visible",
  );
  await createSessionFromSidebar(
    browser,
    '[data-testid="sidebar-workspace-node"]',
    FIXTURE_IDS.primaryDirectory,
    "Agent",
  );
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(
        `#/workspaces/${FIXTURE_IDS.workspace}/sessions/session-created-codex-ui-fixture`,
      ),
    {
      timeout: 1_000,
      timeoutMsg:
        "Codex creation did not navigate directly to the created Session",
    },
  );
  const workspaceSessionBreadcrumb = await browser.$(
    '[data-testid="header-breadcrumb"]',
  );
  assert.match(
    await workspaceSessionBreadcrumb.getText(),
    new RegExp(`${FIXTURE_NAMES.project}[\\s\\S]*${FIXTURE_NAMES.workspace}`),
    "Workspace Session must retain its owning breadcrumb hierarchy",
  );
  assert.equal(
    (await workspaceSessionBreadcrumb.getText()).includes("codex"),
    false,
    "Session names must stay out of the breadcrumb hierarchy",
  );
  assert.equal(
    await (
      await workspaceSessionBreadcrumb.$('[data-testid="breadcrumb-workspace"]')
    ).getAttribute("aria-current"),
    "page",
    "Workspace must remain the current breadcrumb inside a Session",
  );
  assert.equal(
    await (await browser.$('[role="dialog"]')).isExisting(),
    false,
    "Codex creation must not open a setup dialog",
  );
  assert.match(
    await main.getText(),
    /codex[\s\S]*running/i,
    "the created Codex Session must render from the POST response",
  );
  await (await browser.$('button[aria-label="Show right sidebar"]')).click();
  const codexInspector = await browser.$('[data-testid="right-sidebar"]');
  await browser.waitUntil(
    async () => (await codexInspector.getAttribute("aria-hidden")) === "false",
    {
      timeout: 3_000,
      timeoutMsg: "Codex Session inspector did not open",
    },
  );
  await codexInspector.$('button[role="tab"][aria-label="Git History"]').click();
  const singleRepositoryHistorySelect = await codexInspector.$(
    '[data-testid="git-repository"]',
  );
  await singleRepositoryHistorySelect.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await singleRepositoryHistorySelect.getValue(),
    FIXTURE_IDS.workspacePrimaryLocation,
    "Workspace Git History must use its primary repository id",
  );
  assert.equal(
    await singleRepositoryHistorySelect.isEnabled(),
    false,
    "Git History repository selection must be disabled when only one repository is available",
  );
  await (await browser.$('button[aria-label="Hide right sidebar"]')).click();
  const createdCodexSidebarRow = await browser.$(
    '[data-testid="sidebar-session-session-created-codex-ui-fixture"]',
  );
  await moveUiPointerTo(browser, createdCodexSidebarRow);
  await renameSession(
    browser,
    "session-created-codex-ui-fixture",
    "Renamed Agent Session",
  );
  assert.equal(
    await (
      await browser.$(
        '[data-testid="sidebar-session-session-created-codex-ui-fixture"]',
      )
    )
      .getText()
      .then((text) => text.includes("Renamed Agent Session")),
    true,
    "Agent Rename must refresh the sidebar",
  );
  assert.deepEqual(harness.renameRequests.at(-1), {
    kind: "session",
    id: "session-created-codex-ui-fixture",
    name: "Renamed Agent Session",
  });
  const renamedCodexSidebarRow = await browser.$(
    '[data-testid="sidebar-session-session-created-codex-ui-fixture"]',
  );
  await moveUiPointerTo(browser, renamedCodexSidebarRow);
  const createdCodexClose = await renamedCodexSidebarRow.$(
    'button[aria-label="Remove from sidebar"]',
  );
  assert.equal(
    await createdCodexClose.isEnabled(),
    true,
    "Codex must remain closable while its resumable Session ID is being captured",
  );
  await createdCodexClose.click();
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).endsWith(
        `#/workspaces/${FIXTURE_IDS.workspace}`,
      ),
    {
      timeout: 3_000,
      timeoutMsg:
        "closing a newly created Codex did not return to the Workspace",
    },
  );
  await createdCodexSidebarRow.waitForExist({ reverse: true, timeout: 3_000 });
  baseSection = await browser.$('[data-testid="workspace-repositories-section"]');
  await baseSection.waitForDisplayed({ timeout: 3_000 });

  await createSessionFromSidebar(
    browser,
    '[data-testid="sidebar-workspace-node"]',
    FIXTURE_IDS.primaryDirectory,
    "Shell",
  );
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(
        `#/workspaces/${FIXTURE_IDS.workspace}/sessions/session-created-shell-ui-fixture`,
      ),
    {
      timeout: 1_000,
      timeoutMsg:
        "Shell creation waited for the intentionally slow full Workspace refresh",
    },
  );
  assert.match(
    await main.getText(),
    /shell[\s\S]*running/i,
    "the created Shell must render from the POST response without a full refresh",
  );
  await renameSession(
    browser,
    "session-created-shell-ui-fixture",
    "Renamed Shell Session",
  );
  assert.equal(
    (
      await (
        await browser.$(
          '[data-testid="sidebar-session-session-created-shell-ui-fixture"]',
        )
      ).getText()
    ).includes("Renamed Shell Session"),
    true,
    "Shell Rename must refresh the sidebar",
  );
  assert.deepEqual(harness.renameRequests.at(-1), {
    kind: "session",
    id: "session-created-shell-ui-fixture",
    name: "Renamed Shell Session",
  });
  await (await browser.$('main button[aria-label="Close Session"]')).click();
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).endsWith(
        `#/workspaces/${FIXTURE_IDS.workspace}`,
      ),
    {
      timeout: 3_000,
      timeoutMsg: "closing a Workspace Shell did not return to the Workspace",
    },
  );
  baseSection = await browser.$('[data-testid="workspace-repositories-section"]');
  await baseSection.waitForDisplayed({ timeout: 3_000 });
  await browser.waitUntil(
    async () =>
      !(await (
        await browser.$(
          '[data-testid="workspace-session-session-created-shell-ui-fixture"]',
        )
      ).isExisting()),
    {
      timeout: 3_000,
      timeoutMsg: "closed Workspace Shell remained in Session history",
    },
  );
  const activeForkRow = await browser.$(
    `[data-testid="fork-list-row-${FIXTURE_IDS.fork}"]`,
  );
  const activeForkActions = await activeForkRow.$(
    '[data-testid="fork-actions-trigger"]',
  );
  assert.equal(
    await activeForkActions.isExisting(),
    true,
    "active Fork must keep its list action menu visible",
  );
  await clickUiElement(
    browser,
    `[data-testid="fork-list-row-${FIXTURE_IDS.fork}"] [data-testid="fork-actions-trigger"]`,
  );
  const activeForkMenu = await browser.$('[data-testid="fork-actions"]');
  await activeForkMenu.waitForDisplayed({ timeout: 3_000 });
  const blockedForkDelete = await activeForkMenu.$(
    '[data-testid="delete-fork-action"]',
  );
  assert.equal(
    await blockedForkDelete.getAttribute("data-blocked"),
    "true",
    "active Fork deletion must appear unavailable",
  );
  await blockedForkDelete.click();
  let deleteBlockedAlert = await waitForToast(browser, "status", /Finish Fork/i);
  await (
    await deleteBlockedAlert.$('button[aria-label="Close toast"]')
  ).click();
  await pressUiEscape(browser);
  await activeForkMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });

  const archivedForkRow = await browser.$(
    `[data-testid="fork-list-row-${FIXTURE_IDS.archivedFork}"]`,
  );
  await clickUiElement(
    browser,
    `[data-testid="fork-list-row-${FIXTURE_IDS.archivedFork}"] [data-testid="fork-actions-trigger"]`,
  );
  const archivedForkMenu = await browser.$('[data-testid="fork-actions"]');
  await archivedForkMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await archivedForkMenu.$('[data-testid="delete-fork-action"]')
  ).click();
  const deleteForkDialog = await browser.$(
    '[data-testid="delete-record-dialog"]',
  );
  await deleteForkDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await deleteForkDialog.getText(),
    /Permanently delete fork/i,
    "archived Fork deletion must require explicit confirmation",
  );
  await (await deleteForkDialog.$("button=Permanently delete")).click();
  await archivedForkRow.waitForExist({ reverse: true, timeout: 3_000 });
  assert.deepEqual(
    harness.deleteRequests.at(-1),
    { kind: "fork", id: FIXTURE_IDS.archivedFork },
    "Fork deletion must stay scoped to its parent Workspace list",
  );

  await browser.$('button[aria-label="Hide left sidebar"]').click();
  const showSidebar = await browser.$('button[aria-label="Show left sidebar"]');
  await showSidebar.waitForDisplayed({ timeout: 3_000 });
  await showSidebar.click();

  const projectLink = await browser.$('[data-testid="sidebar-project-link"]');
  await projectLink.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await projectLink.getText(),
    FIXTURE_NAMES.project,
    "test must navigate through the deterministic fixture Project",
  );
  await renameNode(
    browser,
    '[data-testid="sidebar-project-node"]',
    "Renamed Project",
    "Updated Project description",
  );
  assert.equal(
    await (await browser.$('[data-testid="sidebar-project-link"]')).getText(),
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
    browser,
    '[data-testid="sidebar-project-node"]',
    FIXTURE_NAMES.project,
    "Deterministic data used only by the Treefold UI core test.",
  );
  const renamedBackProjectLink = await browser.$(
    '[data-testid="sidebar-project-link"]',
  );
  await openUiContextMenu(browser, renamedBackProjectLink);
  const directoryMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await directoryMenu.waitForDisplayed({ timeout: 3_000 });
  const shellSessionItem = await directoryMenu.$(
    '[data-testid="session-kind-shell"]',
  );
  const agentSessionItem = await directoryMenu.$(
    '[data-testid="session-kind-codex"]',
  );
  await moveUiPointerTo(browser, shellSessionItem);
  let directorySubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await assertDirectorySubmenu(directorySubmenu, "Shell", [
    FIXTURE_IDS.primaryDirectory,
    FIXTURE_IDS.attachedDirectory,
  ]);
  await moveUiPointerTo(browser, agentSessionItem);
  await browser.waitUntil(
    async () =>
      (await (
        await (
          await browser.$('[data-testid="directory-session-submenu"]')
        ).$(
          `[data-testid="session-directory-${FIXTURE_IDS.attachedDirectory}"]`,
        )
      ).getAttribute("data-disabled")) !== null,
    {
      timeout: 3_000,
      timeoutMsg: "Agent Session submenu did not become active",
    },
  );
  directorySubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await assertDirectorySubmenu(directorySubmenu, "Agent", [
    FIXTURE_IDS.primaryDirectory,
    FIXTURE_IDS.attachedDirectory,
  ]);
  assert.notEqual(
    await (
      await directorySubmenu.$(
        `[data-testid="session-directory-${FIXTURE_IDS.attachedDirectory}"]`,
      )
    ).getAttribute("data-disabled"),
    null,
    "non-Git locations must remain read-only Agent context",
  );
  const archiveProject = await directoryMenu.$(
    '[data-testid="archive-project-action"]',
  );
  await moveUiPointerTo(browser, archiveProject);
  await archiveProject.click();
  const archiveBlockedAlert = await waitForToast(
    browser,
    "alert",
    /Finish active Workspaces and Forks/i,
  );
  harness.archiveAllStreams();
  await (
    await archiveBlockedAlert.$('button[aria-label="Close toast"]')
  ).click();
  await pressUiEscape(browser);
  await directoryMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await openUiContextMenu(browser, renamedBackProjectLink);
  const archiveReadyMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await archiveReadyMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await archiveReadyMenu.$('[data-testid="archive-project-action"]')
  ).click();
  await browser.waitUntil(
    async () =>
      !(await (
        await browser.$('[data-testid="sidebar-project-link"]')
      ).isExisting()),
    {
      timeout: 3_000,
      timeoutMsg: "archived Project remained in the sidebar",
    },
  );
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith("/"), {
    timeout: 3_000,
    timeoutMsg: "archiving the selected Project did not return to Overview",
  });
  let overviewRow = await browser.$('[data-testid="project-overview-row"]');
  assert.equal(
    await overviewRow.getAttribute("data-project-status"),
    "archived",
    "archived Project must remain visible on Overview",
  );
  await browser.execute((projectId) => {
    window.location.hash = `#/projects/${projectId}`;
  }, FIXTURE_IDS.project);
  const archivedProjectPage = await browser.$('[data-testid="page-content"]');
  await archivedProjectPage.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await archivedProjectPage.getText(),
    /archived · read-only/i,
    "archived Project details must identify their read-only state",
  );
  assert.equal(
    await (
      await archivedProjectPage.$('[data-testid="project-add-location"]')
    ).isExisting(),
    false,
    "archived Project details must not expose location creation",
  );
  assert.equal(
    await (
      await archivedProjectPage.$('[data-testid^="project-location-actions-"]')
    ).isExisting(),
    false,
    "archived Project details must not expose location edits",
  );
  assert.equal(
    await (await archivedProjectPage.$("button=Resume")).isExisting(),
    false,
    "archived Project details must not resume Sessions",
  );
  await (await browser.$('[data-testid="breadcrumb-projects"]')).click();
  overviewRow = await browser.$('[data-testid="project-overview-row"]');
  await overviewRow.waitForDisplayed({ timeout: 3_000 });
  const archivedProjectActions = await overviewRow.$(
    '[data-testid="project-actions-trigger"]',
  );
  assert.equal(
    await archivedProjectActions.isExisting(),
    true,
    "archived Project must expose lifecycle actions from its list row",
  );
  await clickUiElement(
    browser,
    '[data-testid="project-overview-row"] [data-testid="project-actions-trigger"]',
  );
  const archivedProjectMenu = await browser.$(
    '[data-testid="project-actions"]',
  );
  await archivedProjectMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await archivedProjectMenu.$('[data-testid="restore-project-action"]')
    ).isExisting(),
    true,
    "archived Project must expose Restore to sidebar",
  );
  assert.equal(
    await (
      await archivedProjectMenu.$('[data-testid="delete-project-action"]')
    ).isExisting(),
    true,
    "archived Project must expose permanent deletion",
  );
  harness.restoreActiveStreams();
  await (
    await archivedProjectMenu.$('[data-testid="restore-project-action"]')
  ).click();
  const restoredProjectLink = await browser.$(
    '[data-testid="sidebar-project-link"]',
  );
  await restoredProjectLink.waitForDisplayed({ timeout: 3_000 });
  await browser
    .$(`button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`)
    .click();
  assert.equal(
    (await sidebar.getText()).includes("Parent Shell Session"),
    false,
    "the explicitly closed Shell must remain deleted after restore",
  );
  assert.match(
    await sidebar.getText(),
    /Parent Codex Session.*stopped/s,
    "archiving must retain Codex Sessions as stopped",
  );
  overviewRow = await browser.$('[data-testid="project-overview-row"]');
  assert.equal(
    await overviewRow.getAttribute("data-project-status"),
    "active",
    "restored Project must become active on Overview",
  );
  assert.equal(
    await (
      await overviewRow.$('[data-testid="restore-project-action"]')
    ).isExisting(),
    false,
    "active Project must not expose Restore to sidebar",
  );
  const activeProjectActions = await overviewRow.$(
    '[data-testid="project-actions-trigger"]',
  );
  assert.equal(
    await activeProjectActions.isExisting(),
    true,
    "active Project must keep its list action menu visible",
  );
  await clickUiElement(
    browser,
    '[data-testid="project-overview-row"] [data-testid="project-actions-trigger"]',
  );
  const activeProjectMenu = await browser.$('[data-testid="project-actions"]');
  await activeProjectMenu.waitForDisplayed({ timeout: 3_000 });
  const blockedProjectDelete = await activeProjectMenu.$(
    '[data-testid="delete-project-action"]',
  );
  assert.equal(
    await blockedProjectDelete.getAttribute("data-blocked"),
    "true",
    "active Project deletion must appear unavailable",
  );
  await blockedProjectDelete.click();
  deleteBlockedAlert = await waitForToast(browser, "status", /Archive Project/i);
  await (
    await deleteBlockedAlert.$('button[aria-label="Close toast"]')
  ).click();
  await restoredProjectLink.click();
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(`#/projects/${FIXTURE_IDS.project}`),
    {
      timeout: 3_000,
      timeoutMsg: "fixture Project navigation did not update the route",
    },
  );
  const projectContent = await browser.$('[data-testid="page-content"]');
  await browser.waitUntil(
    async () => (await projectContent.getText()).includes("fixture-documentation"),
    {
      timeout: 3_000,
      timeoutMsg: "Project detail content did not finish rendering after navigation",
    },
  );
  assert.match(
    await projectContent.getText(),
    /fixture-documentation/,
    "attached Directory must remain visible on the Project page",
  );
  const activeWorkspaceRow = await browser.$(
    `[data-testid="workspace-list-row-${FIXTURE_IDS.workspace}"]`,
  );
  const activeWorkspaceActions = await activeWorkspaceRow.$(
    '[data-testid="workspace-actions-trigger"]',
  );
  assert.equal(
    await activeWorkspaceActions.isExisting(),
    true,
    "active Workspace must keep its list action menu visible",
  );
  await clickUiElement(browser, activeWorkspaceActions);
  const activeWorkspaceMenu = await browser.$(
    '[data-testid="workspace-actions"]',
  );
  await activeWorkspaceMenu.waitForDisplayed({ timeout: 3_000 });
  const blockedWorkspaceDelete = await activeWorkspaceMenu.$(
    '[data-testid="delete-workspace-action"]',
  );
  assert.equal(
    await blockedWorkspaceDelete.getAttribute("data-blocked"),
    "true",
    "active Workspace deletion must appear unavailable",
  );
  await blockedWorkspaceDelete.click();
  deleteBlockedAlert = await waitForToast(browser, "status", /Finish Workspace/i);
  await (
    await deleteBlockedAlert.$('button[aria-label="Close toast"]')
  ).click();
  await pressUiEscape(browser);
  await activeWorkspaceMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });

  const archivedWorkspaceRow = await browser.$(
    `[data-testid="workspace-list-row-${FIXTURE_IDS.archivedWorkspace}"]`,
  );
  const archivedWorkspaceActions = await archivedWorkspaceRow.$(
    '[data-testid="workspace-actions-trigger"]',
  );
  await clickUiElement(browser, archivedWorkspaceActions);
  const archivedWorkspaceMenu = await browser.$(
    '[data-testid="workspace-actions"]',
  );
  await archivedWorkspaceMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await archivedWorkspaceMenu.$('[data-testid="delete-workspace-action"]')
  ).click();
  const deleteWorkspaceDialog = await browser.$(
    '[data-testid="delete-record-dialog"]',
  );
  await deleteWorkspaceDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await deleteWorkspaceDialog.getText(),
    /Permanently delete workspace/i,
    "archived Workspace deletion must require explicit confirmation",
  );
  await (await deleteWorkspaceDialog.$("button=Permanently delete")).click();
  await archivedWorkspaceRow.waitForExist({ reverse: true, timeout: 3_000 });
  assert.deepEqual(
    harness.deleteRequests.at(-1),
    { kind: "workspace", id: FIXTURE_IDS.archivedWorkspace },
    "Workspace deletion must stay scoped to its archived list record",
  );
  const projectSessionsSection = await browser.$(
    '[data-testid="project-sessions-section"]',
  );
  assert.match(
    await projectSessionsSection.getText(),
    /Saved Project Codex Session/,
    "saved Project Codex history must remain available after archiving and restoring",
  );
  assert.equal(
    await (await browser.$("button=New Shell")).isExisting(),
    false,
    "Project details must rely on the sidebar plus menu for Shell creation",
  );
  assert.equal(
    await (await browser.$("button=New Codex")).isExisting(),
    false,
    "Project details must rely on the sidebar plus menu for Codex creation",
  );
  await createSessionFromSidebar(
    browser,
    '[data-testid="sidebar-project-node"]',
    FIXTURE_IDS.primaryDirectory,
    "Shell",
  );
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(
        `#/projects/${FIXTURE_IDS.project}/sessions/session-created-project-shell-ui-fixture`,
      ),
    {
      timeout: 1_000,
      timeoutMsg: "Project Shell did not open in the managed Web terminal",
    },
  );
  const closeProjectShell = await browser.$(
    'main button[aria-label="Close Session"]',
  );
  await closeProjectShell.waitForDisplayed({ timeout: 3_000 });
  await closeProjectShell.click();
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).endsWith(`#/projects/${FIXTURE_IDS.project}`),
    {
      timeout: 3_000,
      timeoutMsg: "closing a Project Shell did not return to the Project",
    },
  );
  await browser.waitUntil(
    async () =>
      !(await (
        await browser.$(
          '[data-testid="project-session-session-created-project-shell-ui-fixture"]',
        )
      ).isExisting()),
    {
      timeout: 3_000,
      timeoutMsg: "closed Project Shell remained beside saved Codex history",
    },
  );
  await createSessionFromSidebar(
    browser,
    '[data-testid="sidebar-project-node"]',
    FIXTURE_IDS.primaryDirectory,
    "Agent",
  );
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(
        `#/projects/${FIXTURE_IDS.project}/sessions/session-created-project-codex-ui-fixture`,
      ),
    {
      timeout: 1_000,
      timeoutMsg:
        "Project Codex creation did not navigate directly to the managed Session",
    },
  );
  assert.equal(
    await (await browser.$('[role="dialog"]')).isExisting(),
    false,
    "Project Codex creation must not open a setup dialog",
  );
  assert.match(
    await main.getText(),
    /codex[\s\S]*running/i,
    "the created Project Codex must render from the POST response",
  );
  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  const restoredProjectSessionsSection = await browser.$(
    '[data-testid="project-sessions-section"]',
  );
  await restoredProjectSessionsSection.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await browser.$('[data-testid="project-repositories-menu-trigger"]')
    ).isExisting(),
    false,
    "Project details must not duplicate sidebar synchronization actions",
  );
  const orderedLocationNames = await browser.$$(
    '[data-testid^="project-location-"] h3',
  );
  assert.equal(
    await orderedLocationNames[0].getText(),
    "fixture-repository",
    "primary location must render before attached locations",
  );
  const primaryLocation = await browser.$(
    `[data-testid="project-location-${FIXTURE_IDS.primaryRepository}"]`,
  );
  const primaryRepositoryToggle = await primaryLocation.$(
    `[data-testid="project-location-toggle-${FIXTURE_IDS.primaryRepository}"]`,
  );
  assert.equal(
    await primaryRepositoryToggle.getAttribute("aria-expanded"),
    "true",
    "primary repository children must be expanded by default",
  );
  assert.match(
    await primaryLocation.getText(),
    /base\s+main[\s\S]*current\s+main/,
    "repository rows must show the base branch before the current branch",
  );
  const primaryRefresh = await primaryLocation.$(
    `[data-testid="project-location-refresh-${FIXTURE_IDS.primaryRepository}"]`,
  );
  assert.equal(
    await primaryRefresh.getAttribute("aria-label"),
    "Refresh fixture-repository",
  );
  const primaryActionsTrigger = await primaryLocation.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger"]`,
  );
  await clickUiElement(browser, primaryActionsTrigger);
  let primaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await primaryActionsMenu
      .$(`[data-testid="project-location-make-default-${FIXTURE_IDS.primaryRepository}"]`)
      .isExisting(),
    false,
    "primary repository menu must not expose Make default",
  );
  await primaryActionsMenu
    .$(`[data-testid="project-repository-branches-${FIXTURE_IDS.primaryRepository}"]`)
    .click();
  const branchesDialog = await browser.$('[data-testid="repository-branches"]');
  await branchesDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await branchesDialog.getText(),
    /Local[\s\S]*main[\s\S]*release\/ui-fixture[\s\S]*Remote[\s\S]*origin/,
    "Branch must show local branches and remotes as a hierarchy",
  );
  await branchesDialog.$('button=origin').click();
  const remoteBranch = await branchesDialog.$(
    '[data-testid="branch-remote-origin/feature/ui-fixture"]',
  );
  await remoteBranch.click();
  const branchActions = await browser.$(
    '[data-testid="branch-actions-remote-origin/feature/ui-fixture"]',
  );
  await branchActions.waitForDisplayed({ timeout: 3_000 });
  await pressUiEscape(browser);
  await pressUiEscape(browser);
  await branchesDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await pressUiEscape(browser);
  await primaryActionsMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await clickUiElement(browser, primaryActionsTrigger);
  primaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  await clickUiElement(browser, "h2");
  await primaryActionsMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  let primaryDirectories = await primaryLocation.$(
    `[data-testid="project-repository-directories-${FIXTURE_IDS.primaryRepository}"]`,
  );
  assert.equal(
    await primaryDirectories
      .$(`[data-testid="project-directory-${FIXTURE_IDS.primaryDirectory}"]`)
      .isExisting(),
    true,
    "repository rows must expose directory children",
  );
  assert.match(
    await primaryDirectories
      .$(`[data-testid="project-directory-${FIXTURE_IDS.primaryDirectory}"]`)
      .getText(),
    /Root/,
    "repository-root directories must use a user-facing Root label",
  );
  assert.equal(
    await primaryDirectories
      .$(`[data-testid="project-directory-${FIXTURE_IDS.monorepoDirectory}"]`)
      .isExisting(),
    true,
    "multiple directories must remain grouped under their repository",
  );
  let primaryWorktrees = await primaryLocation.$(
    `[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}"]`,
  );
  assert.equal(
    (await primaryWorktrees.$$('[data-testid="project-worktree-row"]')).length,
    4,
    "repository worktrees must render once as peers of its directories",
  );
  assert.equal(
    await primaryDirectories
      .$(
        `[data-testid="project-directory-toggle-${FIXTURE_IDS.primaryDirectory}"]`,
      )
      .isExisting(),
    false,
    "directories must not own nested worktree toggles",
  );
  assert.equal(
    await primaryWorktrees
      .$('[data-testid="project-worktree-row"][data-project-directory-id]')
      .isExisting(),
    false,
    "worktree rows must not be attributed to a directory",
  );
  const primaryDirectoriesToggle = await primaryLocation.$(
    `[data-testid="project-repository-directories-${FIXTURE_IDS.primaryRepository}-toggle"]`,
  );
  const primaryWorktreesToggle = await primaryLocation.$(
    `[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}-toggle"]`,
  );
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
  await primaryDirectories.waitForExist({ reverse: true, timeout: 3_000 });
  assert.equal(
    await primaryWorktrees.isDisplayed(),
    true,
    "Directories must collapse independently from its peer Worktrees group",
  );
  await primaryDirectoriesToggle.click();
  primaryDirectories = await primaryLocation.$(
    `[data-testid="project-repository-directories-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryDirectories.waitForDisplayed({ timeout: 3_000 });
  await primaryWorktreesToggle.click();
  await primaryWorktrees.waitForExist({ reverse: true, timeout: 3_000 });
  assert.equal(
    await primaryDirectories.isDisplayed(),
    true,
    "Worktrees must collapse independently from its peer Directories group",
  );
  await primaryWorktreesToggle.click();
  primaryWorktrees = await primaryLocation.$(
    `[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryWorktrees.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await primaryWorktrees.getText(),
    /Main checkout[\s\S]*Workspace with an intentionally long name/,
  );

  const secondaryLocation = await browser.$(
    `[data-testid="project-location-${FIXTURE_IDS.secondaryRepository}"]`,
  );
  const secondaryRepositoryToggle = await secondaryLocation.$(
    `[data-testid="project-location-toggle-${FIXTURE_IDS.secondaryRepository}"]`,
  );
  assert.equal(
    await secondaryRepositoryToggle.getAttribute("aria-expanded"),
    "false",
    "attached repositories must be collapsed by default",
  );
  assert.match(
    await secondaryLocation.getText(),
    /base\s+develop[\s\S]*current\s+release\/api-fixture/,
    "each repository must show its own branch metadata",
  );
  assert.equal(
    await secondaryLocation
      .$(
        `[data-testid="project-repository-directories-${FIXTURE_IDS.secondaryRepository}"]`,
      )
      .isExisting(),
    false,
    "collapsed repositories must hide their directories and worktrees",
  );
  const secondaryActionsTrigger = await secondaryLocation.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}-trigger"]`,
  );
  await secondaryActionsTrigger.scrollIntoView({ block: "end" });
  await clickUiElement(browser, secondaryActionsTrigger);
  let secondaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`,
  );
  await secondaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await secondaryActionsMenu
      .$(`[data-testid="project-location-make-default-${FIXTURE_IDS.secondaryRepository}"]`)
      .isExisting(),
    false,
    "Make default must not be exposed on a repository",
  );
  await assertOverlayVisibleAndTopmost(
    browser,
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`,
    "viewport-edge repository actions menu",
  );
  await pressUiEscape(browser);
  await secondaryActionsMenu.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });
  await browser.keys(Key.ArrowDown);
  secondaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`,
  );
  await secondaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await browser.execute(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
    `project-repository-branches-${FIXTURE_IDS.secondaryRepository}`,
    "ArrowDown must open the repository menu and focus its Branch action",
  );
  await pressUiEscape(browser);
  await secondaryActionsMenu.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });
  const contextLocation = await browser.$(
    `[data-testid="project-location-${FIXTURE_IDS.attachedDirectory}"]`,
  );
  assert.equal(
    await contextLocation
      .$(
        `[data-testid="project-location-toggle-${FIXTURE_IDS.attachedDirectory}"]`,
      )
      .isExisting(),
    false,
    "non-Git context locations must not expose a worktree toggle",
  );
  await clickUiElement(
    browser,
    await contextLocation.$(
      `[data-testid="project-location-actions-${FIXTURE_IDS.attachedDirectory}-trigger"]`,
    ),
  );
  const contextActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.attachedDirectory}"]`,
  );
  await contextActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await contextActionsMenu
      .$(`[data-testid="project-location-edit-${FIXTURE_IDS.attachedDirectory}"]`)
      .isDisplayed(),
    true,
    "non-Git context locations must retain their edit action",
  );
  await pressUiEscape(browser);
  await contextActionsMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  assert.equal(
    await browser.$("h2=Git Worktrees").isExisting(),
    false,
    "Project pages must not render a separate cross-repository worktree list",
  );

  await primaryRepositoryToggle.click();
  await primaryWorktrees.waitForExist({ reverse: true, timeout: 3_000 });
  assert.equal(
    await primaryRepositoryToggle.getAttribute("aria-expanded"),
    "false",
    "repository children must collapse together",
  );
  await secondaryRepositoryToggle.click();
  const secondaryDirectory = await secondaryLocation.$(
    `[data-testid="project-directory-${FIXTURE_IDS.secondaryDirectory}"]`,
  );
  const secondaryDirectoryActionsTrigger = await secondaryDirectory.$(
    `[data-testid="project-directory-actions-${FIXTURE_IDS.secondaryDirectory}-trigger"]`,
  );
  await clickUiElement(
    browser,
    `[data-testid="project-directory-actions-${FIXTURE_IDS.secondaryDirectory}-trigger"]`,
  );
  const secondaryDirectoryActions = await browser.$(
    `[data-testid="project-directory-actions-${FIXTURE_IDS.secondaryDirectory}"]`,
  );
  await secondaryDirectoryActions.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await secondaryDirectoryActions.$(
        `[data-testid="project-directory-make-default-${FIXTURE_IDS.secondaryDirectory}"]`,
      )
    ).isExisting(),
    true,
    "a non-default directory must expose Make default",
  );
  await (
    await secondaryDirectoryActions.$(
      `[data-testid="project-directory-edit-${FIXTURE_IDS.secondaryDirectory}"]`,
    )
  ).click();
  const editDirectoryDialog = await browser.$('[role="dialog"]');
  await editDirectoryDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await editDirectoryDialog.$('input[name="base_branch"]').isExisting(),
    false,
    "directory editing must not expose repository branch settings",
  );
  assert.equal(
    await editDirectoryDialog.$('select[name="delivery_mode"]').isExisting(),
    false,
    "directory editing must not expose repository delivery settings",
  );
  const directoryNameInput = await editDirectoryDialog.$('input[name="name"]');
  assert.equal(
    await directoryNameInput.isExisting(),
    true,
    "directory editing must expose its Treefold display name",
  );
  await directoryNameInput.setValue("renamed source scope");
  await (await editDirectoryDialog.$('button=Save')).click();
  await editDirectoryDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await browser.waitUntil(
    async () => (await secondaryDirectory.getText()).includes("renamed source scope"),
    { timeout: 3_000, timeoutMsg: "renamed directory must refresh in its row" },
  );
  const secondaryWorktrees = await secondaryLocation.$(
    `[data-testid="project-repository-worktrees-${FIXTURE_IDS.secondaryRepository}"]`,
  );
  await secondaryWorktrees.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    (await secondaryWorktrees.$$('[data-testid="project-worktree-row"]'))
      .length,
    2,
    "secondary worktrees must remain scoped to the secondary repository",
  );
  assert.equal(
    (
      await secondaryWorktrees.$$(
        `[data-testid="project-worktree-row"][data-project-location-id="${FIXTURE_IDS.secondaryRepository}"]`,
      )
    ).length,
    2,
    "worktree rows must retain their repository identity",
  );
  assert.equal(
    await secondaryDirectory
      .$(
        `[data-testid="project-directory-toggle-${FIXTURE_IDS.secondaryDirectory}"]`,
      )
      .isExisting(),
    false,
    "directory rows must remain leaves beside worktree rows",
  );
  await secondaryRepositoryToggle.click();
  await secondaryWorktrees.waitForExist({ reverse: true, timeout: 3_000 });
  await primaryRepositoryToggle.click();
  primaryWorktrees = await primaryLocation.$(
    `[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryWorktrees.waitForDisplayed({ timeout: 3_000 });
  const addLocationButton = await browser.$(
    '[data-testid="project-add-location"]',
  );
  await addLocationButton.click();
  const addDirectoryDialog = await browser.$('[role="dialog"]');
  await addDirectoryDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (await addDirectoryDialog.$('input[name="name"]')).isExisting(),
    false,
    "Location rows must derive names from dirname",
  );
  let locationRows = await addDirectoryDialog.$$(
    '[data-testid="location-draft-row"]',
  );
  assert.equal(
    locationRows.length,
    1,
    "Location dialog must start with one row",
  );
  await (
    await locationRows[0].$('input[aria-label="Location 1 path"]')
  ).setValue("/tmp/treefold-ui-fixture/new-api-repository");
  await (await locationRows[0].$("button=Check")).click();
  assert.equal(
    await locationRows[0]
      .$('input[aria-label="Location 1 base branch"]')
      .isExisting(),
    false,
    "adding a Git location must defer base branch configuration",
  );
  await (await addDirectoryDialog.$("button=Add another")).click();
  locationRows = await addDirectoryDialog.$$(
    '[data-testid="location-draft-row"]',
  );
  assert.equal(
    locationRows.length,
    2,
    "Add another must append a location row in the same dialog",
  );
  await (
    await locationRows[1].$('input[aria-label="Location 2 path"]')
  ).setValue("/tmp/treefold-ui-fixture/reference-context");
  await (await locationRows[1].$("button=Check")).click();
  await browser.waitUntil(
    async () =>
      (await locationRows[1].getText()).includes("Read-only Workspace context"),
    {
      timeout: 3_000,
      timeoutMsg: "non-Git location did not become read-only context",
    },
  );
  assert.equal(
    (await addDirectoryDialog.$$('input[aria-label$="base branch"]')).length,
    0,
    "location creation must not expose base branch configuration",
  );
  assert.equal(
    (await addDirectoryDialog.$$('select[aria-label$="delivery mode"]')).length,
    0,
    "location creation must not expose delivery configuration",
  );
  await (await addDirectoryDialog.$("button=Add 2 locations")).click();
  await addDirectoryDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await browser.waitUntil(
    async () =>
      (
        await (await browser.$('[data-testid="page-content"]')).getText()
      ).includes("new-api-repository"),
    {
      timeout: 3_000,
      timeoutMsg: "batch-added locations did not refresh the Project",
    },
  );
  await projectCreateButton.click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await sessionMenu.$('[data-testid="create-workspace-action"]')
  ).click();
  const deferredSetupDialog = await browser.$('[role="dialog"]');
  await deferredSetupDialog.waitForDisplayed({ timeout: 3_000 });
  const deferredBaseBranch = await deferredSetupDialog.$(
    'select[name^="base_branch:"]',
  );
  await deferredBaseBranch.waitForEnabled({ timeout: 3_000 });
  assert.match(
    await deferredBaseBranch.getText(),
    /main[\s\S]*release\/ui-fixture/,
    "deferred base selection must list only local branches",
  );
  assert.equal(
    await (
      await deferredSetupDialog.$('select[name^="delivery_mode:"]')
    ).isDisplayed(),
    true,
    "Workspace creation must collect missing Project delivery settings",
  );
  assert.match(
    await (
      await deferredSetupDialog.$('select[name^="base_remote:"]')
    ).getText(),
    /origin/,
    "push delivery must select from repository remotes",
  );
  const sharedWorkspaceBranch = await deferredSetupDialog.$(
    'input[name="branch"]',
  );
  const remoteWorkspaceBranch = await deferredSetupDialog.$(
    'input[name="remote_branch"]',
  );
  await sharedWorkspaceBranch.setValue("feature/local-name");
  assert.equal(
    await remoteWorkspaceBranch.getValue(),
    "feature/local-name",
    "remote branch must default to the local Workspace branch name",
  );
  await remoteWorkspaceBranch.setValue("feature/custom-remote-name");
  assert.equal(
    await remoteWorkspaceBranch.getValue(),
    "feature/custom-remote-name",
    "remote branch must remain editable",
  );
  await pressUiEscape(browser);
  await deferredSetupDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  const blockedWorktreeDeletes = await browser.$$(
    'button[data-worktree-delete-state="blocked"]',
  );
  const availableWorktreeDeletes = await browser.$$(
    'button[data-worktree-delete-state="available"]',
  );
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
  await blockedWorktreeDeletes[0].click();
  const blockedWorktreeAlert = await waitForToast(
    browser,
    "status",
    /belongs to active Workspace/,
  );
  await (
    await blockedWorktreeAlert.$('button[aria-label="Close toast"]')
  ).click();
  const projectNode = await browser.$('[data-testid="sidebar-project-node"]');
  await moveUiPointerTo(browser, projectNode);
  const projectNodeMenuTrigger = await projectNode.$(
    '[data-testid="sidebar-node-menu-trigger"]',
  );
  await projectNodeMenuTrigger.click();
  let projectNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await projectNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await projectNodeMenu.$('[data-testid="sidebar-pull-menu"]'),
  );
  let projectGitSubmenu = await browser.$(
    '[data-testid="sidebar-git-submenu"]',
  );
  await projectGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await projectGitSubmenu.$(
        `[data-testid="sidebar-pull-${FIXTURE_IDS.secondaryRepository}"]`,
      )
    ).isExisting(),
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
  await (await projectGitSubmenu.$('[data-testid="sidebar-pull-all"]')).click();
  assert.equal(
    harness.syncRequests.at(-1),
    `/api/projects/${FIXTURE_IDS.project}/git/pull-all`,
    "bulk Pull must target every Project repository",
  );
  const pullFailedToast = await waitForToast(
    browser,
    "alert",
    /fixture-repository: remote rejected the update/,
  );
  await (await pullFailedToast.$('button[aria-label="Close toast"]')).click();
  await pressUiEscape(browser);
  await projectNodeMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await moveUiPointerTo(browser, projectNode);
  await projectNodeMenuTrigger.click();
  projectNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await projectNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await moveUiPointerTo(
    browser,
    await projectNodeMenu.$('[data-testid="sidebar-push-menu"]'),
  );
  projectGitSubmenu = await browser.$('[data-testid="sidebar-git-submenu"]');
  await projectGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await projectGitSubmenu.$(
      `[data-testid="sidebar-push-${FIXTURE_IDS.primaryRepository}"]`,
    )
  ).click();
  assert.equal(
    harness.syncRequests.at(-1),
    `/api/project-repositories/${FIXTURE_IDS.primaryRepository}/git/push`,
    "Project repository Push must target only its Repository",
  );
  await pressUiEscape(browser);
  await projectNodeMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await clickUiElement(
    browser,
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger"]`,
  );
  primaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await primaryActionsMenu.$(
      `[data-testid="project-repository-edit-${FIXTURE_IDS.primaryRepository}"]`,
    )
  ).click();
  const setupCommand = await browser.$(
    'textarea[aria-label="Worktree setup command"]',
  );
  await setupCommand.waitForDisplayed({ timeout: 3_000 });
  const baseBranchSelect = await browser.$('select[name="base_branch"]');
  await baseBranchSelect.waitForEnabled({ timeout: 3_000 });
  assert.equal(
    await baseBranchSelect.isDisplayed(),
    true,
    "base branch must be selected from repository settings",
  );
  assert.match(
    await baseBranchSelect.getText(),
    /main[\s\S]*release\/ui-fixture/,
    "base branch options must come from local branches",
  );
  const baseRemoteSelect = await browser.$('select[name="base_remote"]');
  assert.equal(
    await baseRemoteSelect.isDisplayed(),
    true,
    "Pull and Push remote must be selected from repository settings",
  );
  assert.match(
    await baseRemoteSelect.getText(),
    /None[\s\S]*origin/,
    "remote options must list configured Git remotes",
  );
  assert.equal(
    await (await browser.$('select[name="delivery_mode"]')).isDisplayed(),
    true,
    "delivery mode must be edited from repository settings",
  );
  await setupCommand.setValue("npm install && npm run prepare");
  await browser.$("button=Save repository").click();
  await browser.waitUntil(async () => !(await setupCommand.isExisting()), {
    timeout: 3_000,
    timeoutMsg:
      "Repository details did not close after saving repository settings",
  });
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
    await (await browser.$('[data-testid="page-content"]')).getText(),
    /Setup/,
    "Repository must show when Worktree setup is configured",
  );
  const showRightSidebar = await browser.$(
    'button[aria-label="Show right sidebar"]',
  );
  await showRightSidebar.waitForDisplayed({ timeout: 5_000 });
  await showRightSidebar.click();
  const rightSidebar = await browser.$('[data-testid="right-sidebar"]');
  await rightSidebar.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await toolbar.isDisplayed(),
    true,
    "toolbar must remain visible with the right sidebar open",
  );
  await browser.$('button[role="tab"][aria-label="Git History"]').click();
  const historyRepository = await browser.$(
    '[data-testid="git-repository"]',
  );
  await historyRepository.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await historyRepository.getValue(),
    FIXTURE_IDS.primaryRepository,
    "Git History must default to the Project primary repository",
  );
  assert.equal(
    await historyRepository.isEnabled(),
    true,
    "Git History repository selection must be available for multiple repositories",
  );
  await browser.waitUntil(
    async () =>
      (await browser.$$('[data-testid="git-history-commit"]').length) ===
      FIXTURE_COMMITS.length,
    {
      timeout: 3_000,
      timeoutMsg: "Git History tab did not render fixture commits",
    },
  );
  await selectUiOption(browser, historyRepository, FIXTURE_IDS.secondaryRepository);
  await browser.waitUntil(async () => (await rightSidebar.getText()).includes("develop"), {
    timeout: 3_000,
    timeoutMsg: "Git History did not load the selected repository",
  });
  await browser.$('button[aria-label="Hide right sidebar"]').click();
  await browser.waitUntil(
    async () => (await rightSidebar.getAttribute("aria-hidden")) === "true",
    {
      timeout: 3_000,
      timeoutMsg: "right sidebar did not enter its hidden state",
    },
  );

  await browser.url(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
  await browser
    .$('[data-testid="workspace-repositories-section"]')
    .waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (await browser.$('[data-testid="breadcrumb-project"]')).getText(),
    FIXTURE_NAMES.project,
    "Fork breadcrumb must retain its Project",
  );
  assert.equal(
    await (await browser.$('[data-testid="breadcrumb-workspace"]')).getText(),
    FIXTURE_NAMES.workspace,
    "Fork breadcrumb must include its parent Workspace",
  );
  assert.equal(
    await (
      await browser.$('[data-testid="breadcrumb-workspace"]')
    ).getAttribute("aria-current"),
    null,
    "parent Workspace breadcrumb must remain navigable from a Fork",
  );
  assert.equal(
    await (await browser.$('[data-testid="breadcrumb-fork"]')).getText(),
    FIXTURE_NAMES.fork,
    "Fork breadcrumb must identify the current Fork",
  );
  assert.equal(
    await (
      await browser.$('[data-testid="breadcrumb-fork"]')
    ).getAttribute("aria-current"),
    "page",
    "Fork must be the current breadcrumb",
  );
  const breadcrumbTypography = await browser.execute(() =>
    ["breadcrumb-project", "breadcrumb-workspace", "breadcrumb-fork"].map(
      (testId) => {
        const style = getComputedStyle(
          document.querySelector(`[data-testid="${testId}"] > span`)!,
        );
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
        };
      },
    ),
  );
  assert.deepEqual(
    breadcrumbTypography,
    Array.from({ length: 3 }, () => breadcrumbTypography[0]),
    "Project, Workspace, and Fork breadcrumbs must share typography",
  );
  assert.equal(
    await (await browser.$('[data-testid="new-fork-action"]')).isExisting(),
    false,
    "Fork details must not offer nested Fork creation",
  );
  assert.equal(
    await (
      await browser.$('[data-testid="finish-workspace-action"]')
    ).isExisting(),
    false,
    "Fork details must not duplicate sidebar lifecycle actions",
  );
  assert.equal(
    await (await browser.$("button=New Shell")).isExisting(),
    false,
    "Fork details must rely on the sidebar plus menu for Shell creation",
  );
  assert.equal(
    await (await browser.$("button=New Codex")).isExisting(),
    false,
    "Fork details must rely on the sidebar plus menu for Codex creation",
  );
  assert.match(
    await (
      await browser.$(
        `[data-testid="workspace-directory-${FIXTURE_IDS.primaryDirectory}"]`,
      )
    ).getText(),
    /Root/,
    "Fork repository-root directories must use the shared Root label",
  );
  assert.equal(
    await (
      await browser.$('[data-testid="workspace-repositories-menu-trigger"]')
    ).isExisting(),
    false,
    "Fork must not expose Workspace repository synchronization",
  );
  assert.equal(
    (
      await browser.$$(
        '[data-testid^="workspace-location-actions-"][data-testid$="-trigger"]',
      )
    ).length,
    0,
    "Fork locations must not expose upstream actions",
  );
  const forkNode = await browser.$('[data-testid="sidebar-fork-node"]');
  await moveUiPointerTo(browser, forkNode);
  await (await forkNode.$('[data-testid="sidebar-node-menu-trigger"]')).click();
  const forkNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await forkNodeMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await (
      await forkNodeMenu.$('[data-testid="sidebar-pull-menu"]')
    ).isExisting(),
    false,
    "Fork menu must not inherit Workspace synchronization",
  );
  await pressUiEscape(browser);
  await renameNode(
    browser,
    '[data-testid="sidebar-fork-node"]',
    "Renamed Fork",
    "Updated Fork description",
  );
  assert.equal(
    await (
      await browser.$(
        '[data-testid="sidebar-fork-node"] [data-testid="sidebar-node-name"]',
      )
    ).getText(),
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
    browser,
    '[data-testid="sidebar-fork-node"]',
    FIXTURE_NAMES.fork,
    "Active Fork with a long label.",
  );
  const renamedForkNode = await browser.$('[data-testid="sidebar-fork-node"]');
  await moveUiPointerTo(browser, renamedForkNode);
  const renamedForkNodeMenuTrigger = await renamedForkNode.$(
    '[data-testid="sidebar-node-menu-trigger"]',
  );
  await renamedForkNodeMenuTrigger.click();
  const restoredForkNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await restoredForkNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await restoredForkNodeMenu.$('[data-testid="finish-workspace-action"]')
  ).click();
  const finishForkDialog = await browser.$('[role="dialog"]');
  await finishForkDialog.waitForDisplayed({ timeout: 3_000 });
  const preflight = await finishForkDialog.$('[data-testid="delivery-preflight"]');
  await preflight.waitForDisplayed({ timeout: 3_000 });
  assert.match(await preflight.getText(), /2 ahead/);
  assert.match(await preflight.getText(), /2 files/);
  assert.match(await preflight.getText(), /source is 1 commit/);
  assert.equal(
    await (await finishForkDialog.$("button*=Finish fixture-repository")).isEnabled(),
    true,
    "a ready preflight must unlock Finish",
  );
  const forkStrategy = await finishForkDialog.$("#finish-code-action");
  assert.deepEqual(
    await browser.execute(
      (select) => Array.from((select as HTMLSelectElement).options, (option) => option.value),
      forkStrategy,
    ),
    ["local_merge", "keep"],
    "Fork Finish must expose only parent merge and preserve strategies",
  );
  const removeWorktree = await finishForkDialog.$("#finish-delete-worktree");
  const deleteBranch = await finishForkDialog.$("#finish-delete-branch");
  assert.equal(await removeWorktree.isSelected(), true);
  assert.equal(await deleteBranch.isSelected(), true);
  await selectUiOption(browser, forkStrategy, "keep");
  assert.equal(await removeWorktree.isSelected(), false);
  assert.equal(await deleteBranch.isSelected(), false);
  assert.equal(await removeWorktree.isEnabled(), true);
  assert.equal(await deleteBranch.isEnabled(), false);
  await (
    await finishForkDialog.$('label[for="finish-delete-worktree"]')
  ).click();
  assert.equal(await removeWorktree.isSelected(), true);
  assert.equal(await deleteBranch.isEnabled(), true);
  await (
    await finishForkDialog.$('label[for="finish-delete-branch"]')
  ).click();
  assert.equal(await deleteBranch.isSelected(), true);
  await pressUiEscape(browser);
  await finishForkDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await browser.url(harness.baseUrl);
  await (await browser.$("h1=Overview")).waitForDisplayed({ timeout: 3_000 });
  await clickUiElement(browser, '[data-testid="new-project-action"]');
  const primaryProjectDialog = await browser.$('[role="dialog"]');
  await primaryProjectDialog.waitForDisplayed({ timeout: 3_000 });
  await (
    await primaryProjectDialog.$('input[name="name"]')
  ).setValue("Primary requirement fixture");
  await (await primaryProjectDialog.$("button=Create Project")).click();
  await primaryProjectDialog.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });
  const primaryLocationDialog = await browser.$('[role="dialog"]');
  await primaryLocationDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await (
      await primaryLocationDialog.$(
        '[data-testid="primary-git-location-requirement"]',
      )
    ).getText(),
    /at least one Git repository/,
    "an empty Project must explain its primary Git requirement",
  );
  let primaryLocationRows = await primaryLocationDialog.$$(
    '[data-testid="location-draft-row"]',
  );
  await (
    await primaryLocationRows[0].$('input[aria-label="Location 1 path"]')
  ).setValue("/tmp/treefold-ui-fixture/first-reference-context");
  await (await primaryLocationRows[0].$("button=Check")).click();
  const addPrimaryLocations = await primaryLocationDialog.$(
    "button=Add 1 location",
  );
  assert.equal(
    await addPrimaryLocations.isEnabled(),
    false,
    "a non-Git-only first batch must not be submittable",
  );
  await (await primaryLocationDialog.$("button=Add another")).click();
  primaryLocationRows = await primaryLocationDialog.$$(
    '[data-testid="location-draft-row"]',
  );
  await (
    await primaryLocationRows[1].$('input[aria-label="Location 2 path"]')
  ).setValue("/tmp/treefold-ui-fixture/primary-repository");
  await (await primaryLocationRows[1].$("button=Check")).click();
  const addMixedLocations = await primaryLocationDialog.$(
    "button=Add 2 locations",
  );
  await browser.waitUntil(() => addMixedLocations.isEnabled(), {
    timeout: 3_000,
    timeoutMsg: "a mixed first batch did not become submittable",
  });
  await addMixedLocations.click();
  await primaryLocationDialog.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });
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
  await browser.url(harness.baseUrl);
  await browser.waitUntil(
    async () =>
      (await browser.$$('[data-testid="project-overview-row"]').length) === 2,
    {
      timeout: 3_000,
      timeoutMsg: "Project summaries did not load after returning to the overview",
    },
  );
  harness.setProjectStatus(FIXTURE_IDS.project, "archived");
  await browser.refresh();
  const deletableProjectRow = await browser.$(
    `[data-testid="project-overview-row"][data-project-id="${FIXTURE_IDS.project}"]`,
  );
  await deletableProjectRow.waitForDisplayed({ timeout: 3_000 });
  await clickUiElement(
    browser,
    `[data-testid="project-overview-row"][data-project-id="${FIXTURE_IDS.project}"] [data-testid="project-actions-trigger"]`,
  );
  const deletableProjectMenu = await browser.$('[data-testid="project-actions"]');
  await deletableProjectMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await deletableProjectMenu.$('[data-testid="delete-project-action"]')
  ).click();
  const deleteProjectDialog = await browser.$('[data-testid="delete-record-dialog"]');
  await deleteProjectDialog.waitForDisplayed({ timeout: 3_000 });
  const cleanupReady = await deleteProjectDialog.$(
    '[data-testid="delete-project-cleanup-ready"]',
  );
  await cleanupReady.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await cleanupReady.getText(),
    /1 managed source.*1 managed worktree/i,
    "Project deletion must summarize Treefold-owned local files",
  );
  const preserveProjectFiles = await deleteProjectDialog.$(
    '[data-testid="delete-project-preserve"]',
  );
  await preserveProjectFiles.click();
  assert.equal(
    await preserveProjectFiles.getAttribute("aria-pressed"),
    "true",
    "Project deletion must allow preserving all local files",
  );
  await (
    await deleteProjectDialog.$('[data-testid="delete-project-cleanup"]')
  ).click();
  await (await deleteProjectDialog.$("button=Permanently delete")).click();
  await deletableProjectRow.waitForExist({ reverse: true, timeout: 3_000 });
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
  await browser
    ?.saveScreenshot("/tmp/treefold-sidebar-core-failure.png")
    .catch(() => {});
  throw error;
} finally {
  await closeUiSession(browser);
  await harness.close();
}

import assert from "node:assert/strict";
import { Key, remote } from "webdriverio";
import {
  FIXTURE_COMMITS,
  FIXTURE_IDS,
  FIXTURE_NAMES,
} from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

async function assertOverlayVisibleAndTopmost(browser, selector, label) {
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

async function createSessionFromSidebar(
  browser,
  ownerSelector,
  directoryId,
  kind,
) {
  const owner = await browser.$(ownerSelector);
  await (await owner.$('[data-sidebar-row-action="true"]')).click();
  const menu = await browser.$('[data-testid="sidebar-session-menu"]');
  await menu.waitForDisplayed({ timeout: 3_000 });
  await (
    await menu.$(
      `[data-testid="session-kind-${kind === "Shell" ? "shell" : "codex"}"]`,
    )
  ).moveTo();
  const submenu = await menu.$('[data-testid="directory-session-submenu"]');
  await submenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await submenu.$(`[data-testid="session-directory-${directoryId}"]`)
  ).click();
}

async function renameNode(browser, nodeSelector, name, description) {
  const node = await browser.$(nodeSelector);
  await node.moveTo();
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

async function renameSession(browser, sessionId, name) {
  const row = await browser.$(`[data-testid="sidebar-session-${sessionId}"]`);
  assert.equal(
    await (await row.$('[data-testid="rename-session-action"]')).isExisting(),
    false,
    "Session rows must not show a Rename icon",
  );
  await row.click({ button: "right" });
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

async function pointerDragSession(browser, source, target, expectedPosition) {
  const sourceLocation = await source.getLocation();
  const sourceSize = await source.getSize();
  const targetLocation = await target.getLocation();
  const targetSize = await target.getSize();
  await browser
    .action("pointer")
    .move({
      x: Math.round(sourceLocation.x + sourceSize.width / 2),
      y: Math.round(sourceLocation.y + sourceSize.height / 2),
    })
    .down({ button: 0 })
    .pause(50)
    .move({
      duration: 250,
      x: Math.round(targetLocation.x + targetSize.width / 2),
      y: Math.round(targetLocation.y + targetSize.height / 2),
    })
    .perform(true);
  try {
    await browser.waitUntil(
      async () =>
        (await target.getAttribute("data-drop-position")) === expectedPosition,
      {
        timeout: 3_000,
        timeoutMsg: `Session drag did not show its ${expectedPosition} insertion line`,
      },
    );
  } finally {
    await browser.releaseActions();
  }
}

const harness = await startUiHarness();
let browser;

try {
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--window-size=1400,900", "--disable-gpu"],
      },
    },
  });

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
    await projectsBreadcrumb.getAttribute("aria-label"),
    "All Projects",
    "breadcrumb root must expose the Project list destination",
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
  await browser.keys(Key.Escape);
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
  await (
    await settingsDialog.$('[data-testid="settings-theme"]')
  ).selectByAttribute("value", "dark");
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
  const settingsSaveStatus = await settingsDialog.$(
    '[data-testid="settings-save-status"]',
  );
  await settingsSaveStatus.waitForDisplayed({ timeout: 3_000 });
  await browser.keys(Key.Escape);
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
  await browser.keys(Key.Escape);
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

  await handle.dragAndDrop({ x: 80, y: 0 }, { duration: 250 });
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
  if (nodeNames.length === 0) {
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
    const owner = await name.parentElement();
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

  await (
    await browser.$('[data-testid="sidebar-workspace-node"]')
  ).click({ button: "right" });
  let nodeContextMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await nodeContextMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(await nodeContextMenu.getText(), /New Fork/);
  assert.match(await nodeContextMenu.getText(), /New Session/i);
  assert.match(await nodeContextMenu.getText(), /Shell[\s\S]*Agent/);
  assert.match(await nodeContextMenu.getText(), /Pull[\s\S]*Push/);
  assert.match(await nodeContextMenu.getText(), /Open in Finder/);
  assert.match(await nodeContextMenu.getText(), /Finish Workspace…/);
  assert.equal(
    await (
      await nodeContextMenu.$('[data-testid="archive-project-action"]')
    ).isExisting(),
    false,
    "Workspace context menu must not expose Project archive",
  );
  await browser.keys(Key.Escape);
  await nodeContextMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await (
    await browser.$('[data-testid="sidebar-fork-node"]')
  ).click({ button: "right" });
  nodeContextMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await nodeContextMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(await nodeContextMenu.getText(), /New Session/i);
  assert.match(await nodeContextMenu.getText(), /Finish Fork…/);
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
  await browser.keys(Key.Escape);
  await browser.execute(() => {
    document
      .querySelector('[data-testid="sidebar-fork-node"]')
      ?.dispatchEvent(
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
  await (
    await nodeContextMenu.$('[data-testid="session-kind-shell"]')
  ).moveTo();
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
  await browser.keys(Key.Escape);

  const projectCreateButton = await browser.$(
    '[data-testid="sidebar-project-action"]',
  );
  await projectCreateButton.click();
  let sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(await sessionMenu.getText(), /NEW SESSION/);
  assert.match(await sessionMenu.getText(), /Shell[\s\S]*Agent/);
  const createWorkspaceAction = await sessionMenu.$(
    '[data-testid="create-workspace-action"]',
  );
  assert.equal(
    await createWorkspaceAction.getText(),
    "New Workspace",
    "Project plus menu must offer Workspace creation first",
  );
  await (await sessionMenu.$('[data-testid="session-kind-shell"]')).moveTo();
  const projectSessionSubmenu = await sessionMenu.$(
    '[data-testid="directory-session-submenu"]',
  );
  assert.match(
    await projectSessionSubmenu.getText(),
    /Shell[\s\S]*fixture-repository/i,
  );
  await createWorkspaceAction.moveTo();
  await createWorkspaceAction.click();
  const createWorkspaceDialog = await browser.$('[role="dialog"]');
  await createWorkspaceDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await createWorkspaceDialog.getText(),
    /New Workspace/,
    "Project plus menu must open Workspace creation",
  );
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
  await browser.keys(Key.Escape);
  await createWorkspaceDialog.waitForDisplayed({
    reverse: true,
    timeout: 3_000,
  });
  await projectCreateButton.click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await (await sessionMenu.$('[data-testid="session-kind-codex"]')).moveTo();
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
  assert.match(await sessionMenu.getText(), /NEW SESSION/);
  assert.match(await sessionMenu.getText(), /Shell[\s\S]*Agent/);
  const createForkAction = await sessionMenu.$(
    '[data-testid="create-fork-action"]',
  );
  assert.equal(
    await createForkAction.getText(),
    "New Fork",
    "Workspace plus menu must offer Fork creation first",
  );
  await createForkAction.click();
  const createForkDialog = await browser.$('[role="dialog"]');
  await createForkDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await createForkDialog.getText(),
    /Fork work/,
    "Workspace plus menu must open Fork creation",
  );
  await browser.keys(Key.Escape);
  await createForkDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[0].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await (await sessionMenu.$('[data-testid="session-kind-codex"]')).moveTo();
  const workspaceAgentSubmenu = await sessionMenu.$(
    '[data-testid="directory-session-submenu"]',
  );
  assert.match(
    await workspaceAgentSubmenu.getText(),
    /Agent[\s\S]*fixture-repository/i,
  );
  await main.click();
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[0].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await browser.keys(Key.Escape);
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
  assert.match(
    await sessionMenu.getText(),
    /NEW SESSION[\s\S]*Shell[\s\S]*Agent/,
    "Fork plus menu must retain Session creation",
  );
  await (await sessionMenu.$('[data-testid="session-kind-shell"]')).moveTo();
  const forkShellSubmenu = await sessionMenu.$(
    '[data-testid="directory-session-submenu"]',
  );
  assert.match(
    await forkShellSubmenu.getText(),
    /Shell[\s\S]*fixture-repository[\s\S]*fixture-api-repository/i,
    "Fork Shell creation must list its repository worktrees",
  );
  await main.click();
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[1].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await (await sessionMenu.$('[data-testid="session-kind-codex"]')).moveTo();
  const forkAgentSubmenu = await sessionMenu.$(
    '[data-testid="directory-session-submenu"]',
  );
  assert.match(
    await forkAgentSubmenu.getText(),
    /Agent[\s\S]*fixture-repository[\s\S]*fixture-api-repository/i,
    "Fork Agent creation must list its repository worktrees",
  );
  await browser.keys(Key.Escape);
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
    '[data-testid="workspace-locations-section"]',
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
    /fixture-repository[\s\S]*\.[\s\S]*fixture-repository[\s\S]*apps\/web/,
    "a monorepo must show both Directory scopes under one Repository",
  );
  const workspaceContextDirectories = await browser.$(
    '[data-testid="workspace-context-directories"]',
  );
  assert.match(
    await workspaceContextDirectories.getText(),
    /fixture-documentation[\s\S]*read only/,
  );
  const primaryWorkspaceLocation = await baseSection.$(
    `[data-testid="workspace-location-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
  );
  const primaryWorkspaceActionsTrigger = await primaryWorkspaceLocation.$(
    `[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}-trigger"]`,
  );
  await primaryWorkspaceActionsTrigger.click();
  let primaryWorkspaceActions = await browser.$(
    `[data-testid="workspace-location-actions-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
  );
  await primaryWorkspaceActions.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await primaryWorkspaceActions.getText(),
    /Change upstream[\s\S]*Clear upstream/,
    "repository details must retain upstream configuration actions",
  );
  await (
    await primaryWorkspaceActions.$(
      `[data-testid="workspace-location-upstream-${FIXTURE_IDS.workspacePrimaryLocation}"]`,
    )
  ).click();
  const upstreamDialog = await browser.$('[role="dialog"]');
  await upstreamDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await upstreamDialog.getText(),
    /Change upstream[\s\S]*fixture-repository/,
  );
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
      (await primaryWorkspaceLocation.getText()).includes(
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
  await primaryWorkspaceActionsTrigger.click();
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
    async () => /upstream\s+—/.test(await primaryWorkspaceLocation.getText()),
    {
      timeout: 3_000,
      timeoutMsg: "cleared repository upstream did not refresh",
    },
  );
  await primaryWorkspaceActionsTrigger.click();
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
  await workspaceNode.moveTo();
  const workspaceNodeMenuTrigger = await workspaceNode.$(
    '[data-testid="sidebar-node-menu-trigger"]',
  );
  await workspaceNodeMenuTrigger.click();
  let workspaceNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await workspaceNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await workspaceNodeMenu.$('[data-testid="sidebar-pull-menu"]')
  ).moveTo();
  let workspaceGitSubmenu = await browser.$(
    '[data-testid="sidebar-git-submenu"]',
  );
  await workspaceGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await workspaceGitSubmenu.getText(),
    /Pull All[\s\S]*fixture-repository/,
    "Workspace Pull submenu must offer all and individual repositories",
  );
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
  await workspaceNode.moveTo();
  await workspaceNodeMenuTrigger.click();
  workspaceNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await workspaceNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await workspaceNodeMenu.$('[data-testid="sidebar-pull-menu"]')
  ).moveTo();
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
  await workspaceNode.moveTo();
  await workspaceNodeMenuTrigger.click();
  workspaceNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await workspaceNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await workspaceNodeMenu.$('[data-testid="sidebar-push-menu"]')
  ).moveTo();
  workspaceGitSubmenu = await browser.$('[data-testid="sidebar-git-submenu"]');
  await workspaceGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await workspaceGitSubmenu.getText(),
    /Push All[\s\S]*fixture-repository/,
    "Workspace Push submenu must offer all and individual repositories",
  );
  await browser.keys(Key.Escape);
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
  const forksSection = await browser.$(
    '[data-testid="workspace-forks-section"]',
  );
  const todosSection = await browser.$(
    '[data-testid="workspace-todos-section"]',
  );
  assert.ok(
    (await baseSection.getLocation("y")) <
      (await forksSection.getLocation("y")),
    "Locations section must appear above Forks",
  );
  assert.ok(
    (await forksSection.getLocation("y")) <
      (await todosSection.getLocation("y")),
    "Forks must remain above Todos",
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
  await (await browser.$('button[aria-label="Hide right sidebar"]')).click();
  const createdCodexSidebarRow = await browser.$(
    '[data-testid="sidebar-session-session-created-codex-ui-fixture"]',
  );
  await createdCodexSidebarRow.moveTo();
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
  await renamedCodexSidebarRow.moveTo();
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
  baseSection = await browser.$('[data-testid="workspace-locations-section"]');
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
  baseSection = await browser.$('[data-testid="workspace-locations-section"]');
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
  await activeForkActions.click();
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
  let deleteBlockedAlert = await browser.$('[role="alert"]');
  await deleteBlockedAlert.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await deleteBlockedAlert.getText(),
    /Finish Fork/i,
    "active Fork deletion must explain how to make deletion available",
  );
  await (
    await deleteBlockedAlert.$('button[aria-label="Dismiss error"]')
  ).click();

  const archivedForkRow = await browser.$(
    `[data-testid="fork-list-row-${FIXTURE_IDS.archivedFork}"]`,
  );
  await (
    await archivedForkRow.$('[data-testid="fork-actions-trigger"]')
  ).click();
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
  await renamedBackProjectLink.click({ button: "right" });
  const directoryMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await directoryMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await directoryMenu.getText(),
    /New Session[\s\S]*Shell[\s\S]*Agent/i,
  );
  assert.match(await directoryMenu.getText(), /Open in Finder/);
  assert.match(
    await directoryMenu.getText(),
    /Rename…[\s\S]*Archive Project/,
    "Project Rename must sit immediately above its lifecycle action",
  );
  assert.match(await directoryMenu.getText(), /Archive Project/);
  const shellSessionItem = await directoryMenu.$(
    '[data-testid="session-kind-shell"]',
  );
  const agentSessionItem = await directoryMenu.$(
    '[data-testid="session-kind-codex"]',
  );
  assert.equal(
    await (
      await browser.$('[data-testid="directory-session-submenu"]')
    ).isExisting(),
    false,
    "directory submenu must be hidden before hover",
  );
  await shellSessionItem.moveTo();
  let directorySubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await directorySubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await directorySubmenu.getText(),
    /Shell[\s\S]*fixture-repository[\s\S]*fixture-documentation/i,
  );
  assert.equal(
    await shellSessionItem.getAttribute("aria-expanded"),
    "true",
    "hovered Session kind must expose active feedback",
  );
  await agentSessionItem.moveTo();
  await browser.waitUntil(
    async () =>
      (await agentSessionItem.getAttribute("aria-expanded")) === "true",
    {
      timeout: 3_000,
      timeoutMsg: "Agent Session submenu did not become active",
    },
  );
  directorySubmenu = await browser.$(
    '[data-testid="directory-session-submenu"]',
  );
  await directorySubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await directorySubmenu.getText(),
    /Agent[\s\S]*fixture-repository[\s\S]*fixture-documentation/i,
  );
  assert.notEqual(
    await (
      await directorySubmenu.$(
        `[data-testid="session-directory-${FIXTURE_IDS.attachedDirectory}"]`,
      )
    ).getAttribute("data-disabled"),
    null,
    "non-Git locations must remain read-only Agent context",
  );
  assert.equal(
    await agentSessionItem.getAttribute("aria-expanded"),
    "true",
    "switching Session kinds must update active feedback",
  );
  const finderItem = await directoryMenu.$(
    '[data-slot="context-menu-item"]*=Open in Finder',
  );
  await finderItem.moveTo({ xOffset: 12, yOffset: 12 });
  await browser.waitUntil(
    async () =>
      await browser.execute(
        () =>
          !document.querySelector('[data-testid="directory-session-submenu"]'),
      ),
    {
      timeout: 3_000,
      timeoutMsg:
        "hovering a non-directory context action did not dismiss the directory submenu",
    },
  );
  const archiveProject = await directoryMenu.$(
    '[data-testid="archive-project-action"]',
  );
  await archiveProject.moveTo();
  assert.equal(
    await browser.execute(
      () =>
        !document.querySelector('[data-testid="directory-session-submenu"]'),
    ),
    true,
    "Archive Project must remain reachable without an open directory submenu",
  );
  await archiveProject.click();
  const archiveBlockedAlert = await browser.$('[role="alert"]');
  await archiveBlockedAlert.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await archiveBlockedAlert.getText(),
    /Finish active Workspaces and Forks/i,
    "Project archive must be blocked while child work remains active",
  );
  harness.archiveAllStreams();
  await (
    await archiveBlockedAlert.$('button[aria-label="Dismiss error"]')
  ).click();
  await renamedBackProjectLink.click({ button: "right" });
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
  assert.match(await overviewRow.getText(), /Archived/);
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
  await archivedProjectActions.click();
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
  await activeProjectActions.click();
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
  deleteBlockedAlert = await browser.$('[role="alert"]');
  await deleteBlockedAlert.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await deleteBlockedAlert.getText(),
    /Archive Project/i,
    "active Project deletion must explain how to make deletion available",
  );
  await (
    await deleteBlockedAlert.$('button[aria-label="Dismiss error"]')
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
  await activeWorkspaceActions.click();
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
  deleteBlockedAlert = await browser.$('[role="alert"]');
  await deleteBlockedAlert.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await deleteBlockedAlert.getText(),
    /Finish Workspace/i,
    "active Workspace deletion must explain how to make deletion available",
  );
  await (
    await deleteBlockedAlert.$('button[aria-label="Dismiss error"]')
  ).click();

  const archivedWorkspaceRow = await browser.$(
    `[data-testid="workspace-list-row-${FIXTURE_IDS.archivedWorkspace}"]`,
  );
  const archivedWorkspaceActions = await archivedWorkspaceRow.$(
    '[data-testid="workspace-actions-trigger"]',
  );
  await archivedWorkspaceActions.click();
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
    "primary repository worktrees must be expanded by default",
  );
  assert.match(
    await primaryLocation.getText(),
    /current\s+main[\s\S]*base\s+main/,
    "repository rows must show read-only current and base branches",
  );
  assert.equal(
    await primaryLocation
      .$(`[data-testid="branch-selector-${FIXTURE_IDS.primaryRepository}"]`)
      .isExisting(),
    false,
    "Project repositories must not expose branch switching",
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
  await primaryActionsTrigger.click();
  let primaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await primaryActionsMenu.getText(),
    "Edit location",
    "ready repository details must retain location configuration only",
  );
  assert.equal(
    (await primaryActionsMenu.getText()).includes("Make default"),
    false,
    "primary repository menu must not expose Make default",
  );
  await browser.keys(Key.Escape);
  await primaryActionsMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await primaryActionsTrigger.click();
  primaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  await (await browser.$("h2=Repositories")).click();
  await primaryActionsMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  let primaryWorktrees = await primaryLocation.$(
    `[data-testid="project-location-worktrees-${FIXTURE_IDS.primaryRepository}"]`,
  );
  assert.equal(
    (await primaryWorktrees.$$('[data-testid="project-worktree-row"]')).length,
    4,
    "primary worktrees must be grouped below their repository",
  );
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
    /current\s+release\/api-fixture[\s\S]*base\s+develop/,
    "each repository must show its own branch metadata",
  );
  assert.equal(
    await secondaryLocation
      .$(
        `[data-testid="project-location-worktrees-${FIXTURE_IDS.secondaryRepository}"]`,
      )
      .isExisting(),
    false,
    "collapsed repositories must hide their worktrees",
  );
  const secondaryActionsTrigger = await secondaryLocation.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}-trigger"]`,
  );
  await secondaryActionsTrigger.scrollIntoView({ block: "end" });
  await secondaryActionsTrigger.click();
  let secondaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`,
  );
  await secondaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await secondaryActionsMenu.getText(),
    /Make default[\s\S]*Edit location/,
    "attached repository details must retain management actions",
  );
  await assertOverlayVisibleAndTopmost(
    browser,
    `[data-testid="project-location-actions-${FIXTURE_IDS.secondaryRepository}"]`,
    "viewport-edge repository actions menu",
  );
  await browser.keys(Key.Escape);
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
    `project-location-make-default-${FIXTURE_IDS.secondaryRepository}`,
    "ArrowDown must open the repository menu and focus its first action",
  );
  await browser.keys(Key.ArrowDown);
  assert.equal(
    await browser.execute(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
    `project-location-edit-${FIXTURE_IDS.secondaryRepository}`,
    "ArrowDown must navigate between repository actions",
  );
  await browser.keys(Key.Escape);
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
  await (
    await contextLocation.$(
      `[data-testid="project-location-actions-${FIXTURE_IDS.attachedDirectory}-trigger"]`,
    )
  ).click();
  const contextActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.attachedDirectory}"]`,
  );
  await contextActionsMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(
    await contextActionsMenu.getText(),
    "Edit location",
    "non-Git context menu must not expose Git synchronization actions",
  );
  await browser.keys(Key.Escape);
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
    "repository worktrees must collapse independently",
  );
  await secondaryRepositoryToggle.click();
  const secondaryWorktrees = await secondaryLocation.$(
    `[data-testid="project-location-worktrees-${FIXTURE_IDS.secondaryRepository}"]`,
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
  await primaryRepositoryToggle.click();
  primaryWorktrees = await primaryLocation.$(
    `[data-testid="project-location-worktrees-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryWorktrees.waitForDisplayed({ timeout: 3_000 });
  const addLocationButton = await browser.$(
    '[data-testid="project-add-location"]',
  );
  assert.match(
    await addLocationButton.getAttribute("class"),
    /bg-primary/,
    "Add location must use the primary button treatment",
  );
  await addLocationButton.click();
  const addDirectoryDialog = await browser.$('[role="dialog"]');
  await addDirectoryDialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(await addDirectoryDialog.getText(), /Add project locations/);
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
  await (
    await locationRows[0].$('input[aria-label="Location 1 base branch"]')
  ).waitForDisplayed({ timeout: 3_000 });
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
    1,
    "only Git rows may configure a base branch",
  );
  assert.equal(
    (await addDirectoryDialog.$$('select[aria-label$="delivery mode"]')).length,
    1,
    "only Git rows may configure a delivery mode",
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
  const blockedWorktreeDeletes = await browser.$$(
    'button[data-worktree-delete-state="blocked"]',
  );
  const availableWorktreeDeletes = await browser.$$(
    'button[data-worktree-delete-state="available"]',
  );
  assert.equal(
    blockedWorktreeDeletes.length,
    3,
    "active Workspace worktrees must expose blocked delete controls",
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
  assert.match(
    await availableWorktreeDeletes[0].getAttribute("class"),
    /text-destructive/,
    "available worktree delete controls must use destructive styling",
  );
  await blockedWorktreeDeletes[0].click();
  const blockedWorktreeAlert = await browser.$('[role="alert"]');
  await blockedWorktreeAlert.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await blockedWorktreeAlert.getText(),
    /belongs to active Workspace/,
    "blocked worktree deletion must explain the active Workspace association",
  );
  await (
    await blockedWorktreeAlert.$('button[aria-label="Dismiss error"]')
  ).click();
  const projectNode = await browser.$('[data-testid="sidebar-project-node"]');
  await projectNode.moveTo();
  const projectNodeMenuTrigger = await projectNode.$(
    '[data-testid="sidebar-node-menu-trigger"]',
  );
  await projectNodeMenuTrigger.click();
  let projectNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await projectNodeMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await projectNodeMenu.getText(),
    /New Workspace[\s\S]*Pull[\s\S]*Push[\s\S]*Open in Finder[\s\S]*Archive Project/,
    "Project menu must combine shared and Project-specific actions",
  );
  await (await projectNodeMenu.$('[data-testid="sidebar-pull-menu"]')).moveTo();
  let projectGitSubmenu = await browser.$(
    '[data-testid="sidebar-git-submenu"]',
  );
  await projectGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await projectGitSubmenu.getText(),
    /Pull All[\s\S]*fixture-repository[\s\S]*fixture-api-repository/,
    "Project Pull submenu must offer all and individual repositories",
  );
  await (await projectGitSubmenu.$('[data-testid="sidebar-pull-all"]')).click();
  assert.equal(
    harness.syncRequests.at(-1),
    `/api/projects/${FIXTURE_IDS.project}/git/pull-all`,
    "bulk Pull must target every Project repository",
  );
  await projectNode.moveTo();
  await projectNodeMenuTrigger.click();
  projectNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await projectNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await (await projectNodeMenu.$('[data-testid="sidebar-push-menu"]')).moveTo();
  projectGitSubmenu = await browser.$('[data-testid="sidebar-git-submenu"]');
  await projectGitSubmenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await projectGitSubmenu.getText(),
    /Push All[\s\S]*fixture-repository[\s\S]*fixture-api-repository/,
    "Project Push submenu must offer all and individual repositories",
  );
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
  await (
    await browser.$(
      `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}-trigger"]`,
    )
  ).click();
  primaryActionsMenu = await browser.$(
    `[data-testid="project-location-actions-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await primaryActionsMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await primaryActionsMenu.$(
      `[data-testid="project-location-edit-${FIXTURE_IDS.primaryRepository}"]`,
    )
  ).click();
  const setupCommand = await browser.$(
    'textarea[aria-label="Worktree setup command"]',
  );
  await setupCommand.waitForDisplayed({ timeout: 3_000 });
  await setupCommand.setValue("npm install && npm run prepare");
  await browser.$("button*=Save").click();
  await browser.waitUntil(async () => !(await setupCommand.isExisting()), {
    timeout: 3_000,
    timeoutMsg:
      "Directory details did not close after saving the Worktree setup command",
  });
  assert.match(
    await (await browser.$('[data-testid="page-content"]')).getText(),
    /Setup/,
    "Directory must show when Worktree setup is configured",
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
  await browser.$('button[role="tab"]*=History').click();
  await browser.waitUntil(
    async () =>
      (await browser.$$('[data-testid="git-history-commit"]')).length ===
      FIXTURE_COMMITS.length,
    {
      timeout: 3_000,
      timeoutMsg: "Git History tab did not render fixture commits",
    },
  );
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
    .$('[data-testid="workspace-locations-section"]')
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
  await forkNode.moveTo();
  await (await forkNode.$('[data-testid="sidebar-node-menu-trigger"]')).click();
  const forkNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await forkNodeMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(
    await forkNodeMenu.getText(),
    /Open in Finder[\s\S]*Rename…[\s\S]*Finish Fork…/,
    "Fork Rename must sit above its lifecycle action",
  );
  assert.equal(
    await (
      await forkNodeMenu.$('[data-testid="sidebar-pull-menu"]')
    ).isExisting(),
    false,
    "Fork menu must not inherit Workspace synchronization",
  );
  await browser.keys(Key.Escape);
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
  await renamedForkNode.moveTo();
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
  assert.match(
    await finishForkDialog.getText(),
    /Finish Fork location/,
    "Finish Fork must open from the sidebar menu",
  );
  await browser.keys(Key.Escape);
  await finishForkDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  const showForkInspector = await browser.$(
    'button[aria-label="Show right sidebar"]',
  );
  await showForkInspector.waitForDisplayed({ timeout: 3_000 });
  await showForkInspector.click();
  const forkInspector = await browser.$('[data-testid="right-sidebar"]');
  const historyTab = await forkInspector.$('button[role="tab"]:nth-child(2)');
  await historyTab.waitForDisplayed({ timeout: 3_000 });
  await browser.$('button[role="tab"]*=Operations').click();
  await browser.waitUntil(
    async () =>
      (await browser.$$('[data-testid="git-operation-record"]')).length === 2,
    {
      timeout: 3_000,
      timeoutMsg:
        "Git Operations did not render deterministic reset and rebase history",
    },
  );
  const operationRecords = await browser.$$(
    '[data-testid="git-operation-record"]',
  );
  assert.match(await operationRecords[0].getText(), /reset/);
  assert.match(await operationRecords[0].getText(), /restored/);
  assert.match(
    await operationRecords[0].getText(),
    /refs\/treefold\/recovery\/reset-ui-fixture/,
  );
  const restoredForkNode = await browser.$('[data-testid="sidebar-fork-node"]');
  await restoredForkNode.moveTo();
  await (
    await restoredForkNode.$('[data-testid="sidebar-node-menu-trigger"]')
  ).click();
  const reopenedForkNodeMenu = await browser.$(
    '[data-testid="directory-session-context-menu"]',
  );
  await reopenedForkNodeMenu.waitForDisplayed({ timeout: 3_000 });
  await (
    await reopenedForkNodeMenu.$('[data-testid="finish-workspace-action"]')
  ).click();
  const preflight = await browser.$('[data-testid="delivery-preflight"]');
  await preflight.waitForDisplayed({ timeout: 3_000 });
  assert.match(await preflight.getText(), /2 ahead/);
  assert.match(await preflight.getText(), /2 files/);
  assert.match(await preflight.getText(), /source is 1 commit/);
  const finishButton = await browser.$("button*=Finish fixture-repository");
  assert.equal(
    await finishButton.isEnabled(),
    true,
    "a ready preflight must unlock Finish",
  );
  assert.match(
    await finishButton.getAttribute("class"),
    /text-destructive/,
    "Finish confirmation must retain destructive styling",
  );
  const finishDialog = await browser.$('[role="dialog"]');
  assert.match(
    await finishDialog.getText(),
    /REPOSITORY[\s\S]*fixture-repository/,
    "Finish must select one repository at a time",
  );
  await browser.keys(Key.Escape);

  await browser.url(harness.baseUrl);
  await (await browser.$('button[aria-label="New Project"]')).click();
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
  let orderedOverviewRows = await browser.$$(
    '[data-testid="project-overview-row"]',
  );
  assert.deepEqual(
    await orderedOverviewRows.map((row) => row.getAttribute("data-project-id")),
    ["project-created-primary-requirement", FIXTURE_IDS.project],
    "active Projects must be ordered alphabetically even when the first name has older activity",
  );
  harness.setProjectStatus("project-created-primary-requirement", "archived");
  await browser.refresh();
  await browser.waitUntil(
    async () =>
      (await browser.$$('[data-testid="project-overview-row"]')).length === 2,
    {
      timeout: 3_000,
      timeoutMsg: "Project summaries did not reload after browser refresh",
    },
  );
  orderedOverviewRows = await browser.$$(
    '[data-testid="project-overview-row"]',
  );
  assert.deepEqual(
    await orderedOverviewRows.map((row) => row.getAttribute("data-project-id")),
    [FIXTURE_IDS.project, "project-created-primary-requirement"],
    "archived Projects must be ordered after active Projects",
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
  await browser?.deleteSession();
  await harness.close();
}

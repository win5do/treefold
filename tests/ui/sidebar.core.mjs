import assert from "node:assert/strict";
import { Key, remote } from "webdriverio";
import { FIXTURE_COMMITS, FIXTURE_IDS, FIXTURE_NAMES } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

async function assertOverlayVisibleAndTopmost(browser, selector, label) {
  const result = await browser.execute((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) return { exists: false };
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + 3, rect.top + 3],
      [rect.right - 3, rect.top + 3],
      [rect.left + 3, rect.bottom - 3],
      [rect.right - 3, rect.bottom - 3],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    return {
      exists: true,
      portaled: element.closest('[data-testid="sidebar-session-menu"], [data-testid="directory-session-context-menu"]')?.parentElement === document.body,
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      topmost: points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || (hit instanceof Node && element.contains(hit));
      }),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
  }, selector);
  assert.equal(result.exists, true, `${label} must exist`);
  assert.equal(result.portaled, true, `${label} must be portaled outside clipping ancestors`);
  assert.equal(result.inViewport, true, `${label} must stay within the viewport: ${JSON.stringify(result.rect)}`);
  assert.equal(result.topmost, true, `${label} must be the topmost hit target across its visible area`);
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
  assert.equal(await (await browser.$('button[aria-label="Show right sidebar"]')).isExisting(), false, "right sidebar control must stay hidden outside a Project");

  const initialWidth = await sidebar.getSize("width");
  assert.ok(initialWidth >= 240, `sidebar width ${initialWidth}px is below the 240px minimum`);

  await (await browser.$('[data-testid="open-settings"]')).click();
  const settingsDialog = await browser.$('[role="dialog"]');
  await settingsDialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await settingsDialog.$('[data-testid="settings-language"]')).getValue(), "en-US", "Settings must reflect the persisted language preference");
  assert.equal((await settingsDialog.getText()).includes("Default Codex YOLO"), false, "Settings must not expose the removed YOLO-specific preference");
  let codexArguments = await settingsDialog.$$('input[aria-label^="Codex argument "]');
  assert.deepEqual(
    await codexArguments.map((argument) => argument.getValue()),
    ["--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5.4"],
    "Settings must render each configured argv value as its own row",
  );
  await (await settingsDialog.$("button=Add argument")).click();
  codexArguments = await settingsDialog.$$('input[aria-label^="Codex argument "]');
  await codexArguments[3].setValue("--search");
  await (await settingsDialog.$('button[aria-label="Move Codex argument 4 up"]')).click();
  await (await settingsDialog.$("button=Save")).click();
  await browser.keys(Key.Escape);
  await settingsDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await (await browser.$('[data-testid="open-settings"]')).click();
  const reopenedSettingsDialog = await browser.$('[role="dialog"]');
  await reopenedSettingsDialog.waitForDisplayed({ timeout: 3_000 });
  codexArguments = await reopenedSettingsDialog.$$('input[aria-label^="Codex argument "]');
  assert.deepEqual(
    await codexArguments.map((argument) => argument.getValue()),
    ["--dangerously-bypass-approvals-and-sandbox", "--model", "--search", "gpt-5.4"],
    "argument additions and ordering must survive the atomic settings PATCH",
  );
  const languageSelect = await reopenedSettingsDialog.$('[data-testid="settings-language"]');
  await languageSelect.selectByAttribute("value", "zh-CN");
  await (await reopenedSettingsDialog.$("button=Save")).click();
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.lang)) === "zh-CN", {
    timeout: 3_000,
    timeoutMsg: "Chinese did not apply after saving the language preference",
  });
  assert.match(await reopenedSettingsDialog.getText(), /设置/);
  assert.match(await (await browser.$('[data-testid="page-content"]')).getText(), /概览/);
  assert.match(await (await browser.$('[data-testid="workspace-sidebar"]')).getText(), /设置/);

  await browser.execute(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["en-US"] });
  });
  await languageSelect.selectByAttribute("value", "system");
  await (await reopenedSettingsDialog.$("button=保存")).click();
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.lang)) === "en-US", {
    timeout: 3_000,
    timeoutMsg: "system language preference did not apply the current non-Chinese system locale",
  });
  await browser.execute(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["zh-CN"] });
    window.dispatchEvent(new Event("languagechange"));
  });
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.lang)) === "zh-CN", {
    timeout: 3_000,
    timeoutMsg: "system language preference did not resolve a Chinese system locale",
  });
  await browser.execute(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["en-US"] });
    window.dispatchEvent(new Event("languagechange"));
  });
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.lang)) === "en-US", {
    timeout: 3_000,
    timeoutMsg: "system language preference did not fall back to English for a non-Chinese system locale",
  });
  assert.match(await reopenedSettingsDialog.getText(), /Settings/);
  await languageSelect.selectByAttribute("value", "en-US");
  await (await reopenedSettingsDialog.$("button=Save")).click();
  await browser.keys(Key.Escape);
  await reopenedSettingsDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  const handle = await browser.$('[data-testid="sidebar-resize-handle"]');
  await handle.click();
  await browser.keys(Array(20).fill(Key.ArrowLeft));
  await browser.waitUntil(async () => (await sidebar.getSize("width")) === 240, {
    timeout: 3_000,
    timeoutMsg: "sidebar did not stop at its minimum width",
  });

  await handle.dragAndDrop({ x: 80, y: 0 }, { duration: 250 });
  await browser.waitUntil(async () => (await sidebar.getSize("width")) >= 300, {
    timeout: 3_000,
    timeoutMsg: "sidebar did not respond to pointer resizing",
  });
  const resizedWidth = await sidebar.getSize("width");
  const main = await browser.$('[data-testid="workspace-main"]');
  const mainX = await main.getLocation("x");
  assert.ok(Math.abs(mainX - resizedWidth) <= 2, `main offset ${mainX}px does not match sidebar width ${resizedWidth}px`);
  const toolbarTitle = await browser.$('[data-testid="toolbar-title"]');
  const pageContent = await browser.$('[data-testid="page-content"]');
  const toolbarContentFrame = await browser.$('[data-testid="toolbar-content-frame"]');
  const pageScroll = await browser.$('[data-testid="page-scroll"]');
  assert.equal((await toolbarContentFrame.getCSSProperty("scrollbar-gutter")).value, "stable", "toolbar must reserve the same scrollbar gutter as page content");
  assert.equal((await pageScroll.getCSSProperty("scrollbar-gutter")).value, "stable", "page content must reserve a stable scrollbar gutter");
  assert.ok(Math.abs((await toolbarTitle.getLocation("x")) - (await pageContent.getLocation("x"))) <= 1, "toolbar title must align with the page content while the left sidebar is visible");

  let nodeNames = await browser.$$('[data-testid="sidebar-node-name"]');
  if (nodeNames.length === 0) {
    const projectToggle = await browser.$(`button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`);
    await projectToggle.waitForExist({ timeout: 3_000 });
    await projectToggle.click();
    nodeNames = await browser.$$('[data-testid="sidebar-node-name"]');
  }
  const workstreamToggle = await browser.$(`button[aria-label="Expand Workstream ${FIXTURE_NAMES.workstream}"]`);
  await workstreamToggle.waitForDisplayed({ timeout: 3_000 });
  await workstreamToggle.click();
  const forkToggle = await browser.$(`button[aria-label="Expand Fork ${FIXTURE_NAMES.fork}"]`);
  await forkToggle.waitForDisplayed({ timeout: 3_000 });
  await forkToggle.click();
  await browser.$(`button[title="Fork Shell Session"]`).waitForExist({ timeout: 3_000 });

  const treeRows = [
    await browser.$('[data-testid="sidebar-project-node"]'),
    await browser.$('[data-testid="sidebar-workstream-node"]'),
    await browser.$('[data-testid="sidebar-fork-node"]'),
  ];
  const treeMetrics = [];
  for (const row of treeRows) {
    const chevron = await row.$('[data-testid="sidebar-tree-chevron"]');
    const icon = await row.$('[data-testid="sidebar-tree-icon"]');
    const label = await row.$('[data-sidebar-tree-label="true"]');
    treeMetrics.push({
      rowLeft: await row.getLocation("x"),
      chevronToIcon: (await icon.getLocation("x")) - ((await chevron.getLocation("x")) + (await chevron.getSize("width"))),
      iconToLabel: (await label.getLocation("x")) - ((await icon.getLocation("x")) + (await icon.getSize("width"))),
    });
  }
  assert.ok(Math.max(...treeMetrics.map((item) => item.chevronToIcon)) - Math.min(...treeMetrics.map((item) => item.chevronToIcon)) <= 1, `tree chevron-to-icon gaps differ: ${treeMetrics.map((item) => item.chevronToIcon).join(", ")}`);
  assert.ok(Math.max(...treeMetrics.map((item) => item.iconToLabel)) - Math.min(...treeMetrics.map((item) => item.iconToLabel)) <= 1, `tree icon-to-label gaps differ: ${treeMetrics.map((item) => item.iconToLabel).join(", ")}`);
  const treeIndents = [treeMetrics[1].rowLeft - treeMetrics[0].rowLeft, treeMetrics[2].rowLeft - treeMetrics[1].rowLeft];
  assert.ok(Math.max(...treeIndents) - Math.min(...treeIndents) <= 1, `tree level indents differ: ${treeIndents.join(", ")}`);
  assert.ok(treeIndents.every((indent) => indent >= 18 && indent <= 20), `tree level indents must stay compact: ${treeIndents.join(", ")}`);

  nodeNames = await browser.$$('[data-testid="sidebar-node-name"]');
  assert.equal(nodeNames.length, 2, "expected the fixture Workstream and its active Fork");
  for (const name of nodeNames) {
    const owner = await name.parentElement();
    assert.equal(await owner.getAttribute("title"), await name.getText(), "sidebar node must expose its full name on hover");
  }
  assert.equal((await sidebar.getText()).includes(FIXTURE_NAMES.archivedFork), false, "archived Fork must stay out of the active sidebar tree");

  const actionButtons = await browser.$$('[data-testid="sidebar-node-action"]');
  assert.equal(actionButtons.length, 2, "expected Session actions for the active Workstream and Fork");
  const sidebarX = await sidebar.getLocation("x");
  for (const action of actionButtons) {
    const actionRight = (await action.getLocation("x")) + (await action.getSize("width"));
    assert.ok(actionRight <= sidebarX + resizedWidth + 1, "right-side action escaped the sidebar bounds");
  }
  const forkNodes = await browser.$$('[data-testid="sidebar-fork-node"]');
  assert.equal(forkNodes.length, 1, "expected exactly one active fixture Fork");
  for (const fork of forkNodes) {
    assert.ok(await (await fork.$('[data-testid="sidebar-node-action"]')).isExisting(), "a visible Fork must expose its Session action");
  }
  const alignedActions = await browser.$$('[data-sidebar-row-action="true"]');
  const actionRights = await alignedActions.map(async (action) => (await action.getLocation("x")) + (await action.getSize("width")));
  assert.ok(Math.max(...actionRights) - Math.min(...actionRights) <= 1, `sidebar actions are not right-aligned: ${actionRights.join(", ")}`);

  const plusAnchorLeft = await actionButtons[0].getLocation("x");
  const plusAnchorBottom = (await actionButtons[0].getLocation("y")) + (await actionButtons[0].getSize("height"));
  await actionButtons[0].click();
  let sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  assert.ok(Math.abs((await sessionMenu.getLocation("x")) - plusAnchorLeft) <= 1, "plus menu left edge must align with the plus button left edge");
  assert.ok(Math.abs((await sessionMenu.getLocation("y")) - (plusAnchorBottom + 4)) <= 1, "plus menu must open immediately below its plus button anchor");
  assert.match(await sessionMenu.getText(), /NEW SESSION IN/);
  assert.match(await sessionMenu.getText(), /fixture-repository/);
  await (await sessionMenu.$(`[data-testid="session-directory-${FIXTURE_IDS.primaryDirectory}"]`)).moveTo();
  assert.match(await sessionMenu.getText(), /Shell/);
  assert.match(await sessionMenu.getText(), /Codex/);
  await assertOverlayVisibleAndTopmost(browser, '[data-testid="sidebar-session-menu"]', "plus Session menu");
  await assertOverlayVisibleAndTopmost(browser, '[data-testid="directory-session-submenu"]', "plus Session submenu");
  await main.click();
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });
  await actionButtons[0].click();
  sessionMenu = await browser.$('[data-testid="sidebar-session-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  await browser.keys(Key.Escape);
  await sessionMenu.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await browser.$(`[data-testid="sidebar-workstream-node"] button[title="${FIXTURE_NAMES.workstream}"]`).click();
  await browser.waitUntil(async () => (await browser.getUrl()).includes(`#/workstreams/${FIXTURE_IDS.workstream}`), {
    timeout: 3_000,
    timeoutMsg: "fixture Workstream navigation did not update the route",
  });
  const baseSection = await browser.$('[data-testid="workstream-base-section"]');
  await baseSection.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await baseSection.$("h2")).getText(), "Base", "worktree metadata must be grouped under Base");
  const baseLabels = await baseSection.$$("th");
  assert.deepEqual([await baseLabels[0].getText(), await baseLabels[1].getText()], ["worktree dir", "git branch"], "Base must identify the worktree directory and Git branch");
  const forksSection = await browser.$('[data-testid="workstream-forks-section"]');
  const todosSection = await browser.$('[data-testid="workstream-todos-section"]');
  assert.ok((await baseSection.getLocation("y")) < (await forksSection.getLocation("y")), "Base section must appear above Forks");
  assert.ok((await forksSection.getLocation("y")) < (await todosSection.getLocation("y")), "Forks must remain above Todos");

  await browser.$('button[aria-label="Hide left sidebar"]').click();
  const showSidebar = await browser.$('button[aria-label="Show left sidebar"]');
  await showSidebar.waitForDisplayed({ timeout: 3_000 });
  await browser.waitUntil(async () => (await sidebar.getLocation("x")) + (await sidebar.getSize("width")) <= 1, {
    timeout: 3_000,
    timeoutMsg: "sidebar did not move fully off screen",
  });
  await browser.waitUntil(async () => Math.abs((await main.getLocation("x")) - 48) <= 1, {
    timeout: 3_000,
    timeoutMsg: "main content did not preserve the 48px icon rail",
  });
  assert.equal(await (await browser.$('[data-testid="toolbar-left-rail"]')).getSize("width"), 48, "collapsed toolbar rail must remain 48px wide");
  assert.ok(Math.abs((await toolbarTitle.getLocation("x")) - (await pageContent.getLocation("x"))) <= 1, "toolbar title must align with the page content while the left sidebar is hidden");
  await showSidebar.click();
  await browser.waitUntil(async () => Math.abs(await sidebar.getLocation("x")) <= 1, {
    timeout: 3_000,
    timeoutMsg: "sidebar did not return after using the edge reveal button",
  });
  assert.equal(await toolbar.isDisplayed(), true, "toolbar must remain visible while sidebars toggle");

  const projectLink = await browser.$('[data-testid="sidebar-project-link"]');
  assert.equal(await projectLink.getText(), FIXTURE_NAMES.project, "test must navigate through the deterministic fixture Project");
  await projectLink.click({ button: "right" });
  const directoryMenu = await browser.$('[data-testid="directory-session-context-menu"]');
  await directoryMenu.waitForDisplayed({ timeout: 3_000 });
  assert.match(await directoryMenu.getText(), /NEW SESSION IN/);
  assert.match(await directoryMenu.getText(), /fixture-repository/);
  assert.match(await directoryMenu.getText(), /fixture-documentation/);
  assert.match(await directoryMenu.getText(), /Open in Finder/);
  assert.match(await directoryMenu.getText(), /Archive Project/);
  const primaryDirectoryItem = await directoryMenu.$(`[data-testid="session-directory-${FIXTURE_IDS.primaryDirectory}"]`);
  const attachedDirectoryItem = await directoryMenu.$(`[data-testid="session-directory-${FIXTURE_IDS.attachedDirectory}"]`);
  assert.equal(await (await directoryMenu.$('[data-testid="directory-session-submenu"]')).isExisting(), false, "directory submenu must be hidden before hover");
  await primaryDirectoryItem.moveTo();
  let directorySubmenu = await directoryMenu.$('[data-testid="directory-session-submenu"]');
  assert.match(await directorySubmenu.getText(), /fixture-repository/i);
  assert.ok(Math.abs((await directorySubmenu.getLocation("y")) - (await primaryDirectoryItem.getLocation("y"))) <= 1, "submenu top must align with the hovered primary directory");
  assert.equal(await primaryDirectoryItem.getAttribute("aria-expanded"), "true", "hovered directory must expose active feedback");
  await attachedDirectoryItem.moveTo();
  directorySubmenu = await directoryMenu.$('[data-testid="directory-session-submenu"]');
  assert.match(await directorySubmenu.getText(), /fixture-documentation/i);
  assert.ok(Math.abs((await directorySubmenu.getLocation("y")) - (await attachedDirectoryItem.getLocation("y"))) <= 1, "submenu must move to align with the newly hovered directory");
  assert.match(await directorySubmenu.getText(), /Shell/);
  assert.match(await directorySubmenu.getText(), /Codex/);
  assert.equal(await attachedDirectoryItem.getAttribute("aria-expanded"), "true", "switching directories must update active feedback");
  assert.equal((await directorySubmenu.getCSSProperty("animation-name")).value, "directory-submenu-swap", "switching directories must animate the submenu");
  const finderItem = await directoryMenu.$("button*=Open in Finder");
  await finderItem.moveTo({ xOffset: 12, yOffset: 12 });
  assert.equal(await browser.execute(() => Boolean(document.querySelector('[data-testid="session-menu-footer"]:hover'))), true, "pointer must reach the non-directory context action");
  await browser.waitUntil(async () => await browser.execute(() => !document.querySelector('[data-testid="directory-session-submenu"]')), {
    timeout: 3_000,
    timeoutMsg: "hovering a non-directory context action did not dismiss the directory submenu",
  });
  await assertOverlayVisibleAndTopmost(browser, '[data-testid="directory-session-context-menu"]', "context menu");
  const archiveProject = await directoryMenu.$('[data-testid="archive-project-action"]');
  await archiveProject.moveTo();
  assert.equal(await browser.execute(() => !document.querySelector('[data-testid="directory-session-submenu"]')), true, "Archive Project must remain reachable without an open directory submenu");
  await archiveProject.click();
  await browser.waitUntil(async () => !(await (await browser.$('[data-testid="sidebar-project-link"]')).isExisting()), {
    timeout: 3_000,
    timeoutMsg: "archived Project remained in the sidebar",
  });
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith("/"), {
    timeout: 3_000,
    timeoutMsg: "archiving the selected Project did not return to Overview",
  });
  let overviewRow = await browser.$('[data-testid="project-overview-row"]');
  assert.equal(await overviewRow.getAttribute("data-project-status"), "archived", "archived Project must remain visible on Overview");
  assert.match(await overviewRow.getText(), /Archived/);
  assert.equal(await (await overviewRow.$('[data-testid="restore-project-action"]')).isExisting(), true, "archived Project must expose Restore to sidebar");
  assert.equal(await (await overviewRow.$('[data-testid="delete-project-action"]')).isExisting(), true, "archived Project must expose permanent deletion");
  await (await overviewRow.$('[data-testid="restore-project-action"]')).click();
  const restoredProjectLink = await browser.$('[data-testid="sidebar-project-link"]');
  await restoredProjectLink.waitForDisplayed({ timeout: 3_000 });
  await browser.$(`button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`).click();
  assert.equal((await sidebar.getText()).includes("Parent Shell Session"), false, "archiving must close and hide Shell Sessions");
  assert.equal((await sidebar.getText()).includes("Parent Codex Session"), false, "archiving must close and hide Codex Sessions");
  overviewRow = await browser.$('[data-testid="project-overview-row"]');
  assert.equal(await overviewRow.getAttribute("data-project-status"), "active", "restored Project must become active on Overview");
  assert.equal(await (await overviewRow.$('[data-testid="restore-project-action"]')).isExisting(), false, "active Project must not expose Restore to sidebar");
  await restoredProjectLink.click();
  await browser.waitUntil(async () => (await browser.getUrl()).includes(`#/projects/${FIXTURE_IDS.project}`), {
    timeout: 3_000,
    timeoutMsg: "fixture Project navigation did not update the route",
  });
  await browser.$('button[aria-label="Edit fixture-repository"]').click();
  const setupCommand = await browser.$('textarea[aria-label="Worktree setup command"]');
  await setupCommand.waitForDisplayed({ timeout: 3_000 });
  await setupCommand.setValue("npm install && npm run prepare");
  await browser.$("button*=Save").click();
  await browser.waitUntil(async () => !(await setupCommand.isExisting()), {
    timeout: 3_000,
    timeoutMsg: "Directory details did not close after saving the Worktree setup command",
  });
  assert.match(await (await browser.$('[data-testid="page-content"]')).getText(), /Setup/, "Directory must show when Worktree setup is configured");
  const showRightSidebar = await browser.$('button[aria-label="Show right sidebar"]');
  await showRightSidebar.waitForDisplayed({ timeout: 5_000 });
  assert.ok(Math.abs((await toolbarTitle.getLocation("x")) - (await pageContent.getLocation("x"))) <= 1, "Project title must align with Project content");
  await showRightSidebar.click();
  const rightSidebar = await browser.$('[data-testid="right-sidebar"]');
  await rightSidebar.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await toolbar.isDisplayed(), true, "toolbar must remain visible with the right sidebar open");
  assert.equal(await (await rightSidebar.$('button[aria-label="Close right sidebar"]')).isExisting(), false, "right sidebar must rely on the toolbar collapse control without a duplicate close button");
  const infoTab = await browser.$('button[role="tab"][aria-selected="true"]');
  assert.equal(await infoTab.getText(), "Info", "right sidebar must open on the Info tab");
  await browser.$('button[role="tab"]*=History').click();
  await browser.waitUntil(async () => (await browser.$$('[data-testid="git-history-commit"]')).length === FIXTURE_COMMITS.length, {
    timeout: 3_000,
    timeoutMsg: "Git History tab did not render fixture commits",
  });
  const commits = await browser.$$('[data-testid="git-history-commit"]');
  assert.equal(commits.length, FIXTURE_COMMITS.length, "Git History must list current-branch commits");
  assert.match(await commits[0].getText(), /Replace Makefile with Justfile/);
  assert.match(await commits[0].getText(), /2026\/8\/7 11:17/);
  const openX = await rightSidebar.getLocation("x");
  await browser.$('button[aria-label="Hide right sidebar"]').click();
  await browser.waitUntil(async () => (await rightSidebar.getLocation("x")) >= (await browser.getWindowSize()).width - 1, {
    timeout: 3_000,
    timeoutMsg: "right sidebar did not slide fully off screen",
  });
  assert.ok((await rightSidebar.getLocation("x")) > openX, "right sidebar must exit toward the right");
  assert.equal(await rightSidebar.isExisting(), true, "right sidebar must stay mounted for its exit transition");

  await browser.url(`${harness.baseUrl}/#/workstreams/${FIXTURE_IDS.fork}`);
  const showForkInspector = await browser.$('button[aria-label="Show right sidebar"]');
  await showForkInspector.waitForDisplayed({ timeout: 3_000 });
  await showForkInspector.click();
  const forkInspector = await browser.$('[data-testid="right-sidebar"]');
  const historyTab = await forkInspector.$('button[role="tab"]:nth-child(2)');
  await historyTab.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await historyTab.getText(), "History", "three-tab inspector labels must remain concise");
  await browser.$('button[role="tab"]*=Operations').click();
  await browser.waitUntil(async () => (await browser.$$('[data-testid="git-operation-record"]')).length === 2, {
    timeout: 3_000,
    timeoutMsg: "Git Operations did not render deterministic reset and rebase history",
  });
  const operationRecords = await browser.$$('[data-testid="git-operation-record"]');
  assert.match(await operationRecords[0].getText(), /reset/);
  assert.match(await operationRecords[0].getText(), /restored/);
  assert.match(await operationRecords[0].getText(), /refs\/treefold\/recovery\/reset-ui-fixture/);
  const closeWorkstream = await browser.$("button*=Close…");
  await closeWorkstream.waitForDisplayed({ timeout: 3_000 });
  await closeWorkstream.click();
  const preflight = await browser.$('[data-testid="settlement-preflight"]');
  await preflight.waitForDisplayed({ timeout: 3_000 });
  assert.match(await preflight.getText(), /2 ahead/);
  assert.match(await preflight.getText(), /Files\s+2/);
  assert.match(await preflight.getText(), /source is 1 commit/);
  const settleButton = await browser.$("button*=Close and settle");
  assert.equal(await settleButton.isEnabled(), true, "a ready preflight must unlock settlement");
  const settleDialog = await browser.$('[role="dialog"]');
  assert.equal((await settleDialog.getText()).includes("Context"), false, "settlement must not expose the removed Context feature");
  assert.match(await settleDialog.getText(), /Records[\s\S]*Todos/, "settlement must retain Todo and Session record controls");
  const settleBottom = (await settleButton.getLocation("y")) + (await settleButton.getSize("height"));
  const dialogBottom = (await settleDialog.getLocation("y")) + (await settleDialog.getSize("height"));
  assert.ok(settleBottom <= dialogBottom, "settlement footer must remain visible inside the dialog");
  assert.equal((await settleDialog.getCSSProperty("overflow-y")).value, "hidden", "only the settlement body may scroll");
  const settlementScroll = await browser.$('[data-testid="settlement-scroll-region"]');
  assert.equal((await settlementScroll.getCSSProperty("overflow-y")).value, "auto", "settlement body must own overflow scrolling");
  assert.equal(await (await browser.$('input[aria-label="Verification command"]')).isExisting(), false, "settlement must not expose an arbitrary verification command");
  await browser.keys(Key.Escape);
  const finalProjectLink = await browser.$('[data-testid="sidebar-project-link"]');
  await finalProjectLink.click({ button: "right" });
  const finalProjectMenu = await browser.$('[data-testid="directory-session-context-menu"]');
  await finalProjectMenu.waitForDisplayed({ timeout: 3_000 });
  await (await finalProjectMenu.$('[data-testid="archive-project-action"]')).click();
  overviewRow = await browser.$('[data-testid="project-overview-row"]');
  await browser.waitUntil(async () => (await overviewRow.getAttribute("data-project-status")) === "archived", {
    timeout: 3_000,
    timeoutMsg: "Project did not return to archived state before permanent deletion",
  });
  await browser.execute(() => { window.confirm = () => true; });
  await (await overviewRow.$('[data-testid="delete-project-action"]')).click();
  await browser.waitUntil(async () => (await browser.$$('[data-testid="project-overview-row"]')).length === 0, {
    timeout: 3_000,
    timeoutMsg: "permanently deleted Project remained on Overview",
  });
  assert.match(await (await browser.$('[data-testid="page-content"]')).getText(), /No Projects yet/);
  harness.assertNoUnexpectedRequests();

  console.log("✓ deterministic fixture, Directory setup, sidebar flows, Project lifecycle, inspector, and settlement preflight passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-sidebar-core-failure.png").catch(() => {});
  throw error;
} finally {
  await browser?.deleteSession();
  await harness.close();
}

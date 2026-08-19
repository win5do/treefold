import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";
import {
  closeUiSession,
  createUiSession,
  openUiContextMenu,
  pressUiEscape,
} from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;

async function ownerMenu(selector) {
  await openUiContextMenu(browser, selector);
  const menu = await browser.$('[data-testid="directory-session-context-menu"]');
  await menu.waitForDisplayed({ timeout: 3_000 });
  return menu;
}

try {
  browser = await createUiSession({ sessionName: "parent-operations" });
  await browser.url(`${harness.baseUrl}/workspaces/${FIXTURE_IDS.workspace}`);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });

  let menu = await ownerMenu('[data-testid="sidebar-project-node"]');
  assert.equal(await (await menu.$('[data-testid="update-from-parent-action"]')).isExisting(), false);
  assert.equal(await (await menu.$('[data-testid="integrate-into-parent-action"]')).isExisting(), false);
  await pressUiEscape(browser);

  const projectNode = await browser.$('[data-testid="sidebar-project-node"]');
  const projectToggle = await projectNode.$('[data-testid="sidebar-tree-toggle"]');
  if ((await projectToggle.getAttribute("aria-expanded")) !== "true") await projectToggle.click();
  const workspaceNode = await browser.$('[data-testid="sidebar-workspace-node"]');
  const workspaceToggle = await workspaceNode.$('[data-testid="sidebar-tree-toggle"]');
  if ((await workspaceToggle.getAttribute("aria-expanded")) !== "true") await workspaceToggle.click();
  const session = await browser.$(`[data-testid="sidebar-session-${FIXTURE_IDS.workspaceShell}"]`);
  await openUiContextMenu(browser, session);
  const sessionMenu = await browser.$('[data-testid="session-context-menu"]');
  await sessionMenu.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await sessionMenu.$('[data-testid="update-from-parent-action"]')).isExisting(), false);
  await pressUiEscape(browser);

  menu = await ownerMenu('[data-testid="sidebar-workspace-node"]');
  assert.equal(await (await menu.$('[data-testid="update-from-parent-action"]')).isDisplayed(), true);
  assert.equal(await (await menu.$('[data-testid="integrate-into-parent-action"]')).isDisplayed(), true);
  await (await menu.$('[data-testid="update-from-parent-action"]')).click();

  let dialog = await browser.$('[data-testid="parent-operation-dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  const repository = await dialog.$('#parent-operation-repository');
  assert.equal((await repository.$$('option')).length, 1, "Repository selector must exclude unavailable and read-only locations");
  assert.match(await repository.getText(), /fixture-repository/);
  const rebase = await dialog.$('button=Rebase (Recommended)');
  const merge = await dialog.$('button=Merge');
  assert.equal(await rebase.getAttribute("aria-pressed"), "true", "Update must default to Rebase");
  await merge.click();
  await (await dialog.$('[data-testid="start-parent-operation"]')).click();
  await browser.waitUntil(async () => (await dialog.getText()).includes("Resolve with AI"), { timeout: 3_000 });
  await (await dialog.$('button=Resolve with AI')).click();
  await browser.waitUntil(async () => (await dialog.getText()).includes("Open Session"), { timeout: 3_000 });
  await (await dialog.$('button=Close')).click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  menu = await ownerMenu('[data-testid="sidebar-workspace-node"]');
  await (await menu.$('[data-testid="update-from-parent-action"]')).click();
  dialog = await browser.$('[data-testid="parent-operation-dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(await dialog.getText(), /Resolving/);
  await (await dialog.$('button=Stop AI & Abort')).click();
  await browser.waitUntil(async () => (await dialog.getText()).includes("Aborted"), { timeout: 3_000 });
  await (await dialog.$('button=Close')).click();

  menu = await ownerMenu('[data-testid="sidebar-workspace-node"]');
  await (await menu.$('[data-testid="integrate-into-parent-action"]')).click();
  dialog = await browser.$('[data-testid="parent-operation-dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(await dialog.getText(), /merge commit/i);
  assert.equal(await (await dialog.$('button=Rebase (Recommended)')).isExisting(), false, "Integrate must use fixed Merge strategy");
  await (await dialog.$('[data-testid="start-parent-operation"]')).click();
  await browser.waitUntil(async () => (await dialog.getText()).includes("Undo Integration"), { timeout: 3_000 });
  await (await dialog.$('button=Undo Integration')).click();
  await browser.waitUntil(async () => (await dialog.getText()).includes("Undone"), { timeout: 3_000 });

  assert.ok(harness.parentOperationRequests.includes(`POST ${FIXTURE_IDS.workspacePrimaryLocation}:update:merge`));
  assert.ok(harness.parentOperationRequests.some((item) => item.endsWith(":resolve-with-codex")));
  assert.ok(harness.parentOperationRequests.some((item) => item.endsWith(":abort")));
  assert.ok(harness.parentOperationRequests.includes(`POST ${FIXTURE_IDS.workspacePrimaryLocation}:integrate:merge`));
  assert.ok(harness.parentOperationRequests.some((item) => item.endsWith(":undo")));
  harness.assertNoUnexpectedRequests();
} finally {
  await closeUiSession(browser);
  await harness.close();
}

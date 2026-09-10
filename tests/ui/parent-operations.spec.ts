import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import {
  closeUiSession,
  createUiSession,
  openUiContextMenu,
  pressUiEscape,
} from "./harness/session.ts";

test("parent-operations", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  async function ownerMenu(selector: string) {
    await openUiContextMenu(page, selector);
    const menu = page.locator('[data-testid="directory-session-context-menu"]');
    await menu.waitFor({ timeout: 3_000, state: 'visible' });
    return menu;
  }

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "parent-operations" });
    await page.goto(`${harness.baseUrl}/workspaces/${FIXTURE_IDS.workspace}`);
    await (page.locator('[data-testid="workspace-sidebar"]')).waitFor({ timeout: 10_000, state: 'visible' });

    let menu = await ownerMenu('[data-testid="sidebar-project-node"]');
    assert.equal(await (menu.locator('[data-testid="update-from-parent-action"]')).count().then(count => count > 0), false);
    assert.equal(await (menu.locator('[data-testid="integrate-into-parent-action"]')).count().then(count => count > 0), false);
    await pressUiEscape(page);

    const projectNode = page.locator('[data-testid="sidebar-project-node"]');
    const projectToggle = projectNode.locator('[data-testid="sidebar-tree-toggle"]');
    if ((await projectToggle.getAttribute("aria-expanded")) !== "true") await projectToggle.click();
    const workspaceNode = page.locator('[data-testid="sidebar-workspace-node"]');
    const workspaceToggle = workspaceNode.locator('[data-testid="sidebar-tree-toggle"]');
    if ((await workspaceToggle.getAttribute("aria-expanded")) !== "true") await workspaceToggle.click();
    const session = page.locator(`[data-testid="sidebar-session-${FIXTURE_IDS.workspaceShell}"]`);
    await openUiContextMenu(page, session);
    const sessionMenu = page.locator('[data-testid="session-context-menu"]');
    await sessionMenu.waitFor({ timeout: 3_000, state: 'visible' });
    assert.equal(await (sessionMenu.locator('[data-testid="update-from-parent-action"]')).count().then(count => count > 0), false);
    await pressUiEscape(page);

    menu = await ownerMenu('[data-testid="sidebar-workspace-node"]');
    assert.equal(await (menu.locator('[data-testid="update-from-parent-action"]')).isVisible(), true);
    assert.equal(await (menu.locator('[data-testid="integrate-into-parent-action"]')).isVisible(), true);
    await (menu.locator('[data-testid="update-from-parent-action"]')).click();

    let dialog = page.locator('[data-testid="parent-operation-dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    const repository = dialog.locator('#parent-operation-repository');
    assert.equal((await repository.locator('option').all()).length, 1, "Repository selector must exclude unavailable and read-only locations");
    assert.match(await repository.innerText(), /fixture-repository/);
    const rebase = dialog.locator("button:text-is(\"Rebase (Recommended)\")");
    const merge = dialog.locator("button:text-is(\"Merge\")");
    assert.equal(await rebase.getAttribute("aria-pressed"), "true", "Update must default to Rebase");
    await merge.click();
    await (dialog.locator('[data-testid="start-parent-operation"]')).click();
    await expect.poll(async () => (await dialog.innerText()).includes("Resolve with AI"), { timeout: 3_000 }).toBeTruthy();
    await (dialog.locator("button:text-is(\"Resolve with AI\")")).click();
    await expect.poll(async () => (await dialog.innerText()).includes("Open Session"), { timeout: 3_000 }).toBeTruthy();
    await (dialog.locator("button:text-is(\"Close\")")).click();
    await dialog.waitFor({ timeout: 3_000, state: 'hidden' });

    menu = await ownerMenu('[data-testid="sidebar-workspace-node"]');
    await (menu.locator('[data-testid="update-from-parent-action"]')).click();
    dialog = page.locator('[data-testid="parent-operation-dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await dialog.innerText(), /Resolving/);
    await (dialog.locator("button:text-is(\"Stop AI & Abort\")")).click();
    await expect.poll(async () => (await dialog.innerText()).includes("Aborted"), { timeout: 3_000 }).toBeTruthy();
    await (dialog.locator("button:text-is(\"Close\")")).click();

    menu = await ownerMenu('[data-testid="sidebar-workspace-node"]');
    await (menu.locator('[data-testid="integrate-into-parent-action"]')).click();
    dialog = page.locator('[data-testid="parent-operation-dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await dialog.innerText(), /merge commit/i);
    assert.equal(await (dialog.locator("button:text-is(\"Rebase (Recommended)\")")).count().then(count => count > 0), false, "Integrate must use fixed Merge strategy");
    await (dialog.locator('[data-testid="start-parent-operation"]')).click();
    await expect.poll(async () => (await dialog.innerText()).includes("Undo Integration"), { timeout: 3_000 }).toBeTruthy();
    await (dialog.locator("button:text-is(\"Undo Integration\")")).click();
    await expect.poll(async () => (await dialog.innerText()).includes("Undone"), { timeout: 3_000 }).toBeTruthy();

    assert.ok(harness.parentOperationRequests.includes(`POST ${FIXTURE_IDS.workspacePrimaryLocation}:update:merge`));
    assert.ok(harness.parentOperationRequests.some((item) => item.endsWith(":resolve-with-codex")));
    assert.ok(harness.parentOperationRequests.some((item) => item.endsWith(":abort")));
    assert.ok(harness.parentOperationRequests.includes(`POST ${FIXTURE_IDS.workspacePrimaryLocation}:integrate:merge`));
    assert.ok(harness.parentOperationRequests.some((item) => item.endsWith(":undo")));
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_IDS, FIXTURE_NAMES } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("todos", async () => {
  const harness = await startUiHarness(fixture => {
    fixture.system.agents.find(agent => agent.kind === "pi")!.available = true;
  });
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, windowSize: "900,760", sessionName: "todos" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.locator('[data-testid="workspace-todos-section"]').waitFor({ timeout: 10_000, state: 'visible' });
    const section = page.locator('[data-testid="workspace-todos-section"]');
    assert.match(await section.innerText(), /Pending deterministic Todo/);

    const activeTodo = section.locator('[data-todo-id="todo-active-ui-fixture"]');
    assert.equal(
      await activeTodo.locator('[role="checkbox"]').getAttribute("aria-disabled"),
      "true",
      "an active execution Fork must lock manual status changes",
    );
    assert.equal(
      await activeTodo.locator('button[aria-label="Permanently delete Todo"]')
        .isEnabled(),
      false,
      "an active execution Fork must lock deletion",
    );
    assert.equal(
      await activeTodo.locator('button[aria-label="Open execution Fork"]').isVisible(),
      true,
    );

    await section.locator('[data-todo-id="todo-pending-ui-fixture"]').locator("button:text-is(\"Pending deterministic Todo\")")
      .click();
    const editDialog = page.locator('[role="dialog"]');
    assert.match(await editDialog.locator("textarea").inputValue(), /Remains pending/);
    await editDialog.locator("button:text-is(\"Cancel\")").click();
    await editDialog.waitFor({ timeout: 3_000, state: 'hidden' });

    await page.locator("button:text-is(\"Add Todo\")").click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("textarea").fill("Created through the Todo dialog");
    await dialog.locator("button:text-is(\"Save\")").click();
    await dialog.waitFor({ timeout: 3_000, state: 'hidden' });
    assert.deepEqual(harness.todoRequests.at(-1), {
      action: "create",
      id: "todo-created-3",
      content: "Created through the Todo dialog",
    });

    const createdTodo = section.locator('[data-todo-id="todo-created-3"]');
    await createdTodo.locator('[role="checkbox"]').click();
    await expect.poll(() => harness.todoRequests.some((request) => request.action === "update"), { timeout: 3_000 }).toBeTruthy();

    const pendingTodo = section.locator('[data-todo-id="todo-pending-ui-fixture"]');
    const delegate = pendingTodo.getByRole("button", { name: "Delegate Todo to Fork", exact: true });
    const forkRequests = () => harness.todoRequests.filter(request => request.action === "fork");
    await delegate.click();
    const delegation = page.getByRole("dialog", { name: "Delegate Todo to Fork", exact: true });
    await expect(delegation).toContainText("Pending deterministic Todo");
    await expect(delegation.getByRole("radio", { name: "Codex", exact: true })).toBeFocused();
    await delegation.getByRole("radio", { name: "Pi", exact: true }).check();
    assert.equal(forkRequests().length, 0, "choosing an Agent must not create a Fork");
    await delegation.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(delegation).toBeHidden();
    await expect(delegate).toBeFocused();
    assert.equal(forkRequests().length, 0, "cancel must not create a Fork");

    await delegate.click();
    await expect(delegation.getByRole("radio", { name: "Codex", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(delegation).toBeHidden();
    await expect(delegate).toBeFocused();
    assert.equal(forkRequests().length, 0, "Escape must not create a Fork");

    await delegate.click();
    await expect(delegation.getByRole("radio", { name: "Codex", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(delegation.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    await expect(delegation.getByRole("radio", { name: "Pi", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(async () =>
        (page.url()).includes(`/workspaces/${FIXTURE_IDS.fork}`), { timeout: 3_000 }).toBeTruthy();
    assert.equal(harness.todoRequests.at(-1)!.action, "fork");
    assert.equal(harness.todoRequests.at(-1)!.agentKind, "pi");
    assert.equal(forkRequests().length, 1);
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await expect(page.getByRole("heading", { name: FIXTURE_NAMES.fork, exact: true })).toBeVisible();
    await expect(page.getByTestId("workspace-todos-section")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add Todo", exact: true })).toHaveCount(0);
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await expect(page.getByTestId("workspace-todos-section")).toBeVisible();
    harness.assertNoUnexpectedRequests();
    console.log("✓ Todo CRUD and Todo Fork launch passed");
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});

test("Todo delegation keeps errors in the dialog and allows retry", async () => {
  const harness = await startUiHarness(fixture => {
    fixture.system.agents.find(agent => agent.kind === "pi")!.available = true;
  });
  let page!: Page;
  let releaseRequest!: () => void;
  const heldRequest = new Promise<void>(resolve => { releaseRequest = resolve; });
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "todo-delegation-retry" });
    let attempts = 0;
    await page.route("**/api/todos/todo-pending-ui-fixture/fork?*", async route => {
      attempts++;
      if (attempts === 1) {
        await heldRequest;
        await route.fulfill({ status: 409, json: { error: { code: "FORK_FAILED", message: "Could not create the execution Fork" } } });
      } else {
        await route.continue();
      }
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.locator('[data-todo-id="todo-pending-ui-fixture"]').getByRole("button", { name: "Delegate Todo to Fork" }).click();
    const dialog = page.getByRole("dialog", { name: "Delegate Todo to Fork", exact: true });
    await dialog.getByRole("radio", { name: "Pi", exact: true }).check();
    await dialog.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect.poll(() => attempts).toBe(1);
    await expect(dialog.getByRole("button", { name: "Delegating…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await dialog.press("Enter");
    await dialog.press("Escape");
    await expect(dialog).toBeVisible();
    releaseRequest();
    await expect(dialog.getByRole("alert")).toContainText("Could not create the execution Fork");
    await expect(dialog.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    await dialog.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.fork}`));
    assert.equal(attempts, 2);
    assert.equal(harness.todoRequests.at(-1)!.agentKind, "pi");
    harness.assertNoUnexpectedRequests();
  } finally {
    releaseRequest();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Todo delegation explains unavailable Agents and prevents submission", async () => {
  const harness = await startUiHarness(fixture => {
    fixture.system.agents.forEach(agent => { agent.available = false; });
  });
  let page!: Page;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "todo-delegation-unavailable" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.locator('[data-todo-id="todo-pending-ui-fixture"]').getByRole("button", { name: "Delegate Todo to Fork" }).click();
    const dialog = page.getByRole("dialog", { name: "Delegate Todo to Fork", exact: true });
    await expect(dialog.getByRole("status")).toContainText("No Agents are installed");
    await expect(dialog.getByRole("button", { name: "Delegate", exact: true })).toBeDisabled();
    for (const radio of await dialog.getByRole("radio").all()) await expect(radio).toBeDisabled();
    await dialog.press("Enter");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    assert.equal(harness.todoRequests.length, 0);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

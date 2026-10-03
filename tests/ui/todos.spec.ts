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
    await section.getByRole("combobox", { name: "Agent", exact: true }).selectOption("pi");
    await pendingTodo.locator('button[aria-label="Delegate Todo to Fork"]').click();
    await expect.poll(async () =>
        (page.url()).includes(`/workspaces/${FIXTURE_IDS.fork}`), { timeout: 3_000 }).toBeTruthy();
    assert.equal(harness.todoRequests.at(-1)!.action, "fork");
    assert.equal(harness.todoRequests.at(-1)!.agentKind, "pi");
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


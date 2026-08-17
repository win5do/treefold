import assert from "node:assert/strict";
import { remote } from "webdriverio";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--window-size=900,760", "--disable-gpu"],
      },
    },
  });
  await browser.url(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
  await browser
    .$('[data-testid="workspace-todos-section"]')
    .waitForDisplayed({ timeout: 10_000 });
  const section = await browser.$('[data-testid="workspace-todos-section"]');
  assert.match(await section.getText(), /Pending deterministic Todo/);

  const activeTodo = await section.$('[data-todo-id="todo-active-ui-fixture"]');
  assert.equal(
    await activeTodo.$('[role="checkbox"]').getAttribute("aria-disabled"),
    "true",
    "an active execution Fork must lock manual status changes",
  );
  assert.equal(
    await activeTodo
      .$('button[aria-label="Permanently delete Todo"]')
      .isEnabled(),
    false,
    "an active execution Fork must lock deletion",
  );
  assert.equal(
    await activeTodo
      .$('button[aria-label="Open execution Fork"]')
      .isDisplayed(),
    true,
  );

  await section
    .$('[data-todo-id="todo-pending-ui-fixture"]')
    .$("button=Pending deterministic Todo")
    .click();
  const editDialog = await browser.$('[role="dialog"]');
  assert.match(await editDialog.$("textarea").getValue(), /Remains pending/);
  await editDialog.$("button=Cancel").click();
  await editDialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await browser.$("button=Add Todo").click();
  const dialog = await browser.$('[role="dialog"]');
  await dialog.$("textarea").setValue("Created through the Todo dialog");
  await dialog.$("button=Save").click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  assert.deepEqual(harness.todoRequests.at(-1), {
    action: "create",
    id: "todo-created-3",
    content: "Created through the Todo dialog",
  });

  const createdTodo = await section.$('[data-todo-id="todo-created-3"]');
  await createdTodo.$('[role="checkbox"]').click();
  await browser.waitUntil(
    () => harness.todoRequests.some((request) => request.action === "update"),
    { timeout: 3_000 },
  );

  const pendingTodo = await section.$(
    '[data-todo-id="todo-pending-ui-fixture"]',
  );
  await pendingTodo.$('button[aria-label="Delegate Todo to Fork"]').click();
  await browser.waitUntil(
    async () =>
      (await browser.getUrl()).includes(`/workspaces/${FIXTURE_IDS.fork}`),
    { timeout: 3_000 },
  );
  assert.equal(harness.todoRequests.at(-1).action, "fork");
  harness.assertNoUnexpectedRequests();
  console.log("✓ Todo CRUD and Todo Fork launch passed");
} finally {
  if (browser) await browser.deleteSession();
  await harness.close();
}

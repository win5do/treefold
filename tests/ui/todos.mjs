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
  assert.match(await browser.$('[data-testid="workspace-todos-section"]').getText(), /Pending deterministic Todo/);

  await browser.$("button=Add Todo").click();
  const dialog = await browser.$('[role="dialog"]');
  await dialog.$("textarea").setValue("Created through the Todo dialog");
  await dialog.$("button=Save").click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  assert.deepEqual(harness.todoRequests.at(-1), {
    action: "create",
    id: "todo-created-2",
    content: "Created through the Todo dialog",
  });

  const section = await browser.$('[data-testid="workspace-todos-section"]');
  await section.$('button[aria-label="Complete Todo"]').click();
  await browser.waitUntil(
    () => harness.todoRequests.some((request) => request.action === "update"),
    { timeout: 3_000 },
  );

  await section.$("button=Create Fork").click();
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes(`/workspaces/${FIXTURE_IDS.fork}`),
    { timeout: 3_000 },
  );
  assert.equal(harness.todoRequests.at(-1).action, "fork");
  harness.assertNoUnexpectedRequests();
  console.log("✓ Todo CRUD and Todo Fork launch passed");
} finally {
  if (browser) await browser.deleteSession();
  await harness.close();
}

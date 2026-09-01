import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await createUiSession({ sessionName: "error-feedback" });
  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  await (await browser.$('[data-testid="project-add-location"]')).waitForDisplayed({
    timeout: 10_000,
  });

  await (await browser.$('[data-testid="project-add-location"]')).click();
  const dialog = await browser.$('[role="dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  const row = await dialog.$('[data-testid="location-draft-row"]');
  await (await row.$('input[aria-label="Location 1 path"]')).setValue(
    "/tmp/treefold-ui-fixture/internal-error-repository",
  );
  await (await row.$("button=Check")).click();
  harness.setNextLocationError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "database schema does not accept deferred delivery settings",
  });
  await (await dialog.$("button=Add 1 location")).click();

  const toast = await browser.$('[data-slot="toast"][role="alert"]');
  await toast.waitForDisplayed({ timeout: 3_000 });
  assert.match(await toast.getText(), /database schema does not accept/);
  const openLogs = await toast.$("button=Open logs");
  assert.equal(await openLogs.isExisting(), true);
  await openLogs.click();
  await browser.waitUntil(() => harness.logsRevealRequests.length === 1, {
    timeout: 3_000,
    timeoutMsg: "internal error action did not request the runtime log directory",
  });

  await (await toast.$('button[aria-label="Close toast"]')).click();
  harness.setNextLocationError({
    status: 400,
    code: "BAD_REQUEST",
    message: "directory is already part of this Project",
  });
  await (await dialog.$("button=Add 1 location")).click();
  const businessToast = await browser.$('[data-slot="toast"][role="alert"]');
  await businessToast.waitForDisplayed({ timeout: 3_000 });
  assert.match(await businessToast.getText(), /already part of this Project/);
  assert.equal(
    await (await businessToast.$("button=Open logs")).isExisting(),
    false,
    "expected business rejection must not offer runtime logs",
  );

  harness.assertNoUnexpectedRequests();
  console.log("✓ internal errors expose logs while business rejections stay direct");
} catch (error) {
  await browser
    ?.saveScreenshot("/tmp/treefold-error-feedback-failure.png")
    .catch(() => {});
  throw error;
} finally {
  await closeUiSession(browser);
  await harness.close();
}

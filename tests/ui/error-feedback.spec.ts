import { test, expect, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("error-feedback", async () => {
  const harness = await startUiHarness();
  let page!: Page;

  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "error-feedback" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await (page.locator('[data-testid="project-add-location"]')).waitFor({ timeout: 10_000, state: 'visible' });

    await (page.locator('[data-testid="project-add-location"]')).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 3_000, state: 'visible' });
    const row = dialog.locator('[data-testid="location-draft-row"]');
    await (row.locator('input[aria-label="Location 1 path"]')).fill("/tmp/treefold-ui-fixture/internal-error-repository");
    await (row.locator("button:text-is(\"Check\")")).click();
    harness.setNextLocationError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "database schema does not accept deferred delivery settings",
    });
    await (dialog.locator("button:text-is(\"Add 1 location\")")).click();

    const toast = page.locator('[data-slot="toast"][role="alert"]');
    await toast.waitFor({ timeout: 3_000, state: 'visible' });
    assert.match(await toast.innerText(), /database schema does not accept/);
    const openLogs = toast.locator("button:text-is(\"Open logs\")");
    assert.equal(await openLogs.count().then(count => count > 0), true);
    await openLogs.click();
    await expect.poll(() => harness.logsRevealRequests.length === 1, {
      timeout: 3_000,
      message: "internal error action did not request the runtime log directory",
    }).toBeTruthy();

    await (toast.locator('button[aria-label="Close toast"]')).click();
    harness.setNextLocationError({
      status: 400,
      code: "BAD_REQUEST",
      message: "directory is already part of this Project",
    });
    await (dialog.locator("button:text-is(\"Add 1 location\")")).click();
    const businessToast = page.getByRole("alert").filter({ hasText: "already part of this Project" });
    // The previous toast can remain mounted during its exit animation.
    await expect.poll(async () => /already part of this Project/.test(await businessToast.innerText()), {
      timeout: 3_000,
      message: "business rejection toast did not show the API error",
    }).toBeTruthy();
    assert.equal(
      await (businessToast.locator("button:text-is(\"Open logs\")")).count().then(count => count > 0),
      false,
      "expected business rejection must not offer runtime logs",
    );

    harness.assertNoUnexpectedRequests();
    console.log("✓ internal errors expose logs while business rejections stay direct");
  } catch (error) {
    await page.screenshot({ path: "/tmp/treefold-error-feedback-failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }

});


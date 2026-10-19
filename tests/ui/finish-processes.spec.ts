import { test, expect, type Page } from "@playwright/test";
import type { FinishBatch, FinishPlanItem } from "../../src/renderer/src/domain/types.ts";
import { enUS } from "../../src/renderer/src/i18n/locales/en-US.ts";
import { zhCN } from "../../src/renderer/src/i18n/locales/zh-CN.ts";
import { expectReachableOverlay } from "./overlay-assertions.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";

async function openDelivery(page: Page) {
  await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
  await page.getByTestId("finish-workspace-action").click();
}

for (const language of ["en-US", "zh-CN"] as const) {
  test(`Final delivery defaults to waiting and requires explicit force for live processes (${language})`, async () => {
    const messages = language === "en-US" ? enUS : zhCN;
    const resume = language === "zh-CN";
    const harness = await startUiHarness(fixture => { fixture.settings.language = language; });
    let page: Page | undefined;
    let batch: FinishBatch | null = resume ? {
      workspace_id: FIXTURE_IDS.workspace, status: "paused", continue_work: false, items: [],
    } : null;
    let processChecks = 0;
    const writes: string[] = [];
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `delivery-processes-${language}` });
      await page.setViewportSize({ width: 1000, height: 740 });
      await page.route("**/api/workspace-repositories/*/delivery-preflight", async route => {
        await route.fulfill({ json: { id: "preflight", code_action: route.request().postDataJSON().code_action,
          target_branch: "main", ahead: 0, behind: 0, blockers: [], warnings: [], changed_files: [], source_dirty: false } });
      });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-processes`, async route => {
        processChecks++;
        await route.fulfill({ json: [{ session_id: FIXTURE_IDS.workspaceCodex,
          name: "AI Review — checking API compatibility before delivery", kind: "codex", state: "running", pid: 42001 }] });
      });
      await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch{,/resume}`, async route => {
        if (route.request().method() === "POST") {
          writes.push(route.request().url());
          const plans: FinishPlanItem[] = resume ? [] : route.request().postDataJSON().repositories;
          batch = { workspace_id: FIXTURE_IDS.workspace, status: "completed", continue_work: false,
            items: plans.map(plan => ({ ...plan, repository_name: plan.repository_id, status: "completed", delivered: true, cleaned: true })) };
        }
        await route.fulfill({ json: batch, contentType: "application/json" });
      });
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      const dialog = page.getByRole("dialog", { name: messages.deliveryUi.forkDelivery.title.replace("{{type}}", "Workspace"), exact: true });
      const warning = page.getByRole("alertdialog", { name: messages.deliveryUi.processes.title, exact: true });
      await openDelivery(page);
      await dialog.getByTestId("finish-confirm-action").click();
      await expect(warning).toContainText("AI Review — checking API compatibility before delivery");
      await expect(warning).toContainText("PID 42001");
      await expect(warning.getByRole("button", { name: messages.deliveryUi.processes.wait, exact: true })).toBeFocused();
      expect(writes).toEqual([]);
      if (language === "en-US") await expectReachableOverlay(warning);
      await page.screenshot({ path: `/tmp/treefold-delivery-processes-${language}.png`, animations: "disabled" });
      await page.keyboard.press("Enter");
      await expect(warning).toBeHidden();
      await expect(dialog).toBeHidden();
      expect(writes).toEqual([]);
      await openDelivery(page);
      await dialog.getByTestId("finish-confirm-action").click();
      await expect(warning).toBeVisible();
      expect(processChecks).toBe(2);
      await warning.getByRole("button", { name: messages.deliveryUi.processes.force, exact: true }).click();
      await expect(dialog.getByRole("button", { name: messages.deliveryUi.batchDone, exact: true })).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatch(new RegExp(resume ? "/finish-batch/resume$" : "/finish-batch$"));
      harness.assertNoUnexpectedRequests();
    } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
  });
}

test("A failed process check leaves delivery untouched and retries with a fresh snapshot", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let checks = 0;
  let submitted = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "delivery-process-check-failure" });
    // Already-delivered repositories still need a process check before archival.
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, async route => {
      const response = await route.fetch(); const data = await response.json();
      data.repositories.forEach((item: { delivery_status: string }) => { item.delivery_status = "delivered"; });
      await route.fulfill({ response, json: data });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-processes`, async route => {
      checks++;
      await route.fulfill(checks === 1 ? { status: 503, json: { error: "amux snapshot unavailable" } } : { json: [] });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`, async route => {
      if (route.request().method() === "POST") submitted = true;
      await route.fulfill({ contentType: "application/json", json: submitted ? { workspace_id: FIXTURE_IDS.workspace, status: "completed", items: [] } : null });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openDelivery(page);
    const dialog = page.getByRole("dialog", { name: "Deliver Workspace", exact: true });
    await dialog.getByTestId("finish-confirm-action").click();
    await expect(dialog.getByRole("alert")).toContainText("Could not check running processes");
    expect(submitted).toBe(false);
    await dialog.getByTestId("finish-confirm-action").click();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    expect(checks).toBe(2);
    expect(submitted).toBe(true);
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test("Cancelling an in-flight process check cannot start delivery after its response arrives", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let checked = false;
  let writes = 0;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "delivery-cancel-process-check" });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}`, async route => {
      const response = await route.fetch(); const data = await response.json();
      data.repositories.forEach((item: { delivery_status: string }) => { item.delivery_status = "delivered"; });
      await route.fulfill({ response, json: data });
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-processes`, async route => {
      await released;
      await route.fulfill({ json: [] }).catch(() => {}); // The first request is deliberately cancelled.
      checked = true;
    });
    await page.route(`**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`, async route => {
      if (route.request().method() === "POST") writes++;
      await route.fulfill({ contentType: "application/json", json: writes ? { workspace_id: FIXTURE_IDS.workspace, status: "completed", items: [] } : null });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openDelivery(page);
    const dialog = page.getByRole("dialog", { name: "Deliver Workspace", exact: true });
    const requested = page.waitForRequest(request => request.url().endsWith("/finish-processes"));
    await dialog.getByTestId("finish-confirm-action").click();
    await requested;
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    release();
    await expect.poll(() => checked).toBe(true);
    expect(writes).toBe(0);
    await openDelivery(page);
    await dialog.getByTestId("finish-confirm-action").click();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    expect(writes).toBe(1);
    harness.assertNoUnexpectedRequests();
  } finally { release(); try { await closeUiSession(page); } finally { await harness.close(); } }
});

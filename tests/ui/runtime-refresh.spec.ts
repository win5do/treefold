import { test, expect, type Page } from "@playwright/test";
import { createRuntimeRefreshScheduler } from "../../src/renderer/src/features/app/runtimeRefreshScheduler.ts";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("runtime refresh coalesces bursts and preserves changes received during a slow request", async () => {
  const calls: string[][] = [];
  const gates = [deferred(), deferred()];
  const errors: unknown[] = [];
  const scheduler = createRuntimeRefreshScheduler<string>(async domains => {
    calls.push(domains.sort());
    await gates[calls.length - 1]?.promise;
  }, cause => errors.push(cause));
  try {
    for (let i = 0; i < 10_000; i++) scheduler.request(["sidebar", "sessions"]);
    await expect.poll(() => calls.length).toBe(1);
    for (let i = 0; i < 10_000; i++) scheduler.request(["sidebar", "processes"]);
    gates[0].resolve();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls).toEqual([["sessions", "sidebar"], ["processes", "sidebar"]]);
    expect(errors).toEqual([]);
    scheduler.request(["amux"]);
    scheduler.dispose();
    gates[1].resolve();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(calls).toHaveLength(2);
  } finally {
    scheduler.dispose();
    for (const gate of gates) gate.resolve();
  }
});

test("runtime refresh logs rejection and continues pending work; disposal cancels queued work", async () => {
  const gate = deferred();
  const errors: unknown[] = [];
  let calls = 0;
  const error = new Error("offline");
  const scheduler = createRuntimeRefreshScheduler<string>(async () => {
    calls++;
    if (calls === 1) {
      await gate.promise;
      throw error;
    }
  }, cause => errors.push(cause));
  try {
    scheduler.request(["sidebar"]);
    await expect.poll(() => calls).toBe(1);
    scheduler.request(["sessions"]);
    gate.resolve();
    await expect.poll(() => calls).toBe(2);
    expect(errors).toEqual([error]);
    scheduler.request(["amux"]);
    scheduler.dispose();
    scheduler.request(["sidebar"]);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(calls).toBe(2);
  } finally {
    gate.resolve();
    scheduler.dispose();
  }
});

test("runtime events wait for existing queries and retain the final state after another burst", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const gates = [deferred(), deferred()];
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "runtime-refresh" });
    let streamOpen = false;
    page.on("console", message => { if (message.text().includes("Stream open /api/events")) streamOpen = true; });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await expect(page.getByTestId(`workspace-list-row-${FIXTURE_IDS.workspace}`)).toBeVisible();
    await expect.poll(() => streamOpen).toBe(true);
    const failures: string[] = [];
    page.on("requestfailed", request => { if (request.url().endsWith("/api/sidebar")) failures.push(request.failure()?.errorText ?? "failed"); });
    let requests = 0;
    let label = "Before events";
    await page.route("**/api/sidebar", async route => {
      const index = requests++;
      const response = await route.fetch();
      const data = await response.json();
      data.projects[0].name = label;
      await gates[index]?.promise;
      await route.fulfill({ response, json: data });
    });
    await page.evaluate(async () => {
      const { queryClient } = await import("/src/features/app/queryClient.ts");
      void queryClient.refetchQueries({ queryKey: ["sidebar"] });
    });
    await expect.poll(() => requests).toBe(1);
    label = "During events";
    for (let i = 0; i < 1_000; i++) harness.setProcessState(FIXTURE_IDS.workspaceShell, i % 2 ? "running" : "exited");
    // Keep the pre-event response in flight through the event burst.
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(requests).toBe(1);
    expect(failures).toEqual([]);
    gates[0].resolve();
    await expect.poll(() => requests).toBe(2);
    label = "Runtime final state";
    for (let i = 0; i < 1_000; i++) harness.setProcessState(FIXTURE_IDS.workspaceShell, i % 2 ? "running" : "exited");
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(requests).toBe(2);
    gates[1].resolve();
    await expect(page.getByText("Runtime final state", { exact: true }).first()).toBeVisible();
    expect(requests).toBe(3);
    expect(failures).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } finally {
    for (const gate of gates) gate.resolve();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("settings copies runtime information as a multiline report", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const copied: string[] = [];
  let rejectCopy = false;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "settings-runtime" });
    await page.exposeFunction("recordRuntimeCopy", async (value: string) => {
      if (rejectCopy) throw new Error("Clipboard unavailable");
      copied.push(value);
    });
    await page.goto(harness.baseUrl);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) => (window as unknown as {
            recordRuntimeCopy(value: string): Promise<void>;
          }).recordRuntimeCopy(value),
        },
      });
    });
    await page.getByTestId("open-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("settings-runtime-treefold-home"))
      .toContainText("/tmp/treefold-ui-fixture");
    const copy = dialog.getByRole("button", { name: "Copy environment information", exact: true });
    await copy.click();
    await expect.poll(() => copied).toEqual([
      "App version: 0.1.0-alpha.20261003000000\nTreefold Home: /tmp/treefold-ui-fixture\nPlatform: test",
    ]);
    await expect(page.getByRole("status").filter({ hasText: "Runtime information copied" })).toBeVisible();

    rejectCopy = true;
    await copy.click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not copy runtime information" })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-settings-runtime-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

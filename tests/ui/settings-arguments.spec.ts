import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("Codex argument additions and ordering survive saving and reopening Settings", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "settings-arguments" });
    await page.goto(harness.baseUrl);
    await page.getByTestId("open-settings").click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await dialog.getByRole("button", { name: "Add argument", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Codex argument 4", exact: true }).fill("--search");
    await dialog.getByRole("button", { name: "Move Codex argument 4 up", exact: true }).click();
    const saved = page.waitForResponse(response => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await page.getByTestId("open-settings").click();
    await expect(dialog.getByRole("textbox", { name: "Codex argument 3", exact: true })).toHaveValue("--search");
    expect(await dialog.locator('input[aria-label^="Codex argument "]').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)))
      .toEqual(["--dangerously-bypass-approvals-and-sandbox", "--model", "--search", "gpt-5.4"]);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

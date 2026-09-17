import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("language changes persist and localized actions remain searchable and keyboard accessible", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "localization" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await expect(page.getByTestId("open-settings")).toHaveAccessibleName("Settings");
    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-language").selectOption("zh-CN");
    await page.getByTestId("settings-save").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+Shift+p");
    const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
    await palette.getByRole("combobox").fill("新建 Session");
    await expect(palette.getByRole("option")).toHaveCount(1);
    await palette.getByRole("combobox").press("Enter");
    const sessionDialog = page.getByRole("dialog", { name: "新建 Session", exact: true });
    await expect(sessionDialog.getByRole("button", { name: "Agent", exact: true })).toBeFocused();
    await page.keyboard.press("Meta+f");
    await expect(sessionDialog.getByRole("textbox", { name: "目录", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sessionDialog.getByRole("button", { name: "Agent", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("open-settings")).toHaveAccessibleName("设置");
    expect((await (await page.request.get(`${harness.apiUrl}/api/settings`)).json()).language).toBe("zh-CN");
    await page.getByTestId("open-settings").click();
    await page.getByRole("button", { name: "快捷键", exact: true }).click();
    await page.getByPlaceholder("搜索命令或快捷键").fill("关闭 Session");
    await expect(page.getByTestId("keymap-session.close")).toBeVisible();
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.getByTestId("settings-language").selectOption("en-US");
    await page.getByTestId("settings-save").click();
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+Shift+p");
    await expect(page.getByRole("dialog", { name: "Command Palette", exact: true })).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

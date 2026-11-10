import type { Locator, Page } from "@playwright/test";

export async function chooseSelectOption(page: Page, trigger: Locator, label: string) {
  await trigger.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

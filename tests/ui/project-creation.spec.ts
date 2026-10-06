import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("Git URL creation validates before creating and keeps failed input editable", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-url" });
    await page.goto(harness.baseUrl);
    await page.getByTestId("new-project-action").click();
    const dialog = page.getByRole("dialog", { name: /^New Project/ });
    // Wait for the mounted chooser to own focus before sending native keyboard input.
    await expect(dialog.getByTestId("project-source-list")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "Git URL", exact: true })).toBeFocused();
    await dialog.getByRole("textbox", { name: "Git URL", exact: true }).fill("https://example.test/team/missing.git");
    await expect(dialog.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("missing");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Cannot access this repository");
    expect(harness.projectCreation.createRequests).toEqual([]);
    await dialog.getByRole("textbox", { name: "Git URL", exact: true }).fill("git@example.test:team/service.git");
    await expect(dialog.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("service");
    await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill("My service");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Create Project", exact: true })).toBeFocused();
    expect(harness.projectCreation.createRequests).toEqual([]);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Git URL", exact: true }).fill("https://example.test/team/updated.git");
    await expect(dialog.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("My service");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    harness.projectCreation.failNextCreation({ code: "GIT_REMOTE_UNAVAILABLE", message: "Remote unavailable" });
    await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Cannot access this repository");
    await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/#\/projects\/project-created-primary-requirement$/);
    expect(harness.projectCreation.createRequests).toEqual(Array(2).fill({
      name: "My service", source: { kind: "git_url", url: "https://example.test/team/updated.git" },
    }));
    expect(harness.projectCreation.validationRequests).toHaveLength(3);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("New from empty checks the destination and sends the validated source only on creation", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-empty" });
    await page.goto(harness.baseUrl);
    await page.getByTestId("new-project-action").click();
    const dialog = page.getByRole("dialog", { name: /^New Project/ });
    await dialog.getByRole("option", { name: "New from empty", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Project name", exact: true })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill("existing");
    await dialog.getByRole("textbox", { name: "Parent directory", exact: true }).fill("/tmp/treefold-ui-fixture");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("already exists");
    expect(harness.projectCreation.createRequests).toEqual([]);
    await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill("new-service");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Create Project", exact: true })).toBeEnabled();
    expect(harness.projectCreation.createRequests).toEqual([]);
    await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(harness.projectCreation.createRequests).toEqual([{
      name: "new-service", source: { kind: "empty", parent_path: "/tmp/treefold-ui-fixture" },
    }]);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Back returns to source selection and reopening starts a fresh Project draft", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "project-source-navigation" });
    await page.goto(harness.baseUrl);
    await page.getByTestId("new-project-action").click();
    const dialog = page.getByRole("dialog", { name: /^New Project/ });
    await expect(dialog.getByTestId("project-source-list")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "Project directory", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await dialog.getByRole("textbox", { name: "Git URL", exact: true }).fill("https://example.test/team/draft.git");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("new-project-action").click();
    await dialog.getByRole("option", { name: "Git URL", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Git URL", exact: true })).toHaveValue("");
    expect(harness.projectCreation.createRequests).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

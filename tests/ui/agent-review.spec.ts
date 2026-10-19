import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS, FIXTURE_NAMES } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";
import { enUS } from "../../src/renderer/src/i18n/locales/en-US.ts";
import { zhCN } from "../../src/renderer/src/i18n/locales/zh-CN.ts";

async function openWorkspaceReview(page: Page) {
  const trigger = page.getByTestId("sidebar-workspace-node").getByTestId("sidebar-node-menu-trigger");
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await trigger.press("Enter");
  await page.getByRole("menuitem", { name: "AI Review", exact: true }).click();
}

for (const language of ["en-US", "zh-CN"] as const) {
  test(`Review uses localized defaults and starts the chosen Agent with an editable first message (${language})`, async () => {
    const messages = language === "en-US" ? enUS : zhCN;
    const harness = await startUiHarness(fixture => {
      fixture.settings.language = language;
      fixture.system.agents.find(agent => agent.kind === "pi")!.available = true;
    });
    let page: Page | undefined;
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `review-${language}` });
      await page.setViewportSize({ width: 1000, height: 740 });
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      await openWorkspaceReview(page);
      const dialog = page.getByRole("dialog", { name: "AI Review", exact: true });
      const prompt = dialog.getByRole("textbox", { name: messages.agentReview.prompt, exact: true });
      await expect(prompt).toHaveValue(messages.agentReview.defaultPrompt);
      await expect(dialog).toContainText(messages.agentReview.comparisonBase.replace("{{branch}}", "main"));
      const agents = dialog.getByRole("radiogroup", { name: messages.agentsUi.chooseAgent });
      const codex = agents.getByRole("radio", { name: "Codex", exact: true });
      const pi = agents.getByRole("radio", { name: "Pi", exact: true });
      await expect(codex).toBeChecked();
      // Only installed Agents can be selected, matching New Session.
      await expect(agents.getByRole("radio", { name: /OpenCode/ })).toHaveCount(0);
      const directories = dialog.getByRole("group", { name: messages.terminalUi.availableDirectories, exact: true });
      const primary = directories.getByRole("button", { pressed: true });
      await expect(primary).toBeFocused();
      await page.keyboard.press("ArrowUp");
      const directory = directories.getByRole("button", { name: /apps\/web/ });
      await expect(directory).toBeFocused();
      await expect(directory).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("ArrowRight");
      await expect(codex).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(pi).toBeChecked();
      await page.keyboard.press("ArrowRight");
      await expect(pi).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(directory).toBeFocused();
      await expect(pi).toBeChecked();
      const editedPrompt = `${messages.agentReview.defaultPrompt}\nFocus on API compatibility.`;
      await prompt.fill(editedPrompt);
      for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) await prompt.press(key);
      await expect(prompt).toBeFocused();
      await expect(directory).toHaveAttribute("aria-pressed", "true");
      await expect(pi).toBeChecked();
      await prompt.press("ControlOrMeta+End");
      await prompt.press("Enter");
      await prompt.pressSequentially("Fix confirmed bugs and run focused tests.");
      const expectedPrompt = `${editedPrompt}\nFix confirmed bugs and run focused tests.`;
      await expect(prompt).toHaveValue(expectedPrompt);
      await expect(dialog).toBeVisible();
      // Diagnostic only: inspect the prompt and shared lists in the scrollable dialog.
      await page.screenshot({ path: `/tmp/treefold-agent-review-prompt-${language}.png`, animations: "disabled" });
      await prompt.press("Escape");
      await expect(directory).toBeFocused();
      await expect(dialog).toBeVisible();
      await expect(prompt).toHaveValue(expectedPrompt);
      await expect(dialog.getByRole("button", { name: messages.agentReview.start })).toBeEnabled();
      await agents.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/treefold-agent-review-${language}.png`, animations: "disabled" });
      if (language === "zh-CN") {
        await page.keyboard.press("ArrowRight");
        await expect(pi).toBeFocused();
      }
      const request = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/agent-review"));
      await page.keyboard.press("Enter");
      expect((await request).postDataJSON()).toEqual({ kind: "pi", project_directory_id: FIXTURE_IDS.monorepoDirectory,
        prompt: expectedPrompt });
      await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.workspace}/sessions/review-session-1$`));
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      await openWorkspaceReview(page);
      await expect(prompt).toHaveValue(messages.agentReview.defaultPrompt);
      await prompt.focus();
      await prompt.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(directories.getByRole("button", { pressed: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      harness.assertNoUnexpectedRequests();
    } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
  });
}

test("Project prompt persists, Delivery hands off to Review, and edits remain Session-local", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "review-delivery" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "AI Review settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "AI Review settings", exact: true });
    await settings.getByRole("textbox", { name: "Default Review prompt", exact: true }).fill("Review public API compatibility.  保留原文。");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: "AI Review settings", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "Default Review prompt", exact: true })).toHaveValue("Review public API compatibility.  保留原文。");
    await settings.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-fork-node"));
    await page.getByTestId("finish-workspace-action").click();
    const delivery = page.getByRole("dialog", { name: "Deliver Fork", exact: true });
    await delivery.getByRole("button", { name: "AI Review", exact: true }).click();
    const review = page.getByRole("dialog", { name: "AI Review", exact: true });
    await expect(delivery).toBeHidden();
    await expect(review).toContainText("Compare against: feature/parent");
    const prompt = review.getByRole("textbox", { name: "Review prompt", exact: true });
    await expect(prompt).toHaveValue("Review public API compatibility.  保留原文。");
    await prompt.fill("");
    await expect(review.getByRole("button", { name: "Start Review", exact: true })).toBeDisabled();
    await prompt.fill("Replace the default: review and fix regressions.");
    const request = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/agent-review"));
    await review.getByRole("button", { name: "Start Review", exact: true }).click();
    expect((await request).postDataJSON().prompt).toBe("Replace the default: review and fix regressions.");
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.fork}/sessions/review-session-1$`));
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByRole("button", { name: "AI Review settings", exact: true }).click();
    const defaultPrompt = settings.getByRole("textbox", { name: "Default Review prompt", exact: true });
    await expect(defaultPrompt).toHaveValue("Review public API compatibility.  保留原文。");
    await defaultPrompt.fill("");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings).toBeHidden();
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openWorkspaceReview(page);
    await expect(prompt).toHaveValue(enUS.agentReview.defaultPrompt);
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});


test("Review from a Fork menu uses that Fork while another Workspace is open", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "review-fork-menu" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-project-node"));
    await expect(page.getByRole("menuitem", { name: "AI Review", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openUiContextMenu(page, page.getByTestId("sidebar-fork-node"));
    await page.getByRole("menuitem", { name: "AI Review", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "AI Review", exact: true });
    await expect(dialog).toContainText(FIXTURE_NAMES.fork);
    await expect(dialog).toContainText("Compare against: feature/parent");
    const request = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/workspaces/${FIXTURE_IDS.fork}/agent-review`));
    await dialog.getByRole("button", { name: "Start Review", exact: true }).click();
    await request;
    await expect(page).toHaveURL(new RegExp(`/workspaces/${FIXTURE_IDS.fork}/sessions/review-session-1$`));
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

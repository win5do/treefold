import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("Agent commands and drag order persist and determine the default installed Agent", async () => {
  const harness = await startUiHarness(fixture => {
    for (const agent of fixture.system.agents) agent.available = agent.kind !== "opencode";
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "settings-agents" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByTestId("open-settings").click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    for (const name of ["Codex", "Claude Code", "OpenCode", "Pi"]) {
      await expect(settings.getByRole("button", { name: `Configure ${name}`, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    await settings.getByRole("button", { name: "Configure Codex", exact: true }).click();
    await settings.getByRole("textbox", { name: "Codex launch command", exact: true }).fill("codex --model preserved-draft");
    await settings.getByRole("button", { name: "Configure Pi", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "Pi launch command", exact: true })).toHaveAttribute("placeholder", "pi");
    const command = '/fixture/bin/pi --model "model with spaces" --thinking high';
    await settings.getByRole("textbox", { name: "Pi launch command", exact: true }).fill(command);
    await settings.getByRole("button", { name: "Configure Pi", exact: true }).click();
    await settings.getByRole("button", { name: "Configure Pi", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "Pi launch command", exact: true })).toHaveValue(command);
    await settings.getByRole("button", { name: "Configure OpenCode", exact: true }).click();
    await settings.getByRole("textbox", { name: "OpenCode launch command", exact: true }).fill("opencode --model reset-me");
    await settings.getByRole("button", { name: "Reset OpenCode", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "OpenCode launch command", exact: true })).toHaveValue("");
    await expect(settings.getByRole("textbox", { name: "Codex launch command", exact: true })).toHaveValue("codex --model preserved-draft");
    await expect(settings.getByRole("textbox", { name: "Pi launch command", exact: true })).toHaveValue(command);
    await settings.getByRole("button", { name: "Configure Codex", exact: true }).click();
    await settings.getByRole("button", { name: "Configure OpenCode", exact: true }).click();
    await settings.getByRole("button", { name: "Drag Pi to reorder", exact: true }).dragTo(settings.getByTestId("agent-row-codex"));
    const saved = page.waitForResponse(response => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect((await response.json()).agents).toMatchObject({
      order: ["pi", "codex", "claude_code", "opencode"],
      pi: { command },
    });
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await expect(settings.getByRole("list", { name: "Agent order", exact: true }).getByText("OpenCode", { exact: true })).toHaveCount(0);
    await settings.getByRole("button", { name: "Move Pi down", exact: true }).click();
    await settings.getByRole("button", { name: "Move Pi up", exact: true }).click();
    const reordered = page.waitForResponse(response => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    expect((await (await reordered).json()).agents.order).toEqual(["pi", "codex", "claude_code", "opencode"]);
    await page.reload();
    await page.getByTestId("open-settings").click();
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    await settings.getByRole("button", { name: "Configure Pi", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: "Pi launch command", exact: true })).toHaveValue(command);
    await page.screenshot({ path: "/tmp/treefold-agents-settings.png", animations: "disabled" });
    await settings.getByRole("textbox", { name: "Pi launch command", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/treefold-agents-settings-expanded.png", animations: "disabled" });
    await page.keyboard.press("Escape");
    const open = page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /OpenCode/ })).toHaveCount(0);
    await dialog.getByRole("radio", { name: "Claude Code", exact: true }).check();
    await page.keyboard.press("Escape");
    await open.click();
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    await page.screenshot({ path: "/tmp/treefold-agents-new-session.png", animations: "disabled" });
    const created = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/workspaces/${FIXTURE_IDS.workspace}/sessions`));
    await page.keyboard.press("Enter");
    expect((await created).postDataJSON()).toMatchObject({ kind: "pi", project_directory_id: FIXTURE_IDS.primaryDirectory });
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-agents-settings-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("uninstalled Agents cannot create a Session while Shell remains available", async () => {
  const harness = await startUiHarness(fixture => { for (const agent of fixture.system.agents) agent.available = false; });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "agents-uninstalled" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
    await expect(dialog.getByRole("button", { name: "Shell", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Create Session", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Shell", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Create Session", exact: true })).toBeEnabled();
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test("sidebar Agent creation keeps its Project and directory while selecting a CLI", async () => {
  const harness = await startUiHarness(fixture => {
    fixture.settings.agents.order = ["pi", "codex", "claude_code", "opencode"];
    fixture.system.agents.find(agent => agent.kind === "pi")!.available = true;
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "sidebar-agent-choice", windowSize: "1000,520" });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page.getByTestId("sidebar-project-action").click();
    await page.getByTestId("session-kind-agent").hover();
    await page.getByTestId(`session-directory-${FIXTURE_IDS.primaryDirectory}`).click();
    const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
    await expect(dialog.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    const created = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/projects/${FIXTURE_IDS.project}/sessions`));
    await dialog.getByRole("button", { name: "Create Session", exact: true }).click();
    expect((await created).postDataJSON()).toEqual({ kind: "pi", project_directory_id: FIXTURE_IDS.primaryDirectory });
    await expect(page).toHaveURL(new RegExp(`/projects/${FIXTURE_IDS.project}/sessions/`));
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

test("Agent refresh rechecks installation and versions without saving command drafts", async () => {
  const harness = await startUiHarness(fixture => {
    fixture.settings.agents.order = ["pi", "codex", "claude_code", "opencode"];
  });
  let page: Page | undefined;
  let release = () => {};
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "agents-refresh" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByTestId("open-settings").click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    const refresh = settings.getByRole("button", { name: "Recheck Agents", exact: true });
    await expect(refresh).toBeEnabled();
    const order = settings.getByRole("list", { name: "Agent order", exact: true });
    await expect(order.getByText("Pi", { exact: true })).toHaveCount(0);
    await settings.getByRole("button", { name: "Configure Pi", exact: true }).click();
    const command = settings.getByRole("textbox", { name: "Pi launch command", exact: true });
    await command.fill("pi --model unsaved-draft");
    let checks = 0;
    let writes = 0;
    page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith("/api/settings")) writes++; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/system", async route => {
      checks++;
      await gate;
      const response = await route.fetch();
      const system = await response.json();
      const pi = system.agents.find((agent: { kind: string }) => agent.kind === "pi");
      Object.assign(pi, { available: true, executable: "/fixture/bin/pi", version: "9.8.7" });
      await route.fulfill({ response, json: system });
    });
    await refresh.click();
    await expect.poll(() => checks).toBe(1);
    await expect(refresh).toBeDisabled();
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    release();
    await expect(refresh).toBeEnabled();
    await expect(order.getByText("Pi", { exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Configure Pi", exact: true })).toContainText("9.8.7");
    await expect(command).toHaveValue("pi --model unsaved-draft");
    expect(writes).toBe(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    harness.assertNoUnexpectedRequests();
  } finally {
    release();
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

test("Session keyboard navigation returns to directories without changing selections", async () => {
  const harness = await startUiHarness(fixture => {
    for (const agent of fixture.system.agents) agent.available = agent.kind !== "claude_code";
    fixture.workspaceDetails[FIXTURE_IDS.workspace].workspace_directories[0].path = "/Users/treefold/development/company/projects/treefold-examples/multi-repository-workspace/packages/backend";
  });
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "agent-session-keyboard", windowSize: "1000,700" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await page.getByTestId("workspace-sessions-section").getByRole("button", { name: "New Session", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New Session", exact: true });
    const shellType = dialog.getByRole("button", { name: "Shell", exact: true });
    const agentType = dialog.getByRole("button", { name: "Agent", exact: true });
    const directories = dialog.getByRole("group", { name: "Available directories", exact: true });
    const selectedDirectory = directories.getByRole("button", { pressed: true });
    await expect(shellType).toBeFocused();
    await page.screenshot({ path: "/tmp/treefold-new-session-shell.png", animations: "disabled" });
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft"]) {
      await page.keyboard.press(key);
      await expect(shellType).toBeFocused();
      await expect(shellType).toHaveAttribute("aria-pressed", "true");
    }
    await page.keyboard.press("Tab");
    await expect(agentType).toHaveAttribute("aria-pressed", "true");
    await expect(selectedDirectory).toBeFocused();
    const firstDirectory = await selectedDirectory.innerText();
    await page.keyboard.press("ArrowDown");
    const chosenDirectory = await selectedDirectory.innerText();
    expect(chosenDirectory).not.toBe(firstDirectory);
    await page.keyboard.press("ArrowRight");
    const codex = dialog.getByRole("radio", { name: "Codex", exact: true });
    const opencode = dialog.getByRole("radio", { name: "OpenCode", exact: true });
    await expect(codex).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(opencode).toBeFocused();
    await expect(opencode).toBeChecked();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("radio", { name: "Pi", exact: true })).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(opencode).toBeChecked();
    // Right at the last group must not trigger the radio group's native next option.
    await page.keyboard.press("ArrowRight");
    await expect(opencode).toBeFocused();
    await expect(opencode).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(selectedDirectory).toBeFocused();
    await expect(selectedDirectory).toHaveText(chosenDirectory, { useInnerText: true });
    await page.keyboard.press("ArrowLeft");
    await expect(selectedDirectory).toBeFocused();
    await expect(selectedDirectory).toHaveText(chosenDirectory, { useInnerText: true });
    await page.keyboard.press("ArrowRight");
    await expect(opencode).toBeFocused();
    // Switching type from either group focuses the directory and preserves both choices.
    await page.keyboard.press("Tab");
    await expect(shellType).toHaveAttribute("aria-pressed", "true");
    await expect(selectedDirectory).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(selectedDirectory).toHaveText(firstDirectory, { useInnerText: true });
    await page.keyboard.press("ArrowDown");
    await expect(selectedDirectory).toHaveText(chosenDirectory, { useInnerText: true });
    await page.keyboard.press("Shift+Tab");
    await expect(agentType).toHaveAttribute("aria-pressed", "true");
    await expect(selectedDirectory).toBeFocused();
    await expect(selectedDirectory).toHaveText(chosenDirectory, { useInnerText: true });
    await page.keyboard.press("ArrowRight");
    await expect(opencode).toBeFocused();
    await expect(opencode).toBeChecked();
    await page.screenshot({ path: "/tmp/treefold-agent-session-single-column.png", animations: "disabled" });
    const creation = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/api/workspaces/${FIXTURE_IDS.workspace}/sessions`));
    await page.keyboard.press("Enter");
    expect((await creation).postDataJSON()).toEqual({ kind: "opencode", project_directory_id: FIXTURE_IDS.monorepoDirectory });
    await expect(dialog).toHaveCount(0);
    harness.assertNoUnexpectedRequests();
  } finally { try { await closeUiSession(page); } finally { await harness.close(); } }
});

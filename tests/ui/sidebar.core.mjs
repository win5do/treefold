import assert from "node:assert/strict";
import { Key, remote } from "webdriverio";
import { FIXTURE_NAMES } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

const harness = await startUiHarness(); let browser;
try {
  browser = await remote({ logLevel: "error", capabilities: { browserName: "chrome", "goog:chromeOptions": { args: ["--headless=new", "--window-size=1400,900", "--disable-gpu"] } } });
  await browser.url(harness.baseUrl);
  const sidebar = await browser.$('[data-testid="workspace-sidebar"]'); await sidebar.waitForDisplayed({ timeout: 10_000 });
  assert.equal((await sidebar.getText()).includes("Fork"), false, "active hierarchy must not expose Fork");
  await (await browser.$('[data-testid="open-settings"]')).click();
  let dialog = await browser.$('[role="dialog"]'); await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(await dialog.getText(), /Worktree root/);
  assert.equal(await (await dialog.$("textarea")).getValue(), "--model\ngpt-5.4");
  await browser.keys(Key.Escape); await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  const projectToggle = await browser.$(`button[aria-label="Expand Project ${FIXTURE_NAMES.project}"]`); await projectToggle.click();
  const workspaceToggle = await browser.$(`button[aria-label="Expand Workspace ${FIXTURE_NAMES.workspace}"]`); await workspaceToggle.waitForDisplayed({ timeout: 3_000 });
  assert.equal((await browser.$$('[data-testid="sidebar-workspace-node"]')).length, 1, "Project must contain one flat Workspace node");

  await (await browser.$(`button*=${FIXTURE_NAMES.project}`)).click();
  const projectPage = await browser.$('[data-testid="workspace-main"]'); await projectPage.waitForDisplayed();
  assert.match(await projectPage.getText(), /Project · repository metadata/i);
  assert.match(await projectPage.getText(), /Git common dir/i);
  assert.match(await projectPage.getText(), /Default target/i);
  assert.equal((await projectPage.getText()).includes("Sessions"), false, "Project must not own formal Sessions");
  assert.equal(await (await browser.$("button=Open Shell")).isDisplayed(), true);
  assert.equal(await (await browser.$("button=Open Codex")).isDisplayed(), true);
  await (await browser.$("button=Pull")).click();
  await browser.$("*=Project target pull: up_to_date").waitForDisplayed({ timeout: 3_000 });
  await (await browser.$("button=Push")).click();
  await browser.$("*=Project target push: up_to_date").waitForDisplayed({ timeout: 3_000 });

  await (await browser.$(`button*=${FIXTURE_NAMES.workspace}`)).click();
  await browser.waitUntil(async () => (await browser.getUrl()).includes("/workspaces/"), { timeout: 3_000 });
  const workspacePage = await browser.$('[data-testid="workspace-main"]');
  assert.match(await workspacePage.getText(), /Workspace · development unit/i);
  assert.match(await workspacePage.getText(), /treefold\/feature-a1b2c3/);
  assert.match(await workspacePage.getText(), /origin\/feature\/treefold-model/);
  await (await workspacePage.$("button=Pull")).click();
  await browser.$("*=Workspace branch pull: up_to_date").waitForDisplayed({ timeout: 3_000 });
  await (await workspacePage.$("button=Push")).click();
  await browser.$("*=Workspace branch push: up_to_date").waitForDisplayed({ timeout: 3_000 });

  await (await workspacePage.$("button=Configure")).click();
  dialog = await browser.$('[role="dialog"]'); await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.match(await dialog.getText(), /Target branch 固定为 main/);
  assert.equal(await (await dialog.$('input[name="remote_name"]')).getValue(), "origin");
  await browser.keys(Key.Escape); await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });

  await (await workspacePage.$("button=Finish…")).click();
  dialog = await browser.$('[role="dialog"]'); await dialog.waitForDisplayed({ timeout: 3_000 });
  await browser.waitUntil(async () => (await dialog.getText()).includes("2 ahead"), { timeout: 3_000 });
  const dialogText = await dialog.getText();
  assert.match(dialogText, /Already merged through remote review \/ CI/);
  assert.match(dialogText, /Merge into local target branch/);
  assert.match(dialogText, /Preserve Workspace and branch/);
  assert.match(dialogText, /Discard Workspace code/);
  assert.equal(dialogText.includes("settle"), false, "finish UI must not use settle terminology");
  assert.equal(dialogText.includes("Fork"), false, "finish UI must not refer to Fork");
  assert.equal(await (await dialog.$("button=Finish Workspace")).isEnabled(), true);
  await browser.keys(Key.Escape);

  await browser.url(`${harness.baseUrl}/#/projects/project-ui-fixture`);
  await (await browser.$("button=New Workspace")).click();
  dialog = await browser.$('[role="dialog"]'); await dialog.waitForDisplayed({ timeout: 3_000 });
  assert.equal(await (await dialog.$('input[name="target_branch"]')).getValue(), "main");
  assert.equal(await (await dialog.$('input[name="remote_name"]')).getValue(), "origin");
  assert.equal(await (await dialog.$('input[name="remote_branch"]')).isExisting(), true);
  assert.match(await dialog.getText(), /Remote review \/ CR-CI/i);
  harness.assertNoUnexpectedRequests();
  console.log("✓ Project metadata, flat Workspace hierarchy, Git sync, upstream configuration, and finish flow passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-ui-failure.png").catch(() => {}); throw error;
} finally { await browser?.deleteSession(); await harness.close(); }

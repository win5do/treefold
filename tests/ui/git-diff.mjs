import assert from "node:assert/strict";
import { remote } from "webdriverio";
import { FIXTURE_COMMITS, FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";

const harness = await startUiHarness();
let browser;

async function selectionStates(elements) {
  const states = [];
  for (const element of elements) states.push(await element.getAttribute("aria-selected"));
  return states;
}

try {
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless=new", "--window-size=1400,900", "--disable-gpu"],
      },
    },
  });

  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  await (await browser.$('[data-testid="workspace-sidebar"]')).waitForDisplayed({ timeout: 10_000 });
  const showInspector = await browser.$('button[aria-label="Show right sidebar"]');
  await showInspector.waitForDisplayed({ timeout: 5_000 });
  await showInspector.click();
  await browser.$('button[role="tab"]*=History').click();
  await browser.waitUntil(async () => (await browser.$$('[data-testid="git-history-commit"]')).length === FIXTURE_COMMITS.length, {
    timeout: 3_000,
    timeoutMsg: "Git History fixture commits did not load",
  });

  let commits = await browser.$$('[data-testid="git-history-commit"]');
  await commits[0].click();
  assert.equal(await commits[0].getAttribute("aria-selected"), "true", "click must select one commit");
  await browser.execute((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })), commits[1]);
  commits = await browser.$$('[data-testid="git-history-commit"]');
  assert.deepEqual(await selectionStates(commits), ["true", "true", "false"], "Shift click must select a contiguous range");

  await browser.execute(() => {
    window.__treefoldCopiedCommit = "";
    navigator.clipboard.writeText = async (value) => {
      window.__treefoldCopiedCommit = value;
    };
  });
  await commits[0].click({ button: "right" });
  await (await browser.$('[data-testid="view-git-diff-action"]')).waitForDisplayed({ timeout: 3_000 });
  assert.deepEqual(await selectionStates(commits), ["true", "true", "false"], "right click inside the range must preserve it");
  await browser.$('[data-testid="copy-git-commit-action"]').click();
  assert.equal(
    await browser.execute(() => window.__treefoldCopiedCommit),
    FIXTURE_COMMITS[0].hash,
    "Copy Commit must copy the right-clicked commit's full hash",
  );
  const copyNotice = await browser.$('[role="status"]');
  await copyNotice.waitForDisplayed({ timeout: 1_000 });
  assert.equal(await copyNotice.getText(), "Commit copied", "Copy Commit must confirm success");

  await commits[2].click({ button: "right" });
  await (await browser.$('[data-testid="view-git-diff-action"]')).waitForDisplayed({ timeout: 3_000 });
  commits = await browser.$$('[data-testid="git-history-commit"]');
  assert.deepEqual(await selectionStates(commits), ["false", "false", "true"], "right click outside the range must select only that commit");
  await browser.keys("Escape");

  const repositorySelect = await browser.$('[data-testid="git-history-repository"]');
  await repositorySelect.selectByAttribute("value", FIXTURE_IDS.secondaryRepository);
  await browser.waitUntil(async () => (await browser.$('[data-testid="right-sidebar"]')).getText().then((text) => text.includes("develop")), { timeout: 3_000 });
  commits = await browser.$$('[data-testid="git-history-commit"]');
  assert.deepEqual(await selectionStates(commits), ["false", "false", "false"], "repository changes must clear History selection");
  await repositorySelect.selectByAttribute("value", FIXTURE_IDS.primaryRepository);
  await browser.waitUntil(async () => (await browser.$('[data-testid="right-sidebar"]')).getText().then((text) => text.includes("main")), { timeout: 3_000 });

  commits = await browser.$$('[data-testid="git-history-commit"]');
  await commits[0].click();
  await browser.execute((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })), commits[2]);
  await commits[1].click({ button: "right" });
  const viewDiff = await browser.$('[data-testid="view-git-diff-action"]');
  await viewDiff.waitForDisplayed({ timeout: 3_000 });
  const menuSurface = await browser.$('[data-slot="context-menu-content"]');
  assert.equal(await menuSurface.isDisplayed(), true, "View Diff menu must render through its reachable portal");
  const mainHandle = await browser.getWindowHandle();
  await viewDiff.click();
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2, {
    timeout: 5_000,
    timeoutMsg: "View Diff did not open a dedicated browser window",
  });
  const viewerHandle = (await browser.getWindowHandles()).find((handle) => handle !== mainHandle);
  assert.ok(viewerHandle, "Diff Viewer window handle must exist");
  await browser.switchToWindow(viewerHandle);
  await (await browser.$("h1=fixture-repository")).waitForDisplayed({ timeout: 10_000 });
  assert.deepEqual(harness.compareRequests.at(-1), {
    repositoryId: FIXTURE_IDS.primaryRepository,
    start_commit: FIXTURE_COMMITS[2].hash,
    end_commit: FIXTURE_COMMITS[0].hash,
    commit_count: 3,
  }, "View Diff must compare oldest^1 to newest with the selected count");

  await (await browser.$("h2=Binary file changed")).waitForDisplayed({ timeout: 5_000 });
  const previous = await browser.$('button[aria-label="Previous file"]');
  const next = await browser.$('button[aria-label="Next file"]');
  assert.equal(await previous.isEnabled(), false, "Previous file must be disabled at the first file");
  assert.equal(await next.isEnabled(), true, "Next file must be enabled before the last file");
  await next.click();
  await (await browser.$('[title="src/alpha.ts"]')).waitForDisplayed({ timeout: 8_000 });
  assert.ok((await browser.$('[data-testid="git-diff-content"]')).isDisplayed(), "text diff must be displayed");
  const selectedTreeText = await browser.execute(() => {
    const tree = document.querySelector('[aria-label="Changed files"]');
    return tree?.shadowRoot?.querySelector('[data-item-path="src/alpha.ts"]')?.textContent ?? "";
  });
  assert.match(selectedTreeText, /\+1\s+−1/, "tree statistics must exclude context lines");
  assert.equal(await next.isEnabled(), true, "root files must follow directory leaves");
  assert.equal(await previous.isEnabled(), true, "Previous file must be enabled after moving forward");

  const selectedTreePath = await browser.execute(() => {
    const tree = document.querySelector('[aria-label="Changed files"]');
    return tree?.shadowRoot?.querySelector('[data-item-selected]')?.getAttribute("data-item-path") ?? null;
  });
  assert.equal(selectedTreePath, "src/alpha.ts", "file navigation must synchronize the Changes Tree selection");
  await next.click();
  await (await browser.$('[title="README.md"]')).waitForDisplayed({ timeout: 3_000 });
  assert.equal(await next.isEnabled(), false, "Next file must be disabled at the last tree leaf");
  await browser.execute(() => {
    const tree = document.querySelector('[aria-label="Changed files"]');
    const binary = tree?.shadowRoot?.querySelector('[data-item-path="assets/logo.png"]');
    if (binary instanceof HTMLElement) binary.click();
  });
  await (await browser.$("h2=Binary file changed")).waitForDisplayed({ timeout: 3_000 });

  const emptyRoute = new URL(`${harness.baseUrl}/#/diff`);
  emptyRoute.hash = `#/diff?repositoryKind=project&repositoryId=${FIXTURE_IDS.secondaryRepository}&repositoryName=secondary-api-repository&startCommit=${FIXTURE_COMMITS[0].hash}&endCommit=${FIXTURE_COMMITS[0].hash}&commitCount=1`;
  await browser.url(emptyRoute.toString());
  await (await browser.$("h2=No changes")).waitForDisplayed({ timeout: 5_000 });

  await browser.url(`${harness.baseUrl}/#/diff?repositoryKind=project&repositoryId=missing-repository&repositoryName=missing&startCommit=${FIXTURE_COMMITS[0].hash}&endCommit=${FIXTURE_COMMITS[0].hash}&commitCount=1`);
  await (await browser.$("strong=Could not load diff")).waitForDisplayed({ timeout: 5_000 });

  harness.assertNoUnexpectedRequests();
  console.log("✓ Git History selection, View Diff launch, tree navigation, binary, empty, and error states passed");
} catch (error) {
  await browser?.saveScreenshot("/tmp/treefold-git-diff-failure.png").catch(() => {});
  throw error;
} finally {
  await browser?.deleteSession();
  await harness.close();
}

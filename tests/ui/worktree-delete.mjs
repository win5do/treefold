import assert from "node:assert/strict";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";
import { startUiHarness } from "./ui-harness.mjs";
import { closeUiSession, createUiSession } from "./harness/session.mjs";

const harness = await startUiHarness();
let browser;

try {
  browser = await createUiSession({ sessionName: "worktree-delete" });
  await browser.url(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
  const repository = await browser.$(
    `[data-testid="project-location-${FIXTURE_IDS.primaryRepository}"]`,
  );
  await repository.waitForDisplayed({ timeout: 3_000 });
  const worktreesToggle = await repository.$(
    `[data-testid="project-repository-worktrees-${FIXTURE_IDS.primaryRepository}-toggle"]`,
  );
  if ((await worktreesToggle.getAttribute("aria-expanded")) !== "true")
    await worktreesToggle.click();
  const unmanaged = await repository.$(
    '[data-testid="project-worktree-row"]:has(button[data-worktree-delete-state="available"])',
  );
  const deleteButton = await unmanaged.$(
    'button[data-worktree-delete-state="available"]',
  );

  harness.setWorktreeDeletePrecheck({
    status: "blocked",
    blockers: [
      "worktree has uncommitted changes; commit, stash, or discard them before deleting it",
    ],
    tracked_changes: 0,
    untracked_files: 1,
  });
  await deleteButton.click();
  const dialog = await browser.$('[data-testid="delete-worktree-dialog"]');
  await dialog.waitForDisplayed({ timeout: 3_000 });
  await (await dialog.$('[data-testid="worktree-delete-checking"]')).waitForDisplayed({ timeout: 3_000 });
  const action = await dialog.$('button=Delete worktree');
  assert.equal(await action.isEnabled(), false, "delete must stay disabled during precheck");
  await (await dialog.$('[data-testid="worktree-delete-blocked"]')).waitForDisplayed({ timeout: 3_000 });
  assert.equal(await action.isEnabled(), false, "dirty worktrees must be blocked");

  harness.setWorktreeDeletePrecheck({
    status: "ready",
    blockers: [],
    untracked_files: 0,
  });
  await (await dialog.$("button=Check again")).click();
  await (await dialog.$('[data-testid="worktree-delete-ready"]')).waitForDisplayed({ timeout: 3_000 });
  assert.equal(await action.isEnabled(), true, "clean worktrees must be deletable");
  await action.click();
  await dialog.waitForDisplayed({ reverse: true, timeout: 3_000 });
  const deletingRow = await repository.$(
    '[data-testid="project-worktree-row"]:has(button[data-worktree-delete-state="deleting"])',
  );
  await deletingRow.waitForDisplayed({ timeout: 3_000 });
  assert.match(await deletingRow.getText(), /Deleting/);
  assert.equal(
    await (
      await deletingRow.$('button[data-worktree-delete-state="deleting"]')
    ).isEnabled(),
    false,
    "deleting worktrees must disable repeated deletion",
  );
  assert.equal(
    harness.deleteRequests.some(
      (request) => request.kind === "worktree" && request.path.includes("unmanaged-worktree"),
    ),
    true,
    "worktree deletion must reach the API",
  );
  await deletingRow.waitForDisplayed({ reverse: true, timeout: 5_000 });
  harness.assertNoUnexpectedRequests();
  console.log("✓ worktree deletion precheck, blocking, retry, and removal passed");
} finally {
  await closeUiSession(browser);
  await harness.close();
}

import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";

test("Workspace shares Local, Remote and New switching while Fork has no switch action", async () => {
  let current = "feature/sidebar-polish";
  let rejectCheckout = true;
  const requests: Record<string, unknown>[] = [];
  const harness = await startUiHarness();
  let page: Page | undefined;
  try {
    page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: "workspace-branch-switch" });
    const id = FIXTURE_IDS.workspacePrimaryLocation;
    await page.route(`**/api/workspace-repositories/${id}/branches`, route => route.fulfill({ json: {
      current, local: [current, "available", "occupied"], occupied: { occupied: "/tmp/another-worktree" },
      remotes: [{ name: "origin", branches: ["remote-topic"] }],
    } }));
    await page.route(`**/api/workspace-repositories/${id}/checkout`, async route => {
      if (rejectCheckout) {
        await route.fulfill({ status: 409, json: { error: { code: "GIT_STATE_STALE", message: "Checkout blocked by local changes" } } });
        return;
      }
      const input = route.request().postDataJSON(); requests.push(input);
      current = input.local_branch ?? input.branch;
      await route.fulfill({ json: { branch: current } });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const trigger = page.getByTestId(`workspace-switch-branch-${id}`);
    await trigger.click();
    let dialog = page.getByRole("dialog", { name: "Switch branch", exact: true });
    await expect(dialog.getByTestId("branch-local-occupied")).toBeDisabled();
    await dialog.getByTestId("branch-local-available").click();
    await dialog.getByRole("button", { name: "Switch branch", exact: true }).click();
    await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Checkout blocked by local changes" })).toBeVisible();
    await expect(dialog).toBeVisible();
    rejectCheckout = false;
    await dialog.getByRole("button", { name: "Switch branch", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests[0]).toMatchObject({ kind: "local", branch: "available" });

    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Switch branch", exact: true });
    await dialog.getByRole("button", { name: "origin", exact: true }).click();
    await dialog.getByTestId("branch-remote-origin/remote-topic").click();
    await dialog.getByRole("textbox", { name: "Local branch name" }).fill("tracking-topic");
    await dialog.getByRole("button", { name: "Switch branch", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests[1]).toMatchObject({ kind: "remote", remote: "origin", branch: "remote-topic", local_branch: "tracking-topic" });

    await trigger.click();
    await dialog.getByTestId("branch-local-available").click();
    await dialog.getByRole("button", { name: "New branch", exact: true }).click();
    const name = dialog.getByRole("textbox", { name: "Branch name", exact: true });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("available");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("button", { name: "Create and switch", exact: true })).toBeDisabled();
    await name.fill("new-topic");
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(dialog.getByRole("button", { name: "Create and switch", exact: true })).toBeEnabled();
    await name.press("Enter");
    await expect(dialog).toBeHidden();
    expect(requests[2]).toEqual({ kind: "new", branch: "new-topic", base: { kind: "local", branch: "available" }, expected_branch: "tracking-topic" });
    await trigger.click();
    await dialog.getByRole("button", { name: "origin", exact: true }).click();
    await dialog.getByTestId("branch-remote-origin/remote-topic").click();
    await dialog.getByRole("button", { name: "New branch", exact: true }).click();
    await expect(name).toHaveValue("remote-topic");
    await dialog.getByRole("button", { name: "Create and switch", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests[3]).toEqual({ kind: "new", branch: "remote-topic", base: { kind: "remote", remote: "origin", branch: "remote-topic" }, expected_branch: "new-topic" });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.fork}`);
    await expect(page.getByTestId(`workspace-location-${FIXTURE_IDS.forkPrimaryLocation}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch branch", exact: true })).toHaveCount(0);
    harness.assertNoUnexpectedRequests();
  } catch (error) {
    await page?.screenshot({ path: "/tmp/treefold-workspace-branch-switch-failure.png" }).catch(() => {});
    throw error;
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});

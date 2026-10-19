import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession, openUiContextMenu } from "./harness/session.ts";
import type { CreateWorkspaceInput } from "../../src/renderer/src/domain/types.ts";

for (const kind of ["workspace", "fork"] as const) {
  test(`${kind} creation submits the preview branch or a user override`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    const requests: (CreateWorkspaceInput & { branch?: string; generated_branch?: string })[] = [];
    const submittedBranch = (index: number) => {
      if (kind === "fork") return requests[index].branch;
      const checkout = requests[index].repositories?.find(item => item.repository_id === FIXTURE_IDS.primaryRepository)?.checkout;
      return checkout?.mode === "new" ? checkout.branch : undefined;
    };
    try {
      page = await createUiSession({ apiUrl: harness.apiUrl, sessionName: `create-${kind}` });
      await page.addInitScript(() => {
        const original = crypto.getRandomValues.bind(crypto);
        let sequence = 0;
        crypto.getRandomValues = ((array: Parameters<typeof crypto.getRandomValues>[0]) => {
          if (array instanceof Uint8Array && array.length === 2) {
            sequence += 1;
            array[0] = sequence >>> 8;
            array[1] = sequence & 255;
            return array;
          }
          return original(array);
        }) as typeof crypto.getRandomValues;
      });
      const endpoint = kind === "workspace"
        ? `/api/projects/${FIXTURE_IDS.project}/workspaces`
        : `/api/workspaces/${FIXTURE_IDS.workspace}/forks`;
      await page.route(`**${endpoint}`, async (route) => {
        requests.push(route.request().postDataJSON());
        // Keep the form open to exercise editing and resubmission after an API rejection.
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "BAD_REQUEST", message: "Fixture branch conflict" } }) });
      });
      await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
      const open = async () => {
        if (kind === "workspace") {
          await page!.getByTestId("sidebar-project-action").click();
        } else {
          await openUiContextMenu(page!, '[data-testid="sidebar-workspace-node"]');
        }
        await page!.getByTestId(`create-${kind}-action`).click();
      };
      await open();
      const dialog = page.getByRole("dialog");
      const branch = kind === "workspace"
        ? dialog.getByTestId(`workspace-create-repository-${FIXTURE_IDS.primaryRepository}`).getByRole("textbox", { name: "New branch name", exact: true })
        : dialog.getByRole("textbox", { name: "Branch name", exact: true });
      if (kind === "workspace") await expect(branch).not.toHaveValue("");
      else await expect(branch).toHaveValue("");
      const generated = kind === "workspace" ? await branch.inputValue() : await branch.getAttribute("placeholder");
      expect(generated).toMatch(/^treefold\/\d{6}-\d{4}-[a-f0-9]{4}$/);
      const submit = dialog.getByRole("button", { name: kind === "workspace" ? "Create Workspace" : "Create Fork", exact: true });
      await submit.click();
      await expect.poll(() => requests.length).toBe(1);
      expect(submittedBranch(0)).toBe(kind === "workspace" ? generated : "");
      if (kind === "fork") expect(requests[0].generated_branch).toBe(generated);
      await branch.fill("feature/my-change");
      await submit.click();
      await expect.poll(() => requests.length).toBe(2);
      expect(submittedBranch(1)).toBe("feature/my-change");
      await branch.fill("");
      if (kind === "workspace") {
        await expect(submit).toBeDisabled();
        await branch.fill(generated!);
      } else await expect(branch).toHaveAttribute("placeholder", generated!);
      await submit.click();
      await expect.poll(() => requests.length).toBe(3);
      expect(submittedBranch(2)).toBe(kind === "workspace" ? generated : "");
      if (kind === "fork") expect(requests[2].generated_branch).toBe(generated);
      await expect(submit).toBeEnabled();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
      await open();
      if (kind === "workspace") {
        await expect(branch).not.toHaveValue("");
        await expect(branch).not.toHaveValue(generated!);
      } else {
        await expect(branch).toHaveValue("");
        await expect(branch).not.toHaveAttribute("placeholder", generated!);
      }
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page?.screenshot({ path: `/tmp/treefold-create-${kind}-failure.png` });
      throw error;
    } finally {
      try { await closeUiSession(page); } finally { await harness.close(); }
    }
  });
}

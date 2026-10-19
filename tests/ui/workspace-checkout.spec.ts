import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { createUiSession, closeUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { expectReachableOverlay } from "./overlay-assertions.ts";
import type { CreateWorkspaceInput } from "../../src/renderer/src/domain/types.ts";

for (const scenario of ["mixed-local", "remote-checkout"] as const) {
  test(`Workspace creation supports ${scenario} choices and blocks occupied branches`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    let submitted: CreateWorkspaceInput | undefined;
    try {
      page = await createUiSession({
        apiUrl: harness.apiUrl,
        sessionName: `checkout-${scenario}`,
      });
      await page.setViewportSize({ width: 1000, height: 740 });
      await page.route(
        "**/api/project-repositories/*/branches",
        async (route) => {
          await route.fulfill({
            json: {
              current: "main",
              current_remote: "origin",
              local: ["main", "release", "feature/local"],
              remotes: [
                { name: "origin", branches: ["release", "feature/remote"] },
              ],
              occupied: {
                main: "/project/repository",
                release: "/external/release",
              },
              upstreams: {
                "feature/local": {
                  remote: "origin",
                  branch: "published/local",
                },
              },
            },
          });
        },
      );
      await page.route(
        `**/api/projects/${FIXTURE_IDS.project}/workspaces`,
        async (route) => {
          submitted = route.request().postDataJSON();
          const response = await page!.request.get(
            `${harness.apiUrl}/api/workspaces/${FIXTURE_IDS.workspace}`,
          );
          await route.fulfill({ status: 201, json: await response.json() });
        },
      );
      await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
      await page
        .getByTestId("project-workspaces-section")
        .getByRole("button", { name: "New Workspace", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "New Workspace",
        exact: true,
      });
      const first = dialog.getByTestId(
        `workspace-create-repository-${FIXTURE_IDS.primaryRepository}`,
      );
      const second = dialog.getByTestId(
        `workspace-create-repository-${FIXTURE_IDS.secondaryRepository}`,
      );
      await expect(
        first.getByLabel("New branch name", { exact: true }),
      ).not.toHaveValue("");
      const generated = await first
        .getByLabel("New branch name", { exact: true })
        .inputValue();
      await expect(
        second.getByLabel("New branch name", { exact: true }),
      ).toHaveValue(generated);
      await first
        .getByLabel("New branch name", { exact: true })
        .fill("feature/custom");
      await first.getByLabel("Base branch", { exact: true }).click();
      const basePicker = page.getByRole("dialog", {
        name: "Base branch",
        exact: true,
      });
      // Occupancy restricts checkout, never the base of a new branch.
      await expect(
        basePicker.getByTestId("branch-local-release"),
      ).toBeEnabled();
      await basePicker
        .getByRole("textbox", { name: "Search branches…", exact: true })
        .fill("origin/release");
      await basePicker.getByTestId("branch-remote-origin/release").click();
      await expect(dialog).toBeVisible();
      await second
        .getByRole("button", { name: "Use existing branch", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Create Workspace", exact: true }),
      ).toBeDisabled();
      await second.getByLabel("Branch to check out", { exact: true }).click();
      const checkout = page.getByRole("dialog", {
        name: "Branch to check out",
        exact: true,
      });
      if (scenario === "mixed-local") {
        await expectReachableOverlay(checkout);
        await checkout.press("Escape");
        await expect(checkout).toBeHidden();
        await expect(dialog).toBeVisible();
        await second.getByLabel("Branch to check out", { exact: true }).click();
      }
      await expect(checkout.getByTestId("branch-local-main")).toBeDisabled();
      await expect(checkout.getByTestId("branch-local-release")).toBeDisabled();
      await expect(checkout.getByTestId("branch-local-release")).toContainText(
        "/external/release",
      );
      await checkout.getByTestId("branch-local-feature/local").click();
      await expect(
        second.getByLabel("Remote feature branch", { exact: true }),
      ).toHaveValue("published/local");
      if (scenario === "remote-checkout") {
        await second.getByLabel("Branch to check out", { exact: true }).click();
        await checkout
          .getByRole("textbox", { name: "Search branches…", exact: true })
          .fill("feature/remote");
        await checkout
          .getByTestId("branch-remote-origin/feature/remote")
          .click();
        await expect(
          second.getByLabel("Local branch name", { exact: true }),
        ).toHaveValue("feature/remote");
        await second
          .getByLabel("Local branch name", { exact: true })
          .fill("main");
        await expect(second.getByRole("alert")).toContainText("already exists");
        await expect(
          dialog.getByRole("button", { name: "Create Workspace", exact: true }),
        ).toBeDisabled();
        await second
          .getByLabel("Local branch name", { exact: true })
          .fill("feature/remote-copy");
        await expect(
          second.getByLabel("Remote feature branch", { exact: true }),
        ).toHaveValue("feature/remote");
        await second
          .getByLabel("Remote feature branch", { exact: true })
          .fill("feature/remote");
      }
      await dialog
        .getByRole("button", { name: "Create Workspace", exact: true })
        .click();
      await expect.poll(() => submitted).toBeTruthy();
      expect(
        submitted!.repositories.find(
          (repo) => repo.repository_id === FIXTURE_IDS.primaryRepository,
        ),
      ).toEqual({
        repository_id: FIXTURE_IDS.primaryRepository,
        checkout: {
          mode: "new",
          branch: "feature/custom",
          base: { kind: "remote", remote: "origin", branch: "release" },
        },
        upstream: { remote: "origin", branch: "feature/custom" },
      });
      expect(
        submitted!.repositories.find(
          (repo) => repo.repository_id === FIXTURE_IDS.secondaryRepository,
        ),
      ).toEqual({
        repository_id: FIXTURE_IDS.secondaryRepository,
        checkout:
          scenario === "mixed-local"
            ? {
                mode: "existing",
                source: { kind: "local", branch: "feature/local" },
              }
            : {
                mode: "existing",
                source: {
                  kind: "remote",
                  remote: "origin",
                  branch: "feature/remote",
                },
                local_branch: "feature/remote-copy",
              },
        upstream: {
          remote: "origin",
          branch:
            scenario === "mixed-local" ? "published/local" : "feature/remote",
        },
      });
      expect(harness.repositoryUpdateRequests).toEqual([]);
      harness.assertNoUnexpectedRequests();
    } catch (error) {
      await page
        ?.screenshot({
          path: `/tmp/treefold-workspace-${scenario}-failure.png`,
        })
        .catch(() => {});
      throw error;
    } finally {
      try {
        await page?.unrouteAll({ behavior: "wait" });
      } finally {
        try {
          await closeUiSession(page);
        } finally {
          await harness.close();
        }
      }
    }
  });
}

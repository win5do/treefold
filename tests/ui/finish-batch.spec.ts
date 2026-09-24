import { test, expect, type Page } from "@playwright/test";
import type {
  FinishBatch,
  FinishPlanItem,
} from "../../src/renderer/src/domain/types.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";
import { startUiHarness } from "./ui-harness.ts";
import {
  closeUiSession,
  createUiSession,
  openUiContextMenu,
} from "./harness/session.ts";

test("Finish confirms all repositories and resumes saved progress after closing", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const names = [
    "backend-with-a-long-repository-name",
    "frontend-with-a-long-repository-name",
  ];
  let batch: FinishBatch | null = null;
  const submissions: FinishPlanItem[][] = [];
  let resumes = 0;
  let blocked = true;
  const ids = [
    FIXTURE_IDS.workspacePrimaryLocation,
    FIXTURE_IDS.workspaceSecondaryLocation,
  ];
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "finish-batch",
    });
    await page.setViewportSize({ width: 1000, height: 740 });
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}`,
      async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.repositories = ids.map((id, index) => ({
          ...data.repositories[index],
          id,
          repository_name: names[index],
          delivery_status: "active",
          branch_ownership: index === 0 ? "user" : "managed",
          remote_name: null,
          delivery_mode: "local_merge",
          access_mode: "read_write",
        }));
        data.finish_batch = batch;
        await route.fulfill({ response, json: data });
      },
    );
    await page.route(
      "**/api/workspace-repositories/*/delivery-preflight",
      async (route) => {
        const id = route.request().url().split("/").at(-2)!;
        const action = route.request().postDataJSON().code_action;
        await route.fulfill({
          json: {
            id: `preflight-${id}-${action}`,
            workspace_repository_id: id,
            code_action: action,
            target_branch: "release",
            ahead: 2,
            behind: 0,
            changed_files: [],
            blockers:
              blocked && id === ids[1]
                ? ["Parent target has uncommitted changes"]
                : [],
            warnings: [],
            source_dirty: false,
          },
        });
      },
    );
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`,
      async (route) => {
        if (route.request().method() === "POST") {
          const plans: FinishPlanItem[] = route
            .request()
            .postDataJSON().repositories;
          submissions.push(plans);
          batch = {
            workspace_id: FIXTURE_IDS.workspace,
            status: "running",
            error: null,
            items: plans.map((plan, index) => ({
              ...plan,
              repository_name: names[index],
              status: "pending",
              delivered: false,
              cleaned: false,
              error: null,
              operation_id: null,
            })),
          };
        }
        await route.fulfill({ json: batch, contentType: "application/json" });
      },
    );
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch/resume`,
      async (route) => {
        resumes += 1;
        batch = {
          ...batch!,
          status: "completed",
          items: batch!.items.map((item) => ({
            ...item,
            status: "completed",
            delivered: true,
            cleaned: true,
            error: null,
          })),
        };
        await route.fulfill({ json: batch, contentType: "application/json" });
      },
    );
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    const openFinish = async () => {
      await openUiContextMenu(
        page!,
        page!.getByTestId("sidebar-workspace-node"),
      );
      await page!.getByTestId("finish-workspace-action").click();
    };
    await openFinish();
    const dialog = page.getByRole("dialog", {
      name: "Finish Workspace",
      exact: true,
    });
    const first = dialog.getByRole("tab", { name: new RegExp(names[0]) });
    const second = dialog.getByRole("tab", { name: new RegExp(names[1]) });
    const firstPanel = dialog.getByRole("tabpanel", { name: new RegExp(names[0]) });
    const secondPanel = dialog.getByRole("tabpanel", { name: new RegExp(names[1]) });
    await expect(firstPanel.getByRole("status")).toContainText("Created from main; this delivery will merge into release.");
    await expect(firstPanel.getByRole("checkbox", { name: "Delete local branch" })).not.toBeChecked();
    await expect(second).toContainText(/blocked/i);
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    // Vertical tabs support keyboard selection and keep each repository's draft.
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(
      dialog.getByText("Parent target has uncommitted changes", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(secondPanel.getByRole("checkbox", { name: "Delete local branch" })).toBeChecked();
    await secondPanel
      .getByRole("combobox", { name: "Finish strategy" })
      .selectOption("keep");
    await expect(
      secondPanel.getByRole("checkbox", { name: "Delete local branch" }),
    ).toBeDisabled();
    await first.click();
    await expect(
      firstPanel.getByRole("combobox", { name: "Finish strategy" }),
    ).toHaveValue("local_merge");
    await second.click();
    await expect(
      secondPanel.getByRole("combobox", { name: "Finish strategy" }),
    ).toHaveValue("keep");
    await first.click();
    await firstPanel.getByRole("combobox", { name: "Finish strategy" }).selectOption("squash_merge");
    await second.click();
    blocked = false;
    await dialog.getByRole("button", { name: "Recheck", exact: true }).click();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
    await first.click();
    await page.screenshot({
      path: "/tmp/treefold-finish-batch-configure.png",
      animations: "disabled",
    });
    await dialog.getByTestId("finish-confirm-action").click();
    await expect(
      dialog.getByRole("button", { name: "Close window" }),
    ).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toEqual([
      {
        repository_id: ids[0],
        code_action: "squash_merge",
        delete_worktree: true,
        delete_branch: false,
        preflight_id: `preflight-${ids[0]}-squash_merge`,
      },
      {
        repository_id: ids[1],
        code_action: "keep",
        delete_worktree: false,
        delete_branch: false,
        preflight_id: `preflight-${ids[1]}-keep`,
      },
    ]);
    await dialog.getByRole("button", { name: "Close window" }).click();
    batch = {
      ...batch!,
      status: "paused",
      items: batch!.items.map((item, index) => ({
        ...item,
        status: index === 0 ? "delivered" : "blocked",
        delivered: index === 0,
        error:
          index === 1 ? "Parent target changed; review it and continue." : null,
      })),
    };
    await openFinish();
    await second.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Parent target changed",
    );
    await expect(
      dialog.getByRole("button", { name: "Continue remaining steps" }),
    ).toBeEnabled();
    await page.screenshot({
      path: "/tmp/treefold-finish-batch-paused.png",
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Continue remaining steps" })
      .click();
    await expect(
      dialog.getByText("All repositories finished and archived.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(resumes).toBe(1);
    expect(submissions).toHaveLength(1);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${FIXTURE_IDS.project}$`),
    );
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

test("Finish can archive repositories delivered by the earlier per-repository flow", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let submitted: FinishPlanItem[] | undefined;
  let batch: FinishBatch | null = null;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "finish-delivered",
    });
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}`,
      async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.repositories = data.repositories.map((item: object) => ({
          ...item,
          delivery_status: "delivered",
        }));
        data.forks = [];
        await route.fulfill({ response, json: data });
      },
    );
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`,
      async (route) => {
        if (route.request().method() === "POST") {
          submitted = route.request().postDataJSON().repositories;
          batch = {
            workspace_id: FIXTURE_IDS.workspace,
            status: "completed",
            items: [],
            error: null,
          };
        }
        await route.fulfill({ json: batch, contentType: "application/json" });
      },
    );
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
    await page.getByTestId("finish-workspace-action").click();
    const dialog = page.getByRole("dialog", {
      name: "Finish Workspace",
      exact: true,
    });
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
    await dialog.getByTestId("finish-confirm-action").click();
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeVisible();
    expect(submitted).toEqual([]);
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

for (const resume of [false, true]) {
  test(`Force execute ${resume ? "resumes saved progress" : "confirms partial damage"} without bypassing healthy repository checks`, async () => {
    const harness = await startUiHarness();
    let page: Page | undefined;
    const ids = [
      FIXTURE_IDS.workspacePrimaryLocation,
      FIXTURE_IDS.workspaceSecondaryLocation,
    ];
    let healthyBlocked = !resume;
    const plans: FinishPlanItem[] = ids.map((repository_id) => ({
      repository_id,
      code_action: "local_merge",
      preflight_id: "saved",
      delete_worktree: false,
      delete_branch: false,
    }));
    let batch: FinishBatch | null = resume
      ? {
          workspace_id: FIXTURE_IDS.workspace,
          status: "paused",
          items: plans.map((plan, index) => ({
            ...plan,
            repository_name: index ? "frontend" : "backend",
            status: index ? "delivered" : "blocked",
            delivered: !!index,
            cleaned: false,
            error: index ? null : "Legacy failure",
          })),
        }
      : null;
    const submissions: unknown[] = [];
    try {
      page = await createUiSession({
        apiUrl: harness.apiUrl,
        sessionName: "force-finish",
      });
      await page.route(
        `**/api/workspaces/${FIXTURE_IDS.workspace}`,
        async (route) => {
          const detail = await (await route.fetch()).json();
          detail.repositories = ids.map((id, index) => ({
            ...detail.repositories[0],
            id,
            repository_name: index ? "frontend" : "backend",
            delivery_mode: "local_merge",
            remote_name: null,
          }));
          await route.fulfill({ json: detail });
        },
      );
      await page.route(
        "**/api/workspace-repositories/*/delivery-preflight",
        (route) => {
          const broken = route.request().url().includes(ids[0]);
          return route.fulfill(
            broken
              ? {
                  status: 409,
                  json: {
                    error: {
                      code: "WORKTREE_DIRECTORY_MISSING",
                      message: "Missing",
                    },
                  },
                }
              : {
                  json: {
                    id: "healthy-check",
                    workspace_repository_id: ids[1],
                    code_action: "local_merge",
                    target_branch: "main",
                    ahead: 1,
                    behind: 0,
                    changed_files: [],
                    warnings: [],
                    blockers: healthyBlocked
                      ? ["Parent has uncommitted changes"]
                      : [],
                  },
                },
          );
        },
      );
      const handle = async (route: import("@playwright/test").Route) => {
        if (route.request().method() === "POST") {
          const input = route.request().postDataJSON();
          submissions.push(input);
          if (resume) expect(input).toEqual({ repository_ids: [ids[0]] });
          else {
            expect(input.repositories[0]).toMatchObject({
              repository_id: ids[0],
              code_action: "skip",
              delete_worktree: false,
              delete_branch: false,
            });
            expect(input.repositories[1]).toMatchObject({
              repository_id: ids[1],
              code_action: "local_merge",
              preflight_id: "healthy-check",
            });
          }
          batch = {
            workspace_id: FIXTURE_IDS.workspace,
            status: "completed",
            items: plans.map((plan, index) => ({
              ...plan,
              repository_name: index ? "frontend" : "backend",
              status: index ? "completed" : "skipped",
              delivered: !!index,
              cleaned: true,
            })),
          };
        }
        await route.fulfill({ json: batch, contentType: "application/json" });
      };
      await page.route(
        `**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`,
        handle,
      );
      await page.route(
        `**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch/force-resume`,
        handle,
      );
      await page.goto(
        `${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`,
      );
      await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
      await page.getByTestId("finish-workspace-action").click();
      const dialog = page.getByRole("dialog", {
        name: "Finish Workspace",
        exact: true,
      });
      await expect(dialog.getByRole("alert")).toContainText(
        "Repair the directory or Git worktree manually",
      );
      await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
      const force = dialog.getByRole("button", {
        name: "Force execute",
        exact: true,
      });
      if (!resume) {
        await expect(force).toBeDisabled();
        healthyBlocked = false;
        await dialog.getByRole("button", { name: "Recheck" }).click();
      }
      await expect(force).toBeEnabled();
      if (!resume)
        await page.screenshot({
          path: "/tmp/treefold-force-finish-warning.png",
          animations: "disabled",
        });
      await dialog.getByRole("tab", { name: /frontend/ }).click();
      await expect(force).toHaveCount(1);
      await force.click();
      const confirmation = page.getByRole("alertdialog");
      await expect(confirmation.getByRole("listitem")).toHaveText(["backend"]);
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      expect(submissions).toHaveLength(0);
      await force.click();
      if (!resume)
        await page.screenshot({
          path: "/tmp/treefold-force-finish-confirmation.png",
          animations: "disabled",
        });
      await confirmation
        .getByRole("button", { name: "Force execute", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Done", exact: true }),
      ).toBeVisible();
      expect(submissions).toHaveLength(1);
      await expect(dialog.getByRole("tab", { name: /backend/ })).toContainText(
        "Skipped",
      );
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${FIXTURE_IDS.project}$`),
      );
      harness.assertNoUnexpectedRequests();
    } finally {
      try {
        await closeUiSession(page);
      } finally {
        await harness.close();
      }
    }
  });
}

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
            target_branch: "main",
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
    await dialog
      .getByRole("combobox", { name: "Finish strategy" })
      .selectOption("keep");
    await expect(
      dialog.getByRole("checkbox", { name: "Delete local branch" }),
    ).toBeDisabled();
    await first.click();
    await expect(
      dialog.getByRole("combobox", { name: "Finish strategy" }),
    ).toHaveValue("local_merge");
    await second.click();
    await expect(
      dialog.getByRole("combobox", { name: "Finish strategy" }),
    ).toHaveValue("keep");
    blocked = false;
    await dialog.getByRole("button", { name: "Recheck", exact: true }).click();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
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
        code_action: "local_merge",
        delete_worktree: true,
        delete_branch: true,
        preflight_id: `preflight-${ids[0]}-local_merge`,
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

test("Finish offers Force delete only for structural failures and requires confirmation", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let code = "BAD_REQUEST";
  let removals = 0;
  let failRemoval = true;
  let legacyBatch: FinishBatch | null = null;
  const refreshes: string[] = [];
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "force-delete",
    });
    await page.route(
      "**/api/workspace-repositories/*/delivery-preflight",
      (route) =>
        route.fulfill({
          status: 409,
          json: { error: { code, message: "Preflight failed" } },
        }),
    );
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}/finish-batch`,
      (route) =>
        route.fulfill({ json: legacyBatch, contentType: "application/json" }),
    );
    await page.route(
      `**/api/workspaces/${FIXTURE_IDS.workspace}/force-delete`,
      async (route) => {
        expect(route.request().method()).toBe("POST");
        removals += 1;
        await route.fulfill(
          failRemoval
            ? {
                status: 409,
                json: {
                  error: {
                    code: "FORCE_DELETE_SESSION_ACTIVE",
                    message: "Stop Sessions",
                  },
                },
              }
            : { status: 204, body: "" },
        );
      },
    );
    page.on("request", (request) => {
      if (removals > 1 && request.method() === "GET")
        refreshes.push(request.url());
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
    await page.getByTestId("finish-workspace-action").click();
    const dialog = page.getByRole("dialog", {
      name: "Finish Workspace",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toHaveText("Preflight failed");
    await expect(
      dialog.getByRole("button", { name: "Force delete", exact: true }),
    ).toHaveCount(0);
    code = "WORKTREE_DIRECTORY_MISSING";
    await dialog.getByRole("button", { name: "Recheck" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Directory does not exist",
    );
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    const force = dialog.getByRole("button", {
      name: "Force delete",
      exact: true,
    });
    await force.click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeVisible();
    expect(removals).toBe(0);
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    expect(removals).toBe(0);
    // Old saved failures have no error_code; reopening must inspect actual state.
    legacyBatch = {
      workspace_id: FIXTURE_IDS.workspace,
      status: "paused",
      items: [
        {
          repository_id: FIXTURE_IDS.workspacePrimaryLocation,
          repository_name: "fixture-repository",
          preflight_id: "legacy",
          code_action: "local_merge",
          delete_worktree: true,
          delete_branch: true,
          status: "blocked",
          delivered: false,
          cleaned: false,
          error: "Legacy failure",
        },
      ],
    };
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
    await page.getByTestId("finish-workspace-action").click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Directory does not exist",
    );
    await force.click();
    await confirmation
      .getByRole("button", { name: "Force delete", exact: true })
      .click();
    await expect(confirmation.getByRole("alert")).toContainText(
      "Stop running Sessions",
    );
    expect(removals).toBe(1);
    await page.screenshot({
      path: "/tmp/treefold-force-delete-confirmation.png",
    });
    failRemoval = false;
    await confirmation
      .getByRole("button", { name: "Force delete", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${FIXTURE_IDS.project}$`),
    );
    expect(removals).toBe(2);
    await expect
      .poll(() =>
        refreshes.some((url) =>
          url.includes(`/api/projects/${FIXTURE_IDS.project}`),
        ),
      )
      .toBe(true);
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

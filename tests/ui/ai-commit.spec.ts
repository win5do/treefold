import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import {
  closeUiSession,
  createUiSession,
  openUiContextMenu,
} from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("AI Commit presets fill the command; testing does not gate saving or automatic mode", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  let outcome = "succeeded";
  const tested: string[] = [];
  let generated = 0;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "ai-commit-settings",
    });
    await page.route("**/api/ai-commit/test", (route) => {
      tested.push(route.request().postDataJSON().command);
      return route.fulfill({
        json: {
          id: "test-job",
          status: outcome,
          message: outcome === "succeeded" ? "Fix guest greeting" : null,
          error: "Model unavailable",
          elapsed_ms: 120,
        },
      });
    });
    await page.route("**/api/ai-commit/generate", (route) => {
      generated++;
      return route.fulfill({
        json: {
          id: "auto-job",
          status: "failed",
          message: null,
          error: "Unavailable",
          elapsed_ms: 10,
        },
      });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page
      .getByRole("button", { name: "Show right sidebar", exact: true })
      .click();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Commit message", exact: true }),
    ).toBeVisible();
    await page.getByTestId("open-settings").click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings.getByRole("button", { name: "Agents", exact: true }).click();
    await settings
      .getByLabel("Command preset", { exact: true })
      .selectOption("codex");
    const command = settings.getByRole("textbox", {
      name: "Generation command",
      exact: true,
    });
    await expect(command).toHaveValue(/codex exec/);
    await settings
      .getByRole("button", { name: "Test generation", exact: true })
      .click();
    await expect(settings.getByRole("status")).toContainText("Test passed");
    await expect(settings.getByLabel("Generated test message")).toHaveText(
      "Fix guest greeting",
    );
    await command.fill("my-command --custom");
    await expect(
      settings.getByLabel("Command preset", { exact: true }),
    ).toHaveValue("");
    outcome = "failed";
    await settings
      .getByRole("button", { name: "Test generation", exact: true })
      .click();
    await expect(settings.getByRole("alert")).toContainText(
      "Model unavailable",
    );
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await fetch(`${harness.apiUrl}/api/settings`)).json())
            .ai_commit.command,
      )
      .toBe("my-command --custom");
    expect(
      (await (await fetch(`${harness.apiUrl}/api/settings`)).json()).ai_commit
        .automatic,
    ).toBe(false);
    await settings
      .getByRole("switch", {
        name: "Automatically generate commit messages",
        exact: true,
      })
      .check();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await fetch(`${harness.apiUrl}/api/settings`)).json())
            .ai_commit.automatic,
      )
      .toBe(true);
    expect(tested).toHaveLength(2);
    await expect.poll(() => generated).toBe(1);
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

test("Changes generates editable drafts, preserves input on failure and cancels late results", async () => {
  const harness = await startUiHarness((fixture) => {
    fixture.settings.ai_commit.command = "fixture-agent";
  });
  let page: Page | undefined;
  const inputs: Record<string, unknown>[] = [];
  let outcome = "succeeded";
  let canceled = 0;
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "ai-commit-changes",
    });
    await page.route("**/api/ai-commit/generate", (route) => {
      inputs.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          id: `job-${inputs.length}`,
          status: outcome,
          message: outcome === "succeeded" ? "Fix staged change" : null,
          error: "No model",
          elapsed_ms: 100,
        },
      });
    });
    await page.route("**/api/ai-commit/jobs/*", (route) => {
      if (route.request().method() === "DELETE") canceled++;
      return route.fulfill({
        json: {
          id: "pending",
          status: "running",
          message: null,
          error: null,
          elapsed_ms: 0,
        },
      });
    });
    await page.goto(`${harness.baseUrl}/#/projects/${FIXTURE_IDS.project}`);
    await page
      .getByRole("button", { name: "Show right sidebar", exact: true })
      .click();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    const message = page.getByRole("textbox", {
      name: "Commit message",
      exact: true,
    });
    await expect(message).toBeVisible();
    expect(inputs).toHaveLength(0);
    await page.getByRole("button", { name: "AI Commit", exact: true }).click();
    await expect(message).toHaveValue("Fix staged change");
    expect(inputs[0].repository_kind).toBe("project");
    expect((inputs[0].source as { kind: string }).kind).toBe("staged");
    await message.fill("My handwritten message");
    outcome = "failed";
    await page.getByRole("button", { name: "AI Commit", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("No model");
    await expect(message).toHaveValue("My handwritten message");
    outcome = "running";
    await page.getByRole("button", { name: "AI Commit", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Cancel generation", exact: true }),
    ).toBeVisible();
    await message.fill("Typed while waiting");
    await expect.poll(() => canceled).toBe(1);
    await expect(message).toHaveValue("Typed while waiting");
    await page
      .getByRole("button", { name: "Go to settings", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByLabel("Generation command"),
    ).toBeVisible();
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

test("Finish generates repository drafts independently, keeps templates on timeout and does not auto-retry", async () => {
  const ids = [
    FIXTURE_IDS.workspacePrimaryLocation,
    FIXTURE_IDS.workspaceSecondaryLocation,
  ];
  const harness = await startUiHarness((fixture) => {
    fixture.processes = [];
    for (const repo of fixture.workspaceDetails[FIXTURE_IDS.workspace]
      .repositories) {
      repo.delivery_status = "active";
      repo.git_status = "ready";
      delete repo.creation_error;
      repo.checkout_path ??= "/tmp/treefold-fixture-secondary";
    }
    fixture.settings.ai_commit = { command: "fixture-agent", automatic: true };
    fixture.deliveryPreflights[ids[1]] = {
      ...fixture.deliveryPreflights[ids[0]],
      workspace_repository_id: ids[1],
      id: "second-preflight",
    };
  });
  let page: Page | undefined;
  const inputs: {
    repository_id: string;
    source: {
      kind: string;
      expected_head: string;
      expected_target_head: string;
    };
  }[] = [];
  const jobs = new Map<
    string,
    {
      id: string;
      status: string;
      message: string | null;
      error: string | null;
      elapsed_ms: number;
    }
  >();
  const canceled: string[] = [];
  try {
    page = await createUiSession({
      apiUrl: harness.apiUrl,
      sessionName: "ai-commit-finish",
    });
    await page.route("**/api/ai-commit/generate", (route) => {
      const input = route.request().postDataJSON();
      if (input.source.kind !== "delivery")
        return route.fulfill({
          json: {
            id: "background",
            status: "failed",
            message: null,
            error: "Unavailable",
            elapsed_ms: 1,
          },
        });
      inputs.push(input);
      const job = {
        id: `delivery-${inputs.length}`,
        status: "running",
        message: null,
        error: null,
        elapsed_ms: 0,
      };
      jobs.set(job.id, job);
      return route.fulfill({ json: job });
    });
    await page.route("**/api/ai-commit/jobs/*", (route) => {
      const id = route.request().url().split("/").at(-1)!;
      if (route.request().method() === "DELETE") canceled.push(id);
      return route.fulfill({ json: jobs.get(id) });
    });
    await page.goto(`${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`);
    await openUiContextMenu(page, page.getByTestId("sidebar-workspace-node"));
    await page.getByTestId("finish-workspace-action").click();
    const dialog = page.getByRole("dialog", {
      name: "Deliver Workspace",
      exact: true,
    });
    await dialog
      .getByRole("checkbox", { name: "Squash into one commit", exact: true })
      .check();
    const messages = dialog.getByRole("region", {
      name: "Squash commit messages",
    });
    await expect.poll(() => inputs.length).toBe(2);
    expect(inputs.map((input) => input.repository_id).sort()).toEqual(
      [...ids].sort(),
    );
    for (const input of inputs) {
      expect(input.source.kind).toBe("delivery");
      expect(input.source.expected_head).toBeTruthy();
      expect(input.source.expected_target_head).toBeTruthy();
    }
    await expect(
      messages.getByRole("button", { name: "Cancel generation", exact: true }),
    ).toHaveCount(2);
    await expect(dialog.getByTestId("finish-confirm-action")).toBeDisabled();
    const primaryJob = `delivery-${inputs.findIndex((input) => input.repository_id === ids[0]) + 1}`;
    const secondaryJob = `delivery-${inputs.findIndex((input) => input.repository_id === ids[1]) + 1}`;
    // Complete out of order; one failure must not replace the other repository's draft.
    jobs.set(secondaryJob, {
      ...jobs.get(secondaryJob)!,
      status: "succeeded",
      message: "Update API contract",
    });
    await expect(
      messages.getByLabel("fixture-api-repository", { exact: true }),
    ).toHaveValue("Update API contract");
    jobs.set(primaryJob, { ...jobs.get(primaryJob)!, status: "timed_out" });
    await expect(messages.getByRole("alert")).toContainText("timed out");
    await expect(
      messages.getByLabel("fixture-repository", { exact: true }),
    ).toHaveValue(/^Squash /);
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
    await messages.getByRole("button", { name: "AI Commit settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("textbox", { name: "Generation command", exact: true }).fill("unsaved-example");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(messages.getByLabel("fixture-api-repository", { exact: true })).toHaveValue("Update API contract");
    await dialog.getByRole("button", { name: "Recheck", exact: true }).click();
    await expect(dialog.getByTestId("finish-confirm-action")).toBeEnabled();
    expect(inputs).toHaveLength(2);
    await messages
      .getByRole("button", { name: "AI Commit", exact: true })
      .first()
      .click();
    await expect.poll(() => inputs.length).toBe(3);
    await messages
      .getByRole("button", { name: "Cancel generation", exact: true })
      .click();
    await expect.poll(() => canceled).toContain("delivery-3");
    await expect(
      messages.getByLabel("fixture-api-repository", { exact: true }),
    ).toHaveValue("Update API contract");
    // Closing the editor must cancel even while creation/polling is in progress.
    await messages
      .getByRole("button", { name: "AI Commit", exact: true })
      .first()
      .click();
    await expect.poll(() => inputs.length).toBe(4);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => canceled).toContain("delivery-4");
    harness.assertNoUnexpectedRequests();
  } finally {
    try {
      await closeUiSession(page);
    } finally {
      await harness.close();
    }
  }
});

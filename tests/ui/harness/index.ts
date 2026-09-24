import { createFinishRoutes } from "./routes/finish.ts";
import { createKeymapRoutes } from "./routes/keymap.ts";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppSettings, BackgroundProcess, GitBranches, GitSyncItemResult, Session, WorktreeDeleteOperation, WorktreeDeletePrecheck, WorkspaceRepository } from "../../../src/renderer/src/domain/types.ts";
import type { FixtureDirectory, FixtureProject, FixtureRepository, FixtureSession, FixtureWorkspace } from "../fixtures/types.ts";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  createSidebarCoreFixture,
  FIXTURE_IDS,
} from "../fixtures/sidebar-core.ts";
import { createGitDiffRoutes } from "./routes/git-diff.ts";
import { createParentOperationRoutes } from "./routes/parent-operations.ts";
import { createTodoRoutes } from "./routes/todos.ts";
import { createAgentIntegrationRoutes } from "./routes/agent-integration.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startFixtureApi() {
  const fixture = createSidebarCoreFixture();
  const eventStreams = new Set<ServerResponse>();
  let runtimeInstanceId = "runtime-ui-fixture-1";
  let runtimeRevision = 0;
  const publishRuntimeChange = (domains: string[]) => {
    runtimeRevision += 1;
    const payload = JSON.stringify({ instance_id: runtimeInstanceId, revision: runtimeRevision, domains });
    for (const response of eventStreams) {
      response.write(`event: runtime.changed\ndata: ${payload}\n\n`);
    }
  };
  const unexpectedRequests: string[] = [];
  const syncRequests: string[] = [];
  let nextBulkSyncResults: GitSyncItemResult[] | null = null;
  const workspaceLocationUpdates: (Partial<WorkspaceRepository> & { id: string })[] = [];
  const locationRequests: { projectId: string; path: string; isGit: boolean }[] = [];
  const logsRevealRequests: string[] = [];
  let nextLocationError: { status: number; code: string; message: string } | null = null;
  const repositoryUpdateRequests: (Partial<FixtureRepository> & { id: string })[] = [];
  const renameRequests: { kind: string; id: string; name?: string; description?: string }[] = [];
  const sessionOrderRequests: { workspaceId: string; session_ids: string[] }[] = [];
  const deleteRequests: { kind: string; id?: string; path?: string; cleanupManaged?: boolean }[] = [];
  let worktreeDeletePrecheck: WorktreeDeletePrecheck = {
    status: "ready",
    directory_exists: true,
    tracked_changes: 0,
    untracked_files: 0,
    blockers: [],
    warnings: [],
  };
  let worktreeDeleteOperation: WorktreeDeleteOperation | null = null;
  let worktreeDeletePolls = 0;
  const amuxStopRequests: string[] = [];
  const repositoryBranches = new Map<string, GitBranches>();
  const finishRoutes = createFinishRoutes({ fixture, readJson, sendJson });
  const gitDiffRoutes = createGitDiffRoutes({ fixture, readJson, sendJson });
  const parentOperationRoutes = createParentOperationRoutes({
    fixture,
    readJson,
    sendJson,
  });
  const keymapRoutes = createKeymapRoutes({ readJson, sendJson });
  const todoRoutes = createTodoRoutes({ fixture, readJson, sendJson });
  const agentIntegrationRoutes = createAgentIntegrationRoutes({ fixture, sendJson });
  let slowWorkspaceRefreshesRemaining = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, null);
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://fixture.test");
    const pathname = requestUrl.pathname;
    if (await finishRoutes.handle(request, response, pathname)) return;
    if (await gitDiffRoutes.handle(request, response, pathname)) return;
    if (await parentOperationRoutes.handle(request, response, pathname)) return;
    if (await keymapRoutes.handle(request, response, pathname)) return;
    if (await todoRoutes.handle(request, response, pathname)) return;
    if (await agentIntegrationRoutes.handle(request, response, pathname)) return;
    if (request.method === "GET" && pathname === "/api/system") {
      sendJson(response, 200, fixture.system);
      return;
    }
    if (request.method === "POST" && pathname === "/api/system/logs/reveal") {
      logsRevealRequests.push(pathname);
      sendJson(response, 204, null);
      return;
    }
    if (request.method === "GET" && pathname === "/api/settings") {
      sendJson(response, 200, fixture.settings);
      return;
    }
    if (request.method === "GET" && pathname === "/api/amux") {
      sendJson(response, 200, fixture.amux);
      return;
    }
    if (request.method === "GET" && pathname === "/api/processes") {
      sendJson(response, 200, fixture.processes);
      return;
    }
    if (request.method === "GET" && pathname === "/api/events/revision") {
      sendJson(response, 200, { instance_id: runtimeInstanceId, revision: runtimeRevision });
      return;
    }
    if (request.method === "GET" && pathname === "/api/events") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
      });
      response.write(`event: runtime.sync\ndata: ${JSON.stringify({ instance_id: runtimeInstanceId, revision: runtimeRevision })}\n\n`);
      eventStreams.add(response);
      request.on("close", () => eventStreams.delete(response));
      return;
    }
    if (request.method === "POST" && pathname === "/api/amux/stop") {
      amuxStopRequests.push(pathname);
      fixture.amux.running = false;
      fixture.amux.started_at = undefined;
      fixture.amux.active_groups = 0;
      fixture.amux.active_processes = 0;
      for (const detail of Object.values(fixture.workspaceDetails)) {
        for (const session of detail.sessions) {
          if (session.status === "running") session.status = "stopped";
        }
      }
      sendJson(response, 204, null);
      publishRuntimeChange(["sidebar", "sessions", "processes", "amux"]);
      return;
    }
    if (request.method === "PATCH" && pathname === "/api/settings") {
      const input = await readJson<Partial<AppSettings> & { reset?: string[] }>(request);
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      const allowed = new Set([
        "reset",
        "language",
        "theme",
        "agents",
        "amux",
      ]);
      if (Object.keys(input).some((key) => !allowed.has(key))) {
        sendJson(response, 400, { error: "Unknown settings field" });
        return;
      }
      for (const key of input.reset ?? []) {
        if (key === "language") fixture.settings.language = "system";
        if (key === "theme") fixture.settings.theme = "system";
        if (key === "agents.codex.extra_args") fixture.settings.agents.codex.extra_args = [];
        if (key === "amux.keep_daemon_running_on_exit") fixture.settings.amux.keep_daemon_running_on_exit = false;
      }
      if (input.language !== undefined)
        fixture.settings.language = input.language;
      if (input.theme !== undefined) fixture.settings.theme = input.theme;
      if (input.agents?.codex?.extra_args !== undefined) {
        fixture.settings.agents.codex.extra_args = [
          ...input.agents.codex.extra_args,
        ];
      }
      if (input.amux?.keep_daemon_running_on_exit !== undefined) {
        fixture.settings.amux.keep_daemon_running_on_exit =
          input.amux.keep_daemon_running_on_exit;
      }
      sendJson(response, 200, fixture.settings);
      return;
    }
    if (request.method === "GET" && pathname === "/api/projects/summary") {
      sendJson(
        response,
        200,
        fixture.projects.map((project) => {
          const detail = fixture.projectDetails[project.id];
          const locations = detail?.directories ?? [];
          return {
            id: project.id,
            name: project.name,
            description: project.description,
            status: project.status,
            location_count: locations.length,
            git_location_count: locations.filter(
              (location) => location.repository_id != null,
            ).length,
            context_location_count: locations.filter(
              (location) => location.repository_id == null,
            ).length,
            missing_location_count: locations.filter(
              (location) => location.git_status === "missing",
            ).length,
            abnormal_location_count: locations.filter(
              (location) =>
                !["ready", "not_git", "missing"].includes(location.git_status),
            ).length,
            active_workspace_count: (detail?.workspaces ?? []).filter(
              (workspace) =>
                workspace.kind === "workspace" && workspace.status === "active",
            ).length,
            updated_at: project.updated_at,
          };
        }),
      );
      return;
    }
    if (request.method === "GET" && pathname === "/api/sidebar") {
      sendJson(response, 200, {
        projects: fixture.projects
          .filter((project) => project.status === "active")
          .map((project) => {
            const detail = fixture.projectDetails[project.id];
            return {
              ...project,
              repositories: detail.repositories,
              directories: detail.directories,
              sessions: detail.sessions.filter(
                (session) => session.visibility === "visible",
              ),
              workspaces: detail.workspaces
                .filter(
                  (workspace) =>
                    workspace.kind !== "base" && workspace.status === "active",
                )
                .map((workspace) => ({
                  ...workspace,
                  sessions: (
                    fixture.workspaceDetails[workspace.id]?.sessions ?? []
                  ).filter((session) => session.visibility === "visible"),
                  repositories:
                    fixture.workspaceDetails[workspace.id]?.repositories ?? [],
                  directories:
                    fixture.workspaceDetails[workspace.id]
                      ?.workspace_directories ?? [],
                })),
            };
          }),
      });
      return;
    }
    if (request.method === "GET" && pathname === "/api/projects") {
      sendJson(response, 200, fixture.projects);
      return;
    }

    const worktreePrecheckMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/worktrees\/delete-precheck$/,
    );
    if (request.method === "POST" && worktreePrecheckMatch) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      sendJson(response, 200, worktreeDeletePrecheck);
      return;
    }

    const worktreeDeleteMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/worktrees$/,
    );
    const worktreeDeleteStatusMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/worktrees\/delete-status$/,
    );
    if (request.method === "GET" && worktreeDeleteStatusMatch) {
      if (!worktreeDeleteOperation) {
        sendJson(response, 404, { error: "Worktree deletion not found" });
        return;
      }
      worktreeDeletePolls += 1;
      if (worktreeDeletePolls >= 2) {
        worktreeDeleteOperation.status = "completed";
        for (const detail of Object.values(fixture.projectDetails)) {
          detail.worktrees = detail.worktrees.filter(
            (item) => item.path !== worktreeDeleteOperation!.path,
          );
        }
      }
      sendJson(response, 200, worktreeDeleteOperation);
      return;
    }
    if (request.method === "DELETE" && worktreeDeleteMatch) {
      const input = await readJson<{ path: string }>(request);
      worktreeDeleteOperation = {
        id: "worktree-delete-operation",
        repository_id: worktreeDeleteMatch[1],
        path: input.path,
        status: "deleting",
      };
      worktreeDeletePolls = 0;
      deleteRequests.push({ kind: "worktree", path: input.path });
      sendJson(response, 202, worktreeDeleteOperation);
      return;
    }
    if (request.method === "POST" && pathname === "/api/projects") {
      const input = await readJson<{ name: string; description?: string; locations?: string[] }>(request);
      const created: FixtureProject = {
        id: "project-created-primary-requirement",
        name: input.name,
        description: input.description ?? "",
        status: "active",
        created_at: "2026-08-09T08:30:00.000Z",
        updated_at: "2026-08-09T08:30:00.000Z",
      };
      const locations: FixtureDirectory[] = [];
      fixture.projects.push(created);
      fixture.projectDetails[created.id] = {
        ...created,
        locations,
        directories: locations,
        repositories: [],
        sessions: [],
        workspaces: [],
        worktrees: [],
      };
      for (const [index, locationPath] of (input.locations ?? []).entries()) {
        const isGit = !/docs|documentation|reference|context/i.test(locationPath);
        const name = locationPath.split("/").at(-1) || locationPath;
        const directory: FixtureDirectory = {
          id: `created-location-${index}`, project_id: created.id, name,
          description: "", worktree_setup_command: "", path: locationPath,
          git_status: isGit ? "ready" : "not_git", role: index === 0 ? "primary" : "attached",
          is_git: isGit, dirty: false, created_at: created.created_at,
        };
        if (isGit) {
          const repository: FixtureRepository = {
            id: `created-repository-${index}`, project_id: created.id, name,
            source_root: locationPath, git_common_dir: `${locationPath}/.git`,
            setup_command: "", setup_workdir: ".", git_status: "ready",
            created_at: created.created_at, updated_at: created.updated_at,
          };
          fixture.projectDetails[created.id].repositories.push(repository);
          directory.repository_id = repository.id;
          directory.relative_path = ".";
          if (!created.default_location_id) created.default_location_id = directory.id;
        } else directory.external_path = locationPath;
        fixture.projectDetails[created.id].directories.push(directory);
        locationRequests.push({ projectId: created.id, path: locationPath, isGit });
      }
      fixture.projectDetails[created.id].default_location_id = created.default_location_id;
      sendJson(response, 201, created);
      return;
    }

    if (request.method === "POST" && pathname === "/api/projects/inspect-path") {
      const input = await readJson<{ path: string }>(request);
      const cleanPath = input.path.replace(/\/+$/, "");
      if (cleanPath.endsWith("/additional-locations")) {
        sendJson(response, 200, { path: cleanPath, candidates: ["new-api-repository", "reference-context", "unused-repository"].map((name) => ({
          path: `/tmp/treefold-ui-fixture/${name}`, repository_root: name.includes("context") ? null : `/tmp/treefold-ui-fixture/${name}`, is_git: !name.includes("context"),
        })) });
        return;
      }
      const candidates = cleanPath.endsWith("/multi-repo")
        ? ["backend", "docs", "frontend"].map((name) => ({
            path: `${cleanPath}/${name}`,
            repository_root: name === "docs" ? null : `${cleanPath}/${name}`,
            is_git: name !== "docs",
          }))
        : [{ path: cleanPath, repository_root: cleanPath, is_git: true }];
      sendJson(response, 200, { path: cleanPath, candidates });
      return;
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    const projectDeletePrecheckMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/delete-precheck$/,
    );
    if (
      request.method === "GET" &&
      projectDeletePrecheckMatch &&
      fixture.projectDetails[projectDeletePrecheckMatch[1]]
    ) {
      sendJson(response, 200, {
        status: "ready",
        managed_sources: [
          {
            path: "/tmp/treefold/git/s/project/repository",
            repository_name: "Repository",
            project_repository_id: FIXTURE_IDS.primaryRepository,
          },
        ],
        managed_worktrees: [
          {
            path: "/tmp/treefold/git/w/workspace/repository",
            repository_name: "Repository",
            project_repository_id: FIXTURE_IDS.primaryRepository,
          },
        ],
        blockers: [],
        warnings: [],
      });
      return;
    }
    if (
      request.method === "GET" &&
      projectMatch &&
      fixture.projectDetails[projectMatch[1]]
    ) {
      sendJson(response, 200, fixture.projectDetails[projectMatch[1]]);
      return;
    }

    if (
      request.method === "POST" &&
      pathname === "/api/project-directories/inspect"
    ) {
      const input = await readJson<{ path?: string }>(request);
      const cleanPath = String(input.path ?? "").replace(/\/+$/, "");
      const name = cleanPath.split("/").filter(Boolean).at(-1) || cleanPath;
      const isGit = !/docs|documentation|reference|context/i.test(cleanPath);
      sendJson(response, 200, {
        path: cleanPath,
        name,
        directory_type: isGit ? "git_scope" : "external",
        git_status: isGit ? "ready" : "not_git",
        source_root: isGit ? cleanPath : undefined,
        git_common_dir: isGit ? `${cleanPath}/.git` : undefined,
        relative_path: isGit ? "." : undefined,
        repository_url: isGit ? `https://example.test/${name}.git` : undefined,
        preferred_remote_name: isGit ? "origin" : undefined,
      });
      return;
    }

    const projectLocationsMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/directories$/,
    );
    if (
      request.method === "POST" &&
      projectLocationsMatch &&
      fixture.projectDetails[projectLocationsMatch[1]]
    ) {
      if (nextLocationError) {
        const error = nextLocationError;
        nextLocationError = null;
        sendJson(response, error.status, {
          error: { code: error.code, message: error.message },
        });
        return;
      }
      const input = await readJson<{ path?: string; description?: string; worktree_setup_command?: string }>(request);
      const cleanPath = String(input.path ?? "").replace(/\/+$/, "");
      const name = cleanPath.split("/").filter(Boolean).at(-1) || cleanPath;
      const isGit = !/docs|documentation|reference|context/i.test(cleanPath);
      const detail = fixture.projectDetails[projectLocationsMatch[1]];
      if (!detail.default_location_id && !isGit) {
        sendJson(response, 400, {
          error: {
            code: "BAD_REQUEST",
            message:
              "a Project's first location must be a ready Git repository",
          },
        });
        return;
      }
      const location: FixtureDirectory = {
        id: `location-added-${detail.directories.length}`,
        project_id: projectLocationsMatch[1],
        name,
        description: input.description ?? "",
        worktree_setup_command: input.worktree_setup_command ?? "",
        path: cleanPath,
        repository_url: isGit ? `https://example.test/${name}.git` : undefined,
        preferred_remote_name: isGit ? "origin" : undefined,
        git_common_dir: isGit ? `${cleanPath}/.git` : undefined,
        git_status: isGit ? "ready" : "not_git",
        role: !detail.default_location_id && isGit ? "primary" : "attached",
        is_git: isGit,
        dirty: false,
        created_at: "2026-08-10T08:20:00.000Z",
      };
      if (isGit) {
        const repository: FixtureRepository = {
          id: `repository-added-${detail.repositories.length}`,
          project_id: projectLocationsMatch[1],
          name,
          source_root: cleanPath,
          git_common_dir: `${cleanPath}/.git`,
          repository_url: `https://example.test/${name}.git`,
          preferred_remote_name: "origin",
          setup_command: input.worktree_setup_command ?? "",
          setup_workdir: ".",
          git_status: "ready",
          created_at: location.created_at!,
          updated_at: location.created_at!,
        };
        detail.repositories.push(repository);
        location.repository_id = repository.id;
        location.relative_path = ".";
      } else {
        location.external_path = cleanPath;
      }
      detail.directories.push(location);
      locationRequests.push({
        projectId: projectLocationsMatch[1],
        path: cleanPath,
        isGit,
      });
      if (!detail.default_location_id && isGit) {
        detail.default_location_id = location.id;
        const project = fixture.projects.find(
          (item) => item.id === projectLocationsMatch[1],
        );
        assert.ok(project);
        project.default_location_id = location.id;
      }
      sendJson(response, 201, location);
      return;
    }
    if (
      request.method === "PATCH" &&
      projectMatch &&
      fixture.projectDetails[projectMatch[1]]
    ) {
      const input = await readJson<Partial<FixtureProject>>(request);
      if (
        input.status !== undefined &&
        input.status !== "active" &&
        input.status !== "archived"
      ) {
        sendJson(response, 400, {
          error: "Project status must be active or archived",
        });
        return;
      }
      const project = fixture.projects.find(
        (item) => item.id === projectMatch[1],
      );
      assert.ok(project);
      if (
        input.status === "archived" &&
        fixture.projectDetails[projectMatch[1]].workspaces.some(
          (item) => item.kind !== "base" && item.status === "active",
        )
      ) {
        sendJson(response, 400, {
          error: {
            code: "BAD_REQUEST",
            message:
              "Finish active Workspaces and Forks before archiving this Project",
          },
        });
        return;
      }
      if (input.name !== undefined) {
        project.name = input.name;
        fixture.projectDetails[projectMatch[1]].name = input.name;
      }
      if (input.description !== undefined) {
        project.description = input.description;
        fixture.projectDetails[projectMatch[1]].description = input.description;
      }
      if (input.name !== undefined || input.description !== undefined)
        renameRequests.push({ kind: "project", id: projectMatch[1], ...input });
      if (input.status !== undefined) project.status = input.status;
      if (input.status !== undefined)
        fixture.projectDetails[projectMatch[1]].status = input.status;
      if (input.default_directory_id !== undefined) {
        project.default_directory_id = input.default_directory_id;
        project.default_location_id = input.default_directory_id;
        fixture.projectDetails[projectMatch[1]].default_directory_id =
          input.default_directory_id;
        fixture.projectDetails[projectMatch[1]].default_location_id =
          input.default_directory_id;
      }
      if (input.status === "archived") {
        const projectSessions =
          fixture.projectDetails[projectMatch[1]].sessions;
        fixture.projectDetails[projectMatch[1]].sessions =
          projectSessions.filter((session) => session.kind !== "shell");
        fixture.projectDetails[projectMatch[1]].sessions.forEach((session) => {
          session.status = "stopped";
        });
        Object.values(fixture.workspaceDetails)
          .filter((detail) => detail.project_id === projectMatch[1])
          .forEach((detail) => {
            detail.sessions = detail.sessions.filter(
              (session) => session.kind !== "shell",
            );
            detail.sessions.forEach((session) => {
              session.status = "stopped";
            });
          });
      }
      sendJson(response, 200, project);
      return;
    }
    if (
      request.method === "DELETE" &&
      projectMatch &&
      fixture.projectDetails[projectMatch[1]]
    ) {
      const project = fixture.projects.find(
        (item) => item.id === projectMatch[1],
      );
      assert.ok(project);
      if (project.status !== "archived") {
        sendJson(response, 400, {
          error: "Archive the Project before permanently deleting it",
        });
        return;
      }
      deleteRequests.push({
        kind: "project",
        id: projectMatch[1],
        cleanupManaged:
          requestUrl.searchParams.get("cleanup_managed") === "true",
      });
      fixture.projects = fixture.projects.filter(
        (item) => item.id !== projectMatch[1],
      );
      delete fixture.projectDetails[projectMatch[1]];
      sendJson(response, 204, null);
      return;
    }

    const projectRepositoryMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)$/,
    );
    if (request.method === "PATCH" && projectRepositoryMatch) {
      const input = await readJson<Partial<FixtureRepository>>(request);
      const repository = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.repositories)
        .find((item) => item.id === projectRepositoryMatch[1]);
      if (!repository) {
        sendJson(response, 404, { error: "Repository not found" });
        return;
      }
      Object.assign(repository, {
        setup_command: input.setup_command ?? repository.setup_command,
        setup_workdir: input.setup_workdir ?? repository.setup_workdir,
        preferred_remote_name: input.preferred_remote_name ?? repository.preferred_remote_name,
      });
      repositoryUpdateRequests.push({ id: repository.id, ...input });
      sendJson(response, 200, repository);
      return;
    }

    const projectHistoryMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/git-history$/,
    );
    if (
      request.method === "GET" &&
      projectHistoryMatch &&
      fixture.gitHistories[projectHistoryMatch[1]]
    ) {
      sendJson(response, 200, fixture.gitHistories[projectHistoryMatch[1]]);
      return;
    }

    const projectSessionsMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/sessions$/,
    );
    if (
      projectSessionsMatch &&
      fixture.projectDetails[projectSessionsMatch[1]]
    ) {
      const detail = fixture.projectDetails[projectSessionsMatch[1]];
      if (request.method === "GET") {
        sendJson(response, 200, detail.sessions);
        return;
      }
      if (request.method === "POST") {
        const input = await readJson<{ kind?: Session["kind"]; project_directory_id?: string }>(request);
        const kind = input.kind || "shell";
        if (
          kind === "codex" &&
          Object.keys(input).some(
            (field) => !["kind", "project_directory_id"].includes(field),
          )
        ) {
          sendJson(response, 400, {
            error: "Codex creation must use backend defaults",
          });
          return;
        }
        const directory =
          detail.directories.find(
            (item) => item.id === input.project_directory_id,
          ) ?? detail.directories[0];
        const created: FixtureSession = {
          ...detail.sessions[0],
          id:
            kind === "codex"
              ? "session-created-project-codex-ui-fixture"
              : "session-created-project-shell-ui-fixture",
          workspace_id: `project-base-${detail.id}`,
          amux_workspace_name: `treefold-project-base-${detail.id}`,
          amux_process_name:
            kind === "codex"
              ? "session-created-project-codex-ui-fixture"
              : "session-created-project-shell-ui-fixture",
          name: kind === "shell" ? `shell · ${directory.name}` : "codex",
          kind,
          cwd: directory.path,
          original_cwd: directory.path,
          initial_prompt: "",
          codex_session_id:
            kind === "codex" ? "codex-created-project-ui-fixture" : undefined,
          visibility: "visible",
          status: "running",
          argv: kind === "codex" ? ["codex"] : ["/bin/zsh", "-l"],
          io_mode: "tty",
          created_at: "2026-08-10T08:12:00.000Z",
          updated_at: "2026-08-10T08:12:00.000Z",
        };
        detail.sessions.push(created);
        sendJson(response, 201, created);
        return;
      }
    }

    const projectLocationSyncMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/git\/(pull|push)$/,
    );
    if (request.method === "POST" && projectLocationSyncMatch) {
      syncRequests.push(pathname);
      sendJson(response, 200, {
        scope: "project_repository",
        action: projectLocationSyncMatch[2],
        branch: "main",
        remote: "origin",
        remote_branch: "main",
        status: "up_to_date",
        message: "up to date",
      });
      return;
    }

    const workspaceLocationSyncMatch = pathname.match(
      /^\/api\/workspace-repositories\/([^/]+)\/git\/(pull|push)$/,
    );
    if (request.method === "POST" && workspaceLocationSyncMatch) {
      syncRequests.push(pathname);
      sendJson(response, 200, {
        scope: "workspace_repository",
        action: workspaceLocationSyncMatch[2],
        branch: "treefold/w-ui-fixture",
        remote: "origin",
        remote_branch: "feature/ui-fixture",
        status: "up_to_date",
        message: "up to date",
      });
      return;
    }

    const workspaceLocationMatch = pathname.match(
      /^\/api\/workspace-repositories\/([^/]+)$/,
    );
    if (request.method === "PATCH" && workspaceLocationMatch) {
      const input = await readJson<Partial<WorkspaceRepository>>(request);
      const location = Object.values(fixture.workspaceDetails)
        .flatMap((detail) => detail.repositories)
        .find((item) => item.id === workspaceLocationMatch[1]);
      if (!location)
        return sendJson(response, 404, {
          error: "Workspace Repository not found",
        });
      location.remote_name = input.remote_name || undefined;
      location.remote_branch = input.remote_branch || undefined;
      workspaceLocationUpdates.push({
        id: location.id,
        remote_name: location.remote_name,
        remote_branch: location.remote_branch,
      });
      sendJson(response, 200, location);
      return;
    }

    const syncMatch = pathname.match(
      /^\/api\/(projects|workspaces)\/([^/]+)\/git\/(pull|push)(-all)?$/,
    );
    if (request.method === "POST" && syncMatch) {
      syncRequests.push(pathname);
      if (nextBulkSyncResults) {
        const results = nextBulkSyncResults;
        nextBulkSyncResults = null;
        sendJson(response, 200, results);
        return;
      }
      sendJson(response, 200, [
        {
          project_repository_id:
            fixture.projectDetails[FIXTURE_IDS.project].default_location_id,
          repository_name: "fixture-repository",
          status: "success",
          result: {
            scope:
              syncMatch[1] === "projects"
                ? "project_repository"
                : "workspace_repository",
            action: syncMatch[3],
            branch: "main",
            remote: "origin",
            remote_branch: "main",
            status: "up_to_date",
            message: "up to date",
          },
        },
      ]);
      return;
    }

    const locationRefreshMatch = pathname.match(
      /^\/api\/project-directories\/([^/]+)\/refresh$/,
    );
    if (request.method === "POST" && locationRefreshMatch) {
      const location = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.directories)
        .find((item) => item.id === locationRefreshMatch[1]);
      if (!location)
        return sendJson(response, 404, { error: "Location not found" });
      sendJson(response, 200, location);
      return;
    }

    const revealMatch = pathname.match(
      /^\/api\/(projects|workspaces)\/([^/]+)\/reveal$/,
    );
    if (request.method === "POST" && revealMatch) {
      sendJson(response, 200, { revealed: true });
      return;
    }

    const directoryMatch = pathname.match(
      /^\/api\/project-directories\/([^/]+)$/,
    );
    if (request.method === "PATCH" && directoryMatch) {
      const input = await readJson<Partial<FixtureDirectory>>(request);
      const directory = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.directories)
        .find((item) => item.id === directoryMatch[1]);
      if (!directory) {
        sendJson(response, 404, { error: "Directory not found" });
        return;
      }
      if (input.name) directory.name = input.name;
      directory.description = input.description ?? "";
      directory.worktree_setup_command = input.worktree_setup_command ?? "";
      if (directory.repository_id) {
        Object.values(fixture.projectDetails)
          .flatMap((detail) => detail.repositories ?? [])
          .filter((repository) => repository.id === directory.repository_id)
          .forEach((repository) => {
            repository.setup_command = directory.worktree_setup_command;
          });
      }
      Object.values(fixture.workspaceDetails).forEach((detail) => {
        const item = detail.directories.find(
          (candidate) => candidate.id === directory.id,
        );
        if (item)
          Object.assign(
            item,
            directory,
            item.checkout_path ? { checkout_path: item.checkout_path } : {},
          );
      });
      sendJson(response, 200, directory);
      return;
    }

    const branchesMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/branches$/,
    );
    if (request.method === "GET" && branchesMatch) {
      const repository = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.repositories ?? [])
        .find((item) => item.id === branchesMatch[1]);
      if (!repository)
        return sendJson(response, 404, { error: "Repository not found" });
      const state = repositoryBranches.get(repository.id) ?? {
        current: "main",
        local: ["main", "release/ui-fixture"],
        remotes: [{ name: "origin", branches: ["main", "feature/ui-fixture"] }],
      };
      repositoryBranches.set(repository.id, state);
      sendJson(response, 200, state);
      return;
    }

    const checkoutMatch = pathname.match(
      /^\/api\/project-repositories\/([^/]+)\/checkout$/,
    );
    if (request.method === "POST" && checkoutMatch) {
      const input = await readJson<{ branch: string }>(request);
      const detail = Object.values(fixture.projectDetails).find((candidate) =>
        (candidate.repositories ?? []).some(
          (repository) => repository.id === checkoutMatch[1],
        ),
      );
      if (!detail)
        return sendJson(response, 404, { error: "Repository not found" });
      const directories = detail.directories.filter(
        (directory) => directory.repository_id === checkoutMatch[1],
      );
      directories.forEach((directory) => {
        directory.branch = input.branch;
      });
      const state = repositoryBranches.get(checkoutMatch[1]);
      if (state) {
        state.current = input.branch;
        if (!state.local.includes(input.branch)) state.local.push(input.branch);
      }
      sendJson(response, 200, directories[0]);
      return;
    }

    if (request.method === "DELETE" && branchesMatch) {
      const input = await readJson<{ kind: string; branch: string; remote?: string }>(request);
      const state = repositoryBranches.get(branchesMatch[1]);
      if (!state)
        return sendJson(response, 404, { error: "Repository not found" });
      if (input.kind === "local") {
        state.local = state.local.filter((branch) => branch !== input.branch);
      } else {
        const remote = state.remotes.find((item) => item.name === input.remote);
        if (remote)
          remote.branches = remote.branches.filter(
            (branch) => branch !== input.branch,
          );
      }
      sendJson(response, 200, state);
      return;
    }

    const workspaceMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (
      request.method === "GET" &&
      workspaceMatch &&
      fixture.workspaceDetails[workspaceMatch[1]]
    ) {
      if (slowWorkspaceRefreshesRemaining > 0) {
        slowWorkspaceRefreshesRemaining -= 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
      }
      sendJson(response, 200, fixture.workspaceDetails[workspaceMatch[1]]);
      return;
    }
    if (
      request.method === "PATCH" &&
      workspaceMatch &&
      fixture.workspaceDetails[workspaceMatch[1]]
    ) {
      const input = await readJson<Partial<FixtureWorkspace>>(request);
      Object.assign(fixture.workspaceDetails[workspaceMatch[1]], input);
      const projectDetail = Object.values(fixture.projectDetails).find(
        (detail) =>
          detail.workspaces.some((item) => item.id === workspaceMatch[1]),
      );
      const summary = projectDetail?.workspaces.find(
        (item) => item.id === workspaceMatch[1],
      );
      if (summary) Object.assign(summary, input);
      renameRequests.push({
        kind: fixture.workspaceDetails[workspaceMatch[1]].kind,
        id: workspaceMatch[1],
        ...input,
      });
      sendJson(response, 200, fixture.workspaceDetails[workspaceMatch[1]]);
      return;
    }
    if (request.method === "DELETE" && workspaceMatch) {
      const summary = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.workspaces)
        .find((item) => item.id === workspaceMatch[1]);
      if (!summary)
        return sendJson(response, 404, { error: "Workspace not found" });
      if (summary.status !== "archived")
        return sendJson(response, 400, {
          error: "Finish the Workspace or Fork before permanently deleting it",
        });
      const children = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.workspaces)
        .filter((item) => item.parent_workspace_id === summary.id);
      if (children.length > 0)
        return sendJson(response, 400, {
          error: "Delete this Workspace's Forks before deleting the Workspace",
        });
      for (const detail of Object.values(fixture.projectDetails))
        detail.workspaces = detail.workspaces.filter(
          (item) => item.id !== summary.id,
        );
      for (const detail of Object.values(fixture.workspaceDetails))
        detail.forks = detail.forks.filter((item) => item.id !== summary.id);
      delete fixture.workspaceDetails[summary.id];
      deleteRequests.push({ kind: summary.kind, id: summary.id });
      sendJson(response, 204, null);
      return;
    }

    const workspaceSessionsMatch = pathname.match(
      /^\/api\/workspaces\/([^/]+)\/sessions$/,
    );
    if (
      workspaceSessionsMatch &&
      fixture.workspaceDetails[workspaceSessionsMatch[1]]
    ) {
      const detail = fixture.workspaceDetails[workspaceSessionsMatch[1]];
      if (request.method === "GET") {
        sendJson(response, 200, detail.sessions);
        return;
      }
      if (request.method === "POST") {
        const input = await readJson<{ kind?: Session["kind"]; project_directory_id?: string; name?: string }>(request);
        const kind = input.kind || "shell";
        if (
          kind === "codex" &&
          Object.keys(input).some(
            (field) => !["kind", "project_directory_id"].includes(field),
          )
        ) {
          sendJson(response, 400, {
            error: "Codex creation must use backend defaults",
          });
          return;
        }
        const createdId = `session-created-${kind}-ui-fixture`;
        const created: FixtureSession = {
          ...detail.sessions[0],
          id: createdId,
          workspace_id: detail.id,
          amux_workspace_name: `treefold-${detail.id}`,
          amux_process_name: createdId,
          name: kind,
          kind,
          cwd: input.project_directory_id
            ? detail.directories.find(
                (directory) => directory.id === input.project_directory_id,
              )?.checkout_path || detail.checkout_path
            : detail.checkout_path,
          original_cwd: detail.checkout_path,
          initial_prompt: "",
          codex_session_id: undefined,
          status: "running",
          visibility: "visible",
          argv: kind === "codex" ? ["codex"] : ["/bin/zsh", "-l"],
          io_mode: "tty",
          created_at: "2026-08-10T08:10:00.000Z",
          updated_at: "2026-08-10T08:10:00.000Z",
        };
        detail.sessions.push(created);
        slowWorkspaceRefreshesRemaining = 1;
        sendJson(response, 201, created);
        return;
      }
    }

    const workspaceSessionOrderMatch = pathname.match(
      /^\/api\/workspaces\/([^/]+)\/sessions\/order$/,
    );
    if (
      request.method === "PATCH" &&
      workspaceSessionOrderMatch &&
      fixture.workspaceDetails[workspaceSessionOrderMatch[1]]
    ) {
      const input = await readJson<{ session_ids: string[] }>(request);
      const detail = fixture.workspaceDetails[workspaceSessionOrderMatch[1]];
      const positions = new Map(
        input.session_ids.map((id, index) => [id, index]),
      );
      detail.sessions.sort(
        (left, right) =>
          (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      );
      sessionOrderRequests.push({
        workspaceId: workspaceSessionOrderMatch[1],
        session_ids: [...input.session_ids],
      });
      sendJson(response, 200, detail.sessions);
      return;
    }

    const workspaceHistoryMatch = pathname.match(
      /^\/api\/workspace-repositories\/([^/]+)\/git-history$/,
    );
    if (
      request.method === "GET" &&
      workspaceHistoryMatch &&
      fixture.gitHistories[workspaceHistoryMatch[1]]
    ) {
      sendJson(response, 200, fixture.gitHistories[workspaceHistoryMatch[1]]);
      return;
    }

    const sessionActionMatch = pathname.match(
      /^\/api\/sessions\/([^/]+)\/(close|open|stop|restart)$/,
    );
    if (request.method === "POST" && sessionActionMatch) {
      const collections = [
        ...Object.values(fixture.projectDetails).map(
          (detail) => detail.sessions,
        ),
        ...Object.values(fixture.workspaceDetails).map(
          (detail) => detail.sessions,
        ),
      ];
      const sessions = collections.find((items) =>
        items.some((session) => session.id === sessionActionMatch[1]),
      );
      const session = sessions?.find(
        (item) => item.id === sessionActionMatch[1],
      );
      if (!sessions || !session) {
        sendJson(response, 404, { error: "Session not found" });
        return;
      }
      if (sessionActionMatch[2] === "close" && session.kind !== "codex") {
        collections.forEach((items) => {
          const index = items.findIndex((item) => item.id === session.id);
          if (index >= 0) items.splice(index, 1);
        });
        sendJson(response, 200, {
          ...session,
          visibility: "hidden",
          status: "stopped",
        });
        return;
      }
      if (sessionActionMatch[2] === "close") session.visibility = "hidden";
      if (sessionActionMatch[2] === "open") session.visibility = "visible";
      if (sessionActionMatch[2] === "stop" || sessionActionMatch[2] === "close")
        session.status = "stopped";
      if (sessionActionMatch[2] === "restart") session.status = "running";
      sendJson(response, 200, session);
      return;
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      const session = Object.values(fixture.workspaceDetails)
        .flatMap((detail) => detail.sessions)
        .find((item) => item.id === sessionMatch[1]);
      if (!session) return sendJson(response, 404, { error: "Session not found" });
      sendJson(response, 200, session);
      return;
    }
    if (request.method === "PATCH" && sessionMatch) {
      const sessions = [
        ...Object.values(fixture.projectDetails).flatMap(
          (detail) => detail.sessions,
        ),
        ...Object.values(fixture.workspaceDetails).flatMap(
          (detail) => detail.sessions,
        ),
      ].filter(
        (session, index, values) =>
          values.findIndex((item) => item.id === session.id) === index,
      );
      const session = sessions.find((item) => item.id === sessionMatch[1]);
      if (!session)
        return sendJson(response, 404, { error: "Session not found" });
      const input = await readJson<{ name: string }>(request);
      for (const collection of [
        ...Object.values(fixture.projectDetails).map(
          (detail) => detail.sessions,
        ),
        ...Object.values(fixture.workspaceDetails).map(
          (detail) => detail.sessions,
        ),
      ]) {
        const value = collection.find((item) => item.id === sessionMatch[1]);
        if (value) value.name = input.name;
      }
      renameRequests.push({ kind: "session", id: sessionMatch[1], ...input });
      sendJson(response, 200, { ...session, name: input.name });
      return;
    }

    unexpectedRequests.push(`${request.method} ${pathname}`);
    sendJson(response, 501, {
      error: `UI fixture does not implement ${request.method} ${pathname}`,
    });
  });
  server.on("upgrade", (request, socket) => {
    const pathname = new URL(request.url ?? "/", "http://fixture.test")
      .pathname;
    if (/^\/api\/sessions\/[^/]+\/terminal$/.test(pathname)) {
      socket.destroy();
      return;
    }
    unexpectedRequests.push(`UPGRADE ${pathname}`);
    socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine UI fixture API address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    syncRequests,
    setNextBulkSyncResults(results: GitSyncItemResult[]) {
      nextBulkSyncResults = results;
    },
    locationRequests,
    logsRevealRequests,
    setNextLocationError(error: { status: number; code: string; message: string }) {
      nextLocationError = error;
    },
    repositoryUpdateRequests,
    workspaceLocationUpdates,
    renameRequests,
    sessionOrderRequests,
    deleteRequests,
    amuxStopRequests,
    agentIntegrationRequests: agentIntegrationRoutes.requests,
    setAgentIntegrationState: agentIntegrationRoutes.setState,
    parentOperationRequests: parentOperationRoutes.requests,
    todoRequests: todoRoutes.requests,
    compareRequests: gitDiffRoutes.requests,
    archiveAllStreams() {
      for (const detail of Object.values(fixture.projectDetails))
        detail.workspaces.forEach((item) => {
          if (item.kind !== "base") item.status = "archived";
        });
      for (const detail of Object.values(fixture.workspaceDetails)) {
        detail.status = "archived";
        detail.forks.forEach((item) => {
          item.status = "archived";
        });
      }
    },
    restoreActiveStreams() {
      for (const detail of Object.values(fixture.projectDetails))
        detail.workspaces.forEach((item) => {
          if (item.id === FIXTURE_IDS.workspace || item.id === FIXTURE_IDS.fork)
            item.status = "active";
        });
      for (const detail of Object.values(fixture.workspaceDetails)) {
        if (
          detail.id === FIXTURE_IDS.workspace ||
          detail.id === FIXTURE_IDS.fork
        )
          detail.status = "active";
        detail.forks.forEach((item) => {
          if (item.id === FIXTURE_IDS.fork) item.status = "active";
        });
      }
    },
    setProjectStatus(id: string, status: FixtureProject["status"]) {
      const project = fixture.projects.find((item) => item.id === id);
      if (project) project.status = status;
      if (fixture.projectDetails[id])
        fixture.projectDetails[id].status = status;
    },
    setProcessState(id: string, state: BackgroundProcess["state"] & Session["status"]) {
      const process = fixture.processes.find((item) => item.id === id);
      let changed = false;
      if (process && process.state !== state) {
        process.state = state;
        changed = true;
      }
      for (const detail of Object.values(fixture.workspaceDetails)) {
        const session = detail.sessions.find((item) => item.id === id);
        if (session && session.status !== state) {
          session.status = state;
          changed = true;
        }
      }
      if (changed)
        publishRuntimeChange(["sidebar", "sessions", "processes"]);
    },
    restartRuntimeInstance() {
      runtimeInstanceId = `runtime-ui-fixture-${Date.now()}`;
      runtimeRevision = 0;
    },
    setWorktreeDeletePrecheck(value: Partial<WorktreeDeletePrecheck>) {
      worktreeDeletePrecheck = { ...worktreeDeletePrecheck, ...value };
    },
    removeProcess(id: string) {
      const processCount = fixture.processes.length;
      fixture.processes = fixture.processes.filter((item) => item.id !== id);
      let changed = fixture.processes.length !== processCount;
      for (const detail of Object.values(fixture.workspaceDetails)) {
        const session = detail.sessions.find((item) => item.id === id);
        if (session && session.status !== "stopped") {
          session.status = "stopped";
          changed = true;
        }
      }
      if (changed)
        publishRuntimeChange(["sidebar", "sessions", "processes"]);
    },
    unexpectedRequests,
    async close() {
      for (const response of eventStreams) response.end();
      eventStreams.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

type UiHarness = Omit<Awaited<ReturnType<typeof startFixtureApi>>, "unexpectedRequests"> & { apiUrl: string; assertNoUnexpectedRequests(): void };

export async function startUiHarness(): Promise<UiHarness> {
  const fixtureApi = await startFixtureApi();
  let vite;
  try {
    vite = await createViteServer({
      configFile: path.join(projectRoot, "vite.config.ts"),
      root: path.join(projectRoot, "src/renderer"),
      logLevel: "error",
      define: {
        "import.meta.env.VITE_TREEFOLD_API_BASE": JSON.stringify(
          fixtureApi.baseUrl,
        ),
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
      },
    });
    await vite.listen();
  } catch (error) {
    await fixtureApi.close();
    throw error;
  }

  const address = vite.httpServer?.address();
  if (!address || typeof address === "string") {
    await vite.close();
    await fixtureApi.close();
    throw new Error("Could not determine UI fixture Vite address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiUrl: fixtureApi.baseUrl,
    syncRequests: fixtureApi.syncRequests,
    setNextBulkSyncResults: fixtureApi.setNextBulkSyncResults,
    locationRequests: fixtureApi.locationRequests,
    logsRevealRequests: fixtureApi.logsRevealRequests,
    setNextLocationError: fixtureApi.setNextLocationError,
    repositoryUpdateRequests: fixtureApi.repositoryUpdateRequests,
    workspaceLocationUpdates: fixtureApi.workspaceLocationUpdates,
    renameRequests: fixtureApi.renameRequests,
    sessionOrderRequests: fixtureApi.sessionOrderRequests,
    deleteRequests: fixtureApi.deleteRequests,
    amuxStopRequests: fixtureApi.amuxStopRequests,
    agentIntegrationRequests: fixtureApi.agentIntegrationRequests,
    setAgentIntegrationState: fixtureApi.setAgentIntegrationState,
    parentOperationRequests: fixtureApi.parentOperationRequests,
    todoRequests: fixtureApi.todoRequests,
    compareRequests: fixtureApi.compareRequests,
    archiveAllStreams: fixtureApi.archiveAllStreams,
    restoreActiveStreams: fixtureApi.restoreActiveStreams,
    setProjectStatus: fixtureApi.setProjectStatus,
    setProcessState: fixtureApi.setProcessState,
    restartRuntimeInstance: fixtureApi.restartRuntimeInstance,
    setWorktreeDeletePrecheck: fixtureApi.setWorktreeDeletePrecheck,
    removeProcess: fixtureApi.removeProcess,
    assertNoUnexpectedRequests() {
      if (fixtureApi.unexpectedRequests.length > 0) {
        throw new Error(
          `Unexpected UI fixture requests: ${fixtureApi.unexpectedRequests.join(", ")}`,
        );
      }
    },
    async close() {
      try { await vite.close(); } finally { await fixtureApi.close(); }
    },
  };
}

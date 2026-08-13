import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createSidebarCoreFixture, FIXTURE_IDS } from "./fixtures/sidebar-core.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startFixtureApi() {
  const fixture = createSidebarCoreFixture();
  const unexpectedRequests = [];
  let slowWorkspaceRefreshesRemaining = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, null);
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://fixture.test").pathname;
    if (request.method === "GET" && pathname === "/api/system") {
      sendJson(response, 200, fixture.system);
      return;
    }
    if (request.method === "GET" && pathname === "/api/settings") {
      sendJson(response, 200, fixture.settings);
      return;
    }
    if (request.method === "PATCH" && pathname === "/api/settings") {
      const input = await readJson(request);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const allowed = new Set(["language", "worktree_root", "agents"]);
      if (Object.keys(input).some((key) => !allowed.has(key))) {
        sendJson(response, 400, { error: "Unknown settings field" });
        return;
      }
      if (input.language !== undefined) fixture.settings.language = input.language;
      if (input.worktree_root !== undefined) fixture.settings.worktree_root = input.worktree_root;
      if (input.agents?.codex?.extra_args !== undefined) {
        fixture.settings.agents.codex.extra_args = [...input.agents.codex.extra_args];
      }
      sendJson(response, 200, fixture.settings);
      return;
    }
    if (request.method === "GET" && pathname === "/api/projects") {
      sendJson(response, 200, fixture.projects);
      return;
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (request.method === "GET" && projectMatch && fixture.projectDetails[projectMatch[1]]) {
      sendJson(response, 200, fixture.projectDetails[projectMatch[1]]);
      return;
    }

    if (request.method === "POST" && pathname === "/api/project-locations/inspect") {
      const input = await readJson(request);
      const cleanPath = String(input.path ?? "").replace(/\/+$/, "");
      const name = cleanPath.split("/").filter(Boolean).at(-1) || cleanPath;
      const isGit = !/docs|documentation|reference|context/i.test(cleanPath);
      sendJson(response, 200, {
        path: cleanPath,
        name,
        git_status: isGit ? "ready" : "not_git",
        repository_url: isGit ? `https://example.test/${name}.git` : undefined,
        preferred_remote_name: isGit ? "origin" : undefined,
        base_branch: isGit ? "main" : undefined,
      });
      return;
    }

    const projectLocationsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/locations$/);
    if (request.method === "POST" && projectLocationsMatch && fixture.projectDetails[projectLocationsMatch[1]]) {
      const input = await readJson(request);
      const cleanPath = String(input.path ?? "").replace(/\/+$/, "");
      const name = cleanPath.split("/").filter(Boolean).at(-1) || cleanPath;
      const isGit = input.base_branch != null;
      const location = {
        id: `location-added-${fixture.projectDetails[projectLocationsMatch[1]].locations.length}`,
        project_id: projectLocationsMatch[1],
        name,
        description: input.description ?? "",
        worktree_setup_command: input.worktree_setup_command ?? "",
        path: cleanPath,
        repository_url: isGit ? `https://example.test/${name}.git` : undefined,
        preferred_remote_name: isGit ? "origin" : undefined,
        base_branch: isGit ? input.base_branch : undefined,
        delivery_mode: isGit ? input.delivery_mode : undefined,
        git_common_dir: isGit ? `${cleanPath}/.git` : undefined,
        git_status: isGit ? "ready" : "not_git",
        role: "attached",
        is_git: isGit,
        dirty: false,
        created_at: "2026-08-10T08:20:00.000Z",
      };
      fixture.projectDetails[projectLocationsMatch[1]].locations.push(location);
      sendJson(response, 201, location);
      return;
    }
    if (request.method === "PATCH" && projectMatch && fixture.projectDetails[projectMatch[1]]) {
      const input = await readJson(request);
      if (input.status !== undefined && input.status !== "active" && input.status !== "archived") {
        sendJson(response, 400, { error: "Project status must be active or archived" });
        return;
      }
      const project = fixture.projects.find((item) => item.id === projectMatch[1]);
      if (input.status !== undefined) project.status = input.status;
      if (input.status !== undefined) fixture.projectDetails[projectMatch[1]].status = input.status;
      if (input.default_location_id !== undefined) {
        project.default_location_id = input.default_location_id;
        fixture.projectDetails[projectMatch[1]].default_location_id = input.default_location_id;
      }
      if (input.status === "archived") {
        const projectSessions = fixture.projectDetails[projectMatch[1]].sessions;
        fixture.projectDetails[projectMatch[1]].sessions = projectSessions.filter((session) => session.kind !== "shell");
        fixture.projectDetails[projectMatch[1]].sessions.forEach((session) => { session.sidebar_visible = false; session.status = "closed"; });
        Object.values(fixture.workspaceDetails).filter((detail) => detail.project_id === projectMatch[1]).forEach((detail) => {
          detail.sessions = detail.sessions.filter((session) => session.kind !== "shell");
          detail.sessions.forEach((session) => { session.sidebar_visible = false; session.status = "closed"; });
        });
      }
      sendJson(response, 200, project);
      return;
    }
    if (request.method === "DELETE" && projectMatch && fixture.projectDetails[projectMatch[1]]) {
      const project = fixture.projects.find((item) => item.id === projectMatch[1]);
      if (project.status !== "archived") {
        sendJson(response, 400, { error: "Archive the Project before permanently deleting it" });
        return;
      }
      fixture.projects = fixture.projects.filter((item) => item.id !== projectMatch[1]);
      delete fixture.projectDetails[projectMatch[1]];
      sendJson(response, 204, null);
      return;
    }

    const projectHistoryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git-history$/);
    if (request.method === "GET" && projectHistoryMatch && fixture.gitHistories[projectHistoryMatch[1]]) {
      sendJson(response, 200, fixture.gitHistories[projectHistoryMatch[1]]);
      return;
    }

    const projectSessionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
    if (projectSessionsMatch && fixture.projectDetails[projectSessionsMatch[1]]) {
      const detail = fixture.projectDetails[projectSessionsMatch[1]];
      if (request.method === "GET") {
        sendJson(response, 200, detail.sessions);
        return;
      }
      if (request.method === "POST") {
        const input = await readJson(request);
        const kind = input.kind || "shell";
        if (kind === "codex" && ["name", "initial_prompt", "yolo"].some((field) => Object.hasOwn(input, field))) {
          sendJson(response, 400, { error: "Codex creation must use backend defaults" });
          return;
        }
        const directory = detail.directories.find((item) => item.id === input.project_directory_id) ?? detail.directories[0];
        const created = {
          ...detail.sessions[0],
          id: kind === "codex" ? "session-created-project-codex-ui-fixture" : "session-created-project-shell-ui-fixture",
          workspace_id: `project-base-${detail.id}`,
          process_id: kind === "codex" ? "session-created-project-codex-ui-fixture" : "session-created-project-shell-ui-fixture",
          process_name: `${kind}-project-fixture`,
          name: kind === "shell" ? `shell · ${directory.name}` : "codex",
          kind,
          cwd: directory.path,
          original_cwd: directory.path,
          initial_prompt: "",
          codex_session_id: kind === "codex" ? "codex-created-project-ui-fixture" : undefined,
          yolo: kind === "codex" && fixture.settings.agents.codex.extra_args.includes("--dangerously-bypass-approvals-and-sandbox"),
          sidebar_visible: true,
          status: "running",
          pid: 4343,
          process_group_id: 4343,
          created_at: "2026-08-10T08:12:00.000Z",
          updated_at: "2026-08-10T08:12:00.000Z",
        };
        detail.sessions.push(created);
        sendJson(response, 201, created);
        return;
      }
    }

    const syncMatch = pathname.match(/^\/api\/(projects|workspaces)\/([^/]+)\/git\/(pull|push)(-all)?$/);
    if (request.method === "POST" && syncMatch) {
      sendJson(response, 200, [{ project_location_id: fixture.projectDetails[FIXTURE_IDS.project].default_location_id, location_name: "fixture-repository", status: "success", result: { scope: syncMatch[1] === "projects" ? "project_location" : "workspace_location", action: syncMatch[3], branch: "main", remote: "origin", remote_branch: "main", status: "up_to_date", message: "up to date" } }]);
      return;
    }

    const locationRefreshMatch = pathname.match(/^\/api\/project-locations\/([^/]+)\/refresh$/);
    if (request.method === "POST" && locationRefreshMatch) {
      const location = Object.values(fixture.projectDetails).flatMap((detail) => detail.locations).find((item) => item.id === locationRefreshMatch[1]);
      if (!location) return sendJson(response, 404, { error: "Location not found" });
      sendJson(response, 200, location);
      return;
    }

    const revealMatch = pathname.match(/^\/api\/(projects|workspaces)\/([^/]+)\/reveal$/);
    if (request.method === "POST" && revealMatch) {
      sendJson(response, 200, { revealed: true });
      return;
    }

    const directoryMatch = pathname.match(/^\/api\/project-directories\/([^/]+)$/);
    if (request.method === "PATCH" && directoryMatch) {
      const input = await readJson(request);
      const directory = Object.values(fixture.projectDetails)
        .flatMap((detail) => detail.directories)
        .find((item) => item.id === directoryMatch[1]);
      if (!directory) {
        sendJson(response, 404, { error: "Directory not found" });
        return;
      }
      directory.description = input.description ?? "";
      directory.worktree_setup_command = input.worktree_setup_command ?? "";
      if (input.base_branch) directory.base_branch = input.base_branch;
      if (input.delivery_mode) directory.delivery_mode = input.delivery_mode;
      Object.values(fixture.workspaceDetails).forEach((detail) => {
        const item = detail.directories.find((candidate) => candidate.id === directory.id);
        if (item) Object.assign(item, directory, item.checkout_path ? { checkout_path: item.checkout_path } : {});
      });
      sendJson(response, 200, directory);
      return;
    }

    const branchesMatch = pathname.match(/^\/api\/project-directories\/([^/]+)\/branches$/);
    if (request.method === "GET" && branchesMatch) {
      sendJson(response, 200, { current: "main", local: ["main", "release/ui-fixture"], remotes: [{ name: "origin", branches: ["main", "feature/ui-fixture"] }] });
      return;
    }

    const checkoutMatch = pathname.match(/^\/api\/project-directories\/([^/]+)\/checkout$/);
    if (request.method === "POST" && checkoutMatch) {
      const input = await readJson(request);
      const directory = Object.values(fixture.projectDetails).flatMap((detail) => detail.directories).find((item) => item.id === checkoutMatch[1]);
      if (!directory) return sendJson(response, 404, { error: "Directory not found" });
      directory.branch = input.branch;
      sendJson(response, 200, directory);
      return;
    }

    const workspaceMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (request.method === "GET" && workspaceMatch && fixture.workspaceDetails[workspaceMatch[1]]) {
      if (slowWorkspaceRefreshesRemaining > 0) {
        slowWorkspaceRefreshesRemaining -= 1;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      sendJson(response, 200, fixture.workspaceDetails[workspaceMatch[1]]);
      return;
    }
    if (request.method === "PATCH" && workspaceMatch && fixture.workspaceDetails[workspaceMatch[1]]) {
      const input = await readJson(request);
      Object.assign(fixture.workspaceDetails[workspaceMatch[1]], { remote_name: input.remote_name || undefined, remote_branch: input.remote_branch || undefined, delivery_mode: input.delivery_mode });
      sendJson(response, 200, fixture.workspaceDetails[workspaceMatch[1]]);
      return;
    }

    const workspaceSessionsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/sessions$/);
    if (workspaceSessionsMatch && fixture.workspaceDetails[workspaceSessionsMatch[1]]) {
      const detail = fixture.workspaceDetails[workspaceSessionsMatch[1]];
      if (request.method === "GET") {
        sendJson(response, 200, detail.sessions);
        return;
      }
      if (request.method === "POST") {
        const input = await readJson(request);
        const kind = input.kind || "shell";
        if (kind === "codex" && ["name", "initial_prompt", "yolo"].some((field) => Object.hasOwn(input, field))) {
          sendJson(response, 400, { error: "Codex creation must use backend defaults" });
          return;
        }
        const createdId = `session-created-${kind}-ui-fixture`;
        const created = {
          ...detail.sessions[0],
          id: createdId,
          workspace_id: detail.id,
          process_id: createdId,
          process_name: `${kind}-created-ui-fixture`,
          name: kind,
          kind,
          cwd: input.project_directory_id
            ? detail.directories.find((directory) => directory.id === input.project_directory_id)?.checkout_path || detail.checkout_path
            : detail.checkout_path,
          original_cwd: detail.checkout_path,
          initial_prompt: "",
          codex_session_id: undefined,
          yolo: kind === "codex" && fixture.settings.agents.codex.extra_args.includes("--dangerously-bypass-approvals-and-sandbox"),
          status: "running",
          pid: 4242,
          process_group_id: 4242,
          created_at: "2026-08-10T08:10:00.000Z",
          updated_at: "2026-08-10T08:10:00.000Z",
        };
        detail.sessions.push(created);
        slowWorkspaceRefreshesRemaining = 1;
        sendJson(response, 201, created);
        return;
      }
    }

    const workspaceHistoryMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/git-history$/);
    if (request.method === "GET" && workspaceHistoryMatch && fixture.gitHistories[workspaceHistoryMatch[1]]) {
      sendJson(response, 200, fixture.gitHistories[workspaceHistoryMatch[1]]);
      return;
    }

    const sessionActionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/(close|open|stop|restart)$/);
    if (request.method === "POST" && sessionActionMatch) {
      const collections = [
        ...Object.values(fixture.projectDetails).map((detail) => detail.sessions),
        ...Object.values(fixture.workspaceDetails).map((detail) => detail.sessions),
      ];
      const sessions = collections.find((items) => items.some((session) => session.id === sessionActionMatch[1]));
      const session = sessions?.find((item) => item.id === sessionActionMatch[1]);
      if (!sessions || !session) {
        sendJson(response, 404, { error: "Session not found" });
        return;
      }
      if (sessionActionMatch[2] === "close" && session.kind === "shell") {
        collections.forEach((items) => {
          const index = items.findIndex((item) => item.id === session.id);
          if (index >= 0) items.splice(index, 1);
        });
        sendJson(response, 200, { ...session, sidebar_visible: false, status: "closed" });
        return;
      }
      if (sessionActionMatch[2] === "close") session.sidebar_visible = false;
      if (sessionActionMatch[2] === "open") session.sidebar_visible = true;
      if (sessionActionMatch[2] === "stop" || sessionActionMatch[2] === "close") session.status = "closed";
      if (sessionActionMatch[2] === "restart") session.status = "running";
      sendJson(response, 200, session);
      return;
    }

    const operationsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/git-operations$/);
    if (request.method === "GET" && operationsMatch && fixture.gitOperations[operationsMatch[1]]) {
      sendJson(response, 200, fixture.gitOperations[operationsMatch[1]]);
      return;
    }

    const preflightMatch = pathname.match(/^\/api\/workspace-locations\/([^/]+)\/delivery-preflight$/);
    if (request.method === "POST" && preflightMatch && fixture.deliveryPreflights[preflightMatch[1]]) {
      const input = await readJson(request);
      const base = fixture.deliveryPreflights[preflightMatch[1]];
      sendJson(response, 201, {
        ...base,
        code_action: input.code_action,
      });
      return;
    }

    unexpectedRequests.push(`${request.method} ${pathname}`);
    sendJson(response, 501, { error: `UI fixture does not implement ${request.method} ${pathname}` });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine UI fixture API address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    unexpectedRequests,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export async function startUiHarness() {
  if (process.env.TREEFOLD_UI_URL) {
    return {
      baseUrl: process.env.TREEFOLD_UI_URL,
      assertNoUnexpectedRequests() {},
      async close() {},
    };
  }

  const fixtureApi = await startFixtureApi();
  let vite;
  try {
    vite = await createViteServer({
      configFile: path.join(projectRoot, "vite.config.ts"),
      root: projectRoot,
      logLevel: "error",
      define: {
        "import.meta.env.VITE_TREEFOLD_API_BASE": JSON.stringify(fixtureApi.baseUrl),
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
    assertNoUnexpectedRequests() {
      if (fixtureApi.unexpectedRequests.length > 0) {
        throw new Error(`Unexpected UI fixture requests: ${fixtureApi.unexpectedRequests.join(", ")}`);
      }
    },
    async close() {
      await vite.close();
      await fixtureApi.close();
    },
  };
}

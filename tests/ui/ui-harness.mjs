import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createSidebarCoreFixture } from "./fixtures/sidebar-core.mjs";

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
    if (request.method === "PATCH" && projectMatch && fixture.projectDetails[projectMatch[1]]) {
      const input = await readJson(request);
      if (input.status !== "active" && input.status !== "archived") {
        sendJson(response, 400, { error: "Project status must be active or archived" });
        return;
      }
      const project = fixture.projects.find((item) => item.id === projectMatch[1]);
      project.status = input.status;
      fixture.projectDetails[projectMatch[1]].status = input.status;
      if (input.status === "archived") {
        fixture.projectDetails[projectMatch[1]].sessions.forEach((session) => { session.sidebar_visible = false; session.status = "closed"; });
        Object.values(fixture.workstreamDetails).filter((detail) => detail.project_id === projectMatch[1]).forEach((detail) => {
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
      directory.name = input.name;
      directory.description = input.description ?? "";
      directory.worktree_setup_command = input.worktree_setup_command ?? "";
      Object.values(fixture.workstreamDetails).forEach((detail) => {
        const item = detail.directories.find((candidate) => candidate.id === directory.id);
        if (item) Object.assign(item, directory, item.workspace_path ? { workspace_path: item.workspace_path } : {});
      });
      sendJson(response, 200, directory);
      return;
    }

    const workstreamMatch = pathname.match(/^\/api\/workstreams\/([^/]+)$/);
    if (request.method === "GET" && workstreamMatch && fixture.workstreamDetails[workstreamMatch[1]]) {
      sendJson(response, 200, fixture.workstreamDetails[workstreamMatch[1]]);
      return;
    }

    const workstreamHistoryMatch = pathname.match(/^\/api\/workstreams\/([^/]+)\/git-history$/);
    if (request.method === "GET" && workstreamHistoryMatch && fixture.gitHistories[workstreamHistoryMatch[1]]) {
      sendJson(response, 200, fixture.gitHistories[workstreamHistoryMatch[1]]);
      return;
    }

    const operationsMatch = pathname.match(/^\/api\/workstreams\/([^/]+)\/git-operations$/);
    if (request.method === "GET" && operationsMatch && fixture.gitOperations[operationsMatch[1]]) {
      sendJson(response, 200, fixture.gitOperations[operationsMatch[1]]);
      return;
    }

    const preflightMatch = pathname.match(/^\/api\/workstreams\/([^/]+)\/settlement-preflight$/);
    if (request.method === "POST" && preflightMatch && fixture.settlementPreflights[preflightMatch[1]]) {
      const input = await readJson(request);
      const base = fixture.settlementPreflights[preflightMatch[1]];
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

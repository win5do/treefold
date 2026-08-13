import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createSidebarCoreFixture } from "./fixtures/sidebar-core.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sendJson = (response, status, value) => { response.writeHead(status, { "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
async function readJson(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }

async function startFixtureApi() {
  const fixture = createSidebarCoreFixture(); const unexpectedRequests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return sendJson(response, 204, null);
    const pathname = new URL(request.url ?? "/", "http://fixture.test").pathname;
    if (request.method === "GET" && pathname === "/api/settings") return sendJson(response, 200, fixture.settings);
    if (request.method === "GET" && pathname === "/api/system") return sendJson(response, 200, fixture.system);
    if (request.method === "PATCH" && pathname === "/api/settings") { const input = await readJson(request); if (input.language) fixture.settings.language = input.language; if (input.agents?.codex?.extra_args) fixture.settings.agents.codex.extra_args = input.agents.codex.extra_args; return sendJson(response, 200, fixture.settings); }
    if (request.method === "GET" && pathname === "/api/projects") return sendJson(response, 200, fixture.projects);
    const project = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (request.method === "GET" && project && fixture.projectDetails[project[1]]) return sendJson(response, 200, fixture.projectDetails[project[1]]);
    const workspace = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (request.method === "GET" && workspace && fixture.workspaceDetails[workspace[1]]) return sendJson(response, 200, fixture.workspaceDetails[workspace[1]]);
    if (request.method === "PATCH" && workspace && fixture.workspaceDetails[workspace[1]]) {
      const input = await readJson(request); Object.assign(fixture.workspaceDetails[workspace[1]], { remote_name: input.remote_name || undefined, remote_branch: input.remote_branch || undefined, delivery_mode: input.delivery_mode });
      Object.assign(fixture.projectDetails[fixture.workspaceDetails[workspace[1]].project_id].workspaces[0], fixture.workspaceDetails[workspace[1]]);
      return sendJson(response, 200, fixture.workspaceDetails[workspace[1]]);
    }
    const sync = pathname.match(/^\/api\/(projects|workspaces)\/([^/]+)\/git\/(pull|push)$/);
    if (request.method === "POST" && sync) return sendJson(response, 200, { scope: sync[1] === "projects" ? "project" : "workspace", action: sync[3], branch: sync[1] === "projects" ? "main" : "treefold/feature-a1b2c3", remote: "origin", remote_branch: sync[1] === "projects" ? "main" : "feature/treefold-model", status: "up_to_date", message: `${sync[3]} up_to_date` });
    const preflight = pathname.match(/^\/api\/workspaces\/([^/]+)\/delivery-preflight$/);
    if (request.method === "POST" && preflight && fixture.deliveryPreflights[preflight[1]]) { const input = await readJson(request); return sendJson(response, 201, { ...fixture.deliveryPreflights[preflight[1]], code_action: input.code_action }); }
    unexpectedRequests.push(`${request.method} ${pathname}`); return sendJson(response, 501, { error: `Fixture does not implement ${request.method} ${pathname}` });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Could not determine fixture API address");
  return { baseUrl: `http://127.0.0.1:${address.port}`, unexpectedRequests, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export async function startUiHarness() {
  const fixtureApi = await startFixtureApi();
  const vite = await createViteServer({ configFile: path.join(projectRoot, "vite.config.ts"), root: projectRoot, logLevel: "error", define: { "import.meta.env.VITE_TREEFOLD_API_BASE": JSON.stringify(fixtureApi.baseUrl) }, server: { host: "127.0.0.1", port: 0 } });
  await vite.listen(); const address = vite.httpServer?.address(); if (!address || typeof address === "string") throw new Error("Could not determine Vite address");
  return { baseUrl: `http://127.0.0.1:${address.port}`, assertNoUnexpectedRequests() { if (fixtureApi.unexpectedRequests.length) throw new Error(`Unexpected requests: ${fixtureApi.unexpectedRequests.join(", ")}`); }, async close() { await vite.close(); await fixtureApi.close(); } };
}

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";

export function createWorkspaceDeletionRoutes({ fixture, sendJson }: Pick<RouteDependencies, "fixture" | "sendJson">) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const cleanup = pathname.match(/^\/api\/(projects|workspaces)\/([^/]+)\/(workspaces|forks)\/cleanup-archived$/);
      if (request.method === "POST" && cleanup) {
        const [, scope, id, children] = cleanup;
        if ((scope === "projects" && children !== "workspaces") || (scope === "workspaces" && children !== "forks")) return false;
        const parent = scope === "projects" ? fixture.projectDetails[id] : fixture.workspaceDetails[id];
        if (!parent) return false;
        const candidates = scope === "projects"
          ? fixture.projectDetails[id].workspaces.filter(item => item.kind === "workspace" && !item.parent_workspace_id)
          : fixture.workspaceDetails[id].forks;
        const ids = candidates.filter(item => item.status === "archived").map(item => item.id);
        const deleted = new Set(ids);
        for (const detail of Object.values(fixture.projectDetails)) {
          for (const item of detail.workspaces) if (item.parent_workspace_id && deleted.has(item.parent_workspace_id)) deleted.add(item.id);
          detail.workspaces = detail.workspaces.filter(item => !deleted.has(item.id));
        }
        for (const detail of Object.values(fixture.workspaceDetails)) detail.forks = detail.forks.filter(item => !deleted.has(item.id));
        for (const id of deleted) delete fixture.workspaceDetails[id];
        sendJson(response, 200, { deleted_ids: ids, skipped: [] });
        return true;
      }
      const match = pathname.match(/^\/api\/workspaces\/([^/]+)\/delete-precheck$/);
      if (request.method !== "GET" || !match) return false;
      const workspaces = [
        ...Object.values(fixture.workspaceDetails),
        ...Object.values(fixture.workspaceDetails).flatMap(detail => detail.forks),
        ...Object.values(fixture.projectDetails).flatMap(detail => detail.workspaces),
      ];
      if (!workspaces.some(workspace => workspace.id === match[1])) return false;
      sendJson(response, 200, { undelivered_branches: [], discard_token: null });
      return true;
    },
  };
}

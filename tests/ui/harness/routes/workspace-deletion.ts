import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";

export function createWorkspaceDeletionRoutes({ fixture, sendJson }: Pick<RouteDependencies, "fixture" | "sendJson">) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";

export function createProjectStatusRoutes({ fixture, sendJson }: RouteDependencies) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const match = pathname.match(/^\/api\/projects\/([^/]+)\/worktrees$/);
      if (!match || request.method !== "GET") return false;
      const detail = fixture.projectDetails[match[1]];
      if (!detail) { sendJson(response, 404, { message: "Project not found" }); return true; }
      sendJson(response, 200, detail.worktrees);
      return true;
    },
  };
}

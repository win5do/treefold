import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";

export function createWorkspaceStatusRoutes({ fixture, sendJson }: RouteDependencies) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const match = pathname.match(/^\/api\/workspaces\/([^/]+)\/worktrees$/);
      if (!match || request.method !== "GET") return false;
      const detail = fixture.workspaceDetails[match[1]];
      if (!detail) { sendJson(response, 404, { message: "Workspace not found" }); return true; }
      const worktrees = fixture.projectDetails[detail.project.id]?.worktrees ?? [];
      sendJson(response, 200, worktrees.filter(worktree => detail.repositories.some(repository =>
        repository.git_status !== "creating" &&
        repository.project_repository_id === worktree.project_repository_id &&
        repository.checkout_path === worktree.path,
      )));
      return true;
    },
  };
}

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";

export function createProjectStatusRoutes({ fixture, sendJson }: RouteDependencies) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const refresh = pathname.match(/^\/api\/project-repositories\/([^/]+)\/refresh$/);
      if (refresh && request.method === "POST") {
        const project = Object.values(fixture.projectDetails)
          .find(project => project.repositories.some(repository => repository.id === refresh[1]));
        const repository = project?.repositories.find(repository => repository.id === refresh[1]);
        if (!repository) { sendJson(response, 404, { message: "Repository not found" }); return true; }
        if (project?.status !== "active") { sendJson(response, 400, { message: "Project is archived" }); return true; }
        sendJson(response, 200, repository);
        return true;
      }
      const match = pathname.match(/^\/api\/(projects|project-repositories)\/([^/]+)\/worktrees$/);
      if (!match || request.method !== "GET") return false;
      const repositoryId = match[1] === "project-repositories" ? match[2] : undefined;
      const detail = repositoryId
        ? Object.values(fixture.projectDetails).find(project => project.repositories.some(repository => repository.id === repositoryId))
        : fixture.projectDetails[match[2]];
      if (!detail) { sendJson(response, 404, { message: "Project or repository not found" }); return true; }
      sendJson(response, 200, repositoryId
        ? detail.worktrees.filter(worktree => worktree.project_repository_id === repositoryId)
        : detail.worktrees);
      return true;
    },
  };
}

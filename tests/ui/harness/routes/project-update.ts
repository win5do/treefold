import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FixtureProject } from "../../fixtures/types.ts";
import type { RouteDependencies } from "../types.ts";

export function createProjectUpdateRoutes(
  { fixture, readJson, sendJson }: RouteDependencies,
  renameRequests: { kind: string; id: string; name?: string; description?: string }[],
) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
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
          return true;
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
          return true;
        }
        if (input.review_prompt !== undefined) {
          project.review_prompt = input.review_prompt.trim() ? input.review_prompt : "";
          fixture.projectDetails[projectMatch[1]].review_prompt = project.review_prompt;
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
        return true;
      }
      return false;
    },
  };
}

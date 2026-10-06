import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDependencies } from "../types.ts";
import type { FixtureProject, FixtureDirectory, FixtureRepository } from "../../fixtures/types.ts";
import type { ProjectCreation, ProjectSource } from "../../../../src/renderer/src/domain/types.ts";

type ApiFailure = { code: string; message: string };
export function createProjectCreationRoutes({ fixture, readJson, sendJson }: RouteDependencies,
  locationRequests: { projectId: string; path: string; isGit: boolean }[]) {
  const createRequests: ProjectCreation[] = [];
  const validationRequests: { name: string; source: ProjectSource }[] = [];
  let nextCreateError: ApiFailure | null = null;
  return {
    createRequests, validationRequests,
    failNextCreation(error: ApiFailure) { nextCreateError = error; },
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string) {
      if (request.method === "POST" && pathname === "/api/projects/validate-source") {
        const input = await readJson<{ name: string; source: ProjectSource }>(request);
        validationRequests.push(input);
        if (input.source.kind === "git_url" && !/^(https?:\/\/|ssh:\/\/|git@)/.test(input.source.url)) {
          sendJson(response, 400, { error: { code: "INVALID_GIT_URL", message: "Invalid Git URL" } });
        } else if (input.source.kind === "git_url" && input.source.url.includes("missing.git")) {
          sendJson(response, 400, { error: { code: "GIT_REMOTE_UNAVAILABLE", message: "Repository unavailable" } });
        } else if (input.source.kind === "empty" && input.name === "existing") {
          sendJson(response, 400, { error: { code: "PROJECT_DESTINATION_EXISTS", message: "Destination exists" } });
        } else {
          sendJson(response, 200, { path: input.source.kind === "empty" ? `${input.source.parent_path}/${input.name}` : null });
        }
        return true;
      }
      if (request.method === "POST" && pathname === "/api/projects") {
        const input = await readJson<ProjectCreation & { description?: string }>(request);
        createRequests.push(input);
        if (nextCreateError) {
          const error = nextCreateError; nextCreateError = null;
          sendJson(response, 400, { error }); return true;
        }
        const requestedLocations = "locations" in input ? input.locations : [input.source.kind === "empty"
          ? `${input.source.parent_path}/${input.name}` : `/tmp/treefold-ui-fixture/managed/${input.name}`];
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
        for (const [index, locationPath] of requestedLocations.entries()) {
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
        return true;
      }

      if (request.method === "POST" && pathname === "/api/projects/inspect-path") {
        const input = await readJson<{ path: string }>(request);
        const cleanPath = input.path.replace(/\/+$/, "");
        if (cleanPath.endsWith("/additional-locations")) {
          sendJson(response, 200, { path: cleanPath, candidates: ["new-api-repository", "reference-context", "unused-repository"].map((name) => ({
            path: `/tmp/treefold-ui-fixture/${name}`, repository_root: name.includes("context") ? null : `/tmp/treefold-ui-fixture/${name}`, is_git: !name.includes("context"),
          })) });
          return true;
        }
        const candidates = cleanPath.endsWith("/multi-repo")
          ? ["backend", "docs", "frontend"].map((name) => ({
              path: `${cleanPath}/${name}`,
              repository_root: name === "docs" ? null : `${cleanPath}/${name}`,
              is_git: name !== "docs",
            }))
          : [{ path: cleanPath, repository_root: cleanPath, is_git: true }];
        sendJson(response, 200, { path: cleanPath, candidates });
        return true;
      }

      return false;
    },
  };
}

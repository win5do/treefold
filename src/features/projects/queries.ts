import { queryOptions } from "@tanstack/react-query";
import { projectsApi } from "@/api/projects";
import { normalizeProject } from "@/features/workspace/model";

export const projectKeys = {
  summaries: ["project-summaries"] as const,
  sidebar: ["sidebar"] as const,
  detail: (id: string) => ["project", id] as const,
  sessions: (id: string) => ["project-sessions", id] as const,
};

export const projectSummariesQuery = () =>
  queryOptions({
    queryKey: projectKeys.summaries,
    queryFn: ({ signal }) => projectsApi.summaries(signal),
  });

export const sidebarQuery = () =>
  queryOptions({
    queryKey: projectKeys.sidebar,
    queryFn: async ({ signal }) => {
      const value = await projectsApi.sidebar(signal);
      return value.projects.map((project) => {
        const normalizedProject = normalizeProject({
          ...project,
          locations: project.directories,
          worktrees: [],
        });
        const directories = normalizedProject.directories;
        const projectLocations = new Map(
          directories.map((directory) => [directory.id, directory]),
        );
        const streams = project.workspaces.map((workspace) => ({
          ...workspace,
          locations: workspace.repositories,
          directories: workspace.directories.map((scope) => {
            const repository = scope.workspace_repository_id
              ? workspace.repositories.find(
                  (candidate) => candidate.id === scope.workspace_repository_id,
                )
              : undefined;
            const source = projectLocations.get(scope.project_directory_id);
            return {
              ...source,
              id: scope.project_directory_id,
              project_id: project.id,
              name: scope.name,
              description: scope.description,
              worktree_setup_command: source?.worktree_setup_command ?? "",
              path: scope.path,
              checkout_path: scope.path,
              role: ((project.default_directory_id ??
                project.default_location_id) === scope.project_directory_id
                ? "primary"
                : "attached") as "primary" | "attached",
              is_git: Boolean(repository),
              git_status: repository?.git_status ?? scope.status,
              branch: repository?.branch,
              dirty: false,
            };
          }),
        }));
        const workspaces = streams.map((workspace) => ({
          ...workspace,
          forks: streams.filter(
            (candidate) => candidate.parent_workspace_id === workspace.id,
          ),
        }));
        return normalizeProject({
          ...project,
          locations: directories,
          directories,
          workspaces,
          worktrees: [],
        });
      });
    },
  });

export const projectDetailQuery = (id: string) =>
  queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: ({ signal }) =>
      projectsApi.detail(id, signal).then(normalizeProject),
  });

export const projectSessionsQuery = (id: string) =>
  queryOptions({
    queryKey: projectKeys.sessions(id),
    queryFn: ({ signal }) => projectsApi.sessions(id, signal),
  });

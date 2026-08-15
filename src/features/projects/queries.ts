import { queryOptions } from "@tanstack/react-query";
import { projectsApi } from "@/api/projects";
import { normalizeProject } from "@/features/workspace/model";

export const projectKeys = {
  summaries: ["project-summaries"] as const,
  sidebar: ["sidebar"] as const,
  detail: (id: string) => ["project", id] as const,
  sessions: (id: string) => ["project-sessions", id] as const,
};

export const projectSummariesQuery = () => queryOptions({
  queryKey: projectKeys.summaries,
  queryFn: ({ signal }) => projectsApi.summaries(signal),
});

export const sidebarQuery = () => queryOptions({
  queryKey: projectKeys.sidebar,
  refetchInterval: 1_000,
  queryFn: async ({ signal }) => {
    const value = await projectsApi.sidebar(signal);
    return value.projects.map((project) => {
      const directories = project.locations.map((location) => ({
        ...location,
        role: (project.default_location_id === location.id ? "primary" : "attached") as "primary" | "attached",
        is_git: location.git_status === "ready",
        dirty: false,
      }));
      const projectLocations = new Map(directories.map((directory) => [directory.id, directory]));
      const streams = project.workspaces.map((workspace) => ({
        ...workspace,
        directories: workspace.locations.map((location) => ({
          ...projectLocations.get(location.project_location_id),
          id: location.project_location_id,
          project_id: project.id,
          name: location.location_name,
          description: projectLocations.get(location.project_location_id)?.description ?? "",
          worktree_setup_command: projectLocations.get(location.project_location_id)?.worktree_setup_command ?? "",
          path: location.source_path,
          checkout_path: location.checkout_path,
          role: (project.default_location_id === location.project_location_id ? "primary" : "attached") as "primary" | "attached",
          is_git: location.access_mode === "read_write",
          git_status: location.git_status,
          branch: location.branch,
          dirty: false,
        })),
      }));
      const workspaces = streams.map((workspace) => ({
        ...workspace,
        forks: streams.filter((candidate) => candidate.parent_workspace_id === workspace.id),
      }));
      return normalizeProject({ ...project, directories, workspaces, worktrees: [] });
    });
  },
});

export const projectDetailQuery = (id: string) => queryOptions({
  queryKey: projectKeys.detail(id),
  queryFn: ({ signal }) => projectsApi.detail(id, signal).then(normalizeProject),
});

export const projectSessionsQuery = (id: string) => queryOptions({
  queryKey: projectKeys.sessions(id),
  queryFn: ({ signal }) => projectsApi.sessions(id, signal),
  refetchInterval: 2500,
});

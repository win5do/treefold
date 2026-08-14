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
  queryFn: async ({ signal }) => {
    const value = await projectsApi.sidebar(signal);
    return value.projects.map((project) => {
      const directories = project.locations.map((location) => ({
        ...location,
        role: (project.default_location_id === location.id ? "primary" : "attached") as "primary" | "attached",
        is_git: location.git_status === "ready",
        dirty: false,
      }));
      const workspaces = project.workspaces.map((workspace) => ({
        ...workspace,
        directories,
        forks: project.workspaces.filter((candidate) => candidate.parent_workspace_id === workspace.id),
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

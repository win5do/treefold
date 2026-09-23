import { queryOptions } from "@tanstack/react-query";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";

export const gitHistoryKeys = {
  repository: (kind: "project" | "workspace", id: string) =>
    ["git-history", kind, id] as const,
};

export const gitHistoryQuery = (kind: "project" | "workspace", id: string) =>
  queryOptions({
    queryKey: gitHistoryKeys.repository(kind, id),
    queryFn: ({ signal }) => kind === "workspace"
      ? workspacesApi.repositoryHistory(id, signal)
      : projectsApi.history(id, signal),
  });

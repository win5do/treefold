import { queryOptions } from "@tanstack/react-query";
import { workspacesApi } from "@/api/workspaces";
import { normalizeWorkspace } from "./model";

export const workspaceKeys = {
  detail: (id: string) => ["workspace", id] as const,
  sessions: (id: string) => ["workspace-sessions", id] as const,
};

export const workspaceDetailQuery = (id: string) => queryOptions({
  queryKey: workspaceKeys.detail(id),
  queryFn: ({ signal }) => workspacesApi.detail(id, signal).then(normalizeWorkspace),
});

export const workspaceSessionsQuery = (id: string) => queryOptions({
  queryKey: workspaceKeys.sessions(id),
  queryFn: ({ signal }) => workspacesApi.sessions(id, signal),
});

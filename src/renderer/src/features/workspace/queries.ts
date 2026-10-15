import type { WorkspaceRepository } from "@/domain/types";
import { queryOptions } from "@tanstack/react-query";
import { workspacesApi } from "@/api/workspaces";
import { normalizeWorkspace } from "./model";

export const workspaceKeys = {
  detail: (id: string) => ["workspace", id] as const,
  worktrees: (id: string) => ["workspace-worktrees", id] as const,
  sessions: (id: string) => ["workspace-sessions", id] as const,
};

export const workspaceDetailQuery = (id: string) => queryOptions({
  queryKey: workspaceKeys.detail(id),
  queryFn: ({ signal }) => workspacesApi.detail(id, signal).then(normalizeWorkspace),
  refetchInterval: query => query.state.data?.repositories.some(repository => repository.git_status === "creating") ? 1000 : false,
});

export const workspaceSessionsQuery = (id: string) => queryOptions({
  queryKey: workspaceKeys.sessions(id),
  queryFn: ({ signal }) => workspacesApi.sessions(id, signal),
  refetchInterval: query => query.state.data?.some(session => session.initializing) ? 1000 : false,
});

export const workspaceWorktreesQuery = (id: string, repositories: readonly WorkspaceRepository[]) => queryOptions({
  // A readiness change can arrive through polling when the event stream is offline.
  queryKey: [...workspaceKeys.worktrees(id), repositories.map(repository =>
    [repository.id, repository.git_status, repository.checkout_path],
  )],
  queryFn: ({ signal }) => workspacesApi.worktrees(id, signal),
});

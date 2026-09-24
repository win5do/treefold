import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import type { GitDiffRequest } from "@/domain/types";

export type RepositoryKind = "project" | "workspace";
const apiFor = (kind: RepositoryKind) => kind === "project" ? projectsApi : workspacesApi;

export const gitStatusQuery = (kind: RepositoryKind, id: string) => queryOptions({
  queryKey: ["git-status", kind, id] as const,
  queryFn: ({ signal }) => apiFor(kind).gitStatus(id, signal),
});

export const gitDiffQuery = (kind: RepositoryKind, id: string, request: GitDiffRequest) => queryOptions({
  queryKey: ["git-diff", kind, id, request] as const,
  queryFn: ({ signal }) => apiFor(kind).gitDiff(id, request, signal),
});

/** Invalidate hidden views too, so reopening them cannot reuse pre-mutation data. */
export async function refreshGitQueries(client: QueryClient, kind?: RepositoryKind, id?: string, includeHistory = true) {
  await client.invalidateQueries({
    predicate: ({ queryKey }) => ["git-history", "git-status", "git-diff"].includes(String(queryKey[0]))
      && (includeHistory || queryKey[0] !== "git-history")
      && (kind === undefined || queryKey[1] === kind)
      && (id === undefined || queryKey[2] === id),
  }, { throwOnError: true });
}

import { request } from "./client";
import type {
  DeliveryPreflight,
  FinishProgress,
  GitHistory,
  GitDiffComparison,
  GitDiffRequest,
  GitCommitResult,
  GitStatus,
  GitOperationRecord,
  GitSyncItemResult,
  ParentOperation,
  ParentOperationDirection,
  ParentOperationPreview,
  ParentOperationStrategy,
  Session,
  Workspace,
  WorkspaceDetail,
  WorkspaceLocation,
} from "@/domain/types";

export const workspacesApi = {
  detail: (id: string, signal?: AbortSignal) =>
    request<WorkspaceDetail>(`/api/workspaces/${id}`, { signal }),
  update: (id: string, json: unknown) =>
    request<Workspace>(`/api/workspaces/${id}`, { method: "PATCH", json }),
  delete: (id: string) =>
    request(`/api/workspaces/${id}`, { method: "DELETE" }),
  createFork: (id: string, json: unknown) =>
    request<Workspace>(`/api/workspaces/${id}/forks`, { method: "POST", json }),
  sessions: (id: string, signal?: AbortSignal) =>
    request<Session[]>(`/api/workspaces/${id}/sessions`, { signal }),
  createSession: (id: string, json: unknown) =>
    request<Session>(`/api/workspaces/${id}/sessions`, {
      method: "POST",
      json,
    }),
  reorderSessions: (id: string, sessionIds: string[]) =>
    request(`/api/workspaces/${id}/sessions/order`, {
      method: "PATCH",
      json: { session_ids: sessionIds },
    }),
  reveal: (id: string) =>
    request(`/api/workspaces/${id}/reveal`, { method: "POST" }),
  archive: (id: string) =>
    request(`/api/workspaces/${id}/archive`, { method: "POST" }),
  resync: (id: string) =>
    request<WorkspaceDetail>(`/api/workspaces/${id}/resync`, { method: "POST" }),
  sync: (id: string, action: "pull" | "push") =>
    request<GitSyncItemResult[]>(`/api/workspaces/${id}/git/${action}-all`, {
      method: "POST",
    }),
  updateLocation: (id: string, json: unknown) =>
    request<WorkspaceLocation>(`/api/workspace-repositories/${id}`, {
      method: "PATCH",
      json,
    }),
  syncLocation: (id: string, action: "pull" | "push") =>
    request(`/api/workspace-repositories/${id}/git/${action}`, {
      method: "POST",
    }),
  finishLocation: (id: string, json: unknown) =>
    request<FinishProgress>(`/api/workspace-repositories/${id}/finish`, {
      method: "POST",
      json,
    }),
  parentOperationPreview: (
    id: string,
    direction: ParentOperationDirection,
    signal?: AbortSignal,
  ) =>
    request<ParentOperationPreview>(
      `/api/workspace-repositories/${id}/parent-operation?direction=${direction}`,
      { signal },
    ),
  startParentOperation: (
    id: string,
    direction: ParentOperationDirection,
    strategy: ParentOperationStrategy,
  ) =>
    request<ParentOperation>(
      `/api/workspace-repositories/${id}/parent-operation?direction=${direction}`,
      { method: "POST", json: { strategy } },
    ),
  parentOperation: (id: string, signal?: AbortSignal) =>
    request<ParentOperation>(`/api/parent-operations/${id}`, { signal }),
  resolveParentOperation: (id: string) =>
    request<Session>(`/api/parent-operations/${id}/resolve-with-codex`, {
      method: "POST",
    }),
  abortParentOperation: (id: string) =>
    request<ParentOperation>(`/api/parent-operations/${id}/abort`, {
      method: "POST",
    }),
  undoParentOperation: (id: string) =>
    request<ParentOperation>(`/api/parent-operations/${id}/undo`, {
      method: "POST",
    }),
  preflight: (id: string, codeAction: string, signal?: AbortSignal) =>
    request<DeliveryPreflight>(
      `/api/workspace-repositories/${id}/delivery-preflight`,
      { method: "POST", json: { code_action: codeAction }, signal },
    ),
  locationHistory: (id: string, signal?: AbortSignal) =>
    request<GitHistory>(`/api/workspace-repositories/${id}/git-history`, {
      signal,
    }),
  compareLocation: (
    id: string,
    input: { start_commit: string; end_commit: string; commit_count: number },
    signal?: AbortSignal,
  ) => request<GitDiffComparison>(`/api/workspace-repositories/${id}/compare`, {
    method: "POST",
    json: input,
    signal,
  }),
  gitStatus: (id: string, signal?: AbortSignal) => request<GitStatus>(`/api/workspace-repositories/${id}/git-status`, { signal }),
  gitDiff: (id: string, input: GitDiffRequest, signal?: AbortSignal) => request<GitDiffComparison>(`/api/workspace-repositories/${id}/git-diff`, { method: "POST", json: input, signal }),
  stage: (id: string, paths: string[]) => request<GitStatus>(`/api/workspace-repositories/${id}/git/stage`, { method: "POST", json: { paths } }),
  unstage: (id: string, paths: string[]) => request<GitStatus>(`/api/workspace-repositories/${id}/git/unstage`, { method: "POST", json: { paths } }),
  commit: (id: string, message: string, expected_snapshot: string) => request<GitCommitResult>(`/api/workspace-repositories/${id}/git/commit`, { method: "POST", json: { message, expected_snapshot } }),
};

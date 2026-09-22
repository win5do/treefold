import { request } from "./client";
import type {
  DeliveryPreflight,
  FinishBatch,
  FinishPlanItem,
  GitHistory,
  GitDiffComparison,
  GitDiffRequest,
  GitCommitResult,
  GitStatus,
  GitSyncItemResult,
  ParentOperation,
  ParentOperationDirection,
  ParentOperationPreview,
  ParentOperationStrategy,
  Session,
  Workspace,
  WorkspaceDetail,
  WorkspaceRepository,
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
  resync: (id: string) =>
    request<WorkspaceDetail>(`/api/workspaces/${id}/resync`, { method: "POST" }),
  sync: (id: string, action: "pull" | "push") =>
    request<GitSyncItemResult[]>(`/api/workspaces/${id}/git/${action}-all`, {
      method: "POST",
    }),
  updateRepository: (id: string, json: unknown) =>
    request<WorkspaceRepository>(`/api/workspace-repositories/${id}`, {
      method: "PATCH",
      json,
    }),
  syncRepository: (id: string, action: "pull" | "push") =>
    request(`/api/workspace-repositories/${id}/git/${action}`, {
      method: "POST",
    }),
  finishBatch: (id: string) =>
    request<FinishBatch | null>(`/api/workspaces/${id}/finish-batch`),
  startFinishBatch: (id: string, repositories: FinishPlanItem[]) =>
    request<FinishBatch>(`/api/workspaces/${id}/finish-batch`, {
      method: "POST", json: { repositories },
    }),
  forceResumeFinishBatch: (id: string, repositoryIds: string[]) =>
    request<FinishBatch>(`/api/workspaces/${id}/finish-batch/force-resume`, { method: "POST", json: { repository_ids: repositoryIds } }),
  resumeFinishBatch: (id: string) =>
    request<FinishBatch>(`/api/workspaces/${id}/finish-batch/resume`, { method: "POST" }),
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
  repositoryHistory: (id: string, signal?: AbortSignal) =>
    request<GitHistory>(`/api/workspace-repositories/${id}/git-history`, {
      signal,
    }),
  gitStatus: (id: string, signal?: AbortSignal) => request<GitStatus>(`/api/workspace-repositories/${id}/git-status`, { signal }),
  gitDiff: (id: string, input: GitDiffRequest, signal?: AbortSignal) => request<GitDiffComparison>(`/api/workspace-repositories/${id}/git-diff`, { method: "POST", json: input, signal }),
  stage: (id: string, paths: string[]) => request<GitStatus>(`/api/workspace-repositories/${id}/git/stage`, { method: "POST", json: { paths } }),
  unstage: (id: string, paths: string[]) => request<GitStatus>(`/api/workspace-repositories/${id}/git/unstage`, { method: "POST", json: { paths } }),
  commit: (id: string, message: string, expected_snapshot: string) => request<GitCommitResult>(`/api/workspace-repositories/${id}/git/commit`, { method: "POST", json: { message, expected_snapshot } }),
  revertCommit: (id: string, commit: string) => request<GitHistory>(`/api/workspace-repositories/${id}/git/revert`, { method: "POST", json: { commit } }),
  resetCommit: (id: string, commit: string, mode: "soft" | "mixed" | "hard") => request<GitHistory>(`/api/workspace-repositories/${id}/git/reset`, { method: "POST", json: { commit, mode } }),
};

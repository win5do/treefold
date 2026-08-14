import { request } from "./client";
import type { DeliveryPreflight, GitHistory, GitOperationRecord, Session, Workspace, WorkspaceDetail, WorkspaceLocation } from "@/domain/types";

export const workspacesApi = {
  detail: (id: string, signal?: AbortSignal) => request<WorkspaceDetail>(`/api/workspaces/${id}`, { signal }),
  update: (id: string, json: unknown) => request<Workspace>(`/api/workspaces/${id}`, { method: "PATCH", json }),
  delete: (id: string) => request(`/api/workspaces/${id}`, { method: "DELETE" }),
  createFork: (id: string, json: unknown) => request<Workspace>(`/api/workspaces/${id}/forks`, { method: "POST", json }),
  sessions: (id: string, signal?: AbortSignal) => request<Session[]>(`/api/workspaces/${id}/sessions`, { signal }),
  createSession: (id: string, json: unknown) => request<Session>(`/api/workspaces/${id}/sessions`, { method: "POST", json }),
  reorderSessions: (id: string, sessionIds: string[]) => request(`/api/workspaces/${id}/sessions/order`, { method: "PATCH", json: { session_ids: sessionIds } }),
  reveal: (id: string) => request(`/api/workspaces/${id}/reveal`, { method: "POST" }),
  archive: (id: string) => request(`/api/workspaces/${id}/archive`, { method: "POST" }),
  sync: (id: string, action: "pull" | "push") => request(`/api/workspaces/${id}/git/${action}-all`, { method: "POST" }),
  updateLocation: (id: string, json: unknown) => request<WorkspaceLocation>(`/api/workspace-locations/${id}`, { method: "PATCH", json }),
  syncLocation: (id: string, action: "pull" | "push") => request(`/api/workspace-locations/${id}/git/${action}`, { method: "POST" }),
  finishLocation: (id: string, json: unknown) => request(`/api/workspace-locations/${id}/finish`, { method: "POST", json }),
  preflight: (id: string, codeAction: string, signal?: AbortSignal) => request<DeliveryPreflight>(`/api/workspace-locations/${id}/delivery-preflight`, { method: "POST", json: { code_action: codeAction }, signal }),
  history: (id: string, signal?: AbortSignal) => request<GitHistory>(`/api/workspaces/${id}/git-history`, { signal }),
  locationHistory: (id: string, signal?: AbortSignal) => request<GitHistory>(`/api/workspace-locations/${id}/git-history`, { signal }),
  operations: (id: string, signal?: AbortSignal) => request<GitOperationRecord[]>(`/api/workspaces/${id}/git-operations`, { signal }),
};

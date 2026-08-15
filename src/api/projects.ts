import { request } from "./client";
import type {
  Directory,
  GitHistory,
  GitWorktree,
  Project,
  ProjectDetail,
  ProjectLocationInspection,
  ProjectRepository,
  ProjectSummary,
  Session,
  SidebarData,
  Workspace,
} from "@/domain/types";

export const projectsApi = {
  summaries: (signal?: AbortSignal) =>
    request<ProjectSummary[]>("/api/projects/summary", { signal }),
  sidebar: (signal?: AbortSignal) =>
    request<SidebarData>("/api/sidebar", { signal }),
  detail: (id: string, signal?: AbortSignal) =>
    request<ProjectDetail>(`/api/projects/${id}`, { signal }),
  create: (json: unknown) =>
    request<Project>("/api/projects", { method: "POST", json }),
  update: (id: string, json: unknown) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", json }),
  delete: (id: string) => request(`/api/projects/${id}`, { method: "DELETE" }),
  sessions: (id: string, signal?: AbortSignal) =>
    request<Session[]>(`/api/projects/${id}/sessions`, { signal }),
  createSession: (id: string, json: unknown) =>
    request<Session>(`/api/projects/${id}/sessions`, { method: "POST", json }),
  createWorkspace: (id: string, json: unknown) =>
    request<Workspace>(`/api/projects/${id}/workspaces`, {
      method: "POST",
      json,
    }),
  addLocation: (id: string, json: unknown) =>
    request<Directory>(`/api/projects/${id}/directories`, {
      method: "POST",
      json,
    }),
  inspectLocation: (path: string, projectId?: string, signal?: AbortSignal) =>
    request<ProjectLocationInspection>("/api/project-directories/inspect", {
      method: "POST",
      json: { path, project_id: projectId },
      signal,
    }),
  updateLocation: (id: string, json: unknown) =>
    request<Directory>(`/api/project-directories/${id}`, {
      method: "PATCH",
      json,
    }),
  refreshLocation: (id: string) =>
    request<Directory>(`/api/project-directories/${id}/refresh`, {
      method: "POST",
    }),
  repositories: (id: string, signal?: AbortSignal) =>
    request<ProjectRepository[]>(`/api/projects/${id}/repositories`, {
      signal,
    }),
  updateRepository: (id: string, json: unknown) =>
    request<ProjectRepository>(`/api/project-repositories/${id}`, {
      method: "PATCH",
      json,
    }),
  refreshRepository: (id: string) =>
    request<ProjectRepository>(`/api/project-repositories/${id}/refresh`, {
      method: "POST",
    }),
  reattachLocation: (id: string, path: string) =>
    request<ProjectRepository>(`/api/project-repositories/${id}/reattach`, {
      method: "POST",
      json: { path },
    }),
  removeWorktree: (repositoryId: string, worktree: GitWorktree) =>
    request(`/api/project-repositories/${repositoryId}/worktrees`, {
      method: "DELETE",
      json: { path: worktree.path },
    }),
  reveal: (id: string) =>
    request(`/api/projects/${id}/reveal`, { method: "POST" }),
  sync: (id: string, action: "pull" | "push") =>
    request(`/api/projects/${id}/git/${action}-all`, { method: "POST" }),
  syncLocation: (id: string, action: "pull" | "push") =>
    request(`/api/project-repositories/${id}/git/${action}`, {
      method: "POST",
    }),
  history: (id: string, signal?: AbortSignal) =>
    request<GitHistory>(`/api/project-repositories/${id}/git-history`, {
      signal,
    }),
};

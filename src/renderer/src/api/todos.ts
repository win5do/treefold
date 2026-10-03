import { request } from "./client";
import type { AgentKind, Session, Todo, Workspace } from "@/domain/types";

export type TodoForkResult = {
  fork: Workspace;
  session?: Session;
  session_error?: string;
};

export const todosApi = {
  create: (workspaceId: string, content: string) =>
    request<Todo>(`/api/workspaces/${workspaceId}/todos`, { method: "POST", json: { content } }),
  update: (id: string, json: { content?: string; status?: "pending" | "done" }) =>
    request<Todo>(`/api/todos/${id}`, { method: "PATCH", json }),
  delete: (id: string) => request(`/api/todos/${id}`, { method: "DELETE" }),
  createFork: (id: string, agentKind?: AgentKind) => request<TodoForkResult>(`/api/todos/${id}/fork${agentKind ? `?agent_kind=${agentKind}` : ""}`, { method: "POST" }),
};

import { request } from "@/api/client";
import type { AgentKind, Session } from "@/domain/types";

export type ReviewRepository = {
  repository_id: string;
  name: string;
  current_path: string;
  current_branch: string;
  current_head: string;
  target_path: string;
  target_branch: string;
  target_head: string;
  merge_base: string;
};

export const agentReviewApi = {
  context: (id: string, signal?: AbortSignal) =>
    request<{ repositories: ReviewRepository[] }>(`/api/workspaces/${id}/agent-review`, { signal }),
  start: (id: string, input: { kind: AgentKind; prompt: string; project_directory_id: string }) =>
    request<Session>(`/api/workspaces/${id}/agent-review`, { method: "POST", json: input }),
};

import { request } from "@/api/client";
import type { GitHistory } from "@/domain/types";

export type RewordPreview = { head: string; branch: string; message: string; shared_refs: string[] };
type RewordRequest =
  | { action: "preview"; expected_head: string }
  | { action: "apply"; expected_head: string; expected_branch: string; message: string; confirmed_refs: string[] };
export function rewordCommit(kind: "project" | "workspace", id: string, input: RewordRequest, signal?: AbortSignal) {
  return request<{ preview: RewordPreview | null; history: GitHistory | null }>(
    `/api/${kind}-repositories/${id}/git/reword`, { method: "POST", json: input, signal },
  );
}

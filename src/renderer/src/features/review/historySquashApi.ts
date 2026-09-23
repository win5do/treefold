import { request } from "@/api/client";
import type { GitHistory } from "@/domain/types";

export type SquashPreview = {
  base: string;
  branch: string;
  selected_count: number;
  replayed_count: number;
  shared_branches: string[];
};
type SquashRequest =
  | { action: "preview"; commits: string[]; expected_head: string }
  | { action: "apply"; commits: string[]; expected_head: string; message: string }
  | { action: "undo"; recovery_id: string; expected_head: string };
export function historySquash(
  kind: "project" | "workspace", id: string, input: SquashRequest, signal?: AbortSignal,
) {
  return request<{ preview: SquashPreview | null; history: GitHistory | null; recovery_id: string | null }>(
    `/api/${kind}-repositories/${id}/git/squash`, { method: "POST", json: input, signal },
  );
}

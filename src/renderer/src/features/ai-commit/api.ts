import { request } from "@/api/client";
import type { AgentKind, AiCommitSettings } from "@/domain/types";
export type { AiCommitSettings } from "@/domain/types";
export const DEFAULT_AI_COMMIT: AiCommitSettings = {
  command: "",
  automatic: false,
};
export type Source =
  | { kind: "staged"; expected_snapshot: string }
  | { kind: "history"; commits: string[]; expected_head: string }
  | { kind: "delivery"; expected_head: string; expected_target_head: string };
export type GenerationInput = {
  repository_kind: "project" | "workspace";
  repository_id: string;
  source: Source;
};
export type Job = {
  id: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "timed_out"
    | "canceled";
  message: string | null;
  error: string | null;
  elapsed_ms: number;
};
export type Preset = { kind: AgentKind; command: string };
export const presetsQuery = () => ({
  queryKey: ["ai-commit-presets"],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    request<Preset[]>("/api/ai-commit/presets", { signal }),
});
const abortError = () => new DOMException("Canceled", "AbortError");
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 400);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function runGeneration(
  input: GenerationInput | { command: string },
  signal: AbortSignal,
  onStatus: (status: Job["status"]) => void,
): Promise<Job> {
  // Finish creation even after UI cancellation so the server-issued id can be
  // canceled. Aborting this POST could orphan a job whose response was lost.
  const job = await request<Job>(
    `/api/ai-commit/${"command" in input ? "test" : "generate"}`,
    { method: "POST", json: input },
  );
  let terminal = false;
  try {
    let next = job;
    while (true) {
      if (signal.aborted) throw abortError();
      onStatus(next.status);
      if (next.status !== "queued" && next.status !== "running") {
        terminal = true;
        return next;
      }
      await delay(signal);
      next = await request<Job>(`/api/ai-commit/jobs/${job.id}`, { signal });
    }
  } finally {
    if (!terminal)
      await request(`/api/ai-commit/jobs/${job.id}`, {
        method: "DELETE",
      }).catch(() => undefined);
  }
}
export function openAiCommitSettings() {
  window.dispatchEvent(new Event("treefold:ai-commit-settings"));
}

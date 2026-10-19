import { request } from "@/api/client";

export type FinishProcess = {
  session_id: string;
  name: string;
  kind: string;
  state: "created" | "starting" | "running" | "stopping";
  pid: number;
};

export const finishProcesses = (id: string, signal: AbortSignal) =>
  request<FinishProcess[]>(`/api/workspaces/${id}/finish-processes`, { signal });

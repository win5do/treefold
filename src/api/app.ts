import { request } from "./client";
import type { AmuxStatus, AppSettings, BackgroundProcess, SystemStatus } from "@/domain/types";

export const appApi = {
  system: (signal?: AbortSignal) => request<SystemStatus>("/api/system", { signal }),
  settings: (signal?: AbortSignal) => request<AppSettings>("/api/settings", { signal }),
  updateSettings: (json: unknown) => request<AppSettings>("/api/settings", { method: "PATCH", json }),
  amuxStatus: (signal?: AbortSignal) => request<AmuxStatus>("/api/amux", { signal }),
  stopAmux: () => request<void>("/api/amux/stop", { method: "POST" }),
  backgroundProcesses: (signal?: AbortSignal) => request<BackgroundProcess[]>("/api/processes", { signal }),
  runtimeRevision: (signal?: AbortSignal) => request<{ instance_id: string; revision: number }>("/api/events/revision", { signal }),
};

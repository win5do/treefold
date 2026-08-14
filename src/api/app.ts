import { request } from "./client";
import type { AppSettings, SystemStatus } from "@/domain/types";

export const appApi = {
  system: (signal?: AbortSignal) => request<SystemStatus>("/api/system", { signal }),
  settings: (signal?: AbortSignal) => request<AppSettings>("/api/settings", { signal }),
  updateSettings: (json: unknown) => request<AppSettings>("/api/settings", { method: "PATCH", json }),
};

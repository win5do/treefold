import { request } from "./client";
import type { AgentIntegrationStatus, AmuxStatus, AppSettings, BackgroundProcess, SystemStatus } from "@/domain/types";

export const appApi = {
  system: (signal?: AbortSignal) => request<SystemStatus>("/api/system", { signal }),
  settings: (signal?: AbortSignal) => request<AppSettings>("/api/settings", { signal }),
  updateSettings: (json: unknown) => request<AppSettings>("/api/settings", { method: "PATCH", json }),
  amuxStatus: (signal?: AbortSignal) => request<AmuxStatus>("/api/amux", { signal }),
  stopAmux: () => request<void>("/api/amux/stop", { method: "POST" }),
  agentIntegration: (signal?: AbortSignal) => request<AgentIntegrationStatus>("/api/agent-integration", { signal }),
  syncAgentIntegration: () => request<AgentIntegrationStatus>("/api/agent-integration", { method: "POST" }),
  uninstallAgentIntegration: () => request<AgentIntegrationStatus>("/api/agent-integration", { method: "DELETE" }),
  backgroundProcesses: (signal?: AbortSignal) => request<BackgroundProcess[]>("/api/processes", { signal }),
  runtimeRevision: (signal?: AbortSignal) => request<{ instance_id: string; revision: number }>("/api/events/revision", { signal }),
};

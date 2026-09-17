import { queryOptions } from "@tanstack/react-query";
import { appApi } from "@/api/app";

export const appKeys = {
  system: ["system"] as const,
  settings: ["settings"] as const,
  amux: ["amux"] as const,
  agentIntegration: ["agent-integration"] as const,
  processes: ["processes"] as const,
};

export const systemQuery = () => queryOptions({ queryKey: appKeys.system, queryFn: ({ signal }) => appApi.system(signal) });
export const settingsQuery = () => queryOptions({ queryKey: appKeys.settings, queryFn: ({ signal }) => appApi.settings(signal) });
export const amuxQuery = () => queryOptions({ queryKey: appKeys.amux, queryFn: ({ signal }) => appApi.amuxStatus(signal) });
export const agentIntegrationQuery = () => queryOptions({ queryKey: appKeys.agentIntegration, queryFn: ({ signal }) => appApi.agentIntegration(signal) });

import { queryOptions } from "@tanstack/react-query";
import { appApi } from "@/api/app";

export const appKeys = {
  system: ["system"] as const,
  settings: ["settings"] as const,
};

export const systemQuery = () => queryOptions({ queryKey: appKeys.system, queryFn: ({ signal }) => appApi.system(signal) });
export const settingsQuery = () => queryOptions({ queryKey: appKeys.settings, queryFn: ({ signal }) => appApi.settings(signal) });

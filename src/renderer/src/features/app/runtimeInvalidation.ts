import type { QueryClient } from "@tanstack/react-query";
import { refreshQueries } from "./refreshQueries";
import { appKeys } from "@/features/app/queries";
import { projectKeys } from "@/features/projects/queries";
import { frontendLogger } from "@/lib/logger";

export type RuntimeDomain = "sidebar" | "sessions" | "processes" | "amux";

export const allRuntimeDomains: RuntimeDomain[] = [
  "sidebar",
  "sessions",
  "processes",
  "amux",
];

const hierarchyKeys = [projectKeys.summaries, projectKeys.sidebar, ["project"], ["project-worktrees"], ["workspace"], ["workspace-worktrees"]];

export async function invalidateHierarchyQueries(queryClient: QueryClient) {
  await invalidateRuntimeQueries(queryClient, ["sidebar"]);
}

function runtimeQueryKeys(domains: readonly RuntimeDomain[]) {
  return [
    ...(domains.includes("sidebar") ? hierarchyKeys : []),
    ...(domains.includes("sessions") ? [["project-sessions"], ["workspace-sessions"]] : []),
    ...(domains.includes("processes") ? [appKeys.processes] : []),
    ...(domains.includes("amux") ? [appKeys.amux] : []),
  ];
}

export async function invalidateRuntimeQueries(
  queryClient: QueryClient,
  domains: readonly RuntimeDomain[] = allRuntimeDomains,
  { throwOnError = false }: { throwOnError?: boolean } = {},
) {
  const keys = runtimeQueryKeys(domains);
  try {
    await refreshQueries(queryClient, { predicate: query => keys.some(key => key[0] === query.queryKey[0]) }, { throwOnError: true });
  } catch (error) {
    if (throwOnError) throw error;
    frontendLogger.error("Runtime refresh failed", error);
  }
}

export async function refreshRuntimeQueries(queryClient: QueryClient, domains: readonly RuntimeDomain[], signal: AbortSignal) {
  if (signal.aborted) return;
  await invalidateRuntimeQueries(queryClient, domains, { throwOnError: true });
}

import type { InvalidateOptions, QueryClient } from "@tanstack/react-query";
import { appKeys } from "@/features/app/queries";
import { projectKeys } from "@/features/projects/queries";

export type RuntimeDomain = "sidebar" | "sessions" | "processes" | "amux";

export const allRuntimeDomains: RuntimeDomain[] = [
  "sidebar",
  "sessions",
  "processes",
  "amux",
];

const hierarchyKeys = [projectKeys.summaries, projectKeys.sidebar, ["project"], ["workspace"], ["workspace-worktrees"]];

export async function invalidateHierarchyQueries(queryClient: QueryClient) {
  await Promise.all(hierarchyKeys.map(queryKey => queryClient.invalidateQueries({ queryKey })));
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
  options: InvalidateOptions = {},
) {
  await Promise.all(runtimeQueryKeys(domains).map(queryKey => queryClient.invalidateQueries({ queryKey }, options)));
}

export async function refreshRuntimeQueries(queryClient: QueryClient, domains: readonly RuntimeDomain[], signal: AbortSignal) {
  // A focus/manual refresh may already be in flight. Let it finish, then fetch
  // the event's state rather than cancelling it or reusing a stale response.
  const inFlight = runtimeQueryKeys(domains).flatMap(queryKey =>
    queryClient.getQueryCache().findAll({ queryKey, fetchStatus: "fetching" }).map(query => query.promise),
  );
  await Promise.allSettled(inFlight);
  if (signal.aborted) return;
  await invalidateRuntimeQueries(queryClient, domains, { cancelRefetch: false });
}

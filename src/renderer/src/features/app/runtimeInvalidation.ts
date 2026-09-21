import type { QueryClient } from "@tanstack/react-query";
import { appKeys } from "@/features/app/queries";
import { projectKeys } from "@/features/projects/queries";

export type RuntimeDomain = "sidebar" | "sessions" | "processes" | "amux";

export const allRuntimeDomains: RuntimeDomain[] = [
  "sidebar",
  "sessions",
  "processes",
  "amux",
];

export async function invalidateHierarchyQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: projectKeys.summaries }),
    queryClient.invalidateQueries({ queryKey: projectKeys.sidebar }),
    queryClient.invalidateQueries({ queryKey: ["project"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  ]);
}

export async function invalidateRuntimeQueries(
  queryClient: QueryClient,
  domains: readonly RuntimeDomain[] = allRuntimeDomains,
) {
  const invalidations: Promise<void>[] = [];
  if (domains.includes("sidebar")) {
    invalidations.push(invalidateHierarchyQueries(queryClient));
  }
  if (domains.includes("sessions")) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: ["project-sessions"] }));
    invalidations.push(queryClient.invalidateQueries({ queryKey: ["workspace-sessions"] }));
  }
  if (domains.includes("processes")) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: appKeys.processes }));
  }
  if (domains.includes("amux")) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: appKeys.amux }));
  }
  await Promise.all(invalidations);
}

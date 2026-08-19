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

export async function invalidateRuntimeQueries(
  queryClient: QueryClient,
  domains: readonly RuntimeDomain[] = allRuntimeDomains,
) {
  const invalidations: Promise<void>[] = [];
  if (domains.includes("sidebar")) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: projectKeys.sidebar }));
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

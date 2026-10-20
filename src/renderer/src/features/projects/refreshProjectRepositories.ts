import type { QueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/api/projects";
import type { ProjectDetail } from "@/domain/types";
import { refreshQueries } from "@/features/app/refreshQueries";
import { projectKeys } from "./queries";

/** Each repository publishes its result without waiting for its peers. */
export function refreshProjectRepositories(
  client: QueryClient,
  project: ProjectDetail | undefined,
  reportError: (cause: unknown) => void,
): Promise<void>[] {
  if (!project || project.status !== "active") return [];
  return project.repositories.map(async repository => {
    try {
      await projectsApi.refreshRepository(repository.id);
      // Reload metadata after the observation has been persisted. Query-level
      // serialization also prevents an older in-flight read winning this race.
      await refreshQueries(client, {
        predicate: ({ queryKey }) =>
          (queryKey[0] === "project" && queryKey[1] === project.id)
          || queryKey[0] === projectKeys.sidebar[0],
      }, { throwOnError: true });
    } catch (cause) {
      reportError(cause);
    }
  });
}

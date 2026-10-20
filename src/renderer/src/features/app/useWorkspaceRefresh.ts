import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectDetail } from "@/domain/types";
import { refreshGitQueries } from "@/features/git/queries";
import { refreshProjectRepositories } from "@/features/projects/refreshProjectRepositories";
import { toast } from "@/lib/toast";
import { frontendLogger } from "@/lib/logger";
import { invalidateRuntimeQueries } from "./runtimeInvalidation";

export function useWorkspaceRefresh(project?: ProjectDetail) {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(0);
  const refresh = async ({ background = false, checkRepositories = false }: { background?: boolean; checkRepositories?: boolean } = {}) => {
    pending.current++;
    setRefreshing(true);
    const reported = new Set<unknown>();
    const reportError = (cause: unknown) => {
      const key = cause instanceof Error ? cause.message : cause;
      if (reported.has(key)) return;
      reported.add(key);
      if (background) frontendLogger.error("Background Workspace refresh failed", cause);
      else toast.errorFrom(cause);
    };
    try {
      // Queries publish results independently and keep their previous data.
      // One failed region must neither stop its peers nor end the busy indicator.
      await Promise.allSettled([
        invalidateRuntimeQueries(client, ["sidebar"], { throwOnError: true }).catch(reportError),
        invalidateRuntimeQueries(client, ["sessions"], { throwOnError: true }).catch(reportError),
        refreshGitQueries(client).catch(reportError),
        ...(checkRepositories ? refreshProjectRepositories(client, project, reportError) : []),
      ]);
    } finally {
      pending.current--;
      setRefreshing(pending.current > 0);
    }
  };
  return { refresh, refreshing };
}

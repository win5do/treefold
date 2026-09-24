import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshGitQueries } from "@/features/git/queries";
import { toast } from "@/lib/toast";

export function useWorkspaceRefresh() {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        client.invalidateQueries({ predicate: ({ queryKey }) => [
          "sidebar", "project-summaries", "project", "workspace",
          "project-sessions", "workspace-sessions",
        ].includes(String(queryKey[0])) }, { throwOnError: true }),
        refreshGitQueries(client),
      ]);
    } catch (cause) {
      toast.errorFrom(cause);
    } finally {
      setRefreshing(false);
    }
  };
  return { refresh, refreshing };
}

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workspacesApi } from "@/api/workspaces";
import type { ArchivedCleanupTask } from "@/domain/types";
import { toast } from "@/lib/toast";

export const archivedCleanupKey = ["archived-cleanup"] as const;
export const archivedCleanupQuery = () => queryOptions({
  queryKey: archivedCleanupKey,
  queryFn: ({ signal }) => workspacesApi.cleanupTasks(signal),
});

export function useStartArchivedCleanup(scope: "project" | "workspace", id: string) {
  const client = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: () => workspacesApi.cleanupArchived(scope, id),
    onSuccess: task => {
      client.setQueryData<ArchivedCleanupTask[]>(archivedCleanupKey, current => {
        // A progress event can beat the POST response. Never replace newer progress.
        const existing = current?.find(item => item.id === task.id);
        if (existing) return current;
        return [...(current ?? []).filter(item => item.scope !== scope || item.scope_id !== id), task];
      });
      void client.invalidateQueries({ queryKey: archivedCleanupKey });
    },
    onError: error => toast.errorFrom(error, t("archivedCleanup.failed")),
  });
}

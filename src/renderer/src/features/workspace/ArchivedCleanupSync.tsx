import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { archivedCleanupQuery } from "./archivedCleanup";
import { invalidateRuntimeQueries } from "@/features/app/runtimeInvalidation";
import { refreshGitQueries } from "@/features/git/queries";
import { toast } from "@/lib/toast";

/** Lives above routes: notifications and fallback polling survive navigation. */
export function ArchivedCleanupSync() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const tasks = useQuery({
    ...archivedCleanupQuery(),
    refetchInterval: query => query.state.data?.some(task => task.status === "running") ? 2_000 : false,
    refetchIntervalInBackground: true,
  });
  const observed = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!tasks.data) return;
    const previous = observed.current;
    observed.current = new Map(tasks.data.map(task => [task.id, `${task.status}:${task.completed}`]));
    // A newly opened renderer does not replay historical completion notifications.
    if (!previous) return;
    let changed = false;
    for (const task of tasks.data) {
      const prior = previous.get(task.id);
      if (prior === `${task.status}:${task.completed}`) continue;
      changed = true;
      if (task.status === "running" || prior?.startsWith("completed:") || prior?.startsWith("failed:")) continue;
      const summary = t("archivedCleanup.result", { deleted: task.deleted_ids.length + task.orphan_paths.length, skipped: task.skipped.length });
      const details = task.skipped.slice(0, 3).map(item => `${item.name}: ${item.reason === "cleanup_blocked" ? item.message : t(`archivedCleanup.reasons.${item.reason}`)}`).join("\n");
      if (task.status === "failed") toast.error(`${task.scope_name}: ${t("archivedCleanup.failed")}`, { description: task.error ?? summary });
      else if (task.skipped.length) toast.warning(`${task.scope_name}: ${summary}`, { description: details, timeout: 8_000 });
      else toast.success(`${task.scope_name}: ${summary}`);
    }
    if (changed) {
      // Also refresh after polling recovery and partial filesystem failures. Do not
      // make task completion wait for unrelated, potentially slow Git reads.
      void invalidateRuntimeQueries(client, ["sidebar", "sessions"]);
      void refreshGitQueries(client).catch(() => {});
    }
  }, [tasks.data, client, t]);
  return null;
}

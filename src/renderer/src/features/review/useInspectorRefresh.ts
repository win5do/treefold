import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshQueries } from "@/features/app/refreshQueries";

export type InspectorTab = "info" | "changes" | "history";

export function useInspectorRefresh({ open, tab, repositoryId, projectId, workspaceId, sessionId }: {
  open: boolean;
  tab: InspectorTab;
  repositoryId: string;
  projectId: string;
  workspaceId?: string;
  sessionId?: string;
}) {
  const client = useQueryClient();
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const foregroundRefreshes = useRef(0);
  const [error, setError] = useState("");
  const kind = workspaceId ? "workspace" : "project";
  const ownerId = workspaceId ?? projectId;
  const filters = {
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => tab === "info"
      ? queryKey[1] === ownerId && (queryKey[0] === kind || queryKey[0] === `${kind}-sessions`)
      : Boolean(repositoryId) && queryKey[0] === (tab === "changes" ? "git-status" : "git-history")
        && queryKey[1] === kind && queryKey[2] === repositoryId,
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    foregroundRefreshes.current++;
    setPending(true);
    setError("");
    // Explicit refresh bypasses staleTime, including repeat clicks on the active tab.
    // The shared queue also waits for an older in-flight request before reading again.
    void refreshQueries(client, filters, { throwOnError: true })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => {
        foregroundRefreshes.current--;
        if (active) setPending(false);
      });
    return () => { active = false; };
  }, [client, open, tab, repositoryId, kind, ownerId, sessionId, revision]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || foregroundRefreshes.current > 0) return;
      // Poll only this tab's active queries, without cancelling ongoing reads or
      // showing foreground loading. Slow requests must not accumulate refreshes.
      const queries = client.getQueryCache().findAll(filters);
      if (queries.some(query => query.state.fetchStatus === "fetching")) return;
      void client.refetchQueries({ ...filters, type: "active" }, { cancelRefetch: false });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [client, open, tab, repositoryId, kind, ownerId, sessionId]);

  return { refreshing: open && pending, error, refresh: () => setRevision(value => value + 1) };
}

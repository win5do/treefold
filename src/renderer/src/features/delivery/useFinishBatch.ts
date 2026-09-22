import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workspacesApi } from "@/api/workspaces";
import type {
  DeliveryPreflight,
  FinishBatch,
  FinishPlanItem,
  WorkspaceDetail,
} from "@/domain/types";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";

type Draft = Omit<FinishPlanItem, "repository_id" | "preflight_id">;
export function useFinishBatch(workspace: WorkspaceDetail | null) {
  const client = useQueryClient();
  const [batch, setBatch] = useState<FinishBatch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preflights, setPreflights] = useState<
    Record<string, DeliveryPreflight>
  >({});
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const repositories =
    workspace?.repositories.filter(
      (item) =>
        item.access_mode === "read_write" &&
        ["active", "published", "failed", "conflicted"].includes(
          item.delivery_status,
        ),
    ) ?? [];

  useEffect(() => {
    setBatch(null);
    setLoaded(false);
    setError("");
    setPreflights({});
    setChecks({});
    if (!workspace) return;
    setDrafts(
      Object.fromEntries(
        repositories.map((item) => {
          const code_action: Draft["code_action"] =
            workspace.kind === "fork"
              ? "local_merge"
              : item.delivery_mode === "keep"
                ? "keep"
                : item.delivery_mode === "push_branch" && item.remote_name
                  ? "push_branch"
                  : "local_merge";
          return [
            item.id,
            {
              code_action,
              delete_worktree: code_action !== "keep",
              delete_branch: code_action !== "keep",
            },
          ];
        }),
      ),
    );
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = "";
    const poll = async () => {
      try {
        const next = await workspacesApi.finishBatch(workspace.id);
        if (stopped) return;
        setBatch(next);
        setLoaded(true);
        setError("");
        const fingerprint = JSON.stringify(next);
        if (previous && fingerprint !== previous)
          void invalidateHierarchyQueries(client);
        previous = fingerprint;
        if (next && next.status !== "completed")
          timer = setTimeout(() => void poll(), 1000);
      } catch (cause) {
        if (stopped) return;
        setError(String(cause));
        timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workspace?.id, revision, client]);

  useEffect(() => {
    if (!workspace || !loaded || batch) return;
    const controller = new AbortController();
    setPreflights({});
    setChecks(Object.fromEntries(Object.keys(drafts).map((id) => [id, ""])));
    for (const [id, draft] of Object.entries(drafts)) {
      void workspacesApi
        .preflight(id, draft.code_action, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted)
            setPreflights((current) => ({ ...current, [id]: value }));
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setChecks((current) => ({ ...current, [id]: String(cause) }));
        });
    }
    return () => controller.abort();
  }, [workspace?.id, loaded, Boolean(batch), drafts]);

  const ready =
    loaded &&
    !batch &&
    (repositories.length > 0 ||
      Boolean(
        workspace?.repositories.every((item) =>
          ["delivered", "pushed", "kept", "discarded"].includes(
            item.delivery_status,
          ),
        ),
      )) &&
    repositories.every(
      (item) =>
        preflights[item.id] &&
        !preflights[item.id].blockers.length &&
        !checks[item.id],
    );
  const execute = async () => {
    if (!workspace || busy || (!batch && !ready)) return;
    setBusy(true);
    setError("");
    try {
      const next = batch
        ? await workspacesApi.resumeFinishBatch(workspace.id)
        : await workspacesApi.startFinishBatch(
            workspace.id,
            repositories.map((item) => ({
              repository_id: item.id,
              ...drafts[item.id],
              preflight_id: preflights[item.id].id,
            })),
          );
      setBatch(next);
      setRevision((value) => value + 1);
      await invalidateHierarchyQueries(client);
    } catch (cause) {
      setError(String(cause));
      // A lost response does not mean that the backend rejected the batch.
      try {
        if (await workspacesApi.finishBatch(workspace.id)) {
          setRevision((value) => value + 1);
          await invalidateHierarchyQueries(client);
        }
      } catch {
        /* Keep the original error until the operation can be reopened. */
      }
    } finally {
      setBusy(false);
    }
  };
  return {
    batch,
    loaded,
    drafts,
    preflights,
    checks,
    ready,
    busy,
    error,
    execute,
    update: (id: string, update: Partial<Draft>) =>
      setDrafts((current) => ({
        ...current,
        [id]: { ...current[id], ...update },
      })),
    recheck: () => setDrafts((current) => ({ ...current })),
  };
}

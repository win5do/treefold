import { useTranslation } from "react-i18next";
import { useEffect, useState, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workspacesApi } from "@/api/workspaces";
import type {
  DeliveryPreflight,
  FinishBatch,
  FinishPlanItem,
  WorkspaceDetail,
} from "@/domain/types";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";

import {
  finishError,
  finishErrorText,
  isWorktreeError,
  type FinishError,
} from "./finishErrors";

type Draft = Omit<FinishPlanItem, "repository_id" | "preflight_id">;
type DeliveryChoice = { action: Exclude<Draft["code_action"], "skip">; continueWork: boolean };
export function useFinishBatch(workspace: WorkspaceDetail | null) {
  const client = useQueryClient();
  const { t } = useTranslation();
  const [continueWork, setContinueWork] = useState(false);
  const [forkAction, setForkAction] = useState<"local_merge" | "squash_merge" | "push_branch" | "keep">("local_merge");
  const showResult = useRef(false);
  const settingsDraft = useRef<(DeliveryChoice & { workspaceId: string }) | null>(null);
  useEffect(() => {
    const draft = settingsDraft.current?.workspaceId === workspace?.id
      ? settingsDraft.current : null;
    setContinueWork(draft?.continueWork ?? false);
    setForkAction(draft?.action ?? workspace?.default_delivery ?? "local_merge");
    if (draft) settingsDraft.current = null;
    showResult.current = false;
  }, [workspace?.id]);
  const [batch, setBatch] = useState<FinishBatch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>({});
  const [storedDrafts, setDrafts] = useState<Record<string, Draft>>({});
  const drafts = useMemo(() => workspace && !batch
    ? Object.fromEntries(Object.entries(storedDrafts).map(([id, draft]) => [id, { ...draft, code_action: forkAction, delete_worktree: false, delete_branch: false }]))
    : storedDrafts, [storedDrafts, workspace?.kind, batch, continueWork, forkAction]);
  const [preflights, setPreflights] = useState<
    Record<string, DeliveryPreflight>
  >({});
  const [checks, setChecks] = useState<Record<string, FinishError>>({});
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
    setCommitMessages({});
    setLoaded(false);
    setError("");
    setPreflights({});
    setChecks({});
    if (!workspace) return;
    setDrafts(
      Object.fromEntries(
        repositories.map((item) => {
          const code_action = workspace.default_delivery ?? "local_merge";
          return [
            item.id,
            {
              code_action,
              delete_worktree: false,
              delete_branch: false,
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
        setBatch(next?.continue_work && next.status === "completed" && !showResult.current ? null : next);
        if (next && next.status !== "completed") {
          setContinueWork(Boolean(next.continue_work));
          setDrafts(Object.fromEntries(next.items.map(item => [item.repository_id, { code_action: item.code_action, delete_worktree: item.delete_worktree, delete_branch: item.delete_branch }])));
        }
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
        setError(finishErrorText(finishError(cause), t));
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
    // Recheck paused legacy batches too: old persisted errors had no structured code.
    if (!workspace || !loaded || (batch && batch.status !== "paused")) return;
    const controller = new AbortController();
    setPreflights({});
    setChecks({});
    const pending = Object.entries(drafts).filter(([id]) =>
      !batch?.items.find((item) => item.repository_id === id)?.cleaned,
    );
    const checkNext = async () => {
      while (!controller.signal.aborted) {
        const entry = pending.shift();
        if (!entry) return;
        const [id, draft] = entry;
        try {
          const value = await workspacesApi.preflight(id, draft.code_action, controller.signal);
          if (!controller.signal.aborted)
            setPreflights((current) => ({ ...current, [id]: value }));
        } catch (cause) {
          if (!controller.signal.aborted)
            setChecks((current) => ({ ...current, [id]: finishError(cause) }));
        }
      }
    };
    const workers = Math.min(4, pending.length);
    for (let worker = 0; worker < workers; worker++) void checkNext();
    return () => controller.abort();
  }, [workspace?.id, loaded, batch?.status, drafts]);

  const commitMessage = (id: string) => commitMessages[id] ?? `Squash ${repositories.find(item => item.id === id)?.branch ?? ""}`;
  const validMessage = (id: string) => drafts[id]?.code_action !== "squash_merge" || Boolean(commitMessage(id).trim());

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
        validMessage(item.id) &&
        (drafts[item.id]?.code_action !== "push_branch" || Boolean(item.remote_name && item.remote_branch)) &&
        preflights[item.id] &&
        preflights[item.id].code_action === drafts[item.id]?.code_action &&
        !preflights[item.id].blockers.length &&
        !checks[item.id],
    );
  const skippedRepositories = (workspace?.repositories ?? []).filter(
    (item) =>
      !batch?.items.find((entry) => entry.repository_id === item.id)?.cleaned &&
      (isWorktreeError(checks[item.id]?.code) ||
        (!drafts[item.id] &&
          isWorktreeError(
            batch?.items.find((entry) => entry.repository_id === item.id)
              ?.error_code,
          ))),
  );
  const skipIds = new Set(skippedRepositories.map((item) => item.id));
  const forceReady =
    !continueWork &&
    loaded &&
    !busy &&
    (!batch || batch.status === "paused") &&
    skipIds.size > 0 &&
    repositories.every(
      (item) =>
        skipIds.has(item.id) ||
        batch?.items.find((entry) => entry.repository_id === item.id)
          ?.cleaned ||
        batch?.items.find((entry) => entry.repository_id === item.id)
          ?.delivered ||
        (validMessage(item.id) && preflights[item.id] &&
          !preflights[item.id].blockers.length &&
          !checks[item.id]),
    );
  const execute = async (force = false): Promise<boolean> => {
    if (
      !workspace ||
      busy ||
      (force ? !forceReady : (!batch && !ready) || skipIds.size > 0)
    )
      return false;
    setBusy(true);
    showResult.current = true;
    setError("");
    try {
      const next = batch
        ? force
          ? await workspacesApi.forceResumeFinishBatch(workspace.id, [
              ...skipIds,
            ])
          : await workspacesApi.resumeFinishBatch(workspace.id)
        : await workspacesApi.startFinishBatch(
            workspace.id,
            repositories.map((item) => ({
              repository_id: item.id,
              ...drafts[item.id],
              ...(force && skipIds.has(item.id)
                ? {
                    code_action: "skip" as const,
                    delete_worktree: false,
                    delete_branch: false,
                  }
                : {}),
              preflight_id: preflights[item.id]?.id ?? "",
              ...(drafts[item.id]?.code_action === "squash_merge" ? { commit_message: commitMessage(item.id) } : {}),
            })),
            continueWork,
          );
      setBatch(next);
      setRevision((value) => value + 1);
      void invalidateHierarchyQueries(client);
      return true;
    } catch (cause) {
      setError(finishErrorText(finishError(cause), t));
      // A lost response does not mean that the backend rejected the batch.
      try {
        const current = await workspacesApi.finishBatch(workspace.id);
        if (current && (current.status !== "paused" || !batch)) {
          setRevision((value) => value + 1);
          void invalidateHierarchyQueries(client);
        }
      } catch {
        /* Keep the original error until the operation can be reopened. */
      }
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    batch,
    continueWork,
    setContinueWork: (value: boolean) => { setContinueWork(value); setForkAction(current => current === "keep" || current === "squash_merge" ? workspace?.default_delivery ?? "local_merge" : current); },
    forkAction,
    setForkAction,
    preserveSettingsDraft: () => {
      if (workspace && !batch)
        settingsDraft.current = { workspaceId: workspace.id, action: forkAction, continueWork };
    },
    loaded,
    drafts,
    commitMessage,
    setCommitMessage: (id: string, message: string) => setCommitMessages(current => ({ ...current, [id]: message })),
    preflights,
    checks,
    ready,
    forceReady,
    skippedRepositories,
    busy,
    error,
    execute,
    recheck: () => setDrafts((current) => ({ ...current })),
  };
}

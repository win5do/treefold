import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ProjectRepository, WorktreePrunePreview } from "@/domain/types";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import { toast } from "@/lib/toast";

export function PruneWorktreesDialog({ repository, onClose }: {
  repository: ProjectRepository;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<WorktreePrunePreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setPreview(null);
    setError("");
    void projectsApi.previewWorktreePrune(repository.id, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setPreview(value); })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [repository.id, version]);

  async function prune() {
    if (!preview || submitting) return;
    setSubmitting(true);
    try {
      await projectsApi.pruneWorktrees(repository.id, preview);
      await invalidateHierarchyQueries(queryClient);
      toast.success(t("projectsUi.worktreePruneCompleted"));
      onClose();
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof ApiError && cause.code === "WORKTREE_PRUNE_CHANGED"
        ? t("projectsUi.worktreePruneChanged")
        : cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <AlertDialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg" data-testid="prune-worktrees-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("projectsUi.worktreePruneTitle", { name: repository.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("projectsUi.worktreePruneDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {checking && <p className="flex items-center gap-2 text-xs"><Spinner />{t("projectsUi.worktreePruneChecking")}</p>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {preview && !preview.report && <p className="text-xs text-muted-foreground">{t("projectsUi.worktreePruneEmpty")}</p>}
          {preview?.report && (
            <div className="flex flex-col gap-3">
              {preview.entries.length > 0 && <ul className="flex flex-col gap-3 text-xs">
                {preview.entries.map((entry) => (
                  <li key={entry.path} className="flex min-w-0 flex-col gap-1">
                    <code className="break-all">{entry.path}</code>
                    <span className="text-muted-foreground">{entry.reason}</span>
                    {entry.workspaces.length > 0 && <span>{t("projectsUi.worktreePruneWorkspaces", { names: entry.workspaces.join(", ") })}</span>}
                  </li>
                ))}
              </ul>}
              <details className="text-xs" open={preview.entries.length === 0}>
                <summary className="cursor-pointer">{t("projectsUi.worktreePruneReport")}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all text-muted-foreground">{preview.report}</pre>
              </details>
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>{t("projectsUi.cancel")}</AlertDialogCancel>
          {error && <Button variant="outline" disabled={checking || submitting} onClick={() => setVersion((value) => value + 1)}>{t("projectsUi.checkAgain")}</Button>}
          <AlertDialogAction disabled={checking || submitting || !preview?.report} onClick={() => void prune()}>
            {submitting && <Spinner data-icon="inline-start" />}
            {t("projectsUi.worktreePruneConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

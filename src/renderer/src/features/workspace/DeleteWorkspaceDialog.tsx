import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateRuntimeQueries } from "@/features/app/runtimeInvalidation";
import { refreshGitQueries } from "@/features/git/queries";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client";
import { workspacesApi } from "@/api/workspaces";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { Workspace, WorkspaceDeletePrecheck } from "@/domain/types";

type DeleteTarget = { kind: "workspace" | "fork"; value: Workspace };

export function DeleteWorkspaceDialog({ target, busy, onOpenChange, onDeleted }: {
  target: DeleteTarget | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (workspace: Workspace) => void;
}) {
  // Remount for every target/open so approval never leaks into another deletion.
  return target ? <DeleteWorkspaceConfirmation key={target.value.id} target={target}
    busy={busy} onOpenChange={onOpenChange} onDeleted={onDeleted} /> : null;
}

function DeleteWorkspaceConfirmation({ target, busy, onOpenChange, onDeleted }: {
  target: DeleteTarget;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (workspace: Workspace) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [keepWorktrees, setKeepWorktrees] = useState(false);
  const [keepBranches, setKeepBranches] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [precheck, setPrecheck] = useState<WorkspaceDeletePrecheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const deleteWorktrees = !keepWorktrees;
  const deleteBranches = !keepWorktrees && !keepBranches;
  const disabled = busy || deleting;

  const errorMessage = useCallback((cause: unknown): string => {
    if (cause instanceof ApiError) {
      if (cause.code === "WORKSPACE_DELETE_CHANGED") return t("overview.deleteBranchesChanged");
      if (cause.code === "WORKSPACE_DELETE_UNDELIVERED") return t("overview.deleteUndeliveredDescription");
      if (cause.code === "FINISH_SESSION_ACTIVE") return t("overview.deleteSessionsActive");
    }
    return cause instanceof Error ? cause.message : t("overview.deletePrecheckFailed");
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setPrecheck(null);
    setDiscard(false);
    void workspacesApi.deletePrecheck(target.value.id, {
      delete_worktrees: deleteWorktrees, delete_branches: deleteBranches,
    }, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPrecheck(result);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setChecking(false);
    });
    return () => controller.abort();
  }, [target.value.id, deleteWorktrees, deleteBranches, revision, errorMessage]);

  function resetCheck() {
    setChecking(true);
    setPrecheck(null);
    setDiscard(false);
    setError("");
  }

  const needsDiscard = deleteBranches && Boolean(precheck?.undelivered_branches.length);
  const canConfirm = !disabled && !checking && precheck !== null
    && (!needsDiscard || (discard && Boolean(precheck.discard_token)));

  async function confirm() {
    if (!canConfirm) return;
    setDeleting(true);
    setError("");
    try {
      await workspacesApi.delete(target.value.id, {
        delete_worktrees: deleteWorktrees,
        delete_branches: deleteBranches,
        ...(needsDiscard && discard && precheck?.discard_token
          ? { discard_token: precheck.discard_token } : {}),
      });
      onDeleted(target.value);
    } catch (cause) {
      setError(errorMessage(cause));
      setDiscard(false);
      setPrecheck(null);
      setChecking(true);
      setRevision(value => value + 1);
    } finally {
      // A filesystem cleanup can fail partway through; refresh retained records too.
      await Promise.allSettled([
        invalidateRuntimeQueries(queryClient, ["sidebar", "sessions"]),
        refreshGitQueries(queryClient),
      ]);
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => { if (!disabled) onOpenChange(open); }}>
      <AlertDialogContent data-testid="delete-record-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            {t("overview.deleteTitle", { type: target.kind === "fork" ? "Fork" : "Workspace", name: target.value.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("overview.deleteRecordConfirmation", { type: target.kind === "fork" ? "Fork" : "Workspace" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox id="delete-keep-worktrees" checked={keepWorktrees} disabled={disabled}
              onCheckedChange={(value) => { resetCheck(); setKeepWorktrees(value); }} />
            <FieldLabel htmlFor="delete-keep-worktrees">{t("overview.keepWorktrees")}</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="delete-keep-branches" checked={keepWorktrees || keepBranches} disabled={disabled || keepWorktrees}
              onCheckedChange={(value) => { resetCheck(); setKeepBranches(value); }} />
            <FieldLabel htmlFor="delete-keep-branches">{t("overview.keepBranches")}</FieldLabel>
          </Field>
          <FieldDescription>{t(keepWorktrees || keepBranches ? "overview.retainedFilesDescription" : "overview.cleanupFilesDescription")}</FieldDescription>
        </FieldGroup>
        {checking && <Alert><Spinner /><AlertTitle>{t("overview.deletePrecheckChecking")}</AlertTitle></Alert>}
        {error && <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("overview.deleteCouldNotProceed")}</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>}
        {!checking && !precheck && <Button variant="outline" disabled={disabled}
          onClick={() => { resetCheck(); setRevision(value => value + 1); }}>{t("overview.deleteCheckAgain")}</Button>}
        {needsDiscard && <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>{t("overview.deleteUndeliveredTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("overview.deleteUndeliveredDescription")}</p>
            <ul className="flex flex-col gap-2 break-words">
              {precheck?.undelivered_branches.map(item => <li key={`${item.workspace_name}:${item.repository_name}:${item.branch}`}>
                <div>{item.workspace_name} / {item.repository_name}</div>
                <div>{t("overview.deleteUndeliveredBranch", { branch: item.branch, count: item.commit_count })}</div>
              </li>)}
            </ul>
          </AlertDescription>
        </Alert>}
        {needsDiscard && <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox id="delete-discard-commits" checked={discard} disabled={disabled}
              onCheckedChange={setDiscard} />
            <FieldLabel htmlFor="delete-discard-commits">{t("overview.deleteDiscardConfirmation")}</FieldLabel>
          </Field>
        </FieldGroup>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disabled}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={!canConfirm} onClick={() => void confirm()}>
            {t(needsDiscard ? "overview.deleteDiscardAndDelete" : "overview.permanentlyDelete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

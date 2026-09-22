import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { workspacesApi } from "@/api/workspaces";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import type { WorkspaceDetail } from "@/domain/types";
import { finishError, finishErrorText, type FinishError } from "./finishErrors";

export function ForceDeleteWorkspace({
  workspace,
  onDeleted,
}: {
  workspace: WorkspaceDetail;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FinishError | null>(null);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await workspacesApi.forceDelete(workspace.id);
      onDeleted();
      void invalidateHierarchyQueries(client);
    } catch (cause) {
      setError(finishError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t("deliveryUi.recovery.forceDelete")}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              {t("deliveryUi.recovery.title", { name: workspace.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                workspace.kind === "fork"
                  ? "deliveryUi.recovery.forkDescription"
                  : "deliveryUi.recovery.workspaceDescription",
              )}{" "}
              {t("deliveryUi.recovery.diskDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {finishErrorText(error, t)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("deliveryUi.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t("deliveryUi.recovery.forceDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

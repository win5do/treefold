import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import type { Workspace } from "@/domain/types";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { toast } from "@/lib/toast";

export function ReopenForkButton({ id, parentId, onNewFork }: { id: string; parentId?: string | null; onNewFork: (parent: Workspace) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const reopen = async (confirmSquash = false) => {
    setBusy(true);
    try {
      await workspacesApi.reopen(id, confirmSquash);
      setConfirm(false);
      await invalidateHierarchyQueries(client);
    } catch (error) {
      if (error instanceof ApiError && error.code === "FORK_REOPEN_SQUASH_CONFIRMATION_REQUIRED") {
        setConfirm(true);
      } else if (error instanceof ApiError && error.code === "FORK_REOPEN_UNAVAILABLE") {
        toast.error(t("workspaceUi.reopenUnavailable"));
      } else if (error instanceof ApiError && error.code === "FINISH_SESSION_ACTIVE") {
        toast.error(t("deliveryUi.recovery.sessionActive"));
      } else {
        toast.errorFrom(error, t("workspaceUi.reopenFailed"));
      }
    } finally { setBusy(false); }
  };
  const newFork = async () => {
    if (!parentId) return;
    setBusy(true);
    try {
      const parent = await workspacesApi.detail(parentId);
      if (parent.status !== "active") { toast.error(t("workspaceUi.reopenUnavailable")); return; }
      setConfirm(false);
      onNewFork(parent);
    } catch (error) { toast.errorFrom(error, t("workspaceUi.reopenFailed")); }
    finally { setBusy(false); }
  };
  return <><Button size="sm" disabled={busy} onClick={() => void reopen()}>
    <RotateCcw data-icon="inline-start" />{t("workspaceUi.reopenFork")}
  </Button>
    <AlertDialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}>
      <AlertDialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("workspaceUi.squashReopenTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("workspaceUi.squashReopenHint")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-wrap">
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="secondary" disabled={busy} onClick={() => void reopen(true)}>{t("workspaceUi.reopenAnyway")}</AlertDialogAction>
          <AlertDialogAction disabled={busy || !parentId} onClick={() => void newFork()}>{t("workspaceUi.newForkFromParent")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

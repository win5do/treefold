import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import { projectsApi } from "@/api/projects";
import type { Workspace, ProjectDetail } from "@/domain/types";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { toast } from "@/lib/toast";

export function ReopenForkButton({ id, parentId, projectId, onNewFork, onNewWorkspace }: { id: string; projectId: string; onNewWorkspace: (project: ProjectDetail) => void; parentId?: string | null; onNewFork: (parent: Workspace) => void }) {
  const { t } = useTranslation();
  const type = parentId ? "Fork" : "Workspace";
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
        toast.error(t("workspaceUi.reopenUnavailable", { type }));
      } else if (error instanceof ApiError && error.code === "FINISH_SESSION_ACTIVE") {
        toast.error(t("deliveryUi.recovery.sessionActive"));
      } else {
        toast.errorFrom(error, t("workspaceUi.reopenFailed", { type }));
      }
    } finally { setBusy(false); }
  };
  const newFork = async () => {
    setBusy(true);
    try {
      if (!parentId) {
        const project = await projectsApi.detail(projectId);
        if (project.status !== "active") { toast.error(t("workspaceUi.reopenUnavailable", { type })); return; }
        setConfirm(false); onNewWorkspace(project); return;
      }
      const parent = await workspacesApi.detail(parentId);
      if (parent.status !== "active") { toast.error(t("workspaceUi.reopenUnavailable", { type })); return; }
      setConfirm(false);
      onNewFork(parent);
    } catch (error) { toast.errorFrom(error, t("workspaceUi.reopenFailed", { type })); }
    finally { setBusy(false); }
  };
  return <><Button size="sm" disabled={busy} onClick={() => void reopen()}>
    <RotateCcw data-icon="inline-start" />{t(parentId ? "workspaceUi.reopenFork" : "workspaceUi.reopenWorkspace")}
  </Button>
    <AlertDialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}>
      <AlertDialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("workspaceUi.squashReopenTitle", { type })}</AlertDialogTitle>
          <AlertDialogDescription>{t("workspaceUi.squashReopenHint", { type })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-wrap">
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="secondary" disabled={busy} onClick={() => void reopen(true)}>{t("workspaceUi.reopenAnyway")}</AlertDialogAction>
          <AlertDialogAction disabled={busy} onClick={() => void newFork()}>{t(parentId ? "workspaceUi.newForkFromParent" : "workspaceUi.newWorkspaceFromProject")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

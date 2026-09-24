import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActionMenu, ActionMenuItem } from "@/components/app/ActionMenu";
import type {
  Project,
  Workspace,
  WorkspaceDeleteOptions,
} from "@/domain/types";

export function RecordActionMenu({
  kind,
  name,
  status,
  busy,
  onRestore,
  onDelete,
  onDeleteBlocked,
}: {
  kind: "project" | "workspace" | "fork";
  name: string;
  status: Project["status"] | Workspace["status"];
  busy: boolean;
  onRestore?: () => void;
  onDelete: () => void;
  onDeleteBlocked: () => void;
}) {
  const { t } = useTranslation();
  const deleteBlocked = status !== "archived";
  return (
    <ActionMenu
      label={t("overview.recordActions", { type: kind, name })}
      testId={`${kind}-actions`}
      disabled={busy}
    >
      {status === "archived" && onRestore && (
        <ActionMenuItem
          icon={<RotateCcw className="size-3.5" />}
          disabled={busy}
          testId="restore-project-action"
          onClick={onRestore}
        >
          {t("overview.restoreToSidebar")}
        </ActionMenuItem>
      )}
      <ActionMenuItem
        icon={<Trash2 className="size-3.5" />}
        disabled={busy}
        blocked={deleteBlocked}
        testId={`delete-${kind}-action`}
        variant="destructive"
        onClick={deleteBlocked ? onDeleteBlocked : onDelete}
      >
        {t("overview.permanentlyDelete")}
      </ActionMenuItem>
    </ActionMenu>
  );
}

export function DeleteRecordDialog({
  target,
  busy,
  onOpenChange,
  onConfirm,
}: {
  target:
    | { kind: "workspace" | "fork"; value: Workspace }
    | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: WorkspaceDeleteOptions) => void;
}) {
  const { t } = useTranslation();
  const [keepWorktrees, setKeepWorktrees] = useState(false);
  const [keepBranches, setKeepBranches] = useState(false);
  useEffect(() => { setKeepWorktrees(false); setKeepBranches(false); }, [target?.value.id]);
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="delete-record-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("overview.deleteTitle", {
              type: target?.kind,
              name: target?.value.name,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("overview.deleteRecordConfirmation", {
              type: target?.kind,
              name: target?.value.name,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox id="delete-keep-worktrees" checked={keepWorktrees} disabled={busy} onCheckedChange={setKeepWorktrees} />
            <FieldLabel htmlFor="delete-keep-worktrees">{t("overview.keepWorktrees")}</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="delete-keep-branches" checked={keepWorktrees || keepBranches} disabled={busy || keepWorktrees} onCheckedChange={setKeepBranches} />
            <FieldLabel htmlFor="delete-keep-branches">{t("overview.keepBranches")}</FieldLabel>
          </Field>
          <FieldDescription>{t(keepWorktrees || keepBranches ? "overview.retainedFilesDescription" : "overview.cleanupFilesDescription")}</FieldDescription>
        </FieldGroup>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => onConfirm({ delete_worktrees: !keepWorktrees, delete_branches: !keepWorktrees && !keepBranches })}
          >
            {t("overview.permanentlyDelete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

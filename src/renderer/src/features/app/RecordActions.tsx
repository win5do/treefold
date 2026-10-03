import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionMenu, ActionMenuItem } from "@/components/app/ActionMenu";
import type {
  Project,
  Workspace,
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

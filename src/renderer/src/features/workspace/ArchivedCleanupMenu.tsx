import { useQuery } from "@tanstack/react-query";
import { Ellipsis, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { archivedCleanupQuery, useStartArchivedCleanup } from "./archivedCleanup";

export function ArchivedCleanupMenu({ scope, id, hasArchived, busy }: {
  scope: "project" | "workspace";
  id: string;
  hasArchived: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const tasks = useQuery(archivedCleanupQuery());
  const cleanup = useStartArchivedCleanup(scope, id);
  const task = tasks.data?.find(task => task.scope === scope && task.scope_id === id);
  const running = cleanup.isPending || task?.status === "running";
  const progress = task?.status === "running"
    ? t("archivedCleanup.progress", { completed: task.completed, total: task.total })
    : undefined;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost"
      aria-label={t(scope === "project" ? "archivedCleanup.workspaceActions" : "archivedCleanup.forkActions")}
      title={progress} disabled={busy || running} aria-busy={running} />}>
      {running ? <Spinner data-icon="inline-start" /> : <Ellipsis data-icon="inline-start" />}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuGroup>
        <DropdownMenuItem variant="destructive" disabled={(scope === "workspace" && !hasArchived) || running}
          onClick={() => cleanup.mutate()}>
          <Trash2 />{t("archivedCleanup.action")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

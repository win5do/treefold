import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { workspacesApi } from "@/api/workspaces";
import type { ArchivedCleanupResult } from "@/domain/types";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { invalidateRuntimeQueries } from "@/features/app/runtimeInvalidation";
import { refreshGitQueries } from "@/features/git/queries";
import { toast } from "@/lib/toast";

export function ArchivedCleanupMenu({ scope, id, hasArchived, busy }: {
  scope: "project" | "workspace";
  id: string;
  hasArchived: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<ArchivedCleanupResult | null>(null);
  const cleanup = useMutation({
    mutationFn: () => workspacesApi.cleanupArchived(scope, id),
    onSuccess: (next) => {
      if (next.skipped.length) setResult(next);
      else toast.success(t("archivedCleanup.result", { deleted: next.deleted_ids.length, skipped: 0 }));
    },
    onError: (error) => toast.errorFrom(error, t("archivedCleanup.failed")),
    onSettled: async () => {
      // Refresh even after a partial filesystem failure.
      await Promise.allSettled([
        invalidateRuntimeQueries(queryClient, ["sidebar", "sessions"]),
        refreshGitQueries(queryClient),
      ]);
    },
  });
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost"
        aria-label={t(scope === "project" ? "archivedCleanup.workspaceActions" : "archivedCleanup.forkActions")}
        disabled={busy || cleanup.isPending} aria-busy={cleanup.isPending} />}>
        {cleanup.isPending ? <Spinner data-icon="inline-start" /> : <Ellipsis data-icon="inline-start" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" disabled={!hasArchived || cleanup.isPending} onClick={() => cleanup.mutate()}>
            <Trash2 />{t("archivedCleanup.action")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={result !== null} onOpenChange={(open) => { if (!open) setResult(null); }}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("archivedCleanup.title")}</DialogTitle>
          <DialogDescription>{t("archivedCleanup.result", { deleted: result?.deleted_ids.length ?? 0, skipped: result?.skipped.length ?? 0 })}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("archivedCleanup.description")}</p>
        <ul className="flex flex-col gap-3">
          {result?.skipped.map(item => <li key={item.id} className="break-words text-sm">
            <p className="font-medium">{item.name}</p>
            <p className="text-muted-foreground">{item.reason === "cleanup_blocked" ? item.message : t(`archivedCleanup.reasons.${item.reason}`)}</p>
          </li>)}
        </ul>
      </DialogContent>
    </Dialog>
  </>;
}

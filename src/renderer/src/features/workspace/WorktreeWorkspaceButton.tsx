import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GitWorktree } from "@/domain/types";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import { toast } from "@/lib/toast";

export function WorktreeWorkspaceButton({ worktree, readOnly, disabled, onOpen }: {
  worktree: GitWorktree;
  readOnly: boolean;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: () => projectsApi.openWorktreeWorkspace(worktree.project_repository_id, worktree.path),
    onSuccess: async (workspace) => {
      await invalidateHierarchyQueries(queryClient);
      onOpen(workspace.id);
    },
    onError: (error) => toast.errorFrom(error, t("projectsUi.openWorktreeWorkspaceFailed")),
  });
  if ((readOnly || worktree.is_main) && !worktree.workspace_id) return null;
  const label = t(worktree.workspace_id ? "projectsUi.openWorktreeWorkspace" : "projectsUi.createWorktreeWorkspace", { path: worktree.path });
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled || open.isPending}
      onClick={() => worktree.workspace_id ? onOpen(worktree.workspace_id) : open.mutate()}
    >
      {open.isPending ? <Spinner data-icon="inline-start" /> : <ArrowUpRight data-icon="inline-start" />}
    </Button>
  );
}

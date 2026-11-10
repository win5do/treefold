import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { request } from "@/api/client";
import type { GitBranches, WorkspaceRepository } from "@/domain/types";
import { BranchSwitchDialog } from "@/features/git/BranchSwitchDialog";
import { refreshGitQueries } from "@/features/git/queries";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";

const loadBranches = (id: string, signal?: AbortSignal) => request<GitBranches>(`/api/workspace-repositories/${id}/branches`, { signal });

export function WorkspaceBranchSwitch({ repository, disabled }: { repository: WorkspaceRepository; disabled: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} data-testid={`workspace-switch-branch-${repository.id}`}>
      <GitBranch data-icon="inline-start" />{t("branchSwitch.switch")}
    </Button>
    {open && <BranchSwitchDialog repository={{ id: repository.id, name: repository.repository_name }} busy={disabled}
      hint={t("branchSwitch.workspaceHint")} loadBranches={loadBranches} onOpenChange={setOpen}
      onSwitch={async (payload) => {
        await request(`/api/workspace-repositories/${repository.id}/checkout`, { method: "POST", json: payload });
        setOpen(false);
        await Promise.all([invalidateHierarchyQueries(client), refreshGitQueries(client)]);
      }} />}
  </>;
}

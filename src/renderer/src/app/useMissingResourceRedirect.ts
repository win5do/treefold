import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client";
import type { ProjectDetail, WorkspaceDetail } from "@/domain/types";
import { removeWorkspaceQueries } from "@/features/workspace/workspaceCache";
import { toast } from "@/lib/toast";

type MissingResource = { scope: "workspace" | "project"; id: string };

/** Redirect only after a real 404; evict the old resource after leaving its route. */
export function useMissingResourceRedirect({ workspaceId, projectId, error, workspace, projects }: {
  workspaceId?: string;
  projectId?: string;
  error: unknown;
  workspace?: WorkspaceDetail;
  projects: ProjectDetail[];
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const pending = useRef<MissingResource[]>([]);
  const parentProject = useRef<{ workspaceId: string; projectId: string } | null>(null);

  useEffect(() => {
    const previous = pending.current.filter(item => item.scope === "workspace" ? item.id !== workspaceId : item.id !== projectId);
    pending.current = pending.current.filter(item => !previous.includes(item));
    for (const item of previous) {
      if (item.scope === "workspace") removeWorkspaceQueries(client, item.id);
      else client.removeQueries({ predicate: ({ queryKey: key }) =>
        ["project", "project-sessions", "project-worktrees"].includes(String(key[0])) && key[1] === item.id,
      });
    }
    if (!(error instanceof ApiError) || error.status !== 404) return;
    const id = workspaceId ?? projectId;
    if (!id || pending.current.some(item => item.id === id)) return;
    let destination = "/";
    if (workspaceId) {
      const record = workspace ?? projects.flatMap(project => project.workspaces).find(item => item.id === workspaceId);
      const owner = record?.project_id ?? (parentProject.current?.workspaceId === workspaceId ? parentProject.current.projectId : undefined);
      if (record?.parent_workspace_id) {
        destination = `/workspaces/${record.parent_workspace_id}`;
        if (owner) parentProject.current = { workspaceId: record.parent_workspace_id, projectId: owner };
      } else if (owner) destination = `/projects/${owner}`;
    }
    pending.current.push({ scope: workspaceId ? "workspace" : "project", id });
    toast.info(t("appFeedback.itemDeleted"));
    navigate(destination, { replace: true });
  }, [workspaceId, projectId, error, workspace, projects, client, navigate, t]);
}

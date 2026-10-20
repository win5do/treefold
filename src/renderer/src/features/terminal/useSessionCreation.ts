import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import type { AgentKind, ProjectDetail, Session } from "@/domain/types";
import { projectKeys } from "@/features/projects/queries";
import { workspaceKeys } from "@/features/workspace/queries";
import { updateProjectWorkspaceSessions, upsertSession } from "@/features/workspace/model";
import type { SidebarStream } from "@/features/workspace/WorkspaceSidebar";
import { toast } from "@/lib/toast";

type SessionOwner = { scope: "project" | "workspace"; id: string };

export function useSessionCreation({
  onStart,
  onFinish,
}: {
  onStart: () => void;
  onFinish: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();

  async function create(owner: SessionOwner, kind?: AgentKind | "shell", directoryId?: string) {
    onStart();
    try {
      const api = owner.scope === "project" ? projectsApi : workspacesApi;
      const created = await api.createSession(owner.id, { kind, project_directory_id: directoryId });
      const keys = owner.scope === "project" ? projectKeys : workspaceKeys;
      queryClient.setQueryData<Session[]>(keys.sessions(owner.id),
        (current = []) => upsertSession(current, created));
      if (owner.scope === "workspace") {
        queryClient.setQueryData<ProjectDetail[]>(projectKeys.sidebar, (current = []) =>
          updateProjectWorkspaceSessions(current, owner.id, upsertSession(
            (current.flatMap(project => project.workspaces)
              .find(workspace => workspace.id === owner.id) as SidebarStream | undefined)?.sessions ?? [],
            created,
          )));
      }
      navigate(`/${owner.scope === "project" ? "projects" : "workspaces"}/${owner.id}/sessions/${created.id}`);
    } catch (cause) {
      toast.errorFrom(cause, t(kind === "shell" ? "appFeedback.couldNotCreateShell" : "agentsUi.createFailed"));
    } finally {
      onFinish();
    }
  }

  return { create };
}

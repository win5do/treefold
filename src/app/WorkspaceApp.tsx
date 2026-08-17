import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type * as React from "react";
import {
  ChevronRight,
  CircleAlert,
  Folders,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { appApi } from "@/api/app";
import { projectsApi } from "@/api/projects";
import { sessionsApi } from "@/api/sessions";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { applyLanguage, type LanguagePreference } from "@/i18n";
import type {
  Directory,
  Project,
  ProjectDetail,
  ProjectRepository,
  ProjectSummary,
  ParentOperationDirection,
  ParentOperation,
  RenameTarget,
  Session,
  SessionMenuState,
  ThemePreference,
  Workspace,
  WorkspaceDetail,
  WorkspaceLocation,
  GitWorktree,
} from "@/domain/types";
import {
  normalizeProject,
  normalizeWorkspace,
  updateProjectWorkspaceSessions,
  upsertSession,
} from "@/features/workspace/model";
import {
  WorkspaceSidebar,
  type SessionDropPosition,
  type SidebarStream,
} from "@/features/workspace/WorkspaceSidebar";
import { SessionWorkspace } from "@/features/terminal/SessionWorkspace";
import { WorkspaceInspector } from "@/features/review/WorkspaceInspector";
import { FinishWorkspaceDialog } from "@/features/delivery/FinishWorkspaceDialog";
import { ParentOperationDialog } from "@/features/workspace/ParentOperationDialog";
import { CreateForkDialog } from "@/features/fork/CreateForkDialog";
import { RenameDialog } from "@/features/app/RenameDialog";
import { DeleteRecordDialog } from "@/features/app/RecordActions";
import {
  AddDirectoryDialog,
  CreateProjectDialog,
  EditDirectoryDialog,
  EditRepositoryDialog,
} from "@/features/projects/ProjectDialogs";
import { ProjectHome } from "@/features/projects/ProjectHome";
import { Overview } from "@/features/projects/Overview";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import {
  ConfigureWorkspaceLocationDialog,
  CreateWorkspaceDialog,
} from "@/features/workspace/WorkspaceDialogs";
import { WorkspaceHome } from "@/features/workspace/WorkspaceHome";
import { appKeys, settingsQuery, systemQuery } from "@/features/app/queries";
import {
  projectDetailQuery,
  projectKeys,
  projectSessionsQuery,
  projectSummariesQuery,
  sidebarQuery,
} from "@/features/projects/queries";
import {
  workspaceDetailQuery,
  workspaceKeys,
  workspaceSessionsQuery,
} from "@/features/workspace/queries";
import { watchSystemTheme } from "@/lib/theme";

function HeaderBreadcrumbItem({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId: string;
  onClick?: () => void;
}) {
  const containerClassName =
    "h-6 min-w-0 max-w-48 shrink overflow-hidden px-1.5";
  const labelClassName = "truncate text-xs leading-none font-medium";

  if (onClick) {
    return (
      <Button
        data-testid={testId}
        size="sm"
        variant="ghost"
        className={cn(containerClassName, "text-muted-foreground")}
        title={label}
        onClick={onClick}
      >
        <span className={labelClassName}>{label}</span>
      </Button>
    );
  }

  return (
    <span
      data-testid={testId}
      aria-current="page"
      className={cn(containerClassName, "inline-flex items-center")}
      title={label}
    >
      <span className={labelClassName}>{label}</span>
    </span>
  );
}

export default function WorkspaceApp() {
  return <Workspace />;
}

function Workspace() {
  const { t } = useTranslation();
  const params = useParams<{
    projectId?: string;
    workspaceId?: string;
    sessionId?: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sidebar = useQuery(sidebarQuery());
  const summaries = useQuery({
    ...projectSummariesQuery(),
    enabled: !params.projectId && !params.workspaceId,
  });
  const projectDetail = useQuery({
    ...projectDetailQuery(params.projectId ?? ""),
    enabled: Boolean(params.projectId),
  });
  const workspaceDetail = useQuery({
    ...workspaceDetailQuery(params.workspaceId ?? ""),
    enabled: Boolean(params.workspaceId),
  });
  const projectSessions = useQuery({
    ...projectSessionsQuery(params.projectId ?? ""),
    enabled: Boolean(params.projectId),
  });
  const workspaceSessions = useQuery({
    ...workspaceSessionsQuery(params.workspaceId ?? ""),
    enabled: Boolean(params.workspaceId),
  });
  const systemQueryResult = useQuery(systemQuery());
  const settingsQueryResult = useQuery(settingsQuery());
  const system = systemQueryResult.data ?? null;
  const settings = settingsQueryResult.data ?? null;
  const workspace = workspaceDetail.data
    ? {
        ...workspaceDetail.data,
        sessions: workspaceSessions.data ?? workspaceDetail.data.sessions,
      }
    : null;
  const projects = useMemo(() => {
    const values = [...(sidebar.data ?? [])];
    if (!workspace) return values;
    const projectIndex = values.findIndex(
      (project) => project.id === workspace.project.id,
    );
    if (projectIndex < 0) return values;
    const project = values[projectIndex];
    values[projectIndex] = {
      ...project,
      workspaces: project.workspaces.map((stream) =>
        stream.id === workspace.id
          ? {
              ...stream,
              ...workspace,
              forks: (stream as SidebarStream).forks ?? workspace.forks,
            }
          : stream,
      ),
    };
    return values;
  }, [sidebar.data, workspace]);
  const loading = params.workspaceId
    ? workspaceDetail.isPending
    : params.projectId
      ? projectDetail.isPending
      : summaries.isPending;
  const queryError =
    workspaceDetail.error ??
    projectDetail.error ??
    summaries.error ??
    sidebar.error ??
    systemQueryResult.error ??
    settingsQueryResult.error;
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(
      window.localStorage.getItem("treefold.sidebar.width"),
    );
    return Number.isFinite(stored) ? Math.min(520, Math.max(240, stored)) : 272;
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [addDirectoryProject, setAddDirectoryProject] =
    useState<ProjectDetail | null>(null);
  const [editDirectory, setEditDirectory] = useState<Directory | null>(null);
  const [editRepository, setEditRepository] =
    useState<ProjectRepository | null>(null);
  const [createWorkspaceProject, setCreateWorkspaceProject] =
    useState<ProjectDetail | null>(null);
  const [createForkWorkspace, setCreateForkWorkspace] =
    useState<Workspace | null>(null);
  const [configureWorkspaceLocation, setConfigureWorkspaceLocation] =
    useState<WorkspaceLocation | null>(null);
  const [finishWorkspaceDialog, setFinishWorkspaceDialog] =
    useState<WorkspaceDetail | null>(null);
  const [finishParentOperation, setFinishParentOperation] =
    useState<ParentOperation | null>(null);
  const [parentOperationDialog, setParentOperationDialog] = useState<{
    workspace: WorkspaceDetail;
    direction: ParentOperationDirection;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "project"; value: ProjectDetail | ProjectSummary }
    | { kind: "workspace" | "fork"; value: Workspace }
    | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [closingSessionIds, setClosingSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (queryError instanceof Error) toast.error(queryError.message);
  }, [queryError]);

  const refresh = async () => {
    if (params.workspaceId)
      await Promise.all([
        workspaceDetail.refetch(),
        workspaceSessions.refetch(),
      ]);
    else if (params.projectId)
      await Promise.all([projectDetail.refetch(), projectSessions.refetch()]);
    else await summaries.refetch();
  };

  useEffect(() => {
    if (!workspace) return;
    setExpandedProjects((current) =>
      new Set(current).add(workspace.project.id),
    );
    setExpandedWorkspaces((current) => {
      const next = new Set(current).add(workspace.id);
      if (workspace.parent_workspace_id)
        next.add(workspace.parent_workspace_id);
      return next;
    });
  }, [workspace?.id, workspace?.parent_workspace_id, workspace?.project.id]);
  useEffect(() => {
    const preference = settings?.language ?? "system";
    void applyLanguage(preference);
    if (preference !== "system") return;
    const updateFromSystem = () => {
      void applyLanguage("system");
    };
    window.addEventListener("languagechange", updateFromSystem);
    return () => window.removeEventListener("languagechange", updateFromSystem);
  }, [settings?.language]);
  useLayoutEffect(
    () => watchSystemTheme(settings?.theme ?? "system"),
    [settings?.theme],
  );
  useEffect(() => {
    if (!resizingSidebar) return;
    const resize = (event: PointerEvent) => {
      const maximum = Math.max(240, Math.min(520, window.innerWidth - 360));
      setSidebarWidth(Math.min(maximum, Math.max(240, event.clientX)));
    };
    const stop = () => setResizingSidebar(false);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
    };
  }, [resizingSidebar]);
  useEffect(() => {
    window.localStorage.setItem("treefold.sidebar.width", String(sidebarWidth));
  }, [sidebarWidth]);

  const selectedProject = useMemo(() => {
    if (params.projectId && projectDetail.data?.id === params.projectId) {
      return {
        ...projectDetail.data,
        sessions: projectSessions.data ?? projectDetail.data.sessions,
      };
    }
    return (
      projects.find((project) => project.id === workspace?.project.id) ?? null
    );
  }, [
    params.projectId,
    projectDetail.data,
    projectSessions.data,
    projects,
    workspace?.project.id,
  ]);
  const selectedSession =
    workspace?.sessions.find((session) => session.id === params.sessionId) ??
    selectedProject?.sessions.find(
      (session) => session.id === params.sessionId,
    ) ??
    null;
  const parentWorkspace = workspace?.parent_workspace_id
    ? (selectedProject?.workspaces.find(
        (item) => item.id === workspace.parent_workspace_id,
      ) ?? null)
    : null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.summaries }),
        queryClient.invalidateQueries({ queryKey: projectKeys.sidebar }),
        params.projectId
          ? queryClient.invalidateQueries({
              queryKey: projectKeys.detail(params.projectId),
            })
          : Promise.resolve(),
        params.projectId
          ? queryClient.invalidateQueries({
              queryKey: projectKeys.sessions(params.projectId),
            })
          : Promise.resolve(),
        params.workspaceId
          ? queryClient.invalidateQueries({
              queryKey: workspaceKeys.detail(params.workspaceId),
            })
          : Promise.resolve(),
        params.workspaceId
          ? queryClient.invalidateQueries({
              queryKey: workspaceKeys.sessions(params.workspaceId),
            })
          : Promise.resolve(),
      ]);
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(update: {
    language: LanguagePreference;
    theme: ThemePreference;
    extraArgs: string[];
    keepDaemonRunningOnExit: boolean;
  }) {
    setBusy(true);
    try {
      const next = await appApi.updateSettings({
        language: update.language,
        theme: update.theme,
        agents: { codex: { extra_args: update.extraArgs } },
        amux: { keep_daemon_running_on_exit: update.keepDaemonRunningOnExit },
      });
      queryClient.setQueryData(appKeys.settings, next);
      return { ok: true as const };
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : t("settings.saveFailedFallback");
      return { ok: false as const, error: message };
    } finally {
      setBusy(false);
    }
  }

  async function gitSync(
    scope: "projects" | "workspaces",
    id: string,
    action: "pull" | "push",
  ) {
    await act(() =>
      scope === "projects"
        ? projectsApi.sync(id, action)
        : workspacesApi.sync(id, action),
    );
  }

  async function gitSyncProjectLocation(id: string, action: "pull" | "push") {
    await act(() => projectsApi.syncLocation(id, action));
  }

  async function gitSyncWorkspaceLocation(id: string, action: "pull" | "push") {
    await act(() => workspacesApi.syncLocation(id, action));
  }

  async function clearWorkspaceLocationUpstream(location: WorkspaceLocation) {
    await act(() =>
      workspacesApi.updateLocation(location.id, {
        remote_name: "",
        remote_branch: "",
      }),
    );
  }

  async function resyncWorkspace(workspace: Workspace) {
    await act(() => workspacesApi.resync(workspace.id));
  }

  async function openFinishWorkspace(stream: Workspace) {
    if (workspace?.id === stream.id) {
      setFinishWorkspaceDialog(workspace);
      return;
    }
    setBusy(true);
    try {
      setFinishWorkspaceDialog(
        normalizeWorkspace(await workspacesApi.detail(stream.id)),
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Workspace 加载失败");
    } finally {
      setBusy(false);
    }
  }

  async function openParentOperation(
    stream: Workspace,
    direction: ParentOperationDirection,
  ) {
    setBusy(true);
    try {
      const detail =
        workspace?.id === stream.id
          ? workspace
          : normalizeWorkspace(await workspacesApi.detail(stream.id));
      setParentOperationDialog({ workspace: detail, direction });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Workspace failed to load");
    } finally {
      setBusy(false);
    }
  }

  async function createShell(
    stream: WorkspaceDetail | Workspace,
    directory?: Directory,
  ) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await workspacesApi.createSession(stream.id, {
        kind: "shell",
        project_directory_id: directory?.id,
      });
      queryClient.setQueryData<Session[]>(
        workspaceKeys.sessions(stream.id),
        (current = []) => upsertSession(current, created),
      );
      queryClient.setQueryData<ProjectDetail[]>(
        projectKeys.sidebar,
        (current = []) =>
          updateProjectWorkspaceSessions(
            current,
            stream.id,
            upsertSession(
              (
                current
                  .flatMap((project) => project.workspaces)
                  .find((item) => item.id === stream.id) as
                  SidebarStream | undefined
              )?.sessions ?? [],
              created,
            ),
          ),
      );
      navigate(`/workspaces/${stream.id}/sessions/${created.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Shell 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createCodex(
    stream: WorkspaceDetail | Workspace,
    directory?: Directory,
  ) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await workspacesApi.createSession(stream.id, {
        kind: "codex",
        project_directory_id: directory?.id,
      });
      queryClient.setQueryData<Session[]>(
        workspaceKeys.sessions(stream.id),
        (current = []) => upsertSession(current, created),
      );
      queryClient.setQueryData<ProjectDetail[]>(
        projectKeys.sidebar,
        (current = []) =>
          updateProjectWorkspaceSessions(
            current,
            stream.id,
            upsertSession(
              (
                current
                  .flatMap((project) => project.workspaces)
                  .find((item) => item.id === stream.id) as
                  SidebarStream | undefined
              )?.sessions ?? [],
              created,
            ),
          ),
      );
      navigate(`/workspaces/${stream.id}/sessions/${created.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Codex 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createProjectShell(
    project: ProjectDetail,
    directory?: Directory,
  ) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await projectsApi.createSession(project.id, {
        kind: "shell",
        project_directory_id: directory?.id,
      });
      queryClient.setQueryData<Session[]>(
        projectKeys.sessions(project.id),
        (current = []) => upsertSession(current, created),
      );
      navigate(`/projects/${project.id}/sessions/${created.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Shell 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createProjectCodex(
    project: ProjectDetail,
    directory?: Directory,
  ) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await projectsApi.createSession(project.id, {
        kind: "codex",
        project_directory_id: directory?.id,
      });
      queryClient.setQueryData<Session[]>(
        projectKeys.sessions(project.id),
        (current = []) => upsertSession(current, created),
      );
      navigate(`/projects/${project.id}/sessions/${created.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Codex 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function openInFinder(project: ProjectDetail, stream?: Workspace) {
    await act(() =>
      stream ? workspacesApi.reveal(stream.id) : projectsApi.reveal(project.id),
    );
  }

  async function rename(
    target: RenameTarget,
    name: string,
    description?: string,
  ) {
    const payload =
      target.kind === "session"
        ? { name }
        : { name, description: description ?? "" };
    let updatedSession: Session | null = null;
    const ok = await act(async () => {
      if (target.kind === "project")
        await projectsApi.update(target.value.id, payload);
      else if (target.kind === "session")
        updatedSession = await sessionsApi.update(target.value.id, payload);
      else await workspacesApi.update(target.value.id, payload);
    });
    if (ok && updatedSession) {
      const session = updatedSession as Session;
      queryClient.setQueryData<Session[]>(
        workspaceKeys.sessions(session.workspace_id),
        (current = []) => upsertSession(current, session),
      );
      queryClient.setQueryData<ProjectDetail[]>(
        projectKeys.sidebar,
        (current = []) =>
          updateProjectWorkspaceSessions(
            current,
            session.workspace_id,
            upsertSession(
              (
                current
                  .flatMap((project) => project.workspaces)
                  .find((stream) => stream.id === session.workspace_id) as
                  SidebarStream | undefined
              )?.sessions ?? [],
              session,
            ),
          ),
      );
      if (params.projectId)
        queryClient.setQueryData<Session[]>(
          projectKeys.sessions(params.projectId),
          (current = []) => upsertSession(current, session),
        );
    }
    if (ok) setRenameTarget(null);
  }

  async function reorderSessions(
    stream: Workspace,
    sourceId: string,
    targetId: string,
    position: SessionDropPosition,
  ) {
    const allSessions = (stream as SidebarStream).sessions ?? [];
    const sessions = allSessions.filter(
      (session) => session.visibility === "visible",
    );
    const source = sessions.find((session) => session.id === sourceId);
    if (!source) return;
    const reordered = sessions.filter((session) => session.id !== sourceId);
    const targetIndex = reordered.findIndex(
      (session) => session.id === targetId,
    );
    if (targetIndex < 0) return;
    reordered.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
    if (reordered.every((session, index) => session.id === sessions[index]?.id))
      return;
    const nextSessions = [
      ...reordered,
      ...allSessions.filter((session) => session.visibility !== "visible"),
    ];
    queryClient.setQueryData<Session[]>(
      workspaceKeys.sessions(stream.id),
      nextSessions,
    );
    queryClient.setQueryData<ProjectDetail[]>(
      projectKeys.sidebar,
      (current = []) =>
        updateProjectWorkspaceSessions(current, stream.id, nextSessions),
    );
    try {
      await workspacesApi.reorderSessions(
        stream.id,
        reordered.map((session) => session.id),
      );
    } catch (cause) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.sidebar }),
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.sessions(stream.id),
        }),
      ]);
      toast.error(cause instanceof Error ? cause.message : "Session 排序失败");
    }
  }

  async function updateProjectStatus(
    project: ProjectDetail | ProjectSummary,
    status: Project["status"],
  ) {
    const ok = await act(() => projectsApi.update(project.id, { status }));
    if (!ok) return;
    if (!params.projectId)
      queryClient.removeQueries({
        queryKey: projectKeys.detail(project.id),
        exact: true,
      });
    if (status === "archived") {
      setExpandedProjects((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      if (
        params.projectId === project.id ||
        workspace?.project.id === project.id
      )
        navigate("/");
    }
  }

  async function permanentlyDeleteProject(
    project: ProjectDetail | ProjectSummary,
  ) {
    setDeleteTarget({ kind: "project", value: project });
  }

  async function permanentlyDeleteTarget() {
    if (!deleteTarget) return;
    const ok = await act(() =>
      deleteTarget.kind === "project"
        ? projectsApi.delete(deleteTarget.value.id)
        : workspacesApi.delete(deleteTarget.value.id),
    );
    if (!ok) return;
    const deleted = deleteTarget;
    setDeleteTarget(null);
    if (
      deleted.kind === "project" &&
      (params.projectId === deleted.value.id ||
        workspace?.project.id === deleted.value.id)
    )
      navigate("/");
    if (deleted.kind !== "project" && params.workspaceId === deleted.value.id)
      navigate(
        deleted.value.parent_workspace_id
          ? `/workspaces/${deleted.value.parent_workspace_id}`
          : `/projects/${deleted.value.project_id}`,
      );
  }

  async function removeWorktree(worktree: GitWorktree) {
    if (worktree.workspace_id) {
      toast.warning(
        `Worktree belongs to active Workspace “${worktree.workspace_name || worktree.workspace_id}”; use Finish Workspace.`,
      );
      return;
    }
    if (
      !window.confirm(
        `确定删除 worktree？\n\n${worktree.path}\n\n未提交的改动会被丢弃。`,
      )
    )
      return;
    await act(() =>
      projectsApi.removeWorktree(worktree.project_location_id, worktree),
    );
  }

  async function refreshLocation(location: Directory) {
    await act(() =>
      location.repository_id
        ? projectsApi.refreshRepository(location.repository_id)
        : projectsApi.refreshLocation(location.id),
    );
  }

  async function makeDefaultLocation(
    project: ProjectDetail,
    location: Directory,
  ) {
    await act(() =>
      projectsApi.update(project.id, { default_directory_id: location.id }),
    );
  }

  async function reattachLocation(location: Directory) {
    const selected = await open({
      directory: true,
      multiple: false,
      title: `Relink ${location.name}`,
    });
    if (typeof selected !== "string") return;
    if (!location.repository_id) return;
    const repositoryId = location.repository_id;
    await act(() => projectsApi.reattachLocation(repositoryId, selected));
  }

  async function removeProjectRepository(repository: ProjectRepository) {
    if (!window.confirm(`Remove repository from this Project?\n\n${repository.name}\n\nLocal files and Git resources will not be deleted.`))
      return;
    await act(() => projectsApi.deleteRepository(repository.id));
  }

  async function removeProjectDirectory(directory: Directory) {
    if (!window.confirm(`Remove directory from this Project?\n\n${directory.name}\n\nLocal files and Git resources will not be deleted.`))
      return;
    await act(() => projectsApi.deleteLocation(directory.id));
  }

  async function closeSidebarSession(stream: Workspace, session: Session) {
    setClosingSessionIds((current) => new Set(current).add(session.id));
    if (params.sessionId === session.id)
      navigate(
        stream.id
          ? `/workspaces/${stream.id}`
          : `/projects/${stream.project_id}`,
      );

    try {
      await sessionsApi.close(session.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.sidebar }),
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.sessions(stream.id),
        }),
      ]);
    } catch (cause) {
      await queryClient.invalidateQueries({
        queryKey: workspaceKeys.sessions(stream.id),
      });
      toast.error(cause instanceof Error ? cause.message : "关闭 Session 失败");
    } finally {
      if (session.kind !== "codex") {
        queryClient.setQueryData<Session[]>(
          workspaceKeys.sessions(stream.id),
          (current = []) => current.filter((item) => item.id !== session.id),
        );
      }
      setClosingSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }

  async function closeProjectSession(project: ProjectDetail, session: Session) {
    setClosingSessionIds((current) => new Set(current).add(session.id));
    if (params.sessionId === session.id) navigate(`/projects/${project.id}`);
    try {
      await sessionsApi.close(session.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.sidebar }),
        queryClient.invalidateQueries({
          queryKey: projectKeys.sessions(project.id),
        }),
      ]);
    } catch (cause) {
      await queryClient.invalidateQueries({
        queryKey: projectKeys.sessions(project.id),
      });
      toast.error(cause instanceof Error ? cause.message : "关闭 Session 失败");
    } finally {
      if (session.kind !== "codex") {
        queryClient.setQueryData<Session[]>(
          projectKeys.sessions(project.id),
          (current = []) =>
            current.filter((candidate) => candidate.id !== session.id),
        );
      }
      setClosingSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }

  async function openHistorySession(stream: WorkspaceDetail, session: Session) {
    if (session.visibility !== "visible") {
      const ok = await act(() => sessionsApi.open(session.id));
      if (!ok) return;
    }
    navigate(`/workspaces/${stream.id}/sessions/${session.id}`);
  }

  async function openProjectHistorySession(
    project: ProjectDetail,
    session: Session,
  ) {
    if (session.visibility !== "visible") {
      const ok = await act(() => sessionsApi.open(session.id));
      if (!ok) return;
    }
    navigate(`/projects/${project.id}/sessions/${session.id}`);
  }

  function toggle(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--toolbar-left-width": `${sidebarHidden ? 48 : sidebarWidth}px`,
        } as React.CSSProperties
      }
    >
      <header
        data-testid="app-toolbar"
        className="relative z-50 flex h-10 shrink-0 items-center border-b border-border bg-card"
      >
        <div
          data-testid="toolbar-left-rail"
          className={cn(
            "flex h-full w-12 shrink-0 items-center px-2",
            !resizingSidebar && "transition-[width] duration-200",
            "md:w-[var(--toolbar-left-width)]",
          )}
        >
          <Button
            className="md:hidden"
            size="icon"
            variant="ghost"
            aria-label={t("workspace.openMobileNavigation")}
            onClick={() => setMobileSidebar(true)}
          >
            <Menu data-icon="inline-start" />
          </Button>
          <Button
            className="hidden md:inline-flex"
            size="icon"
            variant={sidebarHidden ? "secondary" : "ghost"}
            aria-label={t(
              sidebarHidden
                ? "workspace.showLeftSidebar"
                : "workspace.hideLeftSidebar",
            )}
            onClick={() => setSidebarHidden((value) => !value)}
          >
            {sidebarHidden ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </div>
        <div
          data-testid="toolbar-content-frame"
          className={cn(
            "min-w-0 flex-1 overflow-y-auto px-5 transition-[margin] duration-200 [scrollbar-gutter:stable] sm:px-8 lg:px-12",
            selectedProject && inspectorOpen && "lg:mr-[340px]",
          )}
        >
          <nav
            data-testid="header-breadcrumb"
            aria-label={t("workspace.breadcrumb")}
            className="mx-auto flex max-w-[96rem] min-w-0 items-center gap-0.5 overflow-hidden pr-16"
          >
            <Button
              data-testid="breadcrumb-projects"
              size="icon-sm"
              variant="ghost"
              aria-label={t("workspace.allProjects")}
              title={t("workspace.allProjects")}
              aria-current={selectedProject ? undefined : "page"}
              onClick={() => navigate("/")}
            >
              <Folders data-icon="inline-start" />
            </Button>
            {selectedProject && (
              <>
                <ChevronRight
                  className="size-3 shrink-0 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <HeaderBreadcrumbItem
                  label={selectedProject.name}
                  testId="breadcrumb-project"
                  onClick={
                    workspace
                      ? () => navigate(`/projects/${selectedProject.id}`)
                      : undefined
                  }
                />
              </>
            )}
            {parentWorkspace && (
              <>
                <ChevronRight
                  className="size-3 shrink-0 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <HeaderBreadcrumbItem
                  label={parentWorkspace.name}
                  testId="breadcrumb-workspace"
                  onClick={() => navigate(`/workspaces/${parentWorkspace.id}`)}
                />
              </>
            )}
            {workspace && (
              <>
                <ChevronRight
                  className="size-3 shrink-0 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <HeaderBreadcrumbItem
                  label={workspace.name}
                  testId={
                    parentWorkspace ? "breadcrumb-fork" : "breadcrumb-workspace"
                  }
                />
              </>
            )}
          </nav>
        </div>
        <div className="absolute right-2 flex items-center">
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={t("workspace.refresh")}
            onClick={() => void refresh()}
          >
            <RefreshCw data-icon="inline-start" />
          </Button>
          {selectedProject && (
            <Button
              size="icon"
              variant={inspectorOpen ? "secondary" : "ghost"}
              aria-label={t(
                inspectorOpen
                  ? "workspace.hideRightSidebar"
                  : "workspace.showRightSidebar",
              )}
              onClick={() => setInspectorOpen((value) => !value)}
            >
              {inspectorOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {mobileSidebar && (
          <button
            className="absolute inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setMobileSidebar(false)}
            aria-label={t("workspace.closeNavigation")}
          />
        )}
        <WorkspaceSidebar
          projects={projects}
          busy={busy}
          selectedProjectId={params.projectId}
          selectedWorkspaceId={workspace?.id}
          selectedSessionId={selectedSession?.id}
          hidden={sidebarHidden}
          mobileOpen={mobileSidebar}
          resizing={resizingSidebar}
          expandedProjects={expandedProjects}
          expandedWorkspaces={expandedWorkspaces}
          closingSessionIds={closingSessionIds}
          sessionMenu={sessionMenu}
          onToggleProject={(id) => toggle(setExpandedProjects, id)}
          onToggleWorkspace={(id) => toggle(setExpandedWorkspaces, id)}
          onSessionMenu={setSessionMenu}
          onNavigate={(path) => {
            navigate(path);
            setMobileSidebar(false);
            setSessionMenu(null);
          }}
          onCreateProject={() => setCreateProjectOpen(true)}
          onCreateWorkspace={setCreateWorkspaceProject}
          onCreateFork={setCreateForkWorkspace}
          onCreateShell={(stream, directory) =>
            void createShell(stream, directory)
          }
          onCreateCodex={(stream, directory) =>
            void createCodex(stream, directory)
          }
          onCreateBaseShell={(project, directory) =>
            void createProjectShell(project, directory)
          }
          onCreateBaseCodex={(project, directory) =>
            void createProjectCodex(project, directory)
          }
          onOpenInFinder={(project, stream) =>
            void openInFinder(project, stream)
          }
          onSyncProject={(project, action) =>
            void gitSync("projects", project.id, action)
          }
          onSyncProjectLocation={(location, action) =>
            void gitSyncProjectLocation(location.id, action)
          }
          onSyncWorkspace={(stream, action) =>
            void gitSync("workspaces", stream.id, action)
          }
          onSyncWorkspaceLocation={(location, action) =>
            void gitSyncWorkspaceLocation(location.id, action)
          }
          onFinishWorkspace={(stream) => void openFinishWorkspace(stream)}
          onParentOperation={(stream, direction) =>
            void openParentOperation(stream, direction)
          }
          onRenameProject={(project) =>
            setRenameTarget({ kind: "project", value: project })
          }
          onRenameWorkspace={(stream) =>
            setRenameTarget({ kind: stream.kind, value: stream })
          }
          onRenameSession={(session) =>
            setRenameTarget({ kind: "session", value: session })
          }
          onReorderSessions={(stream, sourceId, targetId, position) =>
            void reorderSessions(stream, sourceId, targetId, position)
          }
          onArchiveProject={(project) =>
            void updateProjectStatus(project, "archived")
          }
          onCloseSession={(stream, session) =>
            void closeSidebarSession(stream, session)
          }
          onCloseProjectSession={(project, session) =>
            void closeProjectSession(project, session)
          }
          onResizeStart={() => setResizingSidebar(true)}
          onResizeKeyboard={(delta) =>
            setSidebarWidth((current) =>
              Math.min(520, Math.max(240, current + delta)),
            )
          }
          onSettings={() => setSettingsOpen(true)}
        />

        <main
          data-testid="workspace-main"
          className={cn(
            "flex h-full min-w-0 flex-col",
            !resizingSidebar && "transition-[margin] duration-200",
            sidebarHidden ? "md:ml-12" : "md:ml-[var(--sidebar-width)]",
          )}
        >
          {warning && (
            <Alert
              variant="warning"
              className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2"
            >
              <CircleAlert />
              <AlertDescription>
                {t("workspace.branchNotSwitched", { message: warning })}
              </AlertDescription>
              <AlertAction>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Dismiss warning"
                  onClick={() => setWarning("")}
                >
                  <X />
                </Button>
              </AlertAction>
            </Alert>
          )}

          <div className="flex min-h-0 flex-1">
            <section
              className={cn(
                "min-w-0 flex-1 transition-[margin] duration-200",
                selectedProject && inspectorOpen && "lg:mr-[340px]",
              )}
            >
              {loading ? (
                <CenteredMessage>{t("workspace.loading")}</CenteredMessage>
              ) : selectedSession ? (
                <SessionWorkspace
                  session={selectedSession}
                  busy={busy}
                  onStop={() =>
                    void act(() => sessionsApi.stop(selectedSession.id))
                  }
                  onRestart={() =>
                    void act(() => sessionsApi.restart(selectedSession.id))
                  }
                  onClose={() =>
                    workspace
                      ? void closeSidebarSession(workspace, selectedSession)
                      : selectedProject
                        ? void closeProjectSession(
                            selectedProject,
                            selectedSession,
                          )
                        : undefined
                  }
                  onExit={() => {
                    void refresh();
                  }}
                />
              ) : workspace ? (
                <WorkspaceHome
                  detail={workspace}
                  busy={busy}
                  onOpen={(session) =>
                    void openHistorySession(workspace, session)
                  }
                  onOpenFork={(fork) => navigate(`/workspaces/${fork.id}`)}
                  onDeleteFork={(fork) =>
                    setDeleteTarget({ kind: "fork", value: fork })
                  }
                  onDeleteForkBlocked={(fork) =>
                    toast.warning(
                      t("overview.deleteBlocked.fork", { name: fork.name }),
                    )
                  }
                  onConfigureUpstream={setConfigureWorkspaceLocation}
                  onClearUpstream={(location) =>
                    void clearWorkspaceLocationUpstream(location)
                  }
                  onResync={() => void resyncWorkspace(workspace)}
                  onTodosChanged={() => void refresh()}
                  onTodoForkCreated={(fork, session) =>
                    navigate(
                      session
                        ? `/workspaces/${fork.id}/sessions/${session.id}`
                        : `/workspaces/${fork.id}`,
                    )
                  }
                />
              ) : selectedProject ? (
                <ProjectHome
                  project={selectedProject}
                  busy={busy}
                  onOpen={(id) => navigate(`/workspaces/${id}`)}
                  onDeleteWorkspace={(stream) =>
                    setDeleteTarget({ kind: "workspace", value: stream })
                  }
                  onDeleteWorkspaceBlocked={(stream) =>
                    toast.warning(
                      t("overview.deleteBlocked.workspace", {
                        name: stream.name,
                      }),
                    )
                  }
                  onOpenSession={(session) =>
                    void openProjectHistorySession(selectedProject, session)
                  }
                  onAddDirectory={() => setAddDirectoryProject(selectedProject)}
                  onEditDirectory={setEditDirectory}
                  onEditRepository={setEditRepository}
                  onRefreshLocation={(location) =>
                    void refreshLocation(location)
                  }
                  onMakeDefault={(location) =>
                    void makeDefaultLocation(selectedProject, location)
                  }
                  onReattach={(location) => void reattachLocation(location)}
                  onDeleteRepository={(repository) =>
                    void removeProjectRepository(repository)
                  }
                  onDeleteDirectory={(directory) =>
                    void removeProjectDirectory(directory)
                  }
                  onDeleteWorktree={(item) => void removeWorktree(item)}
                />
              ) : (
                <Overview
                  projects={summaries.data ?? []}
                  busy={busy}
                  onOpen={(id) => navigate(`/projects/${id}`)}
                  onCreate={() => setCreateProjectOpen(true)}
                  onRestore={(project) =>
                    void updateProjectStatus(project, "active")
                  }
                  onDelete={(project) => void permanentlyDeleteProject(project)}
                  onDeleteBlocked={(project) =>
                    toast.warning(
                      t("overview.deleteBlocked.project", {
                        name: project.name,
                      }),
                    )
                  }
                />
              )}
            </section>

            {selectedProject && (
              <WorkspaceInspector
                open={inspectorOpen}
                project={selectedProject}
                workspace={workspace}
                session={selectedSession}
              />
            )}
          </div>
        </main>
      </div>

      <CreateProjectDialog
        open={createProjectOpen}
        busy={busy}
        onOpenChange={setCreateProjectOpen}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          let created: Project | null = null;
          const ok = await act(async () => {
            created = await projectsApi.create({
              name: form.get("name"),
              description: form.get("description"),
            });
          });
          if (ok && created) {
            const detail = normalizeProject(
              await projectsApi.detail((created as Project).id),
            );
            queryClient.setQueryData(projectKeys.detail(detail.id), detail);
            setCreateProjectOpen(false);
            setAddDirectoryProject(detail);
            navigate(`/projects/${detail.id}`);
          }
        }}
      />
      <AddDirectoryDialog
        project={addDirectoryProject}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setAddDirectoryProject(null);
        }}
        onSubmit={async (locations) => {
          if (!addDirectoryProject) return;
          const ok = await act(async () => {
            const orderedLocations = addDirectoryProject.default_location_id
              ? locations
              : [
                  ...locations.filter((location) => location.source === "url"),
                  ...locations.filter(
                    (location) => location.inspection?.git_status === "ready",
                  ),
                  ...locations.filter(
                    (location) => location.inspection?.git_status !== "ready",
                  ),
                ];
            for (const location of orderedLocations) {
              if (location.source === "url") {
                await projectsApi.cloneRepository(addDirectoryProject.id, {
                  url: location.path,
                  delivery_mode: location.delivery_mode,
                  setup_command: location.worktree_setup_command,
                });
              } else {
                await projectsApi.addLocation(addDirectoryProject.id, {
                  path: location.path,
                  description: location.description,
                  worktree_setup_command: location.worktree_setup_command,
                  base_branch:
                    location.inspection?.git_status === "ready"
                      ? location.base_branch
                      : undefined,
                  delivery_mode:
                    location.inspection?.git_status === "ready"
                      ? location.delivery_mode
                      : undefined,
                });
              }
            }
          });
          if (ok) setAddDirectoryProject(null);
        }}
      />
      <EditDirectoryDialog
        directory={editDirectory}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setEditDirectory(null);
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!editDirectory) return;
          const form = new FormData(event.currentTarget);
          const ok = await act(() =>
            projectsApi.updateLocation(editDirectory.id, {
              name: form.get("name"),
              description: form.get("description"),
            }),
          );
          if (ok) setEditDirectory(null);
        }}
      />
      <EditRepositoryDialog
        repository={editRepository}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setEditRepository(null);
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!editRepository) return;
          const form = new FormData(event.currentTarget);
          const ok = await act(async () => {
            const baseBranch = String(form.get("base_branch") || "").trim();
            const baseRemote = String(form.get("base_remote") || "").trim();
            if (baseRemote) {
              await projectsApi.setBaseBranch(editRepository.id, {
                branch: baseBranch,
                remote: baseRemote,
              });
            }
            await projectsApi.updateRepository(editRepository.id, {
              setup_command: form.get("setup_command"),
              setup_workdir: form.get("setup_workdir"),
              base_branch: baseBranch,
              delivery_mode: form.get("delivery_mode"),
            });
          });
          if (ok) setEditRepository(null);
        }}
        onCheckout={async (payload) => {
          if (!editRepository) return;
          await act(() => projectsApi.checkoutRepository(editRepository.id, payload));
        }}
      />
      <CreateWorkspaceDialog
        project={createWorkspaceProject}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setCreateWorkspaceProject(null);
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!createWorkspaceProject) return;
          const form = new FormData(event.currentTarget);
          let created: Workspace | null = null;
          const ok = await act(async () => {
            created = await projectsApi.createWorkspace(
              createWorkspaceProject.id,
              {
                name: form.get("name"),
                description: form.get("description"),
                branch: form.get("branch"),
                remote_name: form.get("remote_name"),
                remote_branch: form.get("remote_branch"),
              },
            );
          });
          if (ok && created) {
            setCreateWorkspaceProject(null);
            navigate(`/workspaces/${(created as Workspace).id}`);
          }
        }}
      />
      <CreateForkDialog
        workspace={createForkWorkspace}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setCreateForkWorkspace(null);
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!createForkWorkspace) return;
          const form = new FormData(event.currentTarget);
          let created: Workspace | null = null;
          const ok = await act(async () => {
            created = await workspacesApi.createFork(createForkWorkspace.id, {
              name: form.get("name"),
              description: form.get("description"),
            });
          });
          if (ok && created) {
            setCreateForkWorkspace(null);
            navigate(`/workspaces/${(created as Workspace).id}`);
          }
        }}
      />
      <ConfigureWorkspaceLocationDialog
        location={configureWorkspaceLocation}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setConfigureWorkspaceLocation(null);
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!configureWorkspaceLocation) return;
          const owner = configureWorkspaceLocation;
          const form = new FormData(event.currentTarget);
          const ok = await act(() =>
            workspacesApi.updateLocation(owner.id, {
              remote_name: form.get("remote_name"),
              remote_branch: form.get("remote_branch"),
            }),
          );
          if (ok) setConfigureWorkspaceLocation(null);
        }}
      />
      <FinishWorkspaceDialog
        workspace={finishWorkspaceDialog}
        busy={busy}
        operation={finishParentOperation}
        onOperationChange={setFinishParentOperation}
        onOpenChange={(open) => {
          if (!open) {
            setFinishWorkspaceDialog(null);
            setFinishParentOperation(null);
          }
        }}
        onSubmit={async (locationId, payload) => {
          if (!finishWorkspaceDialog) return;
          const owner = finishWorkspaceDialog;
          let updated: WorkspaceDetail | null = null;
          const ok = await act(async () => {
            const progress = await workspacesApi.finishLocation(locationId, payload);
            setFinishParentOperation(progress.operation ?? null);
            updated = normalizeWorkspace(await workspacesApi.detail(owner.id));
            if (
              (updated as WorkspaceDetail).locations
                .filter((item) => item.access_mode === "read_write")
                .every((item) =>
                  ["delivered", "kept", "discarded", "remote_merged"].includes(
                    item.delivery_status,
                  ),
                )
            )
              await workspacesApi.archive(owner.id);
          });
          if (
            ok &&
            updated &&
            (updated as WorkspaceDetail).locations
              .filter((item) => item.access_mode === "read_write")
              .every((item) =>
                ["delivered", "kept", "discarded", "remote_merged"].includes(
                  item.delivery_status,
                ),
              )
          ) {
            setFinishWorkspaceDialog(null);
            navigate(
              owner.parent_workspace_id
                ? `/workspaces/${owner.parent_workspace_id}`
                : `/projects/${owner.project.id}`,
            );
          } else if (ok && updated) setFinishWorkspaceDialog(updated);
        }}
        onOpenSession={(operation, session) => {
          setFinishWorkspaceDialog(null);
          setFinishParentOperation(null);
          navigate(
            operation.target_scope === "project"
              ? `/projects/${finishWorkspaceDialog?.project.id}/sessions/${session.id}`
              : `/workspaces/${session.workspace_id}/sessions/${session.id}`,
          );
        }}
      />
      <ParentOperationDialog
        workspace={parentOperationDialog?.workspace ?? null}
        direction={parentOperationDialog?.direction ?? null}
        onOpenChange={(open) => {
          if (!open) setParentOperationDialog(null);
        }}
        onOpenSession={(operation, session) => {
          setParentOperationDialog(null);
          navigate(
            operation.target_scope === "project"
              ? `/projects/${parentOperationDialog?.workspace.project.id}/sessions/${session.id}`
              : `/workspaces/${session.workspace_id}/sessions/${session.id}`,
          );
        }}
      />
      <RenameDialog
        target={renameTarget}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onSubmit={(name, description) =>
          void (renameTarget && rename(renameTarget, name, description))
        }
      />
      <DeleteRecordDialog
        target={deleteTarget}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void permanentlyDeleteTarget()}
      />
      <SettingsDialog
        open={settingsOpen}
        system={system}
        settings={settings}
        busy={busy}
        onOpenChange={setSettingsOpen}
        onSave={saveSettings}
      />
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

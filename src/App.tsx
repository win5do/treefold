import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Download,
  Ellipsis,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Info,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Shell,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import "@xterm/xterm/css/xterm.css";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect as Select } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { applyLanguage, type LanguagePreference } from "@/i18n";

type Project = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  default_location_id?: string;
  default_base_branch: string;
  primary_directory_id: string;
  git_common_dir: string;
  preferred_remote?: string;
  default_target_branch: string;
  default_delivery_mode: "remote_review" | "local_merge";
  updated_at: string;
};

type Directory = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  worktree_setup_command: string;
  path: string;
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
  delivery_mode?: "remote_review" | "local_merge";
  git_common_dir?: string;
  git_status: "creating" | "ready" | "failed" | "not_git" | "missing" | "broken" | "mismatch";
  checkout_path?: string;
  role: "primary" | "attached";
  is_git: boolean;
  remote_url?: string;
  branch?: string;
  head_commit?: string;
  head_summary?: string;
  dirty: boolean;
};


type Session = {
  id: string;
  workspace_id: string;
  name: string;
  kind: "shell" | "codex";
  cwd: string;
  original_cwd: string;
  initial_prompt: string;
  codex_session_id?: string;
  sidebar_visible: boolean;
  hidden_at?: string;
  evicted_at?: string;
  process_id: string;
  process_name: string;
  status: string;
  pid?: number;
  process_group_id?: number;
  exit_code?: number;
  exit_signal?: string;
  command?: string[];
  launch_started_at: string;
  last_attached_at?: string;
  created_at: string;
  updated_at: string;
};

type SessionMenuState = { id: string; x: number; y: number };

type Workspace = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  kind: "workspace" | "fork";
  parent_workspace_id?: string;
  checkout_mode: "worktree" | "in_place";
  project_directory_id: string;
  checkout_path: string;
  target_branch: string;
  start_commit: string;
  branch: string;
  forked_from_commit?: string;
  remote_name?: string;
  remote_branch?: string;
  branch_ownership: string;
  delivery_mode: "remote_review" | "local_merge";
  delivery_status: string;
  close_outcome?: string;
  integrated_commit?: string;
  closed_at?: string;
  runtime_id: string;
  runtime_name: string;
  updated_at: string;
};

type WorkspaceLocation = {
  id: string;
  workspace_id: string;
  project_location_id: string;
  location_name: string;
  source_path: string;
  access_mode: "read_write" | "read_only";
  git_status: "creating" | "ready" | "failed" | "not_git" | "missing" | "broken" | "mismatch";
  creation_error?: string;
  checkout_path?: string;
  branch?: string;
  base_branch?: string;
  start_commit?: string;
  remote_name?: string;
  remote_branch?: string;
  delivery_mode: string;
  delivery_status: string;
  close_outcome?: string;
};

type ProjectDetail = Project & {
  locations: Directory[];
  directories: Directory[];
  sessions: Session[];
  workspaces: Workspace[];
  worktrees: GitWorktree[];
};

type Todo = { id: string; workspace_id: string; title: string; description: string; status: string };

type GitWorktree = {
  project_location_id: string;
  location_name: string;
  path: string;
  branch: string;
  head_commit: string;
  is_main: boolean;
  workspace_id?: string;
  workspace_name?: string;
};

type GitCommit = {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  authored_at: string;
};

type GitHistory = { branch: string; commits: GitCommit[] };

type DeliveryPreflight = {
  id: string;
  source_head: string;
  target_head: string;
  target_branch: string;
  source_dirty: boolean;
  target_dirty: boolean;
  ahead: number;
  behind: number;
  changed_files: string[];
  commits: GitCommit[];
  diff_stat: string;
  blockers: string[];
  warnings: string[];
};

type GitOperationRecord = {
  id: string;
  kind: "delivery" | "rebase" | "reset";
  action: string;
  status: string;
  before_head: string;
  target_head: string;
  result_head?: string;
  recovery_ref?: string;
  error: string;
  started_at: string;
  updated_at: string;
};

type ProjectLocationInspection = {
  path: string;
  name: string;
  git_status: "ready" | "not_git";
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
};

type LocationDraft = {
  key: string;
  path: string;
  description: string;
  worktree_setup_command: string;
  base_branch: string;
  delivery_mode: "remote_review" | "local_merge";
  inspection?: ProjectLocationInspection;
  inspectionError?: string;
};

type WorkspaceDetail = Workspace & {
  project: Project;
  directories: Directory[];
  locations: WorkspaceLocation[];
  sessions: Session[];
  todos: Todo[];
  forks: Workspace[];
};

type SystemStatus = {
  platform: string;
  codex_available: boolean;
  codex_version?: string;
  backend: string;
  terminal_runtime: string;
};

type AppSettings = {
  schema_version: number;
  language: LanguagePreference;
  worktree_root: string;
  agents: {
    codex: {
      extra_args: string[];
    };
  };
};

function normalizeProject(value: ProjectDetail): ProjectDetail {
  const locations = value.locations ?? value.directories ?? [];
  const directories = locations.map((location) => ({ ...location, git_status: location.git_status ?? (location.is_git ? "ready" : "not_git"), role: (value.default_location_id ?? value.primary_directory_id) === location.id ? "primary" as const : "attached" as const, is_git: location.git_status ? location.git_status === "ready" : location.is_git, remote_url: location.repository_url ?? location.remote_url }));
  const primary = directories.find((location) => value.default_location_id === location.id);
  return { ...value, default_base_branch: value.default_base_branch ?? value.default_target_branch ?? "main", default_target_branch: value.default_base_branch ?? value.default_target_branch ?? "main", primary_directory_id: value.default_location_id ?? "", git_common_dir: primary?.git_common_dir ?? "", preferred_remote: primary?.preferred_remote_name, locations: directories, directories, sessions: value.sessions ?? [], workspaces: value.workspaces ?? [], worktrees: value.worktrees ?? [] };
}

function normalizeWorkspace(value: WorkspaceDetail): WorkspaceDetail {
  const locations = value.locations ?? (value.directories ?? []).map((directory) => ({ id: `workspace-location-${directory.id}`, workspace_id: value.id, project_location_id: directory.id, location_name: directory.name, source_path: directory.path, access_mode: directory.is_git ? "read_write" as const : "read_only" as const, git_status: directory.git_status ?? (directory.is_git ? "ready" as const : "not_git" as const), checkout_path: directory.checkout_path, branch: value.branch, base_branch: value.target_branch, start_commit: value.start_commit, remote_name: value.remote_name, remote_branch: value.remote_branch, delivery_mode: value.delivery_mode, delivery_status: value.delivery_status }));
  const primary = locations.find((location) => value.project.default_location_id === location.project_location_id && location.git_status === "ready") ?? locations.find((location) => location.access_mode === "read_write" && location.git_status === "ready") ?? locations.find((location) => value.project.default_location_id === location.project_location_id) ?? locations.find((location) => location.access_mode === "read_write");
  const directories = locations.map((location) => ({ id: location.project_location_id, project_id: value.project.id, name: location.location_name, description: "", worktree_setup_command: "", path: location.source_path, checkout_path: location.checkout_path, role: value.project.default_location_id === location.project_location_id ? "primary" as const : "attached" as const, is_git: location.access_mode === "read_write", git_status: location.git_status, dirty: false }));
  return {
    ...value,
    checkout_mode: "worktree",
    project_directory_id: primary?.project_location_id ?? "",
    checkout_path: primary?.checkout_path ?? primary?.source_path ?? value.checkout_path ?? "",
    target_branch: primary?.base_branch ?? value.target_branch ?? "",
    start_commit: primary?.start_commit ?? value.start_commit ?? "",
    branch: primary?.branch ?? value.branch ?? "",
    remote_name: primary?.remote_name,
    remote_branch: primary?.remote_branch,
    branch_ownership: "managed",
    delivery_mode: (primary?.delivery_mode as Workspace["delivery_mode"]) ?? "remote_review",
    delivery_status: primary?.delivery_status ?? "active",
    locations,
    directories,
    sessions: value.sessions ?? [],
    todos: value.todos ?? [],
    forks: value.forks ?? [],
  };
}

function upsertSession(sessions: Session[], session: Session): Session[] {
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index === -1) return [...sessions, session];
  return sessions.map((item, itemIndex) => itemIndex === index ? session : item);
}

function updateProjectWorkspaceSessions(projects: ProjectDetail[], workspaceId: string, sessions: Session[]): ProjectDetail[] {
  return projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.map((stream) => stream.id === workspaceId ? { ...stream, sessions } : stream),
  }));
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Workspace />} />
      <Route path="/projects" element={<Workspace />} />
      <Route path="/projects/:projectId" element={<Workspace />} />
      <Route path="/projects/:projectId/sessions/:sessionId" element={<Workspace />} />
      <Route path="/workspaces/:workspaceId" element={<Workspace />} />
      <Route path="/workspaces/:workspaceId/sessions/:sessionId" element={<Workspace />} />
      <Route path="*" element={<Workspace />} />
    </Routes>
  );
}

function Workspace() {
  const { t } = useTranslation();
  const params = useParams<{ projectId?: string; workspaceId?: string; sessionId?: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectDetail[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("treefold.sidebar.width"));
    return Number.isFinite(stored) ? Math.min(520, Math.max(240, stored)) : 272;
  });
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [addDirectoryProject, setAddDirectoryProject] = useState<ProjectDetail | null>(null);
  const [editDirectory, setEditDirectory] = useState<Directory | null>(null);
  const [createWorkspaceProject, setCreateWorkspaceProject] = useState<ProjectDetail | null>(null);
  const [createForkWorkspace, setCreateForkWorkspace] = useState<Workspace | null>(null);
  const [configureWorkspaceLocation, setConfigureWorkspaceLocation] = useState<WorkspaceLocation | null>(null);
  const [finishWorkspaceDialog, setFinishWorkspaceDialog] = useState<WorkspaceDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [closingSessionIds, setClosingSessionIds] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const sessionRefreshInFlight = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [projectList, systemStatus, appSettings] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<SystemStatus>("/api/system"),
        api<AppSettings>("/api/settings"),
      ]);
      const details = await Promise.all((projectList ?? []).map((project) => api<ProjectDetail>(`/api/projects/${project.id}`).then(normalizeProject)));
      const streamDetails = await Promise.all(details.flatMap((project) => project.workspaces.filter((stream) => stream.status === "active")).map((stream) => api<WorkspaceDetail>(`/api/workspaces/${stream.id}`).then(normalizeWorkspace)));
      const streamsByID = new Map(streamDetails.map((stream) => [stream.id, stream]));
      setProjects(details.map((project) => ({ ...project, workspaces: project.workspaces.map((stream) => streamsByID.get(stream.id) ?? stream) })));
      setSystem(systemStatus);
      setSettings(appSettings);
      if (params.workspaceId) {
        const detail = streamsByID.get(params.workspaceId) ?? normalizeWorkspace(await api<WorkspaceDetail>(`/api/workspaces/${params.workspaceId}`));
        setWorkspace(detail);
        setExpandedProjects((current) => new Set(current).add(detail.project.id));
        setExpandedWorkspaces((current) => {
          const next = new Set(current);
          next.add(detail.id);
          if (detail.parent_workspace_id) next.add(detail.parent_workspace_id);
          return next;
        });
      } else {
        setWorkspace(null);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [params.workspaceId]);

  const refreshWorkspaceSessions = useCallback(async (workspaceId: string) => {
    if (sessionRefreshInFlight.current) return;
    sessionRefreshInFlight.current = true;
    try {
      const sessions = await api<Session[]>(`/api/workspaces/${workspaceId}/sessions`);
      setProjects((current) => updateProjectWorkspaceSessions(current, workspaceId, sessions));
      setWorkspace((current) => current?.id === workspaceId ? { ...current, sessions } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Session 状态刷新失败");
    } finally {
      sessionRefreshInFlight.current = false;
    }
  }, []);

  const refreshProjectSessions = useCallback(async (projectId: string) => {
    if (sessionRefreshInFlight.current) return;
    sessionRefreshInFlight.current = true;
    try {
      const sessions = await api<Session[]>(`/api/projects/${projectId}/sessions`);
      setProjects((current) => current.map((project) => project.id === projectId ? { ...project, sessions } : project));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Session 状态刷新失败");
    } finally {
      sessionRefreshInFlight.current = false;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const preference = settings?.language ?? "system";
    void applyLanguage(preference);
    if (preference !== "system") return;
    const updateFromSystem = () => { void applyLanguage("system"); };
    window.addEventListener("languagechange", updateFromSystem);
    return () => window.removeEventListener("languagechange", updateFromSystem);
  }, [settings?.language]);
  useEffect(() => {
    const refreshSessions = params.workspaceId
      ? () => void refreshWorkspaceSessions(params.workspaceId!)
      : params.projectId
        ? () => void refreshProjectSessions(params.projectId!)
        : null;
    if (!refreshSessions) return;
    const timer = window.setInterval(refreshSessions, 2500);
    return () => window.clearInterval(timer);
  }, [params.projectId, params.workspaceId, refreshProjectSessions, refreshWorkspaceSessions]);
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
  useEffect(() => { window.localStorage.setItem("treefold.sidebar.width", String(sidebarWidth)); }, [sidebarWidth]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === params.projectId || project.id === workspace?.project.id) ?? null, [params.projectId, projects, workspace]);
  const selectedSession = workspace?.sessions.find((session) => session.id === params.sessionId) ?? selectedProject?.sessions.find((session) => session.id === params.sessionId) ?? null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh(true);
      setError("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(update: { language: LanguagePreference; extraArgs: string[] }) {
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ language: update.language, agents: { codex: { extra_args: update.extraArgs } } }),
      });
      await refresh(true);
      setError("");
      return { ok: true as const };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("settings.saveFailedFallback");
      setError(message);
      return { ok: false as const, error: message };
    } finally {
      setBusy(false);
    }
  }

  async function gitSync(scope: "projects" | "workspaces", id: string, action: "pull" | "push") {
    await act(() => api(`/api/${scope}/${id}/git/${action}-all`, { method: "POST" }));
  }

  async function gitSyncProjectLocation(id: string, action: "pull" | "push") {
    await act(() => api(`/api/project-locations/${id}/git/${action}`, { method: "POST" }));
  }

  async function gitSyncWorkspaceLocation(id: string, action: "pull" | "push") {
    await act(() => api(`/api/workspace-locations/${id}/git/${action}`, { method: "POST" }));
  }

  async function clearWorkspaceLocationUpstream(location: WorkspaceLocation) {
    await act(() => api(`/api/workspace-locations/${location.id}`, { method: "PATCH", body: JSON.stringify({ remote_name: "", remote_branch: "" }) }));
  }

  async function createShell(stream: WorkspaceDetail | Workspace, directory?: Directory) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await api<Session>(`/api/workspaces/${stream.id}/sessions`, { method: "POST", body: JSON.stringify({ kind: "shell", project_directory_id: directory?.id }) });
      setProjects((current) => {
        const owner = current.flatMap((project) => project.workspaces).find((item) => item.id === stream.id) as SidebarStream | undefined;
        return updateProjectWorkspaceSessions(current, stream.id, upsertSession(owner?.sessions ?? [], created));
      });
      setWorkspace((current) => current?.id === stream.id ? { ...current, sessions: upsertSession(current.sessions, created) } : current);
      setError("");
      navigate(`/workspaces/${stream.id}/sessions/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shell 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createCodex(stream: WorkspaceDetail | Workspace, directory?: Directory) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await api<Session>(`/api/workspaces/${stream.id}/sessions`, { method: "POST", body: JSON.stringify({ kind: "codex", project_directory_id: directory?.id }) });
      setProjects((current) => {
        const owner = current.flatMap((project) => project.workspaces).find((item) => item.id === stream.id) as SidebarStream | undefined;
        return updateProjectWorkspaceSessions(current, stream.id, upsertSession(owner?.sessions ?? [], created));
      });
      setWorkspace((current) => current?.id === stream.id ? { ...current, sessions: upsertSession(current.sessions, created) } : current);
      setError("");
      navigate(`/workspaces/${stream.id}/sessions/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Codex 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createProjectShell(project: ProjectDetail, directory?: Directory) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await api<Session>(`/api/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ kind: "shell", project_directory_id: directory?.id }) });
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, sessions: upsertSession(item.sessions, created) } : item));
      setError("");
      navigate(`/projects/${project.id}/sessions/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shell 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createProjectCodex(project: ProjectDetail, directory?: Directory) {
    setSessionMenu(null);
    setBusy(true);
    try {
      const created = await api<Session>(`/api/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ kind: "codex", project_directory_id: directory?.id }) });
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, sessions: upsertSession(item.sessions, created) } : item));
      setError("");
      navigate(`/projects/${project.id}/sessions/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Codex 创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function openInFinder(project: ProjectDetail, stream?: Workspace) {
    const endpoint = stream ? `/api/workspaces/${stream.id}/reveal` : `/api/projects/${project.id}/reveal`;
    await act(() => api(endpoint, { method: "POST" }));
  }

  async function updateProjectStatus(project: ProjectDetail, status: Project["status"]) {
    const ok = await act(() => api(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }));
    if (!ok) return;
    if (status === "archived") {
      setExpandedProjects((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      if (params.projectId === project.id || workspace?.project.id === project.id) navigate("/");
    }
  }

  async function permanentlyDeleteProject(project: ProjectDetail) {
    if (!window.confirm(t("overview.deleteConfirmation", { name: project.name }))) return;
    const ok = await act(() => api(`/api/projects/${project.id}`, { method: "DELETE" }));
    if (ok && (params.projectId === project.id || workspace?.project.id === project.id)) navigate("/");
  }

  async function removeWorktree(worktree: GitWorktree) {
    if (worktree.workspace_id) {
      setError(`Worktree belongs to active Workspace “${worktree.workspace_name || worktree.workspace_id}”; use Finish Workspace.`);
      return;
    }
    if (!window.confirm(`确定删除 worktree？\n\n${worktree.path}\n\n未提交的改动会被丢弃。`)) return;
    await act(() => api(`/api/project-directories/${worktree.project_location_id}/worktrees`, {
      method: "DELETE",
      body: JSON.stringify({ path: worktree.path }),
    }));
  }

  async function refreshLocation(location: Directory) {
    await act(() => api(`/api/project-locations/${location.id}/refresh`, { method: "POST" }));
  }

  async function makeDefaultLocation(project: ProjectDetail, location: Directory) {
    await act(() => api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ default_location_id: location.id }) }));
  }

  async function reattachLocation(location: Directory) {
    const selected = await open({ directory: true, multiple: false, title: `Reattach ${location.name}` });
    if (typeof selected !== "string") return;
    await act(() => api(`/api/project-locations/${location.id}/reattach`, { method: "POST", body: JSON.stringify({ path: selected }) }));
  }

  async function closeSidebarSession(stream: Workspace, session: Session) {
    setClosingSessionIds((current) => new Set(current).add(session.id));
    if (params.sessionId === session.id) navigate(stream.id ? `/workspaces/${stream.id}` : `/projects/${stream.project_id}`);

    try {
      await api(`/api/sessions/${session.id}/close`, { method: "POST" });
      await refresh(true);
    } catch (cause) {
      await refresh(true);
      setError(cause instanceof Error ? cause.message : "关闭 Session 失败");
    } finally {
      if (session.kind === "shell") {
        setProjects((current) => updateProjectWorkspaceSessions(current, stream.id, (current.flatMap((project) => project.workspaces).find((item) => item.id === stream.id) as SidebarStream | undefined)?.sessions?.filter((item) => item.id !== session.id) ?? []));
        setWorkspace((current) => current?.id === stream.id ? { ...current, sessions: current.sessions.filter((item) => item.id !== session.id) } : current);
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
      await api(`/api/sessions/${session.id}/close`, { method: "POST" });
      await refresh(true);
    } catch (cause) {
      await refresh(true);
      setError(cause instanceof Error ? cause.message : "关闭 Session 失败");
    } finally {
      if (session.kind === "shell") {
        setProjects((current) => current.map((item) => item.id === project.id ? { ...item, sessions: item.sessions.filter((candidate) => candidate.id !== session.id) } : item));
      }
      setClosingSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }

  async function openHistorySession(stream: WorkspaceDetail, session: Session) {
    if (!session.sidebar_visible) {
      const ok = await act(() => api(`/api/sessions/${session.id}/open`, { method: "POST" }));
      if (!ok) return;
    }
    navigate(`/workspaces/${stream.id}/sessions/${session.id}`);
  }

  async function openProjectHistorySession(project: ProjectDetail, session: Session) {
    if (!session.sidebar_visible) {
      const ok = await act(() => api(`/api/sessions/${session.id}/open`, { method: "POST" }));
      if (!ok) return;
    }
    navigate(`/projects/${project.id}/sessions/${session.id}`);
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f4f4f1] text-neutral-900" style={{ "--sidebar-width": `${sidebarWidth}px`, "--toolbar-left-width": `${sidebarHidden ? 48 : sidebarWidth}px` } as React.CSSProperties}>
      <header data-testid="app-toolbar" className="relative z-50 flex h-12 shrink-0 items-center border-b border-neutral-200 bg-white">
        <div data-testid="toolbar-left-rail" className={cn("flex h-full w-12 shrink-0 items-center px-2", !resizingSidebar && "transition-[width] duration-200", "md:w-[var(--toolbar-left-width)]")}>
          <Button className="md:hidden" size="icon" variant="ghost" aria-label={t("workspace.openMobileNavigation")} onClick={() => setMobileSidebar(true)}><Menu data-icon="inline-start" /></Button>
          <Button className="hidden md:inline-flex" size="icon" variant={sidebarHidden ? "secondary" : "ghost"} aria-label={t(sidebarHidden ? "workspace.showLeftSidebar" : "workspace.hideLeftSidebar")} onClick={() => setSidebarHidden((value) => !value)}>{sidebarHidden ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</Button>
        </div>
        <div data-testid="toolbar-content-frame" className={cn("min-w-0 flex-1 overflow-y-auto px-5 transition-[margin] duration-200 [scrollbar-gutter:stable] sm:px-8 lg:px-12", selectedProject && inspectorOpen && "lg:mr-[340px]")}>
          <div data-testid="toolbar-title" className="mx-auto max-w-6xl truncate pr-16 text-xs text-neutral-500" title={workspace ? `${workspace.project.name} / ${workspace.name}` : selectedProject?.name || "Treefold"}>{workspace ? `${workspace.project.name} / ${workspace.name}` : selectedProject?.name || "Treefold"}</div>
        </div>
        <div className="absolute right-2 flex items-center">
          <Button size="icon" variant="ghost" disabled={busy} aria-label={t("workspace.refresh")} onClick={() => void refresh()}><RefreshCw data-icon="inline-start" /></Button>
          {selectedProject && <Button size="icon" variant={inspectorOpen ? "secondary" : "ghost"} aria-label={t(inspectorOpen ? "workspace.hideRightSidebar" : "workspace.showRightSidebar")} onClick={() => setInspectorOpen((value) => !value)}>{inspectorOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</Button>}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {mobileSidebar && <button className="absolute inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMobileSidebar(false)} aria-label={t("workspace.closeNavigation")} />}
        <WorkspaceSidebar
          projects={projects}
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
          onNavigate={(path) => { navigate(path); setMobileSidebar(false); setSessionMenu(null); }}
          onCreateProject={() => setCreateProjectOpen(true)}
          onCreateWorkspace={setCreateWorkspaceProject}
          onCreateFork={setCreateForkWorkspace}
          onCreateShell={(stream, directory) => void createShell(stream, directory)}
          onCreateCodex={(stream, directory) => void createCodex(stream, directory)}
          onCreateBaseShell={(project, directory) => void createProjectShell(project, directory)}
          onCreateBaseCodex={(project, directory) => void createProjectCodex(project, directory)}
          onOpenInFinder={(project, stream) => void openInFinder(project, stream)}
          onArchiveProject={(project) => void updateProjectStatus(project, "archived")}
          onCloseSession={(stream, session) => void closeSidebarSession(stream, session)}
          onCloseProjectSession={(project, session) => void closeProjectSession(project, session)}
          onResizeStart={() => setResizingSidebar(true)}
          onResizeKeyboard={(delta) => setSidebarWidth((current) => Math.min(520, Math.max(240, current + delta)))}
          onSettings={() => setSettingsOpen(true)}
        />

        <main data-testid="workspace-main" className={cn("flex h-full min-w-0 flex-col", !resizingSidebar && "transition-[margin] duration-200", sidebarHidden ? "md:ml-12" : "md:ml-[var(--sidebar-width)]")}>
        {error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2"><CircleAlert /><AlertDescription>{error}</AlertDescription><AlertAction><Button size="icon-sm" variant="ghost" aria-label="Dismiss error" onClick={() => setError("")}><X /></Button></AlertAction></Alert>}
        {warning && <Alert variant="warning" className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2"><CircleAlert /><AlertDescription>{t("workspace.branchNotSwitched", { message: warning })}</AlertDescription><AlertAction><Button size="icon-sm" variant="ghost" aria-label="Dismiss warning" onClick={() => setWarning("")}><X /></Button></AlertAction></Alert>}

        <div className="flex min-h-0 flex-1">
          <section className={cn("min-w-0 flex-1 transition-[margin] duration-200", selectedProject && inspectorOpen && "lg:mr-[340px]")}>
            {loading ? <CenteredMessage>{t("workspace.loading")}</CenteredMessage> : selectedSession ? (
              <SessionWorkspace
                session={selectedSession}
                busy={busy}
                onStop={() => void act(() => api(`/api/sessions/${selectedSession.id}/stop`, { method: "POST" }))}
                onRestart={() => void act(() => api(`/api/sessions/${selectedSession.id}/restart`, { method: "POST" }))}
                onClose={() => workspace ? void closeSidebarSession(workspace, selectedSession) : selectedProject ? void closeProjectSession(selectedProject, selectedSession) : undefined}
                onExit={() => {
                  if (selectedSession.kind === "shell") {
                    navigate(workspace ? `/workspaces/${workspace.id}` : `/projects/${selectedProject!.id}`);
                  }
                  void refresh(true);
                }}
              />
            ) : workspace ? (
              <WorkspaceHome detail={workspace} busy={busy} onOpen={(session) => void openHistorySession(workspace, session)} onOpenFork={(fork) => navigate(`/workspaces/${fork.id}`)} onFork={() => setCreateForkWorkspace(workspace)} onSyncLocation={(location, action) => void gitSyncWorkspaceLocation(location.id, action)} onConfigureUpstream={setConfigureWorkspaceLocation} onClearUpstream={(location) => void clearWorkspaceLocationUpstream(location)} onPull={() => void gitSync("workspaces", workspace.id, "pull")} onPush={() => void gitSync("workspaces", workspace.id, "push")} onFinish={() => setFinishWorkspaceDialog(workspace)} />
            ) : selectedProject ? (
              <ProjectHome project={selectedProject} busy={busy} onOpen={(id) => navigate(`/workspaces/${id}`)} onOpenSession={(session) => void openProjectHistorySession(selectedProject, session)} onCreate={() => setCreateWorkspaceProject(selectedProject)} onAddDirectory={() => setAddDirectoryProject(selectedProject)} onEditDirectory={setEditDirectory} onRefreshLocation={(location) => void refreshLocation(location)} onMakeDefault={(location) => void makeDefaultLocation(selectedProject, location)} onReattach={(location) => void reattachLocation(location)} onSyncLocation={(location, action) => void gitSyncProjectLocation(location.id, action)} onDeleteWorktree={(item) => void removeWorktree(item)} onPull={() => void gitSync("projects", selectedProject.id, "pull")} onPush={() => void gitSync("projects", selectedProject.id, "push")} />
            ) : (
              <Overview projects={projects} busy={busy} onOpen={(id) => navigate(`/projects/${id}`)} onCreate={() => setCreateProjectOpen(true)} onRestore={(project) => void updateProjectStatus(project, "active")} onDelete={(project) => void permanentlyDeleteProject(project)} />
            )}
          </section>

          {selectedProject && <WorkspaceInspector open={inspectorOpen} project={selectedProject} workspace={workspace} session={selectedSession} />}
        </div>
        </main>
      </div>

      <CreateProjectDialog open={createProjectOpen} busy={busy} onOpenChange={setCreateProjectOpen} onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        let created: Project | null = null;
        const ok = await act(async () => { created = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) }); });
        if (ok && created) { const detail = normalizeProject(await api<ProjectDetail>(`/api/projects/${(created as Project).id}`)); setCreateProjectOpen(false); setAddDirectoryProject(detail); navigate(`/projects/${detail.id}`); }
      }} />
      <AddDirectoryDialog project={addDirectoryProject} busy={busy} onOpenChange={(open) => { if (!open) setAddDirectoryProject(null); }} onSubmit={async (locations) => {
        if (!addDirectoryProject) return;
        const ok = await act(async () => {
          for (const location of locations) {
            await api(`/api/projects/${addDirectoryProject.id}/locations`, {
              method: "POST",
              body: JSON.stringify({
                path: location.path,
                description: location.description,
                worktree_setup_command: location.worktree_setup_command,
                base_branch: location.inspection?.git_status === "ready" ? location.base_branch : undefined,
                delivery_mode: location.inspection?.git_status === "ready" ? location.delivery_mode : undefined,
              }),
            });
          }
        });
        if (ok) setAddDirectoryProject(null);
      }} />
      <EditDirectoryDialog directory={editDirectory} busy={busy} onOpenChange={(open) => { if (!open) setEditDirectory(null); }} onSubmit={async (event) => {
        event.preventDefault();
        if (!editDirectory) return;
        const form = new FormData(event.currentTarget);
        const ok = await act(() => api(`/api/project-directories/${editDirectory.id}`, { method: "PATCH", body: JSON.stringify({ description: form.get("description"), worktree_setup_command: form.get("worktree_setup_command"), base_branch: form.get("base_branch"), delivery_mode: form.get("delivery_mode") }) }));
        if (ok) setEditDirectory(null);
      }} />
      <CreateWorkspaceDialog project={createWorkspaceProject} busy={busy} onOpenChange={(open) => { if (!open) setCreateWorkspaceProject(null); }} onSubmit={async (event) => {
        event.preventDefault();
        if (!createWorkspaceProject) return;
        const form = new FormData(event.currentTarget);
        let created: Workspace | null = null;
        const ok = await act(async () => { created = await api<Workspace>(`/api/projects/${createWorkspaceProject.id}/workspaces`, { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), branch: form.get("branch"), remote_name: form.get("remote_name"), remote_branch: form.get("remote_branch") }) }); });
        if (ok && created) { setCreateWorkspaceProject(null); navigate(`/workspaces/${(created as Workspace).id}`); }
      }} />
      <CreateForkDialog workspace={createForkWorkspace} busy={busy} onOpenChange={(open) => { if (!open) setCreateForkWorkspace(null); }} onSubmit={async (event) => {
        event.preventDefault();
        if (!createForkWorkspace) return;
        const form = new FormData(event.currentTarget);
        let created: Workspace | null = null;
        const ok = await act(async () => { created = await api<Workspace>(`/api/workspaces/${createForkWorkspace.id}/forks`, { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) }); });
        if (ok && created) { setCreateForkWorkspace(null); navigate(`/workspaces/${(created as Workspace).id}`); }
      }} />
      <ConfigureWorkspaceLocationDialog location={configureWorkspaceLocation} busy={busy} onOpenChange={(open) => { if (!open) setConfigureWorkspaceLocation(null); }} onSubmit={async (event) => {
        event.preventDefault(); if (!configureWorkspaceLocation) return; const owner = configureWorkspaceLocation; const form = new FormData(event.currentTarget);
        const ok = await act(() => api(`/api/workspace-locations/${owner.id}`, { method: "PATCH", body: JSON.stringify({ remote_name: form.get("remote_name"), remote_branch: form.get("remote_branch") }) }));
        if (ok) setConfigureWorkspaceLocation(null);
      }} />
      <FinishWorkspaceDialog workspace={finishWorkspaceDialog} busy={busy} onOpenChange={(open) => { if (!open) setFinishWorkspaceDialog(null); }} onSubmit={async (locationId, payload) => {
        if (!finishWorkspaceDialog) return;
        const owner = finishWorkspaceDialog;
        let updated: WorkspaceDetail | null = null;
        const ok = await act(async () => { await api(`/api/workspace-locations/${locationId}/finish`, { method: "POST", body: JSON.stringify(payload) }); updated = normalizeWorkspace(await api<WorkspaceDetail>(`/api/workspaces/${owner.id}`)); if ((updated as WorkspaceDetail).locations.filter((item) => item.access_mode === "read_write").every((item) => ["delivered", "kept", "discarded", "remote_merged"].includes(item.delivery_status))) await api(`/api/workspaces/${owner.id}/archive`, { method: "POST" }); });
        if (ok && updated && (updated as WorkspaceDetail).locations.filter((item) => item.access_mode === "read_write").every((item) => ["delivered", "kept", "discarded", "remote_merged"].includes(item.delivery_status))) { setFinishWorkspaceDialog(null); navigate(owner.parent_workspace_id ? `/workspaces/${owner.parent_workspace_id}` : `/projects/${owner.project.id}`); } else if (ok && updated) setFinishWorkspaceDialog(updated);
      }} />
      <SettingsDialog open={settingsOpen} system={system} settings={settings} busy={busy} onOpenChange={setSettingsOpen} onSave={saveSettings} />
    </div>
  );
}

function WorkspaceSidebar({ projects, selectedWorkspaceId, selectedSessionId, hidden, mobileOpen, resizing, expandedProjects, expandedWorkspaces, closingSessionIds, sessionMenu, onToggleProject, onToggleWorkspace, onSessionMenu, onNavigate, onCreateProject, onCreateWorkspace, onCreateFork, onCreateShell, onCreateCodex, onCreateBaseShell, onCreateBaseCodex, onOpenInFinder, onArchiveProject, onCloseSession, onCloseProjectSession, onResizeStart, onResizeKeyboard, onSettings }: {
  projects: ProjectDetail[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  hidden: boolean;
  mobileOpen: boolean;
  resizing: boolean;
  expandedProjects: Set<string>;
  expandedWorkspaces: Set<string>;
  closingSessionIds: Set<string>;
  sessionMenu: SessionMenuState | null;
  onToggleProject: (id: string) => void;
  onToggleWorkspace: (id: string) => void;
  onSessionMenu: (menu: SessionMenuState | null) => void;
  onNavigate: (path: string) => void;
  onCreateProject: () => void;
  onCreateWorkspace: (project: ProjectDetail) => void;
  onCreateFork: (workspace: Workspace) => void;
  onCreateShell: (stream: Workspace, directory?: Directory) => void;
  onCreateCodex: (stream: Workspace, directory?: Directory) => void;
  onCreateBaseShell: (project: ProjectDetail, directory?: Directory) => void;
  onCreateBaseCodex: (project: ProjectDetail, directory?: Directory) => void;
  onOpenInFinder: (project: ProjectDetail, stream?: Workspace) => void;
  onArchiveProject: (project: ProjectDetail) => void;
  onCloseSession: (stream: Workspace, session: Session) => void;
  onCloseProjectSession: (project: ProjectDetail, session: Session) => void;
  onResizeStart: () => void;
  onResizeKeyboard: (delta: number) => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  const [contextOwner, setContextOwner] = useState<{ project: ProjectDetail; stream?: SidebarStream; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextOwner && !sessionMenu) return;
    const close = () => { setContextOwner(null); onSessionMenu(null); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", closeOnEscape); };
  }, [contextOwner, onSessionMenu, sessionMenu]);
  return <aside data-testid="workspace-sidebar" className={cn("absolute inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] min-w-[240px] max-w-[calc(100vw-2rem)] flex-col border-r border-neutral-200 bg-[#ecece8] md:max-w-[520px]", !resizing && "transition-transform duration-200", mobileOpen ? "translate-x-0" : "-translate-x-full", hidden ? "md:-translate-x-full" : "md:translate-x-0")}>
    <div className="flex h-10 items-center border-b border-neutral-200 px-2">
      <button className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left" onClick={() => onNavigate("/")}><span className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t("sidebar.projects")}</span></button>
      <button data-sidebar-row-action="true" className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-500 hover:bg-white/70" aria-label={t("sidebar.newProject")} onClick={onCreateProject}><Plus className="size-4" /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {projects.filter((project) => project.status === "active").map((project) => {
        const projectOpen = expandedProjects.has(project.id);
        return <div key={project.id} className="relative mb-1">
          <div data-testid="sidebar-project-node" className="group flex min-w-0 items-center" onContextMenu={(event) => { event.preventDefault(); onSessionMenu(null); setContextOwner({ project, x: event.clientX, y: event.clientY }); }}>
            <button data-testid="sidebar-tree-toggle" className={sidebarTreeToggleClass} aria-label={t(projectOpen ? "sidebar.collapseProject" : "sidebar.expandProject", { name: project.name })} aria-expanded={projectOpen} onClick={() => onToggleProject(project.id)}>{projectOpen ? <ChevronDown data-testid="sidebar-tree-chevron" className="size-3.5" /> : <ChevronRight data-testid="sidebar-tree-chevron" className="size-3.5" />}</button>
            <button data-testid="sidebar-project-link" className={cn(sidebarTreeLinkClass, "text-xs font-medium")} title={project.name} onClick={() => onNavigate(`/projects/${project.id}`)}><FolderGit2 data-testid="sidebar-tree-icon" className={sidebarTreeIconClass} /><span data-sidebar-tree-label="true" className="min-w-0 flex-1 truncate">{project.name}</span></button>
            <button data-testid="sidebar-project-action" data-sidebar-row-action="true" className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-500 hover:bg-white" aria-label={t("sidebar.newInProject", { name: project.name })} onClick={(event) => { event.stopPropagation(); setContextOwner(null); const id = `project:${project.id}`; const rect = event.currentTarget.getBoundingClientRect(); onSessionMenu(sessionMenu?.id === id ? null : { id, x: rect.left, y: rect.bottom + 4 }); }}><Plus className="size-3.5" /></button>
          </div>
          {sessionMenu?.id === `project:${project.id}` && <SessionDirectoryMenu testId="sidebar-session-menu" directories={project.directories} position={sessionMenu} primaryAction={<button data-testid="create-workspace-action" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium hover:bg-neutral-100" onClick={() => { onSessionMenu(null); onCreateWorkspace(project); }}><Workflow className="size-3.5" />{t("sidebar.newWorkspace")}</button>} onShell={(directory) => { onSessionMenu(null); onCreateBaseShell(project, directory); }} onCodex={(directory) => { onSessionMenu(null); onCreateBaseCodex(project, directory); }} />}
          {projectOpen && <div data-testid="sidebar-project-children" className="ml-3.5 border-l border-neutral-300 pl-1">
            <SidebarProjectSessions project={project} selectedSessionId={selectedSessionId} closingSessionIds={closingSessionIds} onNavigate={onNavigate} onCloseSession={onCloseProjectSession} />
            {project.workspaces.filter((item) => !item.parent_workspace_id).map((stream) => <SidebarWorkspaceNode
              key={stream.id}
              stream={stream}
              allStreams={project.workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              selectedSessionId={selectedSessionId}
              expandedWorkspaces={expandedWorkspaces}
              closingSessionIds={closingSessionIds}
              sessionMenu={sessionMenu}
              onToggleWorkspace={onToggleWorkspace}
              onSessionMenu={onSessionMenu}
              onNavigate={onNavigate}
              onCreateShell={onCreateShell}
              onCreateCodex={onCreateCodex}
              onCreateFork={onCreateFork}
              onOpenContext={(event, stream) => { event.preventDefault(); onSessionMenu(null); setContextOwner({ project, stream, x: event.clientX, y: event.clientY }); }}
              onCloseSession={onCloseSession}
            />)}
            {project.workspaces.filter((item) => !item.parent_workspace_id).length === 0 && <p className="px-3 py-2 text-[11px] text-neutral-400">{t("sidebar.noWorkspaces")}</p>}
          </div>}
        </div>;
      })}
    </div>
    {contextOwner && <SessionDirectoryMenu testId="directory-session-context-menu" directories={contextOwner.stream?.directories ?? contextOwner.project.directories} position={contextOwner} footerRows={contextOwner.stream ? 1 : 2} onShell={(directory) => { const owner = contextOwner; setContextOwner(null); owner.stream ? onCreateShell(owner.stream, directory) : onCreateBaseShell(owner.project, directory); }} onCodex={(directory) => { const owner = contextOwner; setContextOwner(null); owner.stream ? onCreateCodex(owner.stream, directory) : onCreateBaseCodex(owner.project, directory); }} footer={<><button className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-neutral-100" onClick={() => { const owner = contextOwner; setContextOwner(null); onOpenInFinder(owner.project, owner.stream); }}><FolderOpen className="size-3.5" />{t("sidebar.openInFinder")}</button>{!contextOwner.stream && <button data-testid="archive-project-action" className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-amber-700 hover:bg-amber-50" onClick={() => { const owner = contextOwner; setContextOwner(null); onArchiveProject(owner.project); }}><Archive className="size-3.5" />{t("sidebar.archiveProject")}</button>}</>} />}
    <div className="border-t border-neutral-200 p-2"><button data-testid="open-settings" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-neutral-600 hover:bg-white/70" onClick={onSettings}><Settings2 className="size-4 shrink-0" />{t("sidebar.settings")}</button></div>
    <div data-testid="sidebar-resize-handle" role="separator" aria-label={t("sidebar.resize")} aria-orientation="vertical" tabIndex={0} className="absolute inset-y-0 right-0 hidden w-1 translate-x-1/2 cursor-col-resize touch-none hover:bg-blue-400/50 focus:bg-blue-400/50 md:block" onPointerDown={(event) => { event.preventDefault(); onResizeStart(); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); onResizeKeyboard(-16); } else if (event.key === "ArrowRight") { event.preventDefault(); onResizeKeyboard(16); } }} />
  </aside>;
}

type SidebarStream = Workspace & { sessions?: Session[]; directories?: Directory[]; forks?: Workspace[] };

const sidebarTreeToggleClass = "grid size-6 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-white/70 hover:text-neutral-700";
const sidebarTreeLinkClass = "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md py-1.5 text-left hover:bg-white/70";
const sidebarTreeIconClass = "size-3.5 shrink-0 text-neutral-500";

type SidebarNodeProps = {
  stream: SidebarStream;
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  expandedWorkspaces: Set<string>;
  closingSessionIds: Set<string>;
  sessionMenu: SessionMenuState | null;
  onToggleWorkspace: (id: string) => void;
  onSessionMenu: (menu: SessionMenuState | null) => void;
  onNavigate: (path: string) => void;
  onCreateShell: (stream: Workspace, directory?: Directory) => void;
  onCreateCodex: (stream: Workspace, directory?: Directory) => void;
  onCreateFork: (stream: Workspace) => void;
  onOpenContext: (event: React.MouseEvent, stream: SidebarStream) => void;
  onCloseSession: (stream: Workspace, session: Session) => void;
};

function SessionDirectoryMenu({ directories, testId, position, primaryAction, footer, footerRows = 1, onShell, onCodex }: { directories: Directory[]; testId: string; position: { x: number; y: number }; primaryAction?: React.ReactNode; footer?: React.ReactNode; footerRows?: number; onShell: (directory: Directory) => void; onCodex: (directory: Directory) => void }) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const activate = (item: Directory, element: HTMLButtonElement) => {
    const menuTop = element.closest<HTMLElement>(`[data-testid="${testId}"]`)?.getBoundingClientRect().top ?? 0;
    const availableTop = window.innerHeight - menuTop - 124;
    setDirectory(item);
    setSubmenuTop(Math.max(0, Math.min(element.offsetTop, availableTop)));
  };
  const menuHeight = 36 + directories.length * 40 + (primaryAction ? 42 : 0) + (footer ? 42 * footerRows : 0);
  const left = Math.max(8, Math.min(position.x, window.innerWidth - 208 - 160 - 8));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8));
  return createPortal(<div data-testid={testId} className="fixed z-[100] w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl" style={{ left, top }} onClick={(event) => event.stopPropagation()} onMouseLeave={() => setDirectory(null)}>
    {primaryAction && <div data-testid="session-menu-primary-action" className="mb-1 border-b border-neutral-100 pb-1" onMouseEnter={() => setDirectory(null)} onFocus={() => setDirectory(null)}>{primaryAction}</div>}
    <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{t("sidebar.newSessionIn")}</p>{directories.map((item) => <button key={item.id} data-testid={`session-directory-${item.id}`} aria-expanded={directory?.id === item.id} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-neutral-100", directory?.id === item.id && "bg-neutral-100 text-neutral-950")} onMouseEnter={(event) => activate(item, event.currentTarget)} onFocus={(event) => activate(item, event.currentTarget)}>{item.is_git ? <FolderGit2 className="size-3.5" /> : <Folder className="size-3.5" />}<span className="min-w-0 flex-1 truncate">{item.name}</span>{item.role === "primary" && <span className="text-[9px] text-neutral-400">{t("sidebar.primary")}</span>}<ChevronRight className={cn("size-3 transition-transform", directory?.id === item.id && "translate-x-0.5")} /></button>)}
    {directory && <div key={directory.id} data-testid="directory-session-submenu" className="directory-session-submenu absolute left-full w-40 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl" style={{ top: submenuTop }}><p className="truncate px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-400" title={directory.name}>{directory.name}</p><button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-neutral-100" onClick={() => onShell(directory)}><Shell className="size-3.5" />Shell</button><button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40" disabled={!directory.is_git || directory.git_status !== "ready"} title={!directory.is_git ? "Non-Git locations are read-only Codex context" : undefined} onClick={() => onCodex(directory)}><Bot className="size-3.5" />Codex</button></div>}
    {footer && <div data-testid="session-menu-footer" className="mt-1 border-t border-neutral-100 pt-1" onMouseEnter={() => setDirectory(null)} onMouseMove={() => setDirectory(null)} onFocus={() => setDirectory(null)}>{footer}</div>}
  </div>, document.body);
}

function SidebarCreateSessionMenu({ stream, menu, onSessionMenu, onCreateShell, onCreateCodex, onCreateFork, allowFork = false }: Pick<SidebarNodeProps, "stream" | "onSessionMenu" | "onCreateShell" | "onCreateCodex" | "onCreateFork"> & { menu: SessionMenuState | null; allowFork?: boolean }) {
  const { t } = useTranslation();
  if (!menu) return null;
  return <SessionDirectoryMenu testId="sidebar-session-menu" directories={stream.directories ?? []} position={menu} primaryAction={allowFork ? <button data-testid="create-fork-action" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium hover:bg-neutral-100" onClick={() => { onSessionMenu(null); onCreateFork(stream); }}><GitBranch className="size-3.5" />{t("sidebar.newFork")}</button> : undefined} onShell={(directory) => { onSessionMenu(null); onCreateShell(stream, directory); }} onCodex={(directory) => { onSessionMenu(null); onCreateCodex(stream, directory); }} />;
}

function SidebarSessions({ stream, selectedSessionId, closingSessionIds, onNavigate, onCloseSession }: Pick<SidebarNodeProps, "stream" | "selectedSessionId" | "closingSessionIds" | "onNavigate" | "onCloseSession">) {
  return stream.sessions?.filter((session) => session.sidebar_visible && !closingSessionIds.has(session.id)).map((session) => {
    return <div key={session.id} data-testid={`sidebar-session-${session.id}`} className={cn("group/session flex items-center rounded-md text-[11px] text-neutral-600 hover:bg-white/70", selectedSessionId === session.id && "bg-neutral-900 text-white hover:bg-neutral-800")}>
      <button className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-1.5 text-left" title={session.name} onClick={() => onNavigate(`/workspaces/${stream.id}/sessions/${session.id}`)}>{session.kind === "codex" ? <Bot className="size-3 shrink-0" /> : <TerminalSquare className="size-3 shrink-0" />}<span className="min-w-0 flex-1 truncate">{session.name}</span><StatusDot status={session.status} /></button>
      <button className="invisible mr-1 shrink-0 rounded p-1 opacity-70 hover:bg-white/15 group-hover/session:visible focus-visible:visible" title={session.kind === "shell" ? "Close shell" : "Remove from sidebar"} aria-label={session.kind === "shell" ? "Close shell" : "Remove from sidebar"} onClick={(event) => { event.stopPropagation(); onCloseSession(stream, session); }}><X className="size-3" /></button>
    </div>;
  }) ?? null;
}

function SidebarProjectSessions({ project, selectedSessionId, closingSessionIds, onNavigate, onCloseSession }: { project: ProjectDetail; selectedSessionId?: string; closingSessionIds: Set<string>; onNavigate: (path: string) => void; onCloseSession: (project: ProjectDetail, session: Session) => void }) {
  return project.sessions.filter((session) => session.sidebar_visible && !closingSessionIds.has(session.id)).map((session) => {
    return <div key={session.id} data-testid={`sidebar-session-${session.id}`} className={cn("group/session flex items-center rounded-md text-[11px] text-neutral-600 hover:bg-white/70", selectedSessionId === session.id && "bg-neutral-900 text-white hover:bg-neutral-800")}>
      <button className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-1.5 text-left" title={session.name} onClick={() => onNavigate(`/projects/${project.id}/sessions/${session.id}`)}>{session.kind === "codex" ? <Bot className="size-3 shrink-0" /> : <TerminalSquare className="size-3 shrink-0" />}<span className="min-w-0 flex-1 truncate">{session.name}</span><StatusDot status={session.status} /></button>
      <button className="invisible mr-1 shrink-0 rounded p-1 opacity-70 hover:bg-white/15 group-hover/session:visible focus-visible:visible" title={session.kind === "shell" ? "Close shell" : "Remove from sidebar"} aria-label={session.kind === "shell" ? "Close shell" : "Remove from sidebar"} onClick={(event) => { event.stopPropagation(); onCloseSession(project, session); }}><X className="size-3" /></button>
    </div>;
  });
}

function SidebarForkNode(props: SidebarNodeProps) {
  const { stream, selectedWorkspaceId, selectedSessionId, expandedWorkspaces, closingSessionIds, sessionMenu, onToggleWorkspace, onSessionMenu, onNavigate, onCreateShell, onCreateCodex, onCreateFork, onCloseSession, onOpenContext } = props;
  const open = expandedWorkspaces.has(stream.id);
  return <div className="relative">
    <div data-testid="sidebar-fork-node" className={cn("group flex min-w-0 items-center rounded-md", selectedWorkspaceId === stream.id && !selectedSessionId && "bg-white shadow-sm")} onContextMenu={(event) => onOpenContext(event, stream)}>
      <button data-testid="sidebar-tree-toggle" className={sidebarTreeToggleClass} aria-label={`${open ? "Collapse" : "Expand"} Fork ${stream.name}`} aria-expanded={open} onClick={() => onToggleWorkspace(stream.id)}>{open ? <ChevronDown data-testid="sidebar-tree-chevron" className="size-3.5" /> : <ChevronRight data-testid="sidebar-tree-chevron" className="size-3.5" />}</button>
      <button className={cn(sidebarTreeLinkClass, "text-[11px] text-neutral-600")} title={stream.name} onClick={() => onNavigate(`/workspaces/${stream.id}`)}><GitBranch data-testid="sidebar-tree-icon" className={sidebarTreeIconClass} /><span data-testid="sidebar-node-name" data-sidebar-tree-label="true" className="min-w-0 flex-1 truncate">{stream.name}</span></button>
      {stream.status === "active" ? <button data-testid="sidebar-node-action" data-sidebar-row-action="true" className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900" aria-label={`New Session in Fork ${stream.name}`} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onSessionMenu(sessionMenu?.id === stream.id ? null : { id: stream.id, x: rect.left, y: rect.bottom + 4 }); }}><Plus className="size-3.5" /></button> : <span data-sidebar-row-action="true" className="grid size-7 shrink-0 place-items-center" title="Archived"><StatusDot status="closed" /></span>}
    </div>
    <SidebarCreateSessionMenu stream={stream} menu={sessionMenu?.id === stream.id ? sessionMenu : null} onSessionMenu={onSessionMenu} onCreateShell={onCreateShell} onCreateCodex={onCreateCodex} onCreateFork={onCreateFork} />
    {open && <div className="ml-3.5 border-l border-neutral-300 pl-1"><SidebarSessions stream={stream} selectedSessionId={selectedSessionId} closingSessionIds={closingSessionIds} onNavigate={onNavigate} onCloseSession={onCloseSession} />{(!stream.sessions || stream.sessions.filter((session) => session.sidebar_visible).length === 0) && <p className="px-2 py-1.5 text-[10px] text-neutral-400">No Sessions</p>}</div>}
  </div>;
}

function SidebarWorkspaceNode(props: SidebarNodeProps & { allStreams: Workspace[] }) {
  const { t } = useTranslation();
  const { stream, allStreams, selectedWorkspaceId, selectedSessionId, expandedWorkspaces, closingSessionIds, sessionMenu, onToggleWorkspace, onSessionMenu, onNavigate, onCreateShell, onCreateCodex, onCreateFork, onCloseSession, onOpenContext } = props;
  const open = expandedWorkspaces.has(stream.id);
  const forks = (stream.forks ?? []).map((fork) => (allStreams.find((candidate) => candidate.id === fork.id) ?? fork) as SidebarStream).filter((fork) => fork.status === "active");
  return <div className="relative">
    <div data-testid="sidebar-workspace-node" className={cn("group flex min-w-0 items-center rounded-md", selectedWorkspaceId === stream.id && !selectedSessionId && "bg-white shadow-sm")} onContextMenu={(event) => onOpenContext(event, stream)}>
      <button data-testid="sidebar-tree-toggle" className={sidebarTreeToggleClass} aria-label={`${open ? "Collapse" : "Expand"} Workspace ${stream.name}`} aria-expanded={open} onClick={() => onToggleWorkspace(stream.id)}>{open ? <ChevronDown data-testid="sidebar-tree-chevron" className="size-3.5" /> : <ChevronRight data-testid="sidebar-tree-chevron" className="size-3.5" />}</button>
      <button className={cn(sidebarTreeLinkClass, "text-xs")} title={stream.name} onClick={() => onNavigate(`/workspaces/${stream.id}`)}><Workflow data-testid="sidebar-tree-icon" className={sidebarTreeIconClass} /><span data-testid="sidebar-node-name" data-sidebar-tree-label="true" className="min-w-0 flex-1 truncate">{stream.name}</span></button>
      {stream.status === "active" ? <button data-testid="sidebar-node-action" data-sidebar-row-action="true" className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900" aria-label={t("sidebar.newInWorkspace", { name: stream.name })} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onSessionMenu(sessionMenu?.id === stream.id ? null : { id: stream.id, x: rect.left, y: rect.bottom + 4 }); }}><Plus className="size-3.5" /></button> : <span data-sidebar-row-action="true" className="grid size-7 shrink-0 place-items-center" title="Archived"><StatusDot status="closed" /></span>}
    </div>
    <SidebarCreateSessionMenu stream={stream} menu={sessionMenu?.id === stream.id ? sessionMenu : null} onSessionMenu={onSessionMenu} onCreateShell={onCreateShell} onCreateCodex={onCreateCodex} onCreateFork={onCreateFork} allowFork />
    {open && <div data-testid="sidebar-workspace-children" className="ml-3.5 border-l border-neutral-300 pl-1">
      <SidebarSessions stream={stream} selectedSessionId={selectedSessionId} closingSessionIds={closingSessionIds} onNavigate={onNavigate} onCloseSession={onCloseSession} />
      {forks.map((fork) => <SidebarForkNode key={fork.id} {...props} stream={fork} />)}
      {(!stream.sessions || stream.sessions.filter((session) => session.sidebar_visible).length === 0) && forks.length === 0 && <p className="px-2 py-1.5 text-[10px] text-neutral-400">No Sessions or Forks</p>}
    </div>}
  </div>;
}

function SessionWorkspace({ session, busy, onStop, onRestart, onClose, onExit }: { session: Session; busy: boolean; onStop: () => void; onRestart: () => void; onClose: () => void; onExit: () => void }) {
  const terminalState = ["exited", "failed", "closed", "evicted"].includes(session.status);
  return <div className="flex h-full min-h-0 flex-col bg-[#111315]">
    <div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-[#191b1e] px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-200">{session.kind === "codex" ? <Bot className="size-3.5 shrink-0" /> : <TerminalSquare className="size-3.5 shrink-0" />}<span className="truncate font-medium">{session.name}</span><StatusDot status={session.status} /><span className="text-[10px] text-neutral-500">{session.status}</span></div>
      <div className="flex items-center gap-1 px-2">
        {session.kind === "shell" ? <Button size="sm" variant="terminal" disabled={busy} onClick={onClose}><X data-icon="inline-start" />Close Shell</Button> : terminalState ? <Button size="sm" variant="secondary" disabled={busy} onClick={onRestart}><RotateCcw data-icon="inline-start" />Resume</Button> : <Button size="sm" variant="terminal" disabled={busy} onClick={onStop}><Square data-icon="inline-start" />Stop</Button>}
      </div>
    </div>
    <WebTerminal key={session.id} session={session} onExit={onExit} />
  </div>;
}

function WebTerminal({ session, onExit }: { session: Session; onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: '"SFMono-Regular", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: { background: "#111315", foreground: "#e5e7eb", cursor: "#f5f5f5", selectionBackground: "#47556988", black: "#111315", brightBlack: "#6b7280" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    try { terminal.loadAddon(new WebglAddon()); } catch { /* canvas renderer is fine */ }
    fit.fit();
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`ws://127.0.0.1:7331/api/sessions/${session.id}/terminal?takeover=true`);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        fit.fit();
        socket?.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
        terminal.focus();
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
        else if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; code?: string };
            if (message.type === "exit") onExitRef.current();
            if (message.type === "error") terminal.writeln(`\r\n\x1b[31m${message.code || "terminal error"}\x1b[0m`);
          } catch { terminal.write(event.data); }
        }
      };
      socket.onclose = () => {
        if (!disposed && !["exited", "failed", "closed", "evicted"].includes(session.status)) reconnectTimer = window.setTimeout(connect, 1200);
      };
      socket.onerror = () => socket?.close();
    };
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
    });
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
    });
    resizeObserver.observe(host);
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [session.id, session.status]);
  return <div ref={hostRef} className="min-h-0 flex-1 p-2" />;
}

function WorkspaceInspector({ open, project, workspace, session }: { open: boolean; project: ProjectDetail; workspace: WorkspaceDetail | null; session: Session | null }) {
  const [tab, setTab] = useState<"info" | "history" | "operations">("info");
  const [history, setHistory] = useState<GitHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [operations, setOperations] = useState<GitOperationRecord[] | null>(null);
  const [operationsError, setOperationsError] = useState("");
  const historyPath = workspace ? `/api/workspaces/${workspace.id}/git-history` : `/api/projects/${project.id}/git-history`;

  useEffect(() => {
    if (!open || tab !== "history") return;
    let cancelled = false;
    setHistory(null);
    setHistoryError("");
    void api<GitHistory>(historyPath).then((value) => {
      if (!cancelled) setHistory(value);
    }).catch((cause) => {
      if (!cancelled) setHistoryError(cause instanceof Error ? cause.message : "Git history could not be loaded");
    });
    return () => { cancelled = true; };
  }, [historyPath, open, tab]);

  useEffect(() => {
    if (!open || tab !== "operations" || !workspace) return;
    let cancelled = false;
    setOperations(null); setOperationsError("");
    void api<GitOperationRecord[]>(`/api/workspaces/${workspace.id}/git-operations`).then((value) => {
      if (!cancelled) setOperations(value);
    }).catch((cause) => {
      if (!cancelled) setOperationsError(cause instanceof Error ? cause.message : "Git operations could not be loaded");
    });
    return () => { cancelled = true; };
  }, [open, tab, workspace?.id]);

  useEffect(() => {
    if (!workspace && tab === "operations") setTab("info");
  }, [tab, workspace]);

  return <aside data-testid="right-sidebar" aria-hidden={!open} inert={!open} className={cn("absolute inset-y-0 right-0 z-20 flex w-[min(88vw,340px)] shrink-0 flex-col border-l border-neutral-200 bg-white shadow-2xl transition-transform duration-200 ease-out lg:shadow-none", open ? "translate-x-0" : "translate-x-full pointer-events-none")}>
    <div className="flex h-11 shrink-0 items-stretch border-b border-neutral-200">
      <div className="flex min-w-0 flex-1" role="tablist" aria-label="Sidebar sections">
        <button role="tab" aria-selected={tab === "info"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium", tab === "info" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700")} onClick={() => setTab("info")}><Info className="size-3.5" />Info{tab === "info" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-neutral-900" />}</button>
        <button role="tab" aria-selected={tab === "history"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-xs font-medium", tab === "history" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700")} onClick={() => setTab("history")}><GitBranch className="size-3.5" />History{tab === "history" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-neutral-900" />}</button>
        {workspace && <button role="tab" aria-selected={tab === "operations"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-xs font-medium", tab === "operations" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700")} onClick={() => setTab("operations")}><Workflow className="size-3.5" />Operations{tab === "operations" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-neutral-900" />}</button>}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
    {tab === "history" ? <GitHistoryPanel history={history} error={historyError} /> : tab === "operations" ? <GitOperationsPanel operations={operations} error={operationsError} /> : session ? <div className="flex flex-col gap-6 p-4">
      <div><div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-lg bg-neutral-100">{session.kind === "codex" ? <Bot className="size-4" /> : <TerminalSquare className="size-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.name}</p><div className="mt-1 flex items-center gap-2"><Badge>{session.kind}</Badge><Badge variant={session.status === "running" ? "success" : session.status === "failed" ? "destructive" : "secondary"}>{session.status}</Badge></div></div></div></div>
      <InspectorGroup title="Process"><InspectorRow label="Name" value={session.process_name} /><InspectorRow label="Process ID" value={session.process_id} mono /><InspectorRow label="PID" value={session.pid ? String(session.pid) : "—"} /><InspectorRow label="PGID" value={session.process_group_id ? String(session.process_group_id) : "—"} /><InspectorRow label="Exit" value={session.exit_code === undefined ? "—" : `${session.exit_code}${session.exit_signal ? ` · ${session.exit_signal}` : ""}`} /></InspectorGroup>
      <InspectorGroup title={workspace ? "Workspace" : "Project Session"}>{workspace && <><InspectorRow label="Workspace" value={workspace.name} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Workspace ID" value={workspace.runtime_id} mono /></>}<InspectorRow label="Workdir" value={session.cwd} mono />{session.original_cwd !== session.cwd && <InspectorRow label="Original" value={session.original_cwd} mono />}</InspectorGroup>
      {session.kind === "codex" && <InspectorGroup title="Codex"><InspectorRow label="Session ID" value={session.codex_session_id || "Capturing…"} mono />{session.initial_prompt && <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">{session.initial_prompt}</div>}</InspectorGroup>}
      <InspectorGroup title="Command"><code className="block break-all rounded-lg bg-neutral-950 p-3 text-[10px] leading-5 text-neutral-300">{session.command?.join(" ") || "—"}</code></InspectorGroup>
    </div> : workspace ? <div className="flex flex-col gap-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={workspace.name}>{workspace.name}</p><div className="mt-2 flex gap-2"><Badge>{workspace.kind}</Badge><Badge variant={workspace.status === "active" ? "success" : "secondary"}>{workspace.status}</Badge></div></div>
      <InspectorGroup title="Git"><InspectorRow label="Branch" value={workspace.branch || "—"} mono /><InspectorRow label="Start" value={workspace.start_commit || "—"} mono /><InspectorRow label="Target" value={workspace.target_branch || "—"} mono /><InspectorRow label="Delivery" value={workspace.delivery_status} /></InspectorGroup>
      <InspectorGroup title="Workspace"><InspectorRow label="Mode" value={workspace.checkout_mode} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Path" value={workspace.checkout_path} mono /></InspectorGroup>
      <InspectorGroup title="Records"><InspectorRow label="Sessions" value={String(workspace.sessions.length)} /><InspectorRow label="Todos" value={String(workspace.todos.length)} />{workspace.kind === "workspace" && <InspectorRow label="Forks" value={String(workspace.forks.length)} />}</InspectorGroup>
    </div> : <div className="flex flex-col gap-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={project.name}>{project.name}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{project.description || "No project description."}</p></div>
      <InspectorGroup title="Repository"><InspectorRow label="Target" value={project.default_target_branch || "—"} mono /><InspectorRow label="Remote" value={project.preferred_remote || "—"} /><InspectorRow label="Directories" value={String(project.directories.length)} /><InspectorRow label="Workspaces" value={String(project.workspaces.filter((item) => !item.parent_workspace_id).length)} /></InspectorGroup>
    </div>}
    </div>
  </aside>;
}

function GitHistoryPanel({ history, error }: { history: GitHistory | null; error: string }) {
  if (error) return <div className="p-4"><div className="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</div></div>;
  if (!history) return <div className="grid h-32 place-items-center text-xs text-neutral-400">Loading Git history…</div>;
  if (history.commits.length === 0) return <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-neutral-400">No commits found for this workspace.</div>;
  return <div>
    <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5 text-[10px] text-neutral-400"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono" title={history.branch}>{history.branch}</span><span>{history.commits.length} commits</span></div>
    <div className="divide-y divide-neutral-100">{history.commits.map((commit) => <article key={commit.hash} data-testid="git-history-commit" className="px-4 py-3.5">
      <p className="break-words text-sm font-medium leading-5 text-neutral-800">{commit.subject}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-neutral-400">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-neutral-800 text-[9px] font-semibold uppercase text-white">{commit.author.trim().charAt(0) || "?"}</span>
        <span className="min-w-0 truncate" title={commit.author}>{commit.author}</span><span>·</span><time dateTime={commit.authored_at}>{formatExactGitTime(commit.authored_at)}</time><span>·</span><code className="text-[10px]">{commit.short_hash}</code>
      </div>
    </article>)}</div>
  </div>;
}

function GitOperationsPanel({ operations, error }: { operations: GitOperationRecord[] | null; error: string }) {
  if (error) return <div className="p-4"><div className="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">{error}</div></div>;
  if (!operations) return <div className="grid h-32 place-items-center text-xs text-neutral-400">Loading Git operations…</div>;
  if (operations.length === 0) return <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-neutral-400">No managed Git operations yet.</div>;
  return <div className="divide-y divide-neutral-100">{operations.map((operation) => <article key={operation.id} data-testid="git-operation-record" className="flex flex-col gap-2 px-4 py-3.5">
    <div className="flex items-center gap-2"><Badge>{operation.kind}</Badge><span className="min-w-0 flex-1 truncate text-xs font-medium">{operation.action.replaceAll("_", " ")}</span><Badge variant={operation.status === "completed" || operation.status === "restored" ? "success" : operation.status === "failed" || operation.status === "conflicted" ? "destructive" : "secondary"}>{operation.status}</Badge></div>
    <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[9px] text-neutral-400"><span>before</span><span className="truncate" title={operation.before_head}>{operation.before_head || "—"}</span><span>target</span><span className="truncate" title={operation.target_head}>{operation.target_head || "—"}</span>{operation.recovery_ref && <><span>recovery</span><span className="truncate" title={operation.recovery_ref}>{operation.recovery_ref}</span></>}</div>
    {operation.error && <p className="rounded-md bg-red-50 px-2.5 py-2 text-[10px] leading-4 text-red-700">{operation.error}</p>}
    <time className="block text-[10px] text-neutral-400" dateTime={operation.started_at}>{formatExactGitTime(operation.started_at)}</time>
  </article>)}</div>;
}

function formatExactGitTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const two = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{title}</h3><div className="flex flex-col gap-2">{children}</div></section>; }
function InspectorRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 text-xs"><span className="text-neutral-400">{label}</span><span className={cn("min-w-0 break-all text-neutral-700", mono && "font-mono text-[10px]")}>{value}</span></div>; }
function StatusDot({ status }: { status: string }) { return <span className={cn("size-1.5 shrink-0 rounded-full", status === "running" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "starting" || status === "stopping" ? "bg-amber-500" : "bg-neutral-400")} />; }

function WorkspaceHome({ detail, busy, onOpen, onOpenFork, onFork, onSyncLocation, onConfigureUpstream, onClearUpstream, onPull, onPush, onFinish }: { detail: WorkspaceDetail; busy: boolean; onOpen: (session: Session) => void; onOpenFork: (fork: Workspace) => void; onFork: () => void; onSyncLocation: (location: WorkspaceLocation, action: "pull" | "push") => void; onConfigureUpstream: (location: WorkspaceLocation) => void; onClearUpstream: (location: WorkspaceLocation) => void; onPull: () => void; onPush: () => void; onFinish: () => void }) {
  const [filter, setFilter] = useState<"all" | "codex" | "shell">("all");
  const sessions = detail.sessions.filter((session) => filter === "all" || session.kind === filter);
  const actionLabel = (session: Session) => {
    if (session.status === "closed" && session.kind === "shell") return "";
    if (session.status === "evicted") return "Resume";
    if (!session.sidebar_visible && session.kind === "codex") return session.status === "running" || session.status === "starting" ? "Show in sidebar" : "Open";
    return "Open";
  };
  const displayStatus = (session: Session) => {
    if (session.status === "evicted") return "Ready to resume";
    if (!session.sidebar_visible && session.kind === "codex" && ["running", "starting"].includes(session.status)) return "Background";
    return session.status;
  };
  const formatTime = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
  return <div data-testid="page-scroll" className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12">
    <div data-testid="page-content" className="mx-auto max-w-6xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><div className="mb-3 flex items-center gap-2"><Badge>{detail.checkout_mode}</Badge><Badge variant={detail.status === "active" ? "success" : "secondary"}>{detail.status}</Badge></div><h1 className="text-3xl font-semibold tracking-tight">{detail.name}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">{detail.description || "在同一个 Workspace 中运行 Shell 和 Codex Sessions。"}</p></div>
        {detail.status === "active" && <div className="flex flex-wrap gap-2">{detail.kind === "workspace" && <Button variant="secondary" disabled={busy} onClick={onFork}><GitBranch data-icon="inline-start" />Fork work</Button>}<Button variant="secondary" disabled={busy} onClick={onFinish}><X data-icon="inline-start" />Finish…</Button></div>}
      </div>
      <section data-testid="workspace-locations-section" className="mt-8"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Repository locations</h2><p className="mt-1 text-xs text-neutral-400">Git worktrees are writable; non-Git locations are context-only.</p></div>{detail.kind === "workspace" && <ActionMenu label="Workspace repository actions" testId="workspace-repositories-menu" disabled={busy}><ActionMenuItem icon={<Download className="size-3.5" />} disabled={busy} testId="workspace-pull-all" onClick={onPull}>Pull all</ActionMenuItem><ActionMenuItem icon={<Upload className="size-3.5" />} disabled={busy} testId="workspace-push-all" onClick={onPush}>Push all</ActionMenuItem></ActionMenu>}</div><div className="mt-3 grid gap-3">{detail.locations.map((location) => <WorkspaceLocationRow key={location.id} location={location} busy={busy} actionsEnabled={detail.kind === "workspace"} onSync={(action) => onSyncLocation(location, action)} onConfigureUpstream={() => onConfigureUpstream(location)} onClearUpstream={() => onClearUpstream(location)} />)}</div></section>
      {detail.kind === "workspace" && <section data-testid="workspace-forks-section" className="mt-8"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Forks</h2><span className="text-[11px] text-neutral-400">{detail.forks.length}</span></div><div className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{detail.forks.map((fork) => <button key={fork.id} className="flex w-full items-center gap-3 p-4 text-left hover:bg-neutral-50" onClick={() => onOpenFork(fork)}><GitBranch className="size-4 text-neutral-400" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{fork.name}</span><Badge variant={fork.status === "active" ? "success" : "neutral"}>{fork.delivery_status}</Badge></div><p className="mt-1 truncate text-xs text-neutral-400">{fork.branch}</p></div><ChevronRight className="size-4 text-neutral-300" /></button>)}{detail.forks.length === 0 && <p className="px-4 py-8 text-center text-xs text-neutral-400">No Forks</p>}</div></section>}
      <section data-testid="workspace-todos-section" className="mt-8"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Todos</h2><span className="text-[11px] text-neutral-400">{detail.todos.length}</span></div><div className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{detail.todos.map((todo) => <div key={todo.id} className="flex items-center gap-3 px-4 py-3"><span className={cn("size-2 rounded-full", todo.status === "done" ? "bg-emerald-500" : "bg-amber-400")} /><span className="min-w-0 flex-1 truncate text-sm">{todo.title}</span><Badge>{todo.status}</Badge></div>)}{detail.todos.length === 0 && <p className="px-4 py-8 text-center text-xs text-neutral-400">No Todos</p>}</div></section>
      <div className="mt-8 flex items-center justify-between border-b border-neutral-200">
        <div className="flex gap-5">{([['all', 'All'], ['codex', 'Agent'], ['shell', 'Shell']] as const).map(([value, label]) => <button key={value} className={cn("border-b-2 px-1 pb-3 text-xs font-medium", filter === value ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-400 hover:text-neutral-700")} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <span className="pb-3 text-[11px] text-neutral-400">{sessions.length} sessions</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="hidden grid-cols-[minmax(180px,1.4fr)_90px_130px_130px_130px_minmax(110px,1fr)_120px] gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 md:grid">
          <span>Session</span><span>Type</span><span>Status</span><span>Started</span><span>Last active</span><span>Workspace</span><span className="text-right">Actions</span>
        </div>
        {sessions.map((session) => {
          const label = actionLabel(session);
          return <div key={session.id} data-testid={`workspace-session-${session.id}`} className="grid gap-3 border-b border-neutral-100 px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_90px_130px_130px_130px_minmax(110px,1fr)_120px] md:items-center">
            <div className="flex min-w-0 items-center gap-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-100">{session.kind === "codex" ? <Bot className="size-4" /> : <TerminalSquare className="size-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-medium">{session.name}</p><p className="mt-0.5 truncate font-mono text-[9px] text-neutral-400">{session.codex_session_id || session.id}</p></div></div>
            <div><Badge>{session.kind === "codex" ? "Agent" : "Shell"}</Badge></div>
            <div className="flex items-center gap-2 text-xs text-neutral-600"><StatusDot status={session.status} />{displayStatus(session)}</div>
            <span className="hidden text-xs text-neutral-500 md:block">{formatTime(session.launch_started_at)}</span>
            <span className="hidden text-xs text-neutral-500 md:block">{formatTime(session.hidden_at || session.last_attached_at || session.updated_at || session.created_at)}</span>
            <code className="hidden truncate text-[10px] text-neutral-400 md:block" title={session.cwd}>{session.cwd}</code>
            <div className="flex justify-end">{label && <Button size="sm" variant={session.status === "evicted" ? "default" : "secondary"} disabled={busy || (session.kind === "codex" && !session.codex_session_id)} onClick={() => onOpen(session)}>{session.status === "evicted" && <RotateCcw className="size-3" />}{label}</Button>}</div>
          </div>;
        })}
        {sessions.length === 0 && <div className="py-16 text-center"><TerminalSquare className="mx-auto size-6 text-neutral-300" /><p className="mt-3 text-sm font-medium">没有符合筛选条件的 Session</p></div>}
      </div>
    </div>
  </div>;
}

function repositoryLabel(remote?: string) {
  if (!remote) return "Local Git repository";
  return remote.replace(/^git@([^:]+):/, "$1/").replace(/^https?:\/\//, "").replace(/\.git$/, "");
}

function ActionMenu({ label, testId, disabled, children }: { label: string; testId: string; disabled?: boolean; children: React.ReactNode }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusMenuRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  const show = (focusMenu = false) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    focusMenuRef.current = focusMenu;
    setPosition({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: rect.bottom + 4 });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
    const below = triggerRect.bottom + 4;
    const top = below + menuRect.height <= window.innerHeight - 8 ? below : Math.max(8, triggerRect.top - menuRect.height - 4);
    setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    if (focusMenuRef.current) {
      menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
      focusMenuRef.current = false;
    }
  }, [open, position.left, position.top]);

  useEffect(() => {
    if (!open) return;
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeFromViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", closeFromViewportChange);
    window.addEventListener("scroll", closeFromViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", closeFromViewportChange);
      window.removeEventListener("scroll", closeFromViewportChange, true);
    };
  }, [open]);

  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index <= 0 ? items.length : index) - 1;
    items[next]?.focus();
  };

  return <>
    <Button ref={triggerRef} data-testid={`${testId}-trigger`} size="icon" variant="ghost" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} title={label} onClick={() => open ? setOpen(false) : show()} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); open ? menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus() : show(true); } }}><Ellipsis data-icon="inline-start" /></Button>
    {open && createPortal(<div ref={menuRef} data-testid={testId} data-overlay-root="true" role="menu" aria-label={label} className="fixed z-[100] w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl" style={position} onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false); }} onKeyDown={navigateMenu}>{children}</div>, document.body)}
  </>;
}

function ActionMenuItem({ icon, children, disabled, testId, title, onClick }: { icon: React.ReactNode; children: React.ReactNode; disabled?: boolean; testId?: string; title?: string; onClick: () => void }) {
  return <button type="button" role="menuitem" data-testid={testId} disabled={disabled} title={title} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40" onClick={onClick}>{icon}<span className="min-w-0 flex-1 truncate">{children}</span></button>;
}

function ProjectLocationTreeRow({ directory, worktrees, busy, onOpen, onEdit, onRefresh, onMakeDefault, onReattach, onSync, onDeleteWorktree }: { directory: Directory; worktrees: GitWorktree[]; busy: boolean; onOpen: (id: string) => void; onEdit: () => void; onRefresh: () => void; onMakeDefault: () => void; onReattach: () => void; onSync: (action: "pull" | "push") => void; onDeleteWorktree: (worktree: GitWorktree) => void }) {
  const isRepository = directory.git_status !== "not_git";
  const [expanded, setExpanded] = useState(isRepository && (directory.role === "primary" || directory.git_status !== "ready"));
  const orderedWorktrees = useMemo(() => [...worktrees].sort((left, right) => Number(right.is_main) - Number(left.is_main)), [worktrees]);
  const currentBranch = directory.branch || (directory.head_commit ? `detached @ ${directory.head_commit.slice(0, 7)}` : "detached");
  const repositoryDetails = <>
    <span>current <strong className="font-medium text-neutral-600">{currentBranch}</strong></span>
    <span>·</span>
    <span>base <strong className="font-medium text-neutral-600">{directory.base_branch || "—"}</strong></span>
    <span>·</span>
    <span>{repositoryLabel(directory.repository_url)}</span>
    <span>·</span>
    <span>{directory.delivery_mode === "local_merge" ? "local merge" : "remote review"}</span>
  </>;
  const locationSummary = <>
    <div data-testid={`project-location-icon-${directory.id}`} className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100">{isRepository ? <FolderGit2 className="size-4" /> : <Folder className="size-4" />}</div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold">{directory.name}</h3><Badge>{directory.role}</Badge><Badge variant={directory.git_status === "ready" ? "success" : directory.git_status === "not_git" ? "secondary" : "destructive"}>{directory.git_status}</Badge>{directory.worktree_setup_command && <Badge>Setup</Badge>}{isRepository && <span className="text-[10px] text-neutral-400">{worktrees.length} {worktrees.length === 1 ? "worktree" : "worktrees"}</span>}</div>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{directory.description || "No purpose described yet."}</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-400">{isRepository && repositoryDetails}<code className="min-w-0 truncate" title={directory.path}>{directory.path}</code></div>
    </div>
  </>;

  return <article data-testid={`project-location-${directory.id}`}>
    <div className="flex items-start gap-3 p-4">
      {isRepository ? <button data-testid={`project-location-toggle-${directory.id}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-expanded={expanded} aria-controls={`project-location-worktrees-${directory.id}`} aria-label={`${expanded ? "Collapse" : "Expand"} repository ${directory.name}`} onClick={() => setExpanded((value) => !value)}><span data-testid={`project-location-chevron-${directory.id}`} className="mt-1 grid size-8 shrink-0 place-items-center rounded-md text-neutral-400">{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>{locationSummary}</button> : <div className="flex min-w-0 flex-1 items-start gap-3">{locationSummary}</div>}
      <div className="flex shrink-0 gap-1">
        <Button data-testid={`project-location-refresh-${directory.id}`} size="icon" variant="ghost" disabled={busy} aria-label={`Refresh ${directory.name}`} title={`Refresh ${directory.name}`} onClick={onRefresh}><RefreshCw data-icon="inline-start" /></Button>
        <ActionMenu label={`Actions for ${directory.name}`} testId={`project-location-actions-${directory.id}`} disabled={busy}>
          {isRepository && directory.git_status === "ready" && <><ActionMenuItem icon={<Download className="size-3.5" />} disabled={busy} testId={`project-location-pull-${directory.id}`} title={`Pull ${directory.base_branch || "base branch"}`} onClick={() => onSync("pull")}>Pull {directory.base_branch || "base branch"}</ActionMenuItem><ActionMenuItem icon={<Upload className="size-3.5" />} disabled={busy} testId={`project-location-push-${directory.id}`} title={`Push ${directory.base_branch || "base branch"}`} onClick={() => onSync("push")}>Push {directory.base_branch || "base branch"}</ActionMenuItem><div role="separator" className="my-1 border-t border-neutral-100" /></>}
          {directory.git_status === "ready" && directory.role !== "primary" && <ActionMenuItem icon={<FolderGit2 className="size-3.5" />} disabled={busy} onClick={onMakeDefault}>Make default</ActionMenuItem>}
          {["missing", "broken", "mismatch"].includes(directory.git_status) && <ActionMenuItem icon={<RefreshCw className="size-3.5" />} disabled={busy} onClick={onReattach}>Reattach</ActionMenuItem>}
          <ActionMenuItem icon={<Pencil className="size-3.5" />} disabled={busy} testId={`project-location-edit-${directory.id}`} onClick={onEdit}>Edit location</ActionMenuItem>
        </ActionMenu>
      </div>
    </div>
    {isRepository && expanded && <div id={`project-location-worktrees-${directory.id}`} data-testid={`project-location-worktrees-${directory.id}`} role="group" aria-label={`Worktrees for ${directory.name}`} className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-2">
      <div className="ml-5 divide-y divide-neutral-200 border-l border-neutral-200">
        {orderedWorktrees.map((item) => <div key={`${item.project_location_id}:${item.path}`} data-testid="project-worktree-row" data-project-location-id={directory.id} className="flex min-w-0 items-center gap-3 py-3 pl-5">
          <GitBranch className="size-4 shrink-0 text-neutral-400" />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{item.branch || "detached"}</span>{item.is_main && <Badge>Main checkout</Badge>}{item.workspace_id && <button className="min-w-0 truncate text-xs font-medium text-blue-600 hover:underline" onClick={() => onOpen(item.workspace_id!)}>{item.workspace_name}</button>}</div><div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-neutral-400">{item.head_commit && <><span className="font-mono">{item.head_commit.slice(0, 10)}</span><span>·</span></>}<code className="min-w-0 truncate" title={item.path}>{item.path}</code></div></div>
          {!item.is_main && <Button size="icon" variant={item.workspace_id ? "muted" : "destructive"} disabled={busy} aria-disabled={Boolean(item.workspace_id)} data-worktree-delete-state={item.workspace_id ? "blocked" : "available"} aria-label={item.workspace_id ? `Cannot delete worktree ${item.path}: active Workspace ${item.workspace_name || item.workspace_id}` : `Delete worktree ${item.path}`} title={item.workspace_id ? `Finish Workspace “${item.workspace_name || item.workspace_id}” before deleting this worktree` : `Delete worktree ${item.path}`} onClick={() => onDeleteWorktree(item)}><Trash2 data-icon="inline-start" /></Button>}
        </div>)}
        {orderedWorktrees.length === 0 && <div className="py-5 pl-5 text-xs text-neutral-400">No worktrees found for this repository.</div>}
      </div>
    </div>}
  </article>;
}

function ProjectHome({ project, busy, onOpen, onOpenSession, onCreate, onAddDirectory, onEditDirectory, onRefreshLocation, onMakeDefault, onReattach, onSyncLocation, onDeleteWorktree, onPull, onPush }: { project: ProjectDetail; busy: boolean; onOpen: (id: string) => void; onOpenSession: (session: Session) => void; onCreate: () => void; onAddDirectory: () => void; onEditDirectory: (directory: Directory) => void; onRefreshLocation: (directory: Directory) => void; onMakeDefault: (directory: Directory) => void; onReattach: (directory: Directory) => void; onSyncLocation: (directory: Directory, action: "pull" | "push") => void; onDeleteWorktree: (worktree: GitWorktree) => void; onPull: () => void; onPush: () => void }) {
  const hasGitRepository = project.directories.some((directory) => directory.is_git);
  const primary = project.directories.find((directory) => directory.id === project.primary_directory_id) ?? project.directories.find((directory) => directory.role === "primary");
  const rootWorkspaces = project.workspaces.filter((stream) => !stream.parent_workspace_id);
  return <div data-testid="page-scroll" className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"><div data-testid="page-content" className="mx-auto max-w-6xl">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs text-neutral-400">Project · multi-repository locations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1><p className="mt-2 text-sm text-neutral-500">{project.description}</p></div><Button disabled={busy || primary?.git_status !== "ready"} onClick={onCreate}><Plus data-icon="inline-start" />New Workspace</Button></div>
    <section className="mt-10"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Repositories</h2><p className="mt-1 text-xs text-neutral-400">Expand a repository to inspect its worktrees; non-Git locations remain read-only context.</p></div><div className="flex shrink-0 items-center gap-1"><Button data-testid="project-add-location" size="sm" onClick={onAddDirectory}><Plus data-icon="inline-start" />Add location</Button><ActionMenu label="Repository actions" testId="project-repositories-menu" disabled={busy || !hasGitRepository}><ActionMenuItem icon={<Download className="size-3.5" />} disabled={busy || !hasGitRepository} testId="project-pull-all" onClick={onPull}>Pull all</ActionMenuItem><ActionMenuItem icon={<Upload className="size-3.5" />} disabled={busy || !hasGitRepository} testId="project-push-all" onClick={onPush}>Push all</ActionMenuItem></ActionMenu></div></div>
      <div data-testid="project-repository-tree" className="relative z-10 mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{project.directories.map((directory) => <ProjectLocationTreeRow key={directory.id} directory={directory} worktrees={project.worktrees.filter((item) => item.project_location_id === directory.id)} busy={busy} onOpen={onOpen} onEdit={() => onEditDirectory(directory)} onRefresh={() => onRefreshLocation(directory)} onMakeDefault={() => onMakeDefault(directory)} onReattach={() => onReattach(directory)} onSync={(action) => onSyncLocation(directory, action)} onDeleteWorktree={onDeleteWorktree} />)}{project.directories.length === 0 && <div className="py-10 text-center text-xs text-neutral-400">Add a Git location before creating a Workspace.</div>}</div>
    </section>
    <section data-testid="project-sessions-section" className="mt-10"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Project Sessions</h2><p className="mt-1 text-xs text-amber-600">These Sessions operate directly in Project locations. Shell records disappear when closed; Codex history is retained.</p></div><span className="text-[11px] text-neutral-400">{project.sessions.length}</span></div><div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{project.sessions.map((session) => <div key={session.id} data-testid={`project-session-${session.id}`} className="flex items-center gap-3 p-4"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100">{session.kind === "codex" ? <Bot className="size-4 text-neutral-500" /> : <TerminalSquare className="size-4 text-neutral-500" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{session.name}</p><Badge>{session.kind === "codex" ? "Codex" : "Shell"}</Badge><Badge variant={session.status === "running" ? "success" : "neutral"}>{session.sidebar_visible ? session.status : "history"}</Badge></div><code className="mt-1 block truncate text-[10px] text-neutral-400" title={session.cwd}>{session.cwd}</code></div><Button size="sm" variant="secondary" disabled={busy || (session.kind === "codex" && !session.codex_session_id)} onClick={() => onOpenSession(session)}>{session.sidebar_visible ? "Open" : "Resume"}</Button></div>)}{project.sessions.length === 0 && <div className="py-10 text-center text-xs text-neutral-400">No active Shell or saved Codex Sessions</div>}</div></section>
    <section className="mt-10"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Workspaces</h2><span className="text-[11px] text-neutral-400">{rootWorkspaces.length}</span></div><div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{rootWorkspaces.map((stream) => <button key={stream.id} onClick={() => onOpen(stream.id)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-neutral-50"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100"><Workflow className="size-4 text-neutral-500" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{stream.name}</p>{stream.status === "archived" && <Badge>archived</Badge>}</div><p className="mt-1 truncate text-xs text-neutral-500">{stream.description || stream.checkout_path}</p></div><ChevronRight className="size-4 shrink-0 text-neutral-300" /></button>)}{rootWorkspaces.length === 0 && <div className="py-12 text-center text-xs text-neutral-400">No Workspaces yet</div>}</div></section>
  </div></div>;
}

function WorkspaceLocationRow({ location, busy, actionsEnabled, onSync, onConfigureUpstream, onClearUpstream }: { location: WorkspaceLocation; busy: boolean; actionsEnabled: boolean; onSync: (action: "pull" | "push") => void; onConfigureUpstream: () => void; onClearUpstream: () => void }) {
  const writableGit = location.access_mode === "read_write" && location.git_status === "ready";
  const upstream = location.remote_name && location.remote_branch ? `${location.remote_name}/${location.remote_branch}` : "";
  return <article data-testid={`workspace-location-${location.id}`} className="rounded-xl border border-neutral-200 bg-white p-4">
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{location.location_name}</h3><Badge variant={location.git_status === "ready" ? "success" : location.git_status === "not_git" ? "secondary" : "destructive"}>{location.git_status}</Badge><Badge>{location.access_mode}</Badge><Badge>{location.delivery_status}</Badge></div><code className="mt-2 block truncate text-[10px] text-neutral-500" title={location.checkout_path ?? location.source_path}>{location.checkout_path ?? location.source_path}</code>{location.creation_error && <Alert role="alert" data-testid={`workspace-location-error-${location.id}`} variant="destructive" className="mt-3"><CircleAlert /><AlertDescription className="font-mono text-[11px]">{location.creation_error}</AlertDescription></Alert>}{location.access_mode === "read_write" && <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-neutral-500"><span>branch <code>{location.branch}</code></span><span>base <code>{location.base_branch}</code></span><span>upstream <code>{upstream || "—"}</code></span><span>delivery <code>{location.delivery_mode}</code></span></div>}</div>
      {actionsEnabled && writableGit && <div className="-mt-2 self-start"><ActionMenu label={`Actions for ${location.location_name}`} testId={`workspace-location-actions-${location.id}`} disabled={busy}>
        <ActionMenuItem icon={<Download className="size-3.5" />} disabled={busy || !upstream} testId={`workspace-location-pull-${location.id}`} title={upstream ? `Pull ${upstream}` : "Set an upstream before pulling"} onClick={() => onSync("pull")}>{upstream ? `Pull ${upstream}` : "Pull (set upstream first)"}</ActionMenuItem>
        <ActionMenuItem icon={<Upload className="size-3.5" />} disabled={busy || !upstream} testId={`workspace-location-push-${location.id}`} title={upstream ? `Push ${upstream}` : "Set an upstream before pushing"} onClick={() => onSync("push")}>{upstream ? `Push ${upstream}` : "Push (set upstream first)"}</ActionMenuItem>
        <div role="separator" className="my-1 border-t border-neutral-100" />
        <ActionMenuItem icon={<GitBranch className="size-3.5" />} disabled={busy} testId={`workspace-location-upstream-${location.id}`} onClick={onConfigureUpstream}>{upstream ? "Change upstream" : "Set upstream"}</ActionMenuItem>
        {upstream && <ActionMenuItem icon={<X className="size-3.5" />} disabled={busy} testId={`workspace-location-clear-upstream-${location.id}`} onClick={onClearUpstream}>Clear upstream</ActionMenuItem>}
      </ActionMenu></div>}
    </div>
  </article>;
}
function Overview({ projects, busy, onOpen, onCreate, onRestore, onDelete }: { projects: ProjectDetail[]; busy: boolean; onOpen: (id: string) => void; onCreate: () => void; onRestore: (project: ProjectDetail) => void; onDelete: (project: ProjectDetail) => void }) {
  const { t, i18n } = useTranslation();
  const formatUpdatedAt = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return <div data-testid="page-scroll" className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"><div data-testid="page-content" className="mx-auto max-w-6xl"><div className="flex items-end justify-between"><div><p className="text-xs text-neutral-400">{t("overview.eyebrow")}</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">{t("overview.title")}</h1></div><Button onClick={onCreate}><FolderPlus data-icon="inline-start" />{t("overview.newProject")}</Button></div>
    <div className="mt-8 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[920px] table-fixed text-left">
        <thead><tr className="border-b border-neutral-100 bg-neutral-50 text-[10px] font-semibold uppercase tracking-wider text-neutral-400"><th className="w-[22%] px-4 py-3">{t("overview.columns.project")}</th><th className="w-[25%] px-4 py-3">{t("overview.columns.mainDirectory")}</th><th className="w-[12%] px-4 py-3">{t("overview.columns.gitBranch")}</th><th className="w-[15%] px-4 py-3">{t("overview.columns.remote")}</th><th className="w-[9%] px-4 py-3">{t("overview.columns.workspaces")}</th><th className="w-[9%] px-4 py-3">{t("overview.columns.updated")}</th><th className="w-[8%] px-4 py-3"><span className="sr-only">{t("overview.columns.actions")}</span></th></tr></thead>
        <tbody className="divide-y divide-neutral-100">{projects.map((project) => {
          const primary = project.directories.find((directory) => directory.id === project.primary_directory_id) ?? project.directories.find((directory) => directory.role === "primary");
          return <tr key={project.id} data-testid="project-overview-row" data-project-status={project.status} role="link" tabIndex={0} className={cn("cursor-pointer outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50", project.status === "archived" && "bg-neutral-50/60 text-neutral-500")} onClick={() => onOpen(project.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(project.id); } }}><td className="px-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100">{primary?.is_git ? <FolderGit2 className="size-4 text-neutral-500" /> : <Folder className="size-4 text-neutral-500" />}</div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-semibold">{project.name}</p>{project.status === "archived" && <Badge>{t("overview.archived")}</Badge>}</div><p className="mt-1 truncate text-xs text-neutral-500">{project.description || t("overview.localProject")}</p></div></div></td><td className="px-4 py-4"><code className="block truncate text-[10px] text-neutral-500" title={primary?.path}>{primary?.path || "—"}</code></td><td className="px-4 py-4"><div className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-600">{primary?.is_git && <GitBranch className="size-3.5 shrink-0 text-neutral-400" />}<span className="truncate">{primary?.is_git ? primary.branch || t("overview.detachedHead") : "—"}</span></div></td><td className="px-4 py-4"><span className="block truncate text-xs text-neutral-500" title={primary?.remote_url}>{primary?.remote_url ? repositoryLabel(primary.remote_url) : "—"}</span></td><td className="px-4 py-4 text-xs text-neutral-600">{project.workspaces.length}</td><td className="px-4 py-4 text-xs text-neutral-500">{formatUpdatedAt(project.updated_at)}</td><td className="px-4 py-4"><div className="flex justify-end gap-1">{project.status === "archived" ? <><Button data-testid="restore-project-action" size="icon" variant="ghost" disabled={busy} aria-label={t("overview.restoreProject", { name: project.name })} title={t("overview.restoreToSidebar")} onClick={(event) => { event.stopPropagation(); onRestore(project); }}><RotateCcw data-icon="inline-start" /></Button><Button data-testid="delete-project-action" size="icon" variant="ghost" disabled={busy} aria-label={t("overview.permanentlyDeleteProject", { name: project.name })} title={t("overview.permanentlyDelete")} onClick={(event) => { event.stopPropagation(); onDelete(project); }}><Trash2 data-icon="inline-start" /></Button></> : <ChevronRight className="my-2 size-4 text-neutral-300" />}</div></td></tr>;
        })}</tbody>
      </table>
      {projects.length === 0 && <div className="py-16 text-center text-xs text-neutral-400">{t("overview.empty")}</div>}
    </div>
  </div></div>;
}
function CenteredMessage({ children }: { children: React.ReactNode }) { return <div className="grid h-full place-items-center text-sm text-neutral-400">{children}</div>; }

function DirectoryPathField({ busy, path, label, onPathChange, onInspect }: { busy: boolean; path: string; label: string; onPathChange: (path: string) => void; onInspect: (path: string) => Promise<void> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState("");
  async function chooseDirectory() {
    setPicking(true);
    setPickerError("");
    try {
      const selected = await open({ directory: true, multiple: false, title: "Choose a directory for Treefold" });
      if (typeof selected === "string") {
        onPathChange(selected);
        await onInspect(selected);
      }
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : "Could not open Finder");
    } finally {
      setPicking(false);
    }
  }
  return <div><div className="flex gap-2"><Input className="min-w-0 flex-1 font-mono text-xs" aria-label={label} value={path} onChange={(event) => onPathChange(event.target.value)} placeholder="/absolute/path/to/location" required /><Button type="button" variant="secondary" disabled={busy || picking || !path.trim()} onClick={() => void onInspect(path)}>Check</Button><Button type="button" variant="secondary" disabled={busy || picking} onClick={() => void chooseDirectory()}><FolderOpen data-icon="inline-start" />{picking ? "Choosing…" : "Choose…"}</Button></div>{pickerError && <p className="mt-1.5 text-[11px] text-red-600">{pickerError}</p>}</div>;
}

function WorktreeSetupField({ defaultValue }: { defaultValue?: string }) {
  return <Field>
    <FieldLabel htmlFor="worktree-setup-command">Worktree setup command <span className="text-muted-foreground">(optional)</span></FieldLabel>
    <Textarea id="worktree-setup-command" className="font-mono" name="worktree_setup_command" aria-label="Worktree setup command" defaultValue={defaultValue} placeholder="npm install" />
    <FieldDescription>Starts after worktree creation in a visible setup Shell.</FieldDescription>
  </Field>;
}

function CreateProjectDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New Project</DialogTitle>
        <DialogDescription>Project 只负责组织 locations；Git 分支和交付方式在 repository location 上配置。</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel className="sr-only" htmlFor="project-name">Project name</FieldLabel>
            <Input id="project-name" name="name" placeholder="Project name" required />
          </Field>
          <Field>
            <FieldLabel className="sr-only" htmlFor="project-description">Project description</FieldLabel>
            <Textarea id="project-description" name="description" placeholder="Project description" />
          </Field>
        </FieldGroup>
        <div className="flex justify-end"><Button type="submit" disabled={busy}>Create Project</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

let locationDraftSequence = 0;
function newLocationDraft(): LocationDraft { locationDraftSequence += 1; return { key: `location-draft-${locationDraftSequence}`, path: "", description: "", worktree_setup_command: "", base_branch: "", delivery_mode: "remote_review" }; }

function AddDirectoryDialog({ project, busy, onOpenChange, onSubmit }: { project: ProjectDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (locations: LocationDraft[]) => Promise<void> }) {
  const [locations, setLocations] = useState<LocationDraft[]>([newLocationDraft()]);
  const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set());
  useEffect(() => { if (project) setLocations([newLocationDraft()]); }, [project?.id]);
  const update = (key: string, patch: Partial<LocationDraft>) => setLocations((current) => current.map((location) => location.key === key ? { ...location, ...patch } : location));
  async function inspect(key: string, rawPath: string) {
    const path = rawPath.trim();
    if (!path) return;
    setCheckingKeys((current) => new Set(current).add(key));
    update(key, { inspection: undefined, inspectionError: undefined });
    try {
      const result = await api<ProjectLocationInspection>("/api/project-locations/inspect", { method: "POST", body: JSON.stringify({ path }) });
      update(key, { path: result.path, inspection: result, base_branch: result.base_branch ?? "main", inspectionError: undefined });
    } catch (cause) {
      update(key, { inspection: undefined, inspectionError: cause instanceof Error ? cause.message : "Could not inspect location" });
    } finally {
      setCheckingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }
  const duplicatePath = new Set(locations.map((location) => location.path.trim()).filter((path, index, all) => path && all.indexOf(path) !== index));
  const canSubmit = locations.length > 0 && locations.every((location) => location.inspection && !location.inspectionError && !duplicatePath.has(location.path.trim()) && (location.inspection.git_status !== "ready" || location.base_branch.trim())) && checkingKeys.size === 0;
  return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}><DialogContent className="location-list-dialog"><DialogTitle className="text-lg font-semibold">Add project locations</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Add Git repositories and read-only context directories to {project?.name}. Names always use the directory name.</DialogDescription><form className="mt-5" onSubmit={(event) => { event.preventDefault(); if (canSubmit) void onSubmit(locations); }}><div className="max-h-[58vh] flex flex-col gap-3 overflow-y-auto pr-1" data-testid="location-draft-list">{locations.map((location, index) => { const isGit = location.inspection?.git_status === "ready"; const checking = checkingKeys.has(location.key); return <section key={location.key} data-testid="location-draft-row" className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4"><div className="mb-3 flex items-center gap-2"><span className="text-xs font-semibold">Location {index + 1}</span>{location.inspection && <><Badge variant={isGit ? "success" : "neutral"}>{location.inspection.git_status}</Badge><span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500">{location.inspection.name}</span></>}<Button type="button" size="icon" variant="ghost" aria-label={`Remove location ${index + 1}`} disabled={locations.length === 1 || busy} onClick={() => setLocations((current) => current.filter((item) => item.key !== location.key))}><Trash2 data-icon="inline-start" /></Button></div><DirectoryPathField busy={busy || checking} path={location.path} label={`Location ${index + 1} path`} onPathChange={(path) => update(location.key, { path, inspection: undefined, inspectionError: undefined })} onInspect={(path) => inspect(location.key, path)} />{checking && <p className="mt-2 text-[11px] text-neutral-500">Checking repository…</p>}{location.inspectionError && <p className="mt-2 text-[11px] text-red-600">{location.inspectionError}</p>}{duplicatePath.has(location.path.trim()) && <p className="mt-2 text-[11px] text-red-600">This path is already in the list.</p>}{location.inspection && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[11px] text-neutral-500"><span className="font-medium text-neutral-700">Purpose <span className="font-normal text-neutral-400">(optional)</span></span><Textarea className="mt-1 min-h-16" aria-label={`Location ${index + 1} purpose`} value={location.description} onChange={(event) => update(location.key, { description: event.target.value })} placeholder="API service, docs, design assets…" /></label><label className="text-[11px] text-neutral-500"><span className="font-medium text-neutral-700">Worktree setup <span className="font-normal text-neutral-400">(optional)</span></span><Textarea className="mt-1 min-h-16 font-mono text-xs" aria-label={`Location ${index + 1} worktree setup`} value={location.worktree_setup_command} onChange={(event) => update(location.key, { worktree_setup_command: event.target.value })} placeholder="npm install" disabled={!isGit} /></label></div>}{isGit && <div className="mt-3 grid gap-3 rounded-lg border border-neutral-200 bg-white p-3 sm:grid-cols-2"><label className="text-[11px] text-neutral-500">Base branch<Input className="mt-1 font-mono text-xs" aria-label={`Location ${index + 1} base branch`} value={location.base_branch} onChange={(event) => update(location.key, { base_branch: event.target.value })} required /></label><label className="text-[11px] text-neutral-500">Delivery mode<Select className="mt-1" aria-label={`Location ${index + 1} delivery mode`} value={location.delivery_mode} onChange={(event) => update(location.key, { delivery_mode: event.target.value as LocationDraft["delivery_mode"] })}><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge</option></Select></label></div>}{location.inspection?.git_status === "not_git" && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] text-neutral-500">Read-only Workspace context · no Git branch or delivery settings.</p>}</section>; })}</div><div className="mt-4 flex items-center justify-between gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={() => setLocations((current) => [...current, newLocationDraft()])}><Plus data-icon="inline-start" />Add another</Button><Button type="submit" disabled={busy || !canSubmit}>{busy ? "Adding…" : `Add ${locations.length} location${locations.length === 1 ? "" : "s"}`}</Button></div></form></DialogContent></Dialog>;
}

function EditDirectoryDialog({ directory, busy, onOpenChange, onSubmit }: { directory: Directory | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const isGit = directory?.git_common_dir != null; return <Dialog open={Boolean(directory)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">{directory?.name}</DialogTitle><DialogDescription className="mt-1 truncate font-mono text-[11px] text-neutral-500">{directory?.path}</DialogDescription>{directory && <form key={JSON.stringify([directory.id, directory.description, directory.worktree_setup_command, directory.base_branch, directory.delivery_mode])} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}><Textarea name="description" defaultValue={directory.description} placeholder="What is this location used for?" />{isGit && <WorktreeSetupField defaultValue={directory.worktree_setup_command} />}{isGit && <div className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"><label className="text-[11px] text-neutral-500">Base branch<Input className="mt-1 font-mono text-xs" name="base_branch" defaultValue={directory.base_branch} required /></label><label className="text-[11px] text-neutral-500">Delivery mode<Select className="mt-1" name="delivery_mode" defaultValue={directory.delivery_mode ?? "remote_review"}><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge</option></Select></label></div>}<div className="flex justify-end"><Button type="submit" disabled={busy}>Save</Button></div></form>}</DialogContent></Dialog>; }
function CreateWorkspaceDialog({ project, busy, onOpenChange, onSubmit }: { project: ProjectDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">New Workspace</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Each Git location uses its own base branch and delivery mode.</DialogDescription><form key={project ? project.id : "closed"} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}><Input name="name" placeholder="Feature or fix name" required /><Textarea name="description" placeholder="Scope and expected outcome" /><label className="block text-[11px] text-neutral-500">Shared local branch<Input className="mt-1 font-mono text-xs" name="branch" placeholder="Leave empty to generate treefold/name-random" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-[11px] text-neutral-500">Default repo remote<Input className="mt-1 font-mono text-xs" name="remote_name" defaultValue={project?.preferred_remote ?? ""} placeholder="origin" /></label><label className="block text-[11px] text-neutral-500">Default repo feature branch<Input className="mt-1 font-mono text-xs" name="remote_branch" placeholder="feature/my-change (optional)" /></label></div><p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500">Base branches and Finish behavior come from repository locations. The shared branch name is used across all Git worktrees.</p><div className="flex justify-end"><Button type="submit" disabled={busy}>Create Workspace</Button></div></form></DialogContent></Dialog>; }
function ConfigureWorkspaceLocationDialog({ location, busy, onOpenChange, onSubmit }: { location: WorkspaceLocation | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(location)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">{location?.remote_branch ? "Change" : "Set"} upstream</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Configure the remote feature branch for {location?.location_name}. Base branch and delivery mode remain inherited from its Project repository.</DialogDescription>{location && <form key={JSON.stringify([location.id, location.remote_name, location.remote_branch])} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}><div className="grid grid-cols-2 gap-3"><label className="block text-[11px] text-neutral-500">Remote<Input className="mt-1 font-mono text-xs" name="remote_name" defaultValue={location.remote_name ?? ""} placeholder="origin" required /></label><label className="block text-[11px] text-neutral-500">Remote feature branch<Input className="mt-1 font-mono text-xs" name="remote_branch" defaultValue={location.remote_branch ?? ""} placeholder={location.branch || "feature/my-change"} required /></label></div><p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">Pull and Push for this repository use this upstream. Treefold never force pushes.</p><div className="flex justify-end"><Button type="submit" disabled={busy}>Save upstream</Button></div></form>}</DialogContent></Dialog>; }
function CreateForkDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: Workspace | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="flex items-center gap-2 text-lg font-semibold"><GitBranch className="size-5" />Fork work</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">从 {workspace?.name} 当前 HEAD 创建一个独立 worktree。Fork 不能继续嵌套。</DialogDescription><form key={workspace ? workspace.id : "closed"} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}><Input name="name" placeholder="Fork name" required /><Textarea name="description" placeholder="Independent feature or experiment" /><div className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">父 workspace 必须 clean；完成后可以通过 Close and settle 合回父 Workspace。</div><div className="flex justify-end"><Button type="submit" disabled={busy}>Create Fork</Button></div></form></DialogContent></Dialog>; }

type FinishPayload = { code_action: string; todo_action: string; push_after_merge: boolean; keep_session_history: boolean; delete_worktree: boolean; delete_branch: boolean; commit_message?: string; preflight_id?: string };
function FinishWorkspaceDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: WorkspaceDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (locationId: string, payload: FinishPayload) => void }) {
  const finishable = workspace?.locations.filter((location) => location.access_mode === "read_write" && ["active", "failed"].includes(location.delivery_status)) ?? [];
  const [locationId, setLocationId] = useState("");
  const location = finishable.find((item) => item.id === locationId) ?? finishable[0];
  const [codeAction, setCodeAction] = useState("remote_merged");
  const [todoAction, setTodoAction] = useState("keep");
  const [pushAfterMerge, setPushAfterMerge] = useState(false);
  const [keepSessions, setKeepSessions] = useState(true);
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [preflight, setPreflight] = useState<DeliveryPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const isFork = workspace?.kind === "fork";
  useEffect(() => { if (!workspace) return; const first = workspace.locations.find((item) => item.access_mode === "read_write" && ["active", "failed"].includes(item.delivery_status)); setLocationId(first?.id ?? ""); }, [workspace?.id]);
  useEffect(() => { if (!workspace || !location) return; setCodeAction(isFork || location.delivery_mode === "local_merge" ? "local_merge" : "remote_merged"); setTodoAction(isFork ? "carry" : "keep"); setPushAfterMerge(false); setKeepSessions(true); setDeleteWorktree(true); setDeleteBranch(true); setCommitMessage(""); }, [workspace?.id, location?.id, isFork]);
  useEffect(() => { if (!location) return; let cancelled = false; setChecking(true); setPreflight(null); setPreflightError(""); void api<DeliveryPreflight>(`/api/workspace-locations/${location.id}/delivery-preflight`, { method: "POST", body: JSON.stringify({ code_action: codeAction }) }).then((value) => { if (!cancelled) setPreflight(value); }).catch((cause) => { if (!cancelled) setPreflightError(cause instanceof Error ? cause.message : "Preflight failed"); }).finally(() => { if (!cancelled) setChecking(false); }); return () => { cancelled = true; }; }, [location?.id, codeAction]);
  useEffect(() => { if (codeAction === "keep") { setDeleteWorktree(false); setDeleteBranch(false); } else if (codeAction === "discard") { setDeleteWorktree(true); setDeleteBranch(true); } }, [codeAction]);
  const blocked = !preflight || preflight.blockers.length > 0;
  return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Finish {isFork ? "Fork" : "Workspace"} location</DialogTitle>
        <DialogDescription>Finish each Git location independently. The Workspace is archived only after all repositories reach a terminal state.</DialogDescription>
      </DialogHeader>
      <div data-testid="finish-scroll-region" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <Field>
          <FieldLabel htmlFor="finish-location">REPOSITORY</FieldLabel>
          <Select id="finish-location" className="w-full" value={location?.id ?? ""} onChange={(event) => setLocationId(event.target.value)}>
            {finishable.map((item) => <option key={item.id} value={item.id}>{item.location_name} · {item.delivery_status}</option>)}
          </Select>
        </Field>
        <section data-testid="delivery-preflight" className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">Delivery preflight · {location?.location_name}</h3>
            <Badge variant={preflight && !preflight.blockers.length ? "success" : "neutral"}>{checking ? "checking" : blocked ? "blocked" : "ready"}</Badge>
          </div>
          {preflight && <p className="mt-3 text-xs text-muted-foreground">{preflight.ahead} ahead · {preflight.behind} behind · {preflight.changed_files.length} files</p>}
          {preflight?.warnings.map((item) => <p key={item} className="mt-2 text-xs text-warning">{item}</p>)}
          {preflight?.blockers.map((item) => <p key={item} className="mt-2 text-xs text-destructive">{item}</p>)}
          {preflightError && <p className="mt-2 text-xs text-destructive">{preflightError}</p>}
        </section>
        <FieldSet className="rounded-lg border p-4">
          <FieldLegend variant="label">Code delivery</FieldLegend>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel className="sr-only" htmlFor="finish-code-action">Code delivery action</FieldLabel>
              <Select id="finish-code-action" className="w-full" value={codeAction} onChange={(event) => setCodeAction(event.target.value)}>
                {!isFork && <option value="remote_merged">Already merged through remote review / CI</option>}
                <option value="local_merge">Merge into {isFork ? "parent Workspace" : "local base branch"}</option>
                <option value="keep">Preserve branch</option>
                <option value="discard">Discard code</option>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="finish-commit-message">Final commit message</FieldLabel>
              <Input id="finish-commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Final commit message（required if dirty）" />
            </Field>
          </FieldGroup>
        </FieldSet>
        <FieldSet className="rounded-lg border p-4">
          <FieldLegend variant="label">Cleanup</FieldLegend>
          <FieldGroup className="gap-3">
            <Field orientation="horizontal" data-disabled={codeAction === "keep" || codeAction === "discard" || undefined}>
              <Checkbox id="finish-delete-worktree" checked={deleteWorktree} disabled={codeAction === "keep" || codeAction === "discard"} onCheckedChange={setDeleteWorktree} />
              <FieldLabel htmlFor="finish-delete-worktree">Remove managed worktree</FieldLabel>
            </Field>
            <Field orientation="horizontal" data-disabled={codeAction === "keep" || codeAction === "discard" || !deleteWorktree || undefined}>
              <Checkbox id="finish-delete-branch" checked={deleteBranch} disabled={codeAction === "keep" || codeAction === "discard" || !deleteWorktree} onCheckedChange={setDeleteBranch} />
              <FieldLabel htmlFor="finish-delete-branch">Delete delivered local branch</FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={busy || checking || blocked || !location} onClick={() => location && onSubmit(location.id, { code_action: codeAction, todo_action: todoAction, push_after_merge: false, keep_session_history: keepSessions, delete_worktree: codeAction === "discard" || deleteWorktree, delete_branch: codeAction === "discard" || deleteBranch, commit_message: commitMessage || undefined, preflight_id: preflight?.id })}>{busy ? "Finishing…" : `Finish ${location?.location_name ?? "location"}`}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
type SettingsSaveFeedback =
  | { kind: "idle" | "saving" | "success" }
  | { kind: "error"; message: string };

function SettingsDialog({ open, system, settings, busy, onOpenChange, onSave }: { open: boolean; system: SystemStatus | null; settings: AppSettings | null; busy: boolean; onOpenChange: (open: boolean) => void; onSave: (update: { language: LanguagePreference; extraArgs: string[] }) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const { t } = useTranslation();
  const [extraArgs, setExtraArgs] = useState<string[]>([]);
  const [language, setLanguage] = useState<LanguagePreference>("system");
  const [saveFeedback, setSaveFeedback] = useState<SettingsSaveFeedback>({ kind: "idle" });
  const configuredArgsKey = JSON.stringify(settings?.agents.codex.extra_args ?? []);
  useEffect(() => {
    if (!open) return;
    setExtraArgs([...(settings?.agents.codex.extra_args ?? [])]);
    setLanguage(settings?.language ?? "system");
  }, [open, configuredArgsKey, settings?.language]);
  useEffect(() => {
    if (open) setSaveFeedback({ kind: "idle" });
  }, [open]);
  useEffect(() => {
    if (saveFeedback.kind !== "success") return;
    const timer = window.setTimeout(() => setSaveFeedback({ kind: "idle" }), 2400);
    return () => window.clearTimeout(timer);
  }, [saveFeedback.kind]);
  const clearSaveFeedback = () => setSaveFeedback({ kind: "idle" });
  const updateArgument = (index: number, value: string) => {
    clearSaveFeedback();
    setExtraArgs((current) => current.map((argument, itemIndex) => itemIndex === index ? value : argument));
  };
  const removeArgument = (index: number) => {
    clearSaveFeedback();
    setExtraArgs((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };
  const moveArgument = (index: number, offset: number) => {
    clearSaveFeedback();
    setExtraArgs((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const hasEmptyArgument = extraArgs.some((argument) => argument.length === 0);
  const saving = saveFeedback.kind === "saving";
  const handleSave = async () => {
    setSaveFeedback({ kind: "saving" });
    const result = await onSave({ language, extraArgs });
    setSaveFeedback(result.ok ? { kind: "success" } : { kind: "error", message: result.error });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden">
      <DialogHeader className="shrink-0">
        <DialogTitle>{t("settings.title")}</DialogTitle>
        <DialogDescription>{t("settings.description")}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs">
          <p>Codex · {system?.codex_available ? system.codex_version : t("common.unavailable")}</p>
          <p className="mt-2">{t("settings.backend")} · Rust / {system?.terminal_runtime || "portable-pty"}</p>
        </div>
        <section className="rounded-xl border border-neutral-200 p-4">
          <label className="block text-sm font-medium" htmlFor="settings-language">{t("settings.language.title")}</label>
          <p className="mt-1 text-xs leading-5 text-neutral-400">{t("settings.language.description")}</p>
          <Select data-testid="settings-language" id="settings-language" className="mt-3" value={language} onChange={(event) => { clearSaveFeedback(); setLanguage(event.target.value as LanguagePreference); }}>
            <option value="system">{t("settings.language.system")}</option>
            <option value="en-US">{t("settings.language.english")}</option>
            <option value="zh-CN">{t("settings.language.simplifiedChinese")}</option>
          </Select>
        </section>
        <section className="rounded-xl border border-neutral-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-medium">{t("settings.codexArguments.title")}</h3><p className="mt-1 text-xs leading-5 text-neutral-400">{t("settings.codexArguments.description")}</p></div>
            <Button size="sm" variant="secondary" onClick={() => { clearSaveFeedback(); setExtraArgs((current) => [...current, ""]); }}><Plus data-icon="inline-start" />{t("settings.codexArguments.add")}</Button>
          </div>
          <div data-testid="codex-extra-args" className="mt-4 flex flex-col gap-2">
            {extraArgs.length === 0 ? <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-400">{t("settings.codexArguments.empty")}</p> : extraArgs.map((argument, index) => <div key={index} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-[10px] text-neutral-400">{index + 1}</span>
              <Input className="min-w-0 flex-1 font-mono text-xs" aria-label={t("settings.codexArguments.input", { index: index + 1 })} value={argument} placeholder="--argument" onChange={(event) => updateArgument(index, event.target.value)} />
              <Button className="size-8" size="icon" variant="ghost" aria-label={t("settings.codexArguments.moveUp", { index: index + 1 })} disabled={index === 0} onClick={() => moveArgument(index, -1)}><ChevronUp data-icon="inline-start" /></Button>
              <Button className="size-8" size="icon" variant="ghost" aria-label={t("settings.codexArguments.moveDown", { index: index + 1 })} disabled={index === extraArgs.length - 1} onClick={() => moveArgument(index, 1)}><ChevronDown data-icon="inline-start" /></Button>
              <Button className="size-8" size="icon" variant="ghost" aria-label={t("settings.codexArguments.remove", { index: index + 1 })} onClick={() => removeArgument(index)}><Trash2 data-icon="inline-start" /></Button>
            </div>)}
          </div>
          {hasEmptyArgument && <p className="mt-2 text-xs text-red-600">{t("settings.codexArguments.validation")}</p>}
        </section>
      </div>
      <div className="mt-5 flex min-h-9 shrink-0 items-center justify-end gap-3">
        {saveFeedback.kind === "success" && <p data-testid="settings-save-status" role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-emerald-700"><CircleCheck className="size-4" />{t("settings.saved")}</p>}
        {saveFeedback.kind === "error" && <p data-testid="settings-save-status" role="alert" className="max-w-sm truncate text-xs text-red-600" title={saveFeedback.message}>{t("settings.saveFailed", { message: saveFeedback.message })}</p>}
        <Button data-testid="settings-save" aria-busy={saving} disabled={busy || hasEmptyArgument} onClick={() => void handleSave()}>{saving && <Spinner data-testid="settings-save-spinner" data-icon="inline-start" />}{t(saving ? "settings.saving" : "common.save")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

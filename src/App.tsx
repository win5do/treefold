import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
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
  git_status: "ready" | "not_git" | "missing" | "broken" | "mismatch";
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
  yolo: boolean;
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
  git_status: "ready" | "not_git" | "missing" | "broken" | "mismatch";
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

type GitBranches = {
  current: string;
  local: string[];
  remotes: Array<{ name: string; branches: string[] }>;
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

type BranchSelection = { kind: "local"; branch: string } | { kind: "remote"; remote: string; branch: string };

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

const CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG = "--dangerously-bypass-approvals-and-sandbox";

function normalizeProject(value: ProjectDetail): ProjectDetail {
  const locations = value.locations ?? value.directories ?? [];
  const directories = locations.map((location) => ({ ...location, git_status: location.git_status ?? (location.is_git ? "ready" : "not_git"), role: (value.default_location_id ?? value.primary_directory_id) === location.id ? "primary" as const : "attached" as const, is_git: location.git_status ? location.git_status === "ready" : location.is_git, remote_url: location.repository_url ?? location.remote_url }));
  const primary = directories.find((location) => value.default_location_id === location.id);
  return { ...value, default_base_branch: value.default_base_branch ?? value.default_target_branch ?? "main", default_target_branch: value.default_base_branch ?? value.default_target_branch ?? "main", primary_directory_id: value.default_location_id ?? "", git_common_dir: primary?.git_common_dir ?? "", preferred_remote: primary?.preferred_remote_name, locations: directories, directories, workspaces: value.workspaces ?? [], worktrees: value.worktrees ?? [] };
}

function normalizeWorkspace(value: WorkspaceDetail): WorkspaceDetail {
  const locations = value.locations ?? (value.directories ?? []).map((directory) => ({ id: `workspace-location-${directory.id}`, workspace_id: value.id, project_location_id: directory.id, location_name: directory.name, source_path: directory.path, access_mode: directory.is_git ? "read_write" as const : "read_only" as const, git_status: directory.git_status ?? (directory.is_git ? "ready" as const : "not_git" as const), checkout_path: directory.checkout_path, branch: value.branch, base_branch: value.target_branch, start_commit: value.start_commit, remote_name: value.remote_name, remote_branch: value.remote_branch, delivery_mode: value.delivery_mode, delivery_status: value.delivery_status }));
  const primary = locations.find((location) => value.project.default_location_id === location.project_location_id) ?? locations.find((location) => location.access_mode === "read_write");
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
  const [createCodexTarget, setCreateCodexTarget] = useState<{ project: ProjectDetail; workspace: WorkspaceDetail | Workspace; directory?: Directory } | null>(null);
  const [createForkWorkspace, setCreateForkWorkspace] = useState<Workspace | null>(null);
  const [configureWorkspace, setConfigureWorkspace] = useState<WorkspaceDetail | null>(null);
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
    if (!params.workspaceId) return;
    const timer = window.setInterval(() => void refreshWorkspaceSessions(params.workspaceId!), 2500);
    return () => window.clearInterval(timer);
  }, [params.workspaceId, refreshWorkspaceSessions]);
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
  const selectedSession = workspace?.sessions.find((session) => session.id === params.sessionId) ?? null;

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

  async function openProjectTool(project: ProjectDetail, kind: "shell" | "codex", directory?: Directory) {
    setSessionMenu(null);
    await act(() => api(`/api/projects/${project.id}/open-tool`, { method: "POST", body: JSON.stringify({ kind, project_directory_id: directory?.id }) }));
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
    const association = worktree.workspace_name ? `，并归档 Workspace “${worktree.workspace_name}”` : "";
    if (!window.confirm(`确定删除 worktree？\n\n${worktree.path}${association}\n\n未提交的改动会被丢弃。`)) return;
    await act(() => api(`/api/project-directories/${worktree.project_location_id}/worktrees`, {
      method: "DELETE",
      body: JSON.stringify({ path: worktree.path }),
    }));
  }

  async function checkoutDirectoryBranch(directory: Directory, selection: BranchSelection) {
    setBusy(true);
    try {
      await api<Directory>(`/api/project-directories/${directory.id}/checkout`, {
        method: "POST",
        body: JSON.stringify(selection),
      });
      await refresh(true);
      setWarning("");
      setError("");
      return true;
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : "Git could not switch branches");
      return false;
    } finally {
      setBusy(false);
    }
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
          <Button className="md:hidden" size="icon" variant="ghost" aria-label={t("workspace.openMobileNavigation")} onClick={() => setMobileSidebar(true)}><Menu className="size-4" /></Button>
          <Button className="hidden md:inline-flex" size="icon" variant={sidebarHidden ? "secondary" : "ghost"} aria-label={t(sidebarHidden ? "workspace.showLeftSidebar" : "workspace.hideLeftSidebar")} onClick={() => setSidebarHidden((value) => !value)}>{sidebarHidden ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</Button>
        </div>
        <div data-testid="toolbar-content-frame" className={cn("min-w-0 flex-1 overflow-y-auto px-5 transition-[margin] duration-200 [scrollbar-gutter:stable] sm:px-8 lg:px-12", selectedProject && inspectorOpen && "lg:mr-[340px]")}>
          <div data-testid="toolbar-title" className="mx-auto max-w-6xl truncate pr-16 text-xs text-neutral-500" title={workspace ? `${workspace.project.name} / ${workspace.name}` : selectedProject?.name || "Treefold"}>{workspace ? `${workspace.project.name} / ${workspace.name}` : selectedProject?.name || "Treefold"}</div>
        </div>
        <div className="absolute right-2 flex items-center">
          <Button size="icon" variant="ghost" disabled={busy} aria-label={t("workspace.refresh")} onClick={() => void refresh()}><RefreshCw className="size-4" /></Button>
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
          onCreateCodex={(stream, directory) => { setSessionMenu(null); const project = projects.find((item) => item.id === stream.project_id); if (project) setCreateCodexTarget({ project, workspace: stream, directory }); }}
          onCreateBaseShell={(project, directory) => void openProjectTool(project, "shell", directory)}
          onCreateBaseCodex={(project, directory) => void openProjectTool(project, "codex", directory)}
          onOpenInFinder={(project, stream) => void openInFinder(project, stream)}
          onArchiveProject={(project) => void updateProjectStatus(project, "archived")}
          onCloseSession={(stream, session) => void closeSidebarSession(stream, session)}
          onResizeStart={() => setResizingSidebar(true)}
          onResizeKeyboard={(delta) => setSidebarWidth((current) => Math.min(520, Math.max(240, current + delta)))}
          onSettings={() => setSettingsOpen(true)}
        />

        <main data-testid="workspace-main" className={cn("flex h-full min-w-0 flex-col", !resizingSidebar && "transition-[margin] duration-200", sidebarHidden ? "md:ml-12" : "md:ml-[var(--sidebar-width)]")}>
        {error && <div className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"><CircleAlert className="size-4" /><span className="flex-1">{error}</span><button onClick={() => setError("")}><X className="size-4" /></button></div>}
        {warning && <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700"><CircleAlert className="size-4" /><span className="flex-1">{t("workspace.branchNotSwitched", { message: warning })}</span><button onClick={() => setWarning("")}><X className="size-4" /></button></div>}

        <div className="flex min-h-0 flex-1">
          <section className={cn("min-w-0 flex-1 transition-[margin] duration-200", selectedProject && inspectorOpen && "lg:mr-[340px]")}>
            {loading ? <CenteredMessage>{t("workspace.loading")}</CenteredMessage> : selectedSession ? (
              <SessionWorkspace
                session={selectedSession}
                busy={busy}
                onStop={() => void act(() => api(`/api/sessions/${selectedSession.id}/stop`, { method: "POST" }))}
                onRestart={() => void act(() => api(`/api/sessions/${selectedSession.id}/restart`, { method: "POST" }))}
                onExit={() => void refresh(true)}
              />
            ) : workspace ? (
              <WorkspaceHome detail={workspace} busy={busy} onOpen={(session) => void openHistorySession(workspace, session)} onOpenFork={(fork) => navigate(`/workspaces/${fork.id}`)} onShell={(directory) => void createShell(workspace, directory)} onCodex={() => setCreateCodexTarget({ project: selectedProject!, workspace })} onFork={() => setCreateForkWorkspace(workspace)} onConfigure={() => setConfigureWorkspace(workspace)} onPull={() => void gitSync("workspaces", workspace.id, "pull")} onPush={() => void gitSync("workspaces", workspace.id, "push")} onReveal={() => void openInFinder(selectedProject!, workspace)} onFinish={() => setFinishWorkspaceDialog(workspace)} />
            ) : selectedProject ? (
              <ProjectHome project={selectedProject} busy={busy} onOpen={(id) => navigate(`/workspaces/${id}`)} onCreate={() => setCreateWorkspaceProject(selectedProject)} onAddDirectory={() => setAddDirectoryProject(selectedProject)} onEditDirectory={setEditDirectory} onRefreshLocation={(location) => void refreshLocation(location)} onMakeDefault={(location) => void makeDefaultLocation(selectedProject, location)} onReattach={(location) => void reattachLocation(location)} onCheckoutBranch={checkoutDirectoryBranch} onDeleteWorktree={(item) => void removeWorktree(item)} onOpenTool={(kind, directory) => void openProjectTool(selectedProject, kind, directory)} onPull={() => void gitSync("projects", selectedProject.id, "pull")} onPush={() => void gitSync("projects", selectedProject.id, "push")} />
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
      <CreateCodexDialog target={createCodexTarget} busy={busy} yoloDefault={Boolean(settings?.agents.codex.extra_args.includes(CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG))} onOpenChange={(open) => { if (!open) setCreateCodexTarget(null); }} onSubmit={async (event) => {
        event.preventDefault();
        if (!createCodexTarget) return;
        const form = new FormData(event.currentTarget);
        let created: Session | null = null;
        const endpoint = `/api/workspaces/${createCodexTarget.workspace.id}/sessions`;
        const ok = await act(async () => { created = await api<Session>(endpoint, { method: "POST", body: JSON.stringify({ kind: "codex", name: form.get("name"), initial_prompt: form.get("initial_prompt"), yolo: form.get("yolo") === "on", project_directory_id: createCodexTarget.directory?.id }) }); });
        if (ok && created) { const target = createCodexTarget; setCreateCodexTarget(null); navigate(`/workspaces/${target.workspace.id}/sessions/${(created as Session).id}`); }
      }} />
      <CreateForkDialog workspace={createForkWorkspace} busy={busy} onOpenChange={(open) => { if (!open) setCreateForkWorkspace(null); }} onSubmit={async (event) => {
        event.preventDefault();
        if (!createForkWorkspace) return;
        const form = new FormData(event.currentTarget);
        let created: Workspace | null = null;
        const ok = await act(async () => { created = await api<Workspace>(`/api/workspaces/${createForkWorkspace.id}/forks`, { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) }); });
        if (ok && created) { setCreateForkWorkspace(null); navigate(`/workspaces/${(created as Workspace).id}`); }
      }} />
      <ConfigureWorkspaceDialog workspace={configureWorkspace} busy={busy} onOpenChange={(open) => { if (!open) setConfigureWorkspace(null); }} onSubmit={async (event) => {
        event.preventDefault(); if (!configureWorkspace) return; const owner = configureWorkspace; const form = new FormData(event.currentTarget);
        const ok = await act(() => api(`/api/workspaces/${owner.id}`, { method: "PATCH", body: JSON.stringify({ remote_name: form.get("remote_name"), remote_branch: form.get("remote_branch"), delivery_mode: form.get("delivery_mode") }) }));
        if (ok) setConfigureWorkspace(null);
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

function WorkspaceSidebar({ projects, selectedWorkspaceId, selectedSessionId, hidden, mobileOpen, resizing, expandedProjects, expandedWorkspaces, closingSessionIds, sessionMenu, onToggleProject, onToggleWorkspace, onSessionMenu, onNavigate, onCreateProject, onCreateWorkspace, onCreateFork, onCreateShell, onCreateCodex, onCreateBaseShell, onCreateBaseCodex, onOpenInFinder, onArchiveProject, onCloseSession, onResizeStart, onResizeKeyboard, onSettings }: {
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
          {sessionMenu?.id === `project:${project.id}` && <SessionDirectoryMenu testId="sidebar-session-menu" directories={project.directories} position={sessionMenu} external primaryAction={<button data-testid="create-workspace-action" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium hover:bg-neutral-100" onClick={() => { onSessionMenu(null); onCreateWorkspace(project); }}><Workflow className="size-3.5" />{t("sidebar.newWorkspace")}</button>} onShell={(directory) => { onSessionMenu(null); onCreateBaseShell(project, directory); }} onCodex={(directory) => { onSessionMenu(null); onCreateBaseCodex(project, directory); }} />}
          {projectOpen && <div data-testid="sidebar-project-children" className="ml-3.5 border-l border-neutral-300 pl-1">
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
    {contextOwner && <SessionDirectoryMenu testId="directory-session-context-menu" directories={contextOwner.stream?.directories ?? contextOwner.project.directories} position={contextOwner} external={!contextOwner.stream} footerRows={contextOwner.stream ? 1 : 2} onShell={(directory) => { const owner = contextOwner; setContextOwner(null); owner.stream ? onCreateShell(owner.stream, directory) : onCreateBaseShell(owner.project, directory); }} onCodex={(directory) => { const owner = contextOwner; setContextOwner(null); owner.stream ? onCreateCodex(owner.stream, directory) : onCreateBaseCodex(owner.project, directory); }} footer={<><button className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-neutral-100" onClick={() => { const owner = contextOwner; setContextOwner(null); onOpenInFinder(owner.project, owner.stream); }}><FolderOpen className="size-3.5" />{t("sidebar.openInFinder")}</button>{!contextOwner.stream && <button data-testid="archive-project-action" className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-amber-700 hover:bg-amber-50" onClick={() => { const owner = contextOwner; setContextOwner(null); onArchiveProject(owner.project); }}><Archive className="size-3.5" />{t("sidebar.archiveProject")}</button>}</>} />}
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

function SessionDirectoryMenu({ directories, testId, position, external = false, primaryAction, footer, footerRows = 1, onShell, onCodex }: { directories: Directory[]; testId: string; position: { x: number; y: number }; external?: boolean; primaryAction?: React.ReactNode; footer?: React.ReactNode; footerRows?: number; onShell: (directory: Directory) => void; onCodex: (directory: Directory) => void }) {
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
    <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-400">{external ? "Open external tool in…" : t("sidebar.newSessionIn")}</p>{directories.map((item) => <button key={item.id} data-testid={`session-directory-${item.id}`} aria-expanded={directory?.id === item.id} className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-neutral-100", directory?.id === item.id && "bg-neutral-100 text-neutral-950")} onMouseEnter={(event) => activate(item, event.currentTarget)} onFocus={(event) => activate(item, event.currentTarget)}>{item.is_git ? <FolderGit2 className="size-3.5" /> : <Folder className="size-3.5" />}<span className="min-w-0 flex-1 truncate">{item.name}</span>{item.role === "primary" && <span className="text-[9px] text-neutral-400">{t("sidebar.primary")}</span>}<ChevronRight className={cn("size-3 transition-transform", directory?.id === item.id && "translate-x-0.5")} /></button>)}
    {directory && <div key={directory.id} data-testid="directory-session-submenu" className="directory-session-submenu absolute left-full w-40 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl" style={{ top: submenuTop }}><p className="truncate px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-400" title={directory.name}>{directory.name}</p><button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-neutral-100" onClick={() => onShell(directory)}><Shell className="size-3.5" />{external ? "Open Shell" : "Shell"}</button><button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-neutral-100" onClick={() => onCodex(directory)}><Bot className="size-3.5" />{external ? "Open Codex" : "Codex"}</button></div>}
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
    const capturing = session.kind === "codex" && !session.codex_session_id;
    return <div key={session.id} className={cn("group/session flex items-center rounded-md text-[11px] text-neutral-600 hover:bg-white/70", selectedSessionId === session.id && "bg-neutral-900 text-white hover:bg-neutral-800")}>
      <button className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-1.5 text-left" title={session.name} onClick={() => onNavigate(`/workspaces/${stream.id}/sessions/${session.id}`)}>{session.kind === "codex" ? <Bot className="size-3 shrink-0" /> : <TerminalSquare className="size-3 shrink-0" />}<span className="min-w-0 flex-1 truncate">{session.name}</span><StatusDot status={session.status} /></button>
      <button className="invisible mr-1 shrink-0 rounded p-1 opacity-70 hover:bg-white/15 group-hover/session:visible focus-visible:visible disabled:cursor-not-allowed disabled:opacity-30" disabled={capturing} title={capturing ? "Capturing session ID" : session.kind === "shell" ? "Close shell" : "Remove from sidebar"} aria-label={capturing ? "Capturing session ID" : session.kind === "shell" ? "Close shell" : "Remove from sidebar"} onClick={(event) => { event.stopPropagation(); onCloseSession(stream, session); }}><X className="size-3" /></button>
    </div>;
  }) ?? null;
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

function SessionWorkspace({ session, busy, onStop, onRestart, onExit }: { session: Session; busy: boolean; onStop: () => void; onRestart: () => void; onExit: () => void }) {
  const terminalState = ["exited", "failed", "closed", "evicted"].includes(session.status);
  return <div className="flex h-full min-h-0 flex-col bg-[#111315]">
    <div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-[#191b1e] px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-200">{session.kind === "codex" ? <Bot className="size-3.5 shrink-0" /> : <TerminalSquare className="size-3.5 shrink-0" />}<span className="truncate font-medium">{session.name}</span><StatusDot status={session.status} /><span className="text-[10px] text-neutral-500">{session.status}</span></div>
      <div className="flex items-center gap-1 px-2">
        {terminalState ? <Button size="sm" variant="secondary" disabled={busy} onClick={onRestart}><RotateCcw className="size-3" />{session.kind === "codex" ? "Resume" : "Restart"}</Button> : <Button size="sm" variant="ghost" className="text-neutral-300 hover:bg-white/10 hover:text-white" disabled={busy} onClick={onStop}><Square className="size-3" />Stop</Button>}
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
    {tab === "history" ? <GitHistoryPanel history={history} error={historyError} /> : tab === "operations" ? <GitOperationsPanel operations={operations} error={operationsError} /> : session && workspace ? <div className="space-y-6 p-4">
      <div><div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-lg bg-neutral-100">{session.kind === "codex" ? <Bot className="size-4" /> : <TerminalSquare className="size-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.name}</p><div className="mt-1 flex items-center gap-2"><Badge>{session.kind}</Badge><Badge variant={session.status === "running" ? "success" : session.status === "failed" ? "danger" : "neutral"}>{session.status}</Badge>{session.yolo && <Badge variant="danger">YOLO</Badge>}</div></div></div></div>
      <InspectorGroup title="Process"><InspectorRow label="Name" value={session.process_name} /><InspectorRow label="Process ID" value={session.process_id} mono /><InspectorRow label="PID" value={session.pid ? String(session.pid) : "—"} /><InspectorRow label="PGID" value={session.process_group_id ? String(session.process_group_id) : "—"} /><InspectorRow label="Exit" value={session.exit_code === undefined ? "—" : `${session.exit_code}${session.exit_signal ? ` · ${session.exit_signal}` : ""}`} /></InspectorGroup>
      <InspectorGroup title="Workspace"><InspectorRow label="Workspace" value={workspace.name} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Workspace ID" value={workspace.runtime_id} mono /><InspectorRow label="Workdir" value={session.cwd} mono />{session.original_cwd !== session.cwd && <InspectorRow label="Original" value={session.original_cwd} mono />}</InspectorGroup>
      {session.kind === "codex" && <InspectorGroup title="Codex"><InspectorRow label="Session ID" value={session.codex_session_id || "Capturing…"} mono /><InspectorRow label="Autonomy" value={session.yolo ? "Bypass approvals & sandbox" : "Use Codex defaults"} />{session.initial_prompt && <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">{session.initial_prompt}</div>}</InspectorGroup>}
      <InspectorGroup title="Command"><code className="block break-all rounded-lg bg-neutral-950 p-3 text-[10px] leading-5 text-neutral-300">{session.command?.join(" ") || "—"}</code></InspectorGroup>
    </div> : workspace ? <div className="space-y-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={workspace.name}>{workspace.name}</p><div className="mt-2 flex gap-2"><Badge>{workspace.kind}</Badge><Badge variant={workspace.status === "active" ? "success" : "neutral"}>{workspace.status}</Badge></div></div>
      <InspectorGroup title="Git"><InspectorRow label="Branch" value={workspace.branch || "—"} mono /><InspectorRow label="Start" value={workspace.start_commit || "—"} mono /><InspectorRow label="Target" value={workspace.target_branch || "—"} mono /><InspectorRow label="Delivery" value={workspace.delivery_status} /></InspectorGroup>
      <InspectorGroup title="Workspace"><InspectorRow label="Mode" value={workspace.checkout_mode} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Path" value={workspace.checkout_path} mono /></InspectorGroup>
      <InspectorGroup title="Records"><InspectorRow label="Sessions" value={String(workspace.sessions.length)} /><InspectorRow label="Todos" value={String(workspace.todos.length)} />{workspace.kind === "workspace" && <InspectorRow label="Forks" value={String(workspace.forks.length)} />}</InspectorGroup>
    </div> : <div className="space-y-6 p-4">
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
  return <div className="divide-y divide-neutral-100">{operations.map((operation) => <article key={operation.id} data-testid="git-operation-record" className="space-y-2 px-4 py-3.5">
    <div className="flex items-center gap-2"><Badge>{operation.kind}</Badge><span className="min-w-0 flex-1 truncate text-xs font-medium">{operation.action.replaceAll("_", " ")}</span><Badge variant={operation.status === "completed" || operation.status === "restored" ? "success" : operation.status === "failed" || operation.status === "conflicted" ? "danger" : "neutral"}>{operation.status}</Badge></div>
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

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{title}</h3><div className="space-y-2">{children}</div></section>; }
function InspectorRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 text-xs"><span className="text-neutral-400">{label}</span><span className={cn("min-w-0 break-all text-neutral-700", mono && "font-mono text-[10px]")}>{value}</span></div>; }
function StatusDot({ status }: { status: string }) { return <span className={cn("size-1.5 shrink-0 rounded-full", status === "running" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "starting" || status === "stopping" ? "bg-amber-500" : "bg-neutral-400")} />; }

function WorkspaceHome({ detail, busy, onOpen, onOpenFork, onShell, onCodex, onFork, onConfigure, onPull, onPush, onReveal, onFinish }: { detail: WorkspaceDetail; busy: boolean; onOpen: (session: Session) => void; onOpenFork: (fork: Workspace) => void; onShell: (directory?: Directory) => void; onCodex: () => void; onFork: () => void; onConfigure: () => void; onPull: () => void; onPush: () => void; onReveal: () => void; onFinish: () => void }) {
  const [filter, setFilter] = useState<"all" | "codex" | "shell">("all");
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
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
        <div><div className="mb-3 flex items-center gap-2"><Badge>{detail.checkout_mode}</Badge><Badge variant={detail.status === "active" ? "success" : "neutral"}>{detail.status}</Badge></div><h1 className="text-3xl font-semibold tracking-tight">{detail.name}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">{detail.description || "在同一个 Workspace 中运行 Shell 和 Codex Sessions。"}</p></div>
        {detail.status === "active" && <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={onReveal}><FolderOpen className="size-4" />Finder</Button>{detail.kind === "workspace" && <Button variant="secondary" disabled={busy} onClick={onFork}><GitBranch className="size-4" />Fork work</Button>}<div className="relative flex"><Button className={cn(detail.directories.length > 1 && "rounded-r-none")} variant="secondary" disabled={busy} onClick={() => onShell()}><Shell className="size-4" />New Shell</Button>{detail.directories.length > 1 && <Button className="rounded-l-none border-l border-neutral-300 px-2" variant="secondary" disabled={busy} aria-label="Choose Shell directory" onClick={() => setShellMenuOpen((value) => !value)}><ChevronDown className="size-3.5" /></Button>}{shellMenuOpen && <div className="absolute right-0 top-10 z-30 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl"><p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-400">Start Shell in</p>{detail.directories.map((directory) => <button key={directory.id} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-neutral-100" onClick={() => { setShellMenuOpen(false); onShell(directory); }}>{directory.is_git ? <FolderGit2 className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}<span className="min-w-0 flex-1 truncate">{directory.name}</span>{directory.role === "primary" && <span className="text-[9px] text-neutral-400">default</span>}</button>)}</div>}</div><Button disabled={busy} onClick={onCodex}><Bot className="size-4" />New Codex</Button><Button variant="secondary" disabled={busy} onClick={onFinish}><X className="size-4" />Finish…</Button></div>}
      </div>
      <section data-testid="workspace-locations-section" className="mt-8"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Repository locations</h2><p className="mt-1 text-xs text-neutral-400">Git worktrees are writable; non-Git locations are context-only.</p></div>{detail.kind === "workspace" && <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={onConfigure}><Settings2 className="size-3.5" />Configure</Button><Button size="sm" variant="secondary" disabled={busy} onClick={onPull}><RefreshCw className="size-3.5" />Pull all</Button><Button size="sm" variant="secondary" disabled={busy} onClick={onPush}><Upload className="size-3.5" />Push all</Button></div>}</div><div className="mt-3 grid gap-3">{detail.locations.map((location) => <article key={location.id} data-testid={`workspace-location-${location.id}`} className="rounded-xl border border-neutral-200 bg-white p-4"><div className="flex items-center gap-2"><h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{location.location_name}</h3><Badge variant={location.git_status === "ready" ? "success" : location.git_status === "not_git" ? "neutral" : "danger"}>{location.git_status}</Badge><Badge>{location.access_mode}</Badge><Badge>{location.delivery_status}</Badge></div><code className="mt-2 block truncate text-[10px] text-neutral-500" title={location.checkout_path ?? location.source_path}>{location.checkout_path ?? location.source_path}</code>{location.access_mode === "read_write" && <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-neutral-500"><span>branch <code>{location.branch}</code></span><span>base <code>{location.base_branch}</code></span><span>upstream <code>{location.remote_name && location.remote_branch ? `${location.remote_name}/${location.remote_branch}` : "—"}</code></span></div>}</article>)}</div></section>
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
          return <div key={session.id} className="grid gap-3 border-b border-neutral-100 px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_90px_130px_130px_130px_minmax(110px,1fr)_120px] md:items-center">
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

function BranchSelector({ directory, busy, onCheckout }: { directory: Directory; busy: boolean; onCheckout: (directory: Directory, selection: BranchSelection) => Promise<boolean> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [view, setView] = useState<"root" | "local" | "remotes" | `remote:${string}`>("root");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggleOpen() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setView("root");
    setLoading(true);
    setError("");
    try {
      setBranches(await api<GitBranches>(`/api/project-directories/${directory.id}/branches`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load branches");
    } finally {
      setLoading(false);
    }
  }

  async function choose(selection: BranchSelection) {
    if (await onCheckout(directory, selection)) setOpen(false);
  }

  const remoteName = view.startsWith("remote:") ? view.slice("remote:".length) : "";
  const remote = branches?.remotes.find((item) => item.name === remoteName);
  const openRemote = () => {
    if (!branches?.remotes.length) return;
    setView(branches.remotes.length === 1 ? `remote:${branches.remotes[0].name}` : "remotes");
  };
  const back = () => setView(view.startsWith("remote:") && branches && branches.remotes.length > 1 ? "remotes" : "root");

  return <div ref={hostRef} className={cn("relative shrink-0", open ? "z-30" : "z-0")}>
    <button data-testid={`branch-selector-${directory.id}`} className="flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900" disabled={busy} onClick={() => void toggleOpen()}><GitBranch className="size-3" /><span>{directory.branch || "No branch"}</span><ChevronDown className="size-3 text-neutral-400" /></button>
    {open && <div className="absolute left-0 top-7 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
      <div className="flex h-9 items-center border-b border-neutral-100 px-2">
        {view !== "root" && <button className="mr-1 rounded p-1 hover:bg-neutral-100" aria-label="Back" onClick={back}><ChevronRight className="size-3.5 rotate-180" /></button>}
        <span className="min-w-0 flex-1 truncate px-1 text-[11px] font-semibold">{view === "root" ? "Branches" : view === "local" ? "Local" : view === "remotes" ? "Remote" : remoteName}</span>
        {loading && <RefreshCw className="size-3 animate-spin text-neutral-400" />}
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {error ? <p className="px-2 py-3 text-[11px] text-red-600">{error}</p> : !loading && branches && view === "root" ? <>
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-neutral-100" onClick={() => setView("local")}><Folder className="size-4 text-neutral-400" /><span className="flex-1 font-medium">Local</span><span className="text-[10px] text-neutral-400">{branches.local.length}</span><ChevronRight className="size-3.5 text-neutral-400" /></button>
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-neutral-100 disabled:opacity-40" disabled={branches.remotes.length === 0} onClick={openRemote}><Folder className="size-4 text-neutral-400" /><span className="flex-1 font-medium">Remote</span><span className="text-[10px] text-neutral-400">{branches.remotes.reduce((count, item) => count + item.branches.length, 0)}</span><ChevronRight className="size-3.5 text-neutral-400" /></button>
        </> : !loading && branches && view === "local" ? <>{branches.local.map((branch) => <button key={branch} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-neutral-100" disabled={busy} onClick={() => void choose({ kind: "local", branch })}><GitBranch className="size-3.5 text-neutral-400" /><span className="min-w-0 flex-1 truncate" title={branch}>{branch}</span>{branch === branches.current && <Badge variant="success">current</Badge>}</button>)}{branches.local.length === 0 && <p className="px-2 py-3 text-[11px] text-neutral-400">No local branches</p>}</> : !loading && branches && view === "remotes" ? <>{branches.remotes.map((item) => <button key={item.name} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-neutral-100" onClick={() => setView(`remote:${item.name}`)}><Folder className="size-4 text-neutral-400" /><span className="min-w-0 flex-1 truncate font-medium">{item.name}</span><span className="text-[10px] text-neutral-400">{item.branches.length}</span><ChevronRight className="size-3.5 text-neutral-400" /></button>)}</> : !loading && remote ? <>{remote.branches.map((branch) => <button key={branch} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-neutral-100" disabled={busy} onClick={() => void choose({ kind: "remote", remote: remote.name, branch })}><GitBranch className="size-3.5 text-neutral-400" /><span className="min-w-0 flex-1 truncate" title={branch}>{branch}</span></button>)}{remote.branches.length === 0 && <p className="px-2 py-3 text-[11px] text-neutral-400">No remote branches</p>}</> : null}
      </div>
    </div>}
  </div>;
}

function ProjectHome({ project, busy, onOpen, onCreate, onAddDirectory, onEditDirectory, onRefreshLocation, onMakeDefault, onReattach, onCheckoutBranch, onDeleteWorktree, onOpenTool, onPull, onPush }: { project: ProjectDetail; busy: boolean; onOpen: (id: string) => void; onCreate: () => void; onAddDirectory: () => void; onEditDirectory: (directory: Directory) => void; onRefreshLocation: (directory: Directory) => void; onMakeDefault: (directory: Directory) => void; onReattach: (directory: Directory) => void; onCheckoutBranch: (directory: Directory, selection: BranchSelection) => Promise<boolean>; onDeleteWorktree: (worktree: GitWorktree) => void; onOpenTool: (kind: "shell" | "codex", directory?: Directory) => void; onPull: () => void; onPush: () => void }) {
  const hasGitRepository = project.directories.some((directory) => directory.is_git);
  const primary = project.directories.find((directory) => directory.id === project.primary_directory_id) ?? project.directories.find((directory) => directory.role === "primary");
  const rootWorkspaces = project.workspaces.filter((stream) => !stream.parent_workspace_id);
  return <div data-testid="page-scroll" className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"><div data-testid="page-content" className="mx-auto max-w-6xl">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs text-neutral-400">Project · multi-repository locations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1><p className="mt-2 text-sm text-neutral-500">{project.description}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !primary} onClick={() => onOpenTool("shell", primary)}><Shell className="size-4" />Open Shell</Button><Button variant="secondary" disabled={busy || !primary} onClick={() => onOpenTool("codex", primary)}><Bot className="size-4" />Open Codex</Button><Button disabled={busy || primary?.git_status !== "ready"} onClick={onCreate}><Plus className="size-4" />New Workspace</Button></div></div>
    <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Repository synchronization</h2><p className="mt-1 text-xs text-neutral-400">Best effort across every Git location · failures do not roll back successful repositories.</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy || !hasGitRepository} onClick={onPull}><RefreshCw className="size-3.5" />Pull all</Button><Button size="sm" variant="secondary" disabled={busy || !hasGitRepository} onClick={onPush}><Upload className="size-3.5" />Push all</Button></div></div></section>
    <section className="mt-10"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Project locations</h2><p className="mt-1 text-xs text-neutral-400">Git locations join new Workspaces; non-Git locations remain read-only context.</p></div><Button size="sm" variant="secondary" onClick={onAddDirectory}><Plus className="size-3.5" />Add location</Button></div>
      <div className="relative z-10 mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">{project.directories.map((directory) => <article key={directory.id} data-testid={`project-location-${directory.id}`} className="flex items-start gap-3 p-4"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100">{directory.is_git ? <FolderGit2 className="size-4" /> : <Folder className="size-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold">{directory.name}</h3><Badge>{directory.role}</Badge><Badge variant={directory.git_status === "ready" ? "success" : directory.git_status === "not_git" ? "neutral" : "danger"}>{directory.git_status}</Badge>{directory.worktree_setup_command && <Badge>Setup</Badge>}</div><p className="mt-1 text-xs leading-5 text-neutral-500">{directory.description || "No purpose described yet."}</p><div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-400">{directory.is_git && <><BranchSelector directory={directory} busy={busy} onCheckout={onCheckoutBranch} /><span>·</span><span>{repositoryLabel(directory.repository_url)}</span><span>·</span><span>base {directory.base_branch}</span><span>·</span><span>{directory.delivery_mode === "local_merge" ? "local merge" : "remote review"}</span></>}<code className="min-w-0 truncate" title={directory.path}>{directory.path}</code></div></div><div className="flex shrink-0 gap-1"><Button size="sm" variant="ghost" disabled={busy} onClick={() => onRefreshLocation(directory)}>Refresh</Button>{directory.git_status === "ready" && directory.role !== "primary" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMakeDefault(directory)}>Make default</Button>}{["missing", "broken", "mismatch"].includes(directory.git_status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReattach(directory)}>Reattach</Button>}<button className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800" aria-label={`Edit ${directory.name}`} onClick={() => onEditDirectory(directory)}><Pencil className="size-3.5" /></button></div></article>)}{project.directories.length === 0 && <div className="py-10 text-center text-xs text-neutral-400">Add a Git location before creating a Workspace.</div>}</div>
    </section>
    <section className="mt-10"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Workspaces</h2><span className="text-[11px] text-neutral-400">{rootWorkspaces.length}</span></div><div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{rootWorkspaces.map((stream) => <button key={stream.id} onClick={() => onOpen(stream.id)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-neutral-50"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100"><Workflow className="size-4 text-neutral-500" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{stream.name}</p>{stream.status === "archived" && <Badge>archived</Badge>}</div><p className="mt-1 truncate text-xs text-neutral-500">{stream.description || stream.checkout_path}</p></div><ChevronRight className="size-4 shrink-0 text-neutral-300" /></button>)}{rootWorkspaces.length === 0 && <div className="py-12 text-center text-xs text-neutral-400">No Workspaces yet</div>}</div></section>
    {hasGitRepository && <section className="mt-10"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Git Worktrees</h2><p className="mt-1 text-xs text-neutral-400">Worktrees are created for every Git location in a Workspace.</p></div><span className="text-[11px] text-neutral-400">{project.worktrees.length}</span></div><div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{project.worktrees.map((item) => <div key={`${item.project_location_id}:${item.path}`} className="flex items-center gap-3 p-4"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100"><GitBranch className="size-4 text-neutral-500" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{item.branch}</span>{item.is_main && <Badge>Project location</Badge>}{item.workspace_id && <button className="text-xs font-medium text-blue-600 hover:underline" onClick={() => onOpen(item.workspace_id!)}>{item.workspace_name}</button>}</div><div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-neutral-400"><span>{item.location_name}</span>{item.head_commit && <><span>·</span><span className="font-mono">{item.head_commit}</span></>}<span>·</span><code className="min-w-0 truncate" title={item.path}>{item.path}</code></div></div>{!item.is_main && <Button size="icon" variant="ghost" disabled={busy} aria-label={`Delete worktree ${item.path}`} onClick={() => onDeleteWorktree(item)}><Trash2 className="size-4 text-neutral-400" /></Button>}</div>)}{project.worktrees.length === 0 && <div className="py-10 text-center text-xs text-neutral-400">No Git worktrees found</div>}</div></section>}
  </div></div>;
}
function Overview({ projects, busy, onOpen, onCreate, onRestore, onDelete }: { projects: ProjectDetail[]; busy: boolean; onOpen: (id: string) => void; onCreate: () => void; onRestore: (project: ProjectDetail) => void; onDelete: (project: ProjectDetail) => void }) {
  const { t, i18n } = useTranslation();
  const formatUpdatedAt = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return <div data-testid="page-scroll" className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"><div data-testid="page-content" className="mx-auto max-w-6xl"><div className="flex items-end justify-between"><div><p className="text-xs text-neutral-400">{t("overview.eyebrow")}</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">{t("overview.title")}</h1></div><Button onClick={onCreate}><FolderPlus className="size-4" />{t("overview.newProject")}</Button></div>
    <div className="mt-8 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[920px] table-fixed text-left">
        <thead><tr className="border-b border-neutral-100 bg-neutral-50 text-[10px] font-semibold uppercase tracking-wider text-neutral-400"><th className="w-[22%] px-4 py-3">{t("overview.columns.project")}</th><th className="w-[25%] px-4 py-3">{t("overview.columns.mainDirectory")}</th><th className="w-[12%] px-4 py-3">{t("overview.columns.gitBranch")}</th><th className="w-[15%] px-4 py-3">{t("overview.columns.remote")}</th><th className="w-[9%] px-4 py-3">{t("overview.columns.workspaces")}</th><th className="w-[9%] px-4 py-3">{t("overview.columns.updated")}</th><th className="w-[8%] px-4 py-3"><span className="sr-only">{t("overview.columns.actions")}</span></th></tr></thead>
        <tbody className="divide-y divide-neutral-100">{projects.map((project) => {
          const primary = project.directories.find((directory) => directory.id === project.primary_directory_id) ?? project.directories.find((directory) => directory.role === "primary");
          return <tr key={project.id} data-testid="project-overview-row" data-project-status={project.status} role="link" tabIndex={0} className={cn("cursor-pointer outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50", project.status === "archived" && "bg-neutral-50/60 text-neutral-500")} onClick={() => onOpen(project.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(project.id); } }}><td className="px-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100">{primary?.is_git ? <FolderGit2 className="size-4 text-neutral-500" /> : <Folder className="size-4 text-neutral-500" />}</div><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-semibold">{project.name}</p>{project.status === "archived" && <Badge>{t("overview.archived")}</Badge>}</div><p className="mt-1 truncate text-xs text-neutral-500">{project.description || t("overview.localProject")}</p></div></div></td><td className="px-4 py-4"><code className="block truncate text-[10px] text-neutral-500" title={primary?.path}>{primary?.path || "—"}</code></td><td className="px-4 py-4"><div className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-600">{primary?.is_git && <GitBranch className="size-3.5 shrink-0 text-neutral-400" />}<span className="truncate">{primary?.is_git ? primary.branch || t("overview.detachedHead") : "—"}</span></div></td><td className="px-4 py-4"><span className="block truncate text-xs text-neutral-500" title={primary?.remote_url}>{primary?.remote_url ? repositoryLabel(primary.remote_url) : "—"}</span></td><td className="px-4 py-4 text-xs text-neutral-600">{project.workspaces.length}</td><td className="px-4 py-4 text-xs text-neutral-500">{formatUpdatedAt(project.updated_at)}</td><td className="px-4 py-4"><div className="flex justify-end gap-1">{project.status === "archived" ? <><Button data-testid="restore-project-action" size="icon" variant="ghost" disabled={busy} aria-label={t("overview.restoreProject", { name: project.name })} title={t("overview.restoreToSidebar")} onClick={(event) => { event.stopPropagation(); onRestore(project); }}><RotateCcw className="size-4 text-neutral-500" /></Button><Button data-testid="delete-project-action" size="icon" variant="ghost" disabled={busy} aria-label={t("overview.permanentlyDeleteProject", { name: project.name })} title={t("overview.permanentlyDelete")} onClick={(event) => { event.stopPropagation(); onDelete(project); }}><Trash2 className="size-4 text-red-500" /></Button></> : <ChevronRight className="my-2 size-4 text-neutral-300" />}</div></td></tr>;
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
  return <div><div className="flex gap-2"><Input className="min-w-0 flex-1 font-mono text-xs" aria-label={label} value={path} onChange={(event) => onPathChange(event.target.value)} placeholder="/absolute/path/to/location" required /><Button type="button" variant="secondary" disabled={busy || picking || !path.trim()} onClick={() => void onInspect(path)}>Check</Button><Button type="button" variant="secondary" disabled={busy || picking} onClick={() => void chooseDirectory()}><FolderOpen className="size-4" />{picking ? "Choosing…" : "Choose…"}</Button></div>{pickerError && <p className="mt-1.5 text-[11px] text-red-600">{pickerError}</p>}</div>;
}

function WorktreeSetupField({ defaultValue }: { defaultValue?: string }) { return <label className="block text-[11px] text-neutral-500"><span className="font-medium text-neutral-700">Worktree setup command <span className="font-normal text-neutral-400">(optional)</span></span><Textarea className="mt-1 font-mono text-xs" name="worktree_setup_command" aria-label="Worktree setup command" defaultValue={defaultValue} placeholder="npm install" /><span className="mt-1 block text-[10px] leading-4 text-neutral-400">Runs in each new managed worktree using your login shell.</span></label>; }
function CreateProjectDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">New Project</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Project 只负责组织 locations；Git 分支和交付方式在 repository location 上配置。</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><Input name="name" placeholder="Project name" required /><Textarea name="description" placeholder="Project description" /><div className="flex justify-end"><Button disabled={busy}>Create Project</Button></div></form></DialogContent></Dialog>; }

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
  return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}><DialogContent className="location-list-dialog"><DialogTitle className="text-lg font-semibold">Add project locations</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Add Git repositories and read-only context directories to {project?.name}. Names always use the directory name.</DialogDescription><form className="mt-5" onSubmit={(event) => { event.preventDefault(); if (canSubmit) void onSubmit(locations); }}><div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1" data-testid="location-draft-list">{locations.map((location, index) => { const isGit = location.inspection?.git_status === "ready"; const checking = checkingKeys.has(location.key); return <section key={location.key} data-testid="location-draft-row" className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4"><div className="mb-3 flex items-center gap-2"><span className="text-xs font-semibold">Location {index + 1}</span>{location.inspection && <><Badge variant={isGit ? "success" : "neutral"}>{location.inspection.git_status}</Badge><span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500">{location.inspection.name}</span></>}<Button type="button" size="icon" variant="ghost" aria-label={`Remove location ${index + 1}`} disabled={locations.length === 1 || busy} onClick={() => setLocations((current) => current.filter((item) => item.key !== location.key))}><Trash2 className="size-3.5" /></Button></div><DirectoryPathField busy={busy || checking} path={location.path} label={`Location ${index + 1} path`} onPathChange={(path) => update(location.key, { path, inspection: undefined, inspectionError: undefined })} onInspect={(path) => inspect(location.key, path)} />{checking && <p className="mt-2 text-[11px] text-neutral-500">Checking repository…</p>}{location.inspectionError && <p className="mt-2 text-[11px] text-red-600">{location.inspectionError}</p>}{duplicatePath.has(location.path.trim()) && <p className="mt-2 text-[11px] text-red-600">This path is already in the list.</p>}{location.inspection && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[11px] text-neutral-500"><span className="font-medium text-neutral-700">Purpose <span className="font-normal text-neutral-400">(optional)</span></span><Textarea className="mt-1 min-h-16" aria-label={`Location ${index + 1} purpose`} value={location.description} onChange={(event) => update(location.key, { description: event.target.value })} placeholder="API service, docs, design assets…" /></label><label className="text-[11px] text-neutral-500"><span className="font-medium text-neutral-700">Worktree setup <span className="font-normal text-neutral-400">(optional)</span></span><Textarea className="mt-1 min-h-16 font-mono text-xs" aria-label={`Location ${index + 1} worktree setup`} value={location.worktree_setup_command} onChange={(event) => update(location.key, { worktree_setup_command: event.target.value })} placeholder="npm install" disabled={!isGit} /></label></div>}{isGit && <div className="mt-3 grid gap-3 rounded-lg border border-neutral-200 bg-white p-3 sm:grid-cols-2"><label className="text-[11px] text-neutral-500">Base branch<Input className="mt-1 font-mono text-xs" aria-label={`Location ${index + 1} base branch`} value={location.base_branch} onChange={(event) => update(location.key, { base_branch: event.target.value })} required /></label><label className="text-[11px] text-neutral-500">Delivery mode<Select className="mt-1" aria-label={`Location ${index + 1} delivery mode`} value={location.delivery_mode} onChange={(event) => update(location.key, { delivery_mode: event.target.value as LocationDraft["delivery_mode"] })}><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge</option></Select></label></div>}{location.inspection?.git_status === "not_git" && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] text-neutral-500">Read-only Workspace context · no Git branch or delivery settings.</p>}</section>; })}</div><div className="mt-4 flex items-center justify-between gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={() => setLocations((current) => [...current, newLocationDraft()])}><Plus className="size-4" />Add another</Button><Button disabled={busy || !canSubmit}>{busy ? "Adding…" : `Add ${locations.length} location${locations.length === 1 ? "" : "s"}`}</Button></div></form></DialogContent></Dialog>;
}

function EditDirectoryDialog({ directory, busy, onOpenChange, onSubmit }: { directory: Directory | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const isGit = directory?.git_common_dir != null; return <Dialog open={Boolean(directory)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">{directory?.name}</DialogTitle><DialogDescription className="mt-1 truncate font-mono text-[11px] text-neutral-500">{directory?.path}</DialogDescription>{directory && <form key={directory.id} className="mt-6 space-y-3" onSubmit={onSubmit}><Textarea name="description" defaultValue={directory.description} placeholder="What is this location used for?" />{isGit && <WorktreeSetupField defaultValue={directory.worktree_setup_command} />}{isGit && <div className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"><label className="text-[11px] text-neutral-500">Base branch<Input className="mt-1 font-mono text-xs" name="base_branch" defaultValue={directory.base_branch} required /></label><label className="text-[11px] text-neutral-500">Delivery mode<Select className="mt-1" name="delivery_mode" defaultValue={directory.delivery_mode ?? "remote_review"}><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge</option></Select></label></div>}<div className="flex justify-end"><Button disabled={busy}>Save</Button></div></form>}</DialogContent></Dialog>; }
function CreateWorkspaceDialog({ project, busy, onOpenChange, onSubmit }: { project: ProjectDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">New Workspace</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Each Git location uses its own base branch and delivery mode.</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><Input name="name" placeholder="Feature or fix name" required /><Textarea name="description" placeholder="Scope and expected outcome" /><label className="block text-[11px] text-neutral-500">Shared local branch<Input className="mt-1 font-mono text-xs" name="branch" placeholder="Leave empty to generate treefold/name-random" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-[11px] text-neutral-500">Default repo remote<Input className="mt-1 font-mono text-xs" name="remote_name" defaultValue={project?.preferred_remote ?? ""} placeholder="origin" /></label><label className="block text-[11px] text-neutral-500">Default repo feature branch<Input className="mt-1 font-mono text-xs" name="remote_branch" placeholder="feature/my-change (optional)" /></label></div><p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500">Base branches and Finish behavior come from repository locations. The shared branch name is used across all Git worktrees.</p><div className="flex justify-end"><Button disabled={busy}>Create Workspace</Button></div></form></DialogContent></Dialog>; }
function ConfigureWorkspaceDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: WorkspaceDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">Workspace delivery settings</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Target branch 固定为 {workspace?.target_branch}；这里只修改 feature branch 的 upstream 与交付方式。</DialogDescription>{workspace && <form key={workspace.id} className="mt-6 space-y-3" onSubmit={onSubmit}><div className="grid grid-cols-2 gap-3"><label className="block text-[11px] text-neutral-500">Remote<Input className="mt-1 font-mono text-xs" name="remote_name" defaultValue={workspace.remote_name ?? ""} placeholder="origin" /></label><label className="block text-[11px] text-neutral-500">Remote feature branch<Input className="mt-1 font-mono text-xs" name="remote_branch" defaultValue={workspace.remote_branch ?? ""} placeholder="feature/my-change" /></label></div><Select name="delivery_mode" defaultValue={workspace.delivery_mode}><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge + optional push</option></Select><p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">两项都留空会清除 upstream。Treefold 不会替你 force push。</p><div className="flex justify-end"><Button disabled={busy}>Save</Button></div></form>}</DialogContent></Dialog>; }
function CreateCodexDialog({ target, busy, yoloDefault, onOpenChange, onSubmit }: { target: { project: ProjectDetail; workspace: WorkspaceDetail | Workspace; directory?: Directory } | null; busy: boolean; yoloDefault: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const label = target?.directory?.name ?? target?.workspace.name; return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="flex items-center gap-2 text-lg font-semibold"><Bot className="size-5" />New Codex Session</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">在 {label} 中启动正式的 Treefold Session。</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><Input name="name" placeholder="Session name" /><Textarea name="initial_prompt" placeholder="What should Codex work on?" /><label className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/60 p-4"><input className="mt-0.5" type="checkbox" name="yolo" defaultChecked={yoloDefault} /><span><span className="block text-sm font-medium text-red-800">YOLO mode</span><span className="mt-1 block text-xs leading-5 text-red-600">跳过 approvals 和 sandbox，仅在受控 Workspace 中使用。</span></span></label><div className="flex justify-end"><Button disabled={busy}>Start Codex</Button></div></form></DialogContent></Dialog>; }
function CreateForkDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: Workspace | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="flex items-center gap-2 text-lg font-semibold"><GitBranch className="size-5" />Fork work</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">从 {workspace?.name} 当前 HEAD 创建一个独立 worktree。Fork 不能继续嵌套。</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><Input name="name" placeholder="Fork name" required /><Textarea name="description" placeholder="Independent feature or experiment" /><div className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">父 workspace 必须 clean；完成后可以通过 Close and settle 合回父 Workspace。</div><div className="flex justify-end"><Button disabled={busy}>Create Fork</Button></div></form></DialogContent></Dialog>; }

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
  return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[86vh] flex-col overflow-hidden"><DialogTitle className="text-lg font-semibold">Finish {isFork ? "Fork" : "Workspace"} location</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Finish each Git location independently. The Workspace is archived only after all repositories reach a terminal state.</DialogDescription><div data-testid="finish-scroll-region" className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"><section className="rounded-xl border border-neutral-200 p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Repository</p><Select value={location?.id ?? ""} onChange={(event) => setLocationId(event.target.value)}>{finishable.map((item) => <option key={item.id} value={item.id}>{item.location_name} · {item.delivery_status}</option>)}</Select></section><section data-testid="delivery-preflight" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Delivery preflight · {location?.location_name}</h3><Badge variant={preflight && !preflight.blockers.length ? "success" : "neutral"}>{checking ? "checking" : blocked ? "blocked" : "ready"}</Badge></div>{preflight && <p className="mt-3 text-[11px]">{preflight.ahead} ahead · {preflight.behind} behind · {preflight.changed_files.length} files</p>}{preflight?.warnings.map((item) => <p key={item} className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700">{item}</p>)}{preflight?.blockers.map((item) => <p key={item} className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] text-red-700">{item}</p>)}{preflightError && <p className="mt-2 text-[11px] text-red-700">{preflightError}</p>}</section><fieldset className="rounded-xl border border-neutral-200 p-4"><legend className="px-1 text-xs font-semibold">Code delivery</legend><Select value={codeAction} onChange={(event) => setCodeAction(event.target.value)}>{!isFork && <option value="remote_merged">Already merged through remote review / CI</option>}<option value="local_merge">Merge into {isFork ? "parent Workspace" : "local base branch"}</option><option value="keep">Preserve branch</option><option value="discard">Discard code</option></Select><Input className="mt-3" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Final commit message（required if dirty）" /></fieldset><fieldset className="rounded-xl border border-neutral-200 p-4"><legend className="px-1 text-xs font-semibold">Cleanup</legend><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={deleteWorktree} disabled={codeAction === "keep" || codeAction === "discard"} onChange={(event) => setDeleteWorktree(event.target.checked)} />Remove managed worktree</label><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={deleteBranch} disabled={codeAction === "keep" || codeAction === "discard" || !deleteWorktree} onChange={(event) => setDeleteBranch(event.target.checked)} />Delete delivered local branch</label></fieldset></div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || checking || blocked || !location} onClick={() => location && onSubmit(location.id, { code_action: codeAction, todo_action: todoAction, push_after_merge: false, keep_session_history: keepSessions, delete_worktree: codeAction === "discard" || deleteWorktree, delete_branch: codeAction === "discard" || deleteBranch, commit_message: commitMessage || undefined, preflight_id: preflight?.id })}>{busy ? "Finishing…" : `Finish ${location?.location_name ?? "location"}`}</Button></div></DialogContent></Dialog>;
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
      <DialogTitle className="shrink-0 text-lg font-semibold">{t("settings.title")}</DialogTitle>
      <DialogDescription className="mt-1 shrink-0 text-sm text-neutral-500">{t("settings.description")}</DialogDescription>
      <div className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
            <Button size="sm" variant="secondary" onClick={() => { clearSaveFeedback(); setExtraArgs((current) => [...current, ""]); }}><Plus className="size-3.5" />{t("settings.codexArguments.add")}</Button>
          </div>
          <div data-testid="codex-extra-args" className="mt-4 space-y-2">
            {extraArgs.length === 0 ? <p className="rounded-lg bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-400">{t("settings.codexArguments.empty")}</p> : extraArgs.map((argument, index) => <div key={index} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-[10px] text-neutral-400">{index + 1}</span>
              <Input className="min-w-0 flex-1 font-mono text-xs" aria-label={t("settings.codexArguments.input", { index: index + 1 })} value={argument} placeholder="--argument" onChange={(event) => updateArgument(index, event.target.value)} />
              <Button className="size-8" size="icon" variant="ghost" aria-label={t("settings.codexArguments.moveUp", { index: index + 1 })} disabled={index === 0} onClick={() => moveArgument(index, -1)}><ChevronUp className="size-3.5" /></Button>
              <Button className="size-8" size="icon" variant="ghost" aria-label={t("settings.codexArguments.moveDown", { index: index + 1 })} disabled={index === extraArgs.length - 1} onClick={() => moveArgument(index, 1)}><ChevronDown className="size-3.5" /></Button>
              <Button className="size-8" size="icon" variant="ghost" aria-label={t("settings.codexArguments.remove", { index: index + 1 })} onClick={() => removeArgument(index)}><Trash2 className="size-3.5" /></Button>
            </div>)}
          </div>
          {hasEmptyArgument && <p className="mt-2 text-xs text-red-600">{t("settings.codexArguments.validation")}</p>}
        </section>
      </div>
      <div className="mt-5 flex min-h-9 shrink-0 items-center justify-end gap-3">
        {saveFeedback.kind === "success" && <p data-testid="settings-save-status" role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-emerald-700"><CircleCheck className="size-4" />{t("settings.saved")}</p>}
        {saveFeedback.kind === "error" && <p data-testid="settings-save-status" role="alert" className="max-w-sm truncate text-xs text-red-600" title={saveFeedback.message}>{t("settings.saveFailed", { message: saveFeedback.message })}</p>}
        <Button data-testid="settings-save" aria-busy={saving} disabled={busy || hasEmptyArgument} onClick={() => void handleSave()}>{saving && <RefreshCw data-testid="settings-save-spinner" className="size-3.5 animate-spin" />}{t(saving ? "settings.saving" : "common.save")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

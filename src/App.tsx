import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  Archive, Bot, ChevronDown, ChevronRight, CircleAlert, CircleCheck, FolderGit2,
  FolderOpen, GitBranch, GitMerge, Menu, PanelLeftClose, PanelLeftOpen, Plus,
  RefreshCw, RotateCcw, Settings2, Shell, Square, TerminalSquare, Trash2,
  Upload, Workflow, X,
} from "lucide-react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { open } from "@tauri-apps/plugin-dialog";
import "@xterm/xterm/css/xterm.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Project = {
  id: string; name: string; description: string; status: "active" | "archived";
  primary_directory_id: string; git_common_dir: string; preferred_remote?: string;
  default_target_branch: string; default_delivery_mode: "remote_review" | "local_merge";
  updated_at: string;
};
type Directory = {
  id: string; project_id: string; name: string; description: string;
  worktree_setup_command: string; path: string; checkout_path?: string;
  role: "primary" | "attached"; is_git: boolean; remote_url?: string; branch?: string;
  head_commit?: string; head_summary?: string; dirty: boolean;
};
type Session = {
  id: string; workspace_id: string; name: string; kind: "shell" | "codex";
  cwd: string; original_cwd: string; initial_prompt: string; codex_session_id?: string;
  yolo: boolean; sidebar_visible: boolean; status: string; exit_code?: number;
};
type Workspace = {
  id: string; project_id: string; name: string; description: string;
  status: "active" | "archived"; project_directory_id: string; checkout_path: string;
  target_branch: string; start_commit: string; branch: string; remote_name?: string;
  remote_branch?: string; branch_ownership: string;
  delivery_mode: "remote_review" | "local_merge"; delivery_status: string;
  close_outcome?: string; integrated_commit?: string; closed_at?: string; updated_at: string;
};
type Todo = { id: string; workspace_id: string; title: string; description: string; status: string };
type GitWorktree = { directory_id: string; directory_name: string; path: string; branch: string; head_commit: string; is_main: boolean; workspace_id?: string; workspace_name?: string };
type ProjectDetail = Project & { directories: Directory[]; workspaces: Workspace[]; worktrees: GitWorktree[] };
type WorkspaceDetail = Workspace & { project: Project; directories: Directory[]; sessions: Session[]; todos: Todo[] };
type GitSyncResult = { scope: string; action: string; branch: string; remote: string; remote_branch: string; status: string; message: string };
type GitCommit = { hash: string; short_hash: string; subject: string; author: string; authored_at: string };
type DeliveryPreflight = { id: string; target_branch: string; ahead: number; behind: number; changed_files: string[]; commits: GitCommit[]; blockers: string[]; warnings: string[] };
type AppSettings = { schema_version: number; language: string; worktree_root: string; agents: { codex: { extra_args: string[] } } };
type SystemStatus = { codex_available: boolean; codex_version?: string; backend: string; terminal_runtime: string };

const normalizeProject = (value: ProjectDetail): ProjectDetail => ({ ...value, directories: value.directories ?? [], workspaces: value.workspaces ?? [], worktrees: value.worktrees ?? [] });
const normalizeWorkspace = (value: WorkspaceDetail): WorkspaceDetail => ({ ...value, directories: value.directories ?? [], sessions: value.sessions ?? [], todos: value.todos ?? [] });

export default function App() {
  return <Routes>
    <Route path="/" element={<Treefold />} />
    <Route path="/projects/:projectId" element={<Treefold />} />
    <Route path="/workspaces/:workspaceId" element={<Treefold />} />
    <Route path="/workspaces/:workspaceId/sessions/:sessionId" element={<Treefold />} />
    <Route path="*" element={<Treefold />} />
  </Routes>;
}

function Treefold() {
  const { projectId, workspaceId, sessionId } = useParams<{ projectId?: string; workspaceId?: string; sessionId?: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectDetail[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createWorkspaceProject, setCreateWorkspaceProject] = useState<ProjectDetail | null>(null);
  const [codexWorkspace, setCodexWorkspace] = useState<WorkspaceDetail | null>(null);
  const [configureWorkspace, setConfigureWorkspace] = useState<WorkspaceDetail | null>(null);
  const [finishWorkspace, setFinishWorkspace] = useState<WorkspaceDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const list = await api<Project[]>("/api/projects");
      const details = await Promise.all((list ?? []).map((project) => api<ProjectDetail>(`/api/projects/${project.id}`).then(normalizeProject)));
      if (workspaceId) {
        const detail = normalizeWorkspace(await api<WorkspaceDetail>(`/api/workspaces/${workspaceId}`));
        setProjects(details.map((project) => project.id === detail.project.id ? { ...project, workspaces: project.workspaces.map((item) => item.id === detail.id ? detail : item) } : project));
        setWorkspace(detail);
        setExpandedProjects((current) => new Set(current).add(detail.project.id));
        setExpandedWorkspaces((current) => new Set(current).add(detail.id));
      } else {
        setProjects(details);
        setWorkspace(null);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!workspaceId) return;
    const timer = window.setInterval(() => void refresh(true), 2500);
    return () => window.clearInterval(timer);
  }, [workspaceId, refresh]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId || project.id === workspace?.project.id) ?? null, [projectId, projects, workspace]);
  const selectedSession = workspace?.sessions.find((session) => session.id === sessionId) ?? null;

  async function act(action: () => Promise<unknown>, success?: string) {
    setBusy(true); setNotice("");
    try {
      await action();
      await refresh(true);
      setError("");
      if (success) setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
      return false;
    } finally { setBusy(false); }
  }

  async function gitSync(scope: "projects" | "workspaces", id: string, action: "pull" | "push") {
    let result: GitSyncResult | undefined;
    const ok = await act(async () => { result = await api<GitSyncResult>(`/api/${scope}/${id}/git/${action}`, { method: "POST" }); });
    if (ok && result) setNotice(`${result.scope === "project" ? "Project target" : "Workspace branch"} ${action}: ${result.status} · ${result.remote}/${result.remote_branch}`);
  }

  async function createSession(owner: WorkspaceDetail | Workspace, kind: "shell" | "codex", input: Record<string, unknown> = {}) {
    let created: Session | undefined;
    const ok = await act(async () => { created = await api<Session>(`/api/workspaces/${owner.id}/sessions`, { method: "POST", body: JSON.stringify({ kind, ...input }) }); });
    if (ok && created) navigate(`/workspaces/${owner.id}/sessions/${created.id}`);
  }

  async function openProjectTool(project: ProjectDetail, kind: "shell" | "codex") {
    await act(() => api(`/api/projects/${project.id}/open-tool`, { method: "POST", body: JSON.stringify({ kind }) }), `${kind === "shell" ? "Shell" : "Codex"} 已在 source checkout 的外部终端中打开；它不是 Treefold Session。`);
  }

  async function openSettings() {
    setBusy(true);
    try {
      const [nextSettings, nextSystem] = await Promise.all([api<AppSettings>("/api/settings"), api<SystemStatus>("/api/system")]);
      setSettings(nextSettings); setSystem(nextSystem); setSettingsOpen(true); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Settings"); }
    finally { setBusy(false); }
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  return <div className="flex h-dvh flex-col overflow-hidden bg-[#f4f4f1] text-neutral-900">
    <header data-testid="app-toolbar" className="flex h-12 shrink-0 items-center border-b border-neutral-200 bg-white px-2">
      <Button size="icon" variant="ghost" className="md:hidden" onClick={() => setMobileSidebar(true)} aria-label="Open navigation"><Menu className="size-4" /></Button>
      <Button size="icon" variant="ghost" className="hidden md:inline-flex" onClick={() => setSidebarOpen((value) => !value)} aria-label="Toggle navigation">{sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}</Button>
      <p className="min-w-0 flex-1 truncate px-4 text-xs text-neutral-500">{workspace ? `${workspace.project.name} / ${workspace.name}` : selectedProject?.name ?? "Treefold"}</p>
      <Button size="icon" variant="ghost" disabled={busy} onClick={() => void refresh()} aria-label="Refresh"><RefreshCw className={cn("size-4", busy && "animate-spin")} /></Button>
    </header>
    <div className="relative flex min-h-0 flex-1">
      {mobileSidebar && <button className="absolute inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMobileSidebar(false)} aria-label="Close navigation" />}
      <Sidebar projects={projects} open={sidebarOpen} mobileOpen={mobileSidebar} selectedWorkspaceId={workspace?.id} selectedSessionId={sessionId} expandedProjects={expandedProjects} expandedWorkspaces={expandedWorkspaces}
        onNavigate={(path) => { navigate(path); setMobileSidebar(false); }} onToggleProject={(id) => toggle(setExpandedProjects, id)} onToggleWorkspace={(id) => toggle(setExpandedWorkspaces, id)} onCreateProject={() => setCreateProjectOpen(true)} onCreateWorkspace={setCreateWorkspaceProject} onCreateSession={(owner, kind) => void createSession(owner, kind)} onSettings={() => void openSettings()} />
      <main data-testid="workspace-main" className={cn("flex min-w-0 flex-1 flex-col transition-[margin]", sidebarOpen ? "md:ml-72" : "md:ml-0")}>
        {error && <Message tone="error" onClose={() => setError("")}>{error}</Message>}
        {notice && <Message tone="success" onClose={() => setNotice("")}>{notice}</Message>}
        <section className="min-h-0 flex-1">
          {loading ? <CenteredMessage>Loading…</CenteredMessage> : selectedSession ? <SessionWorkspace session={selectedSession} busy={busy} onStop={() => void act(() => api(`/api/sessions/${selectedSession.id}/stop`, { method: "POST" }))} onRestart={() => void act(() => api(`/api/sessions/${selectedSession.id}/restart`, { method: "POST" }))} onExit={() => void refresh(true)} />
            : workspace ? <WorkspaceHome detail={workspace} busy={busy} onShell={() => void createSession(workspace, "shell")} onCodex={() => setCodexWorkspace(workspace)} onConfigure={() => setConfigureWorkspace(workspace)} onPull={() => void gitSync("workspaces", workspace.id, "pull")} onPush={() => void gitSync("workspaces", workspace.id, "push")} onFinish={() => setFinishWorkspace(workspace)} onOpenSession={(session) => navigate(`/workspaces/${workspace.id}/sessions/${session.id}`)} onReveal={() => void act(() => api(`/api/workspaces/${workspace.id}/reveal`, { method: "POST" }))} />
            : selectedProject ? <ProjectHome project={selectedProject} busy={busy} onCreate={() => setCreateWorkspaceProject(selectedProject)} onOpen={(id) => navigate(`/workspaces/${id}`)} onOpenTool={(kind) => void openProjectTool(selectedProject, kind)} onPull={() => void gitSync("projects", selectedProject.id, "pull")} onPush={() => void gitSync("projects", selectedProject.id, "push")} onReveal={() => void act(() => api(`/api/projects/${selectedProject.id}/reveal`, { method: "POST" }))} />
            : <Overview projects={projects} busy={busy} onCreate={() => setCreateProjectOpen(true)} onOpen={(id) => navigate(`/projects/${id}`)} />}
        </section>
      </main>
    </div>
    <CreateProjectDialog open={createProjectOpen} busy={busy} onOpenChange={setCreateProjectOpen} onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); let created: Project | undefined;
      const ok = await act(async () => { created = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name: form.get("name"), path: form.get("path"), description: form.get("description"), preferred_remote: form.get("preferred_remote"), default_target_branch: form.get("default_target_branch"), default_delivery_mode: form.get("default_delivery_mode"), directory_worktree_setup_command: form.get("worktree_setup_command") }) }); });
      if (ok && created) { setCreateProjectOpen(false); navigate(`/projects/${created.id}`); }
    }} />
    <CreateWorkspaceDialog project={createWorkspaceProject} busy={busy} onOpenChange={(open) => { if (!open) setCreateWorkspaceProject(null); }} onSubmit={async (event) => {
      event.preventDefault(); if (!createWorkspaceProject) return; const form = new FormData(event.currentTarget); let created: Workspace | undefined;
      const ok = await act(async () => { created = await api<Workspace>(`/api/projects/${createWorkspaceProject.id}/workspaces`, { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), target_branch: form.get("target_branch"), branch: form.get("branch"), remote_name: form.get("remote_name"), remote_branch: form.get("remote_branch"), delivery_mode: form.get("delivery_mode") }) }); });
      if (ok && created) { setCreateWorkspaceProject(null); navigate(`/workspaces/${created.id}`); }
    }} />
    <CreateCodexDialog workspace={codexWorkspace} busy={busy} onOpenChange={(open) => { if (!open) setCodexWorkspace(null); }} onSubmit={async (event) => {
      event.preventDefault(); if (!codexWorkspace) return; const owner = codexWorkspace; const form = new FormData(event.currentTarget); setCodexWorkspace(null);
      await createSession(owner, "codex", { name: form.get("name"), initial_prompt: form.get("initial_prompt"), yolo: form.get("yolo") === "on" });
    }} />
    <ConfigureWorkspaceDialog workspace={configureWorkspace} busy={busy} onOpenChange={(open) => { if (!open) setConfigureWorkspace(null); }} onSubmit={async (event) => {
      event.preventDefault(); if (!configureWorkspace) return; const owner = configureWorkspace; const form = new FormData(event.currentTarget);
      const ok = await act(() => api(`/api/workspaces/${owner.id}`, { method: "PATCH", body: JSON.stringify({ remote_name: form.get("remote_name"), remote_branch: form.get("remote_branch"), delivery_mode: form.get("delivery_mode") }) }));
      if (ok) setConfigureWorkspace(null);
    }} />
    <FinishWorkspaceDialog workspace={finishWorkspace} busy={busy} onOpenChange={(open) => { if (!open) setFinishWorkspace(null); }} onSubmit={async (payload) => {
      if (!finishWorkspace) return; const owner = finishWorkspace; const ok = await act(() => api(`/api/workspaces/${owner.id}/finish`, { method: "POST", body: JSON.stringify(payload) }));
      if (ok) { setFinishWorkspace(null); navigate(`/projects/${owner.project_id}`); }
    }} />
    <SettingsDialog open={settingsOpen} settings={settings} system={system} busy={busy} onOpenChange={setSettingsOpen} onSave={async (next) => {
      const ok = await act(() => api("/api/settings", { method: "PATCH", body: JSON.stringify({ language: next.language, agents: { codex: { extra_args: next.extra_args } } }) }), "Settings saved");
      if (ok) { setSettings((current) => current ? { ...current, language: next.language, agents: { codex: { extra_args: next.extra_args } } } : current); }
    }} />
  </div>;
}

function Sidebar({ projects, open, mobileOpen, selectedWorkspaceId, selectedSessionId, expandedProjects, expandedWorkspaces, onNavigate, onToggleProject, onToggleWorkspace, onCreateProject, onCreateWorkspace, onCreateSession, onSettings }: {
  projects: ProjectDetail[]; open: boolean; mobileOpen: boolean; selectedWorkspaceId?: string; selectedSessionId?: string;
  expandedProjects: Set<string>; expandedWorkspaces: Set<string>; onNavigate: (path: string) => void;
  onToggleProject: (id: string) => void; onToggleWorkspace: (id: string) => void; onCreateProject: () => void;
  onCreateWorkspace: (project: ProjectDetail) => void; onCreateSession: (workspace: Workspace, kind: "shell" | "codex") => void;
  onSettings: () => void;
}) {
  return <aside data-testid="workspace-sidebar" className={cn("absolute inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-neutral-200 bg-[#ecece8] transition-transform", mobileOpen ? "translate-x-0" : "-translate-x-full", open ? "md:translate-x-0" : "md:-translate-x-full")}>
    <div className="flex h-10 items-center border-b border-neutral-200 px-3"><button className="flex-1 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500" onClick={() => onNavigate("/")}>Projects</button><Button size="icon" variant="ghost" onClick={onCreateProject} aria-label="New Project"><Plus className="size-4" /></Button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{projects.filter((project) => project.status === "active").map((project) => {
      const projectOpen = expandedProjects.has(project.id);
      return <div key={project.id} className="mb-1">
        <div data-testid="sidebar-project-node" className="flex items-center rounded-md hover:bg-white/60"><TreeToggle open={projectOpen} onClick={() => onToggleProject(project.id)} label={`${projectOpen ? "Collapse" : "Expand"} Project ${project.name}`} /><button className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-xs font-medium" onClick={() => onNavigate(`/projects/${project.id}`)}><FolderGit2 className="size-3.5 shrink-0 text-neutral-500" /><span className="truncate">{project.name}</span></button><Button size="icon" variant="ghost" aria-label={`New Workspace in ${project.name}`} onClick={() => onCreateWorkspace(project)}><Plus className="size-3.5" /></Button></div>
        {projectOpen && <div className="ml-3 border-l border-neutral-300 pl-2">{project.workspaces.map((workspace) => {
          const workspaceOpen = expandedWorkspaces.has(workspace.id); const selected = selectedWorkspaceId === workspace.id;
          return <div key={workspace.id}>
            <div data-testid="sidebar-workspace-node" className={cn("flex items-center rounded-md", selected && !selectedSessionId && "bg-white shadow-sm")}><TreeToggle open={workspaceOpen} onClick={() => onToggleWorkspace(workspace.id)} label={`${workspaceOpen ? "Collapse" : "Expand"} Workspace ${workspace.name}`} /><button className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs" onClick={() => onNavigate(`/workspaces/${workspace.id}`)}><Workflow className="size-3.5 shrink-0 text-neutral-500" /><span className="truncate">{workspace.name}</span></button>{workspace.status === "active" && <Button size="icon" variant="ghost" onClick={() => onCreateSession(workspace, "shell")} aria-label={`New Session in ${workspace.name}`}><Plus className="size-3.5" /></Button>}</div>
            {workspaceOpen && selected && <div className="ml-3 border-l border-neutral-300 pl-2">{(workspace as WorkspaceDetail).sessions?.filter((session) => session.sidebar_visible).map((session) => <button key={session.id} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px]", selectedSessionId === session.id ? "bg-neutral-900 text-white" : "hover:bg-white/60")} onClick={() => onNavigate(`/workspaces/${workspace.id}/sessions/${session.id}`)}>{session.kind === "codex" ? <Bot className="size-3" /> : <TerminalSquare className="size-3" />}<span className="min-w-0 flex-1 truncate">{session.name}</span><StatusDot status={session.status} /></button>)}</div>}
          </div>;
        })}{project.workspaces.length === 0 && <p className="px-2 py-2 text-[11px] text-neutral-400">No Workspaces</p>}</div>}
      </div>;
    })}</div>
    <div className="border-t border-neutral-200 p-2"><button data-testid="open-settings" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-neutral-600 hover:bg-white/70" onClick={onSettings}><Settings2 className="size-4" />Settings</button></div>
  </aside>;
}

function TreeToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) { return <button data-testid="sidebar-tree-toggle" className="grid size-7 shrink-0 place-items-center text-neutral-400" onClick={onClick} aria-label={label} aria-expanded={open}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>; }

function ProjectHome({ project, busy, onCreate, onOpen, onOpenTool, onPull, onPush, onReveal }: { project: ProjectDetail; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onOpenTool: (kind: "shell" | "codex") => void; onPull: () => void; onPush: () => void; onReveal: () => void }) {
  const primary = project.directories.find((directory) => directory.id === project.primary_directory_id);
  return <Page><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-neutral-400">Project · repository metadata</p><h1 className="mt-2 text-2xl font-semibold">{project.name}</h1><p className="mt-2 max-w-2xl text-sm text-neutral-500">{project.description || "No description"}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={onReveal}><FolderOpen className="size-4" />Finder</Button><Button variant="secondary" disabled={busy} onClick={() => onOpenTool("shell")}><Shell className="size-4" />Open Shell</Button><Button variant="secondary" disabled={busy} onClick={() => onOpenTool("codex")}><Bot className="size-4" />Open Codex</Button></div></div>
    <section className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Meta label="Source checkout" value={primary?.path ?? "—"} mono /><Meta label="Git common dir" value={project.git_common_dir} mono /><Meta label="Default target" value={project.default_target_branch} mono /><Meta label="Delivery default" value={project.default_delivery_mode === "remote_review" ? "Remote review / CI" : "Local merge"} /></section>
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Target synchronization</h2><p className="mt-1 text-xs text-neutral-400">Fast-forward only · {project.preferred_remote ? `${project.preferred_remote}/${project.default_target_branch}` : "No preferred remote"}</p></div><div className="flex gap-2"><Button variant="secondary" disabled={busy || !project.preferred_remote} onClick={onPull}><RefreshCw className="size-4" />Pull</Button><Button variant="secondary" disabled={busy || !project.preferred_remote} onClick={onPush}><Upload className="size-4" />Push</Button></div></div></section>
    <section className="mt-8"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Workspaces</h2><p className="mt-1 text-xs text-neutral-400">Feature and fix development units with isolated worktrees.</p></div><Button disabled={busy} onClick={onCreate}><Plus className="size-4" />New Workspace</Button></div><div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{project.workspaces.map((workspace) => <button key={workspace.id} className="flex w-full items-center gap-3 p-4 text-left hover:bg-neutral-50" onClick={() => onOpen(workspace.id)}><Workflow className="size-4 text-neutral-400" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{workspace.name}</span><Badge variant={workspace.status === "active" ? "success" : "neutral"}>{workspace.delivery_status}</Badge></div><p className="mt-1 truncate font-mono text-[10px] text-neutral-400">{workspace.branch} → {workspace.target_branch}</p></div><ChevronRight className="size-4 text-neutral-300" /></button>)}{project.workspaces.length === 0 && <p className="px-4 py-10 text-center text-xs text-neutral-400">No Workspaces yet</p>}</div></section>
  </Page>;
}

function WorkspaceHome({ detail, busy, onShell, onCodex, onConfigure, onPull, onPush, onFinish, onOpenSession, onReveal }: { detail: WorkspaceDetail; busy: boolean; onShell: () => void; onCodex: () => void; onConfigure: () => void; onPull: () => void; onPush: () => void; onFinish: () => void; onOpenSession: (session: Session) => void; onReveal: () => void }) {
  const upstream = detail.remote_name && detail.remote_branch ? `${detail.remote_name}/${detail.remote_branch}` : "Not configured";
  return <Page><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-neutral-400">Workspace · development unit</p><h1 className="mt-2 text-2xl font-semibold">{detail.name}</h1><p className="mt-2 text-sm text-neutral-500">{detail.description || "No description"}</p></div>{detail.status === "active" && <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={onReveal}><FolderOpen className="size-4" />Finder</Button><Button variant="secondary" disabled={busy} onClick={onShell}><Shell className="size-4" />New Shell</Button><Button disabled={busy} onClick={onCodex}><Bot className="size-4" />New Codex</Button><Button variant="secondary" disabled={busy} onClick={onFinish}><GitMerge className="size-4" />Finish…</Button></div>}</div>
    <section className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Meta label="Local branch" value={detail.branch} mono /><Meta label="Fixed target" value={detail.target_branch} mono /><Meta label="Remote branch" value={upstream} mono /><Meta label="Delivery" value={`${detail.delivery_mode} · ${detail.delivery_status}`} /></section>
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Feature branch synchronization</h2><p className="mt-1 text-xs text-neutral-400">Pull is fast-forward only; Push never forces. The upstream can be changed explicitly.</p></div><div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={onConfigure}><Settings2 className="size-4" />Configure</Button><Button variant="secondary" disabled={busy || upstream === "Not configured"} onClick={onPull}><RefreshCw className="size-4" />Pull</Button><Button variant="secondary" disabled={busy || upstream === "Not configured"} onClick={onPush}><Upload className="size-4" />Push</Button></div></div></section>
    <section className="mt-8"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Sessions</h2><span className="text-xs text-neutral-400">{detail.sessions.length}</span></div><div className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{detail.sessions.map((session) => <button key={session.id} className="flex w-full items-center gap-3 p-4 text-left hover:bg-neutral-50" onClick={() => onOpenSession(session)}>{session.kind === "codex" ? <Bot className="size-4 text-neutral-400" /> : <TerminalSquare className="size-4 text-neutral-400" />}<span className="min-w-0 flex-1 truncate text-sm">{session.name}</span><StatusDot status={session.status} /><span className="text-[10px] text-neutral-400">{session.status}</span></button>)}{detail.sessions.length === 0 && <p className="px-4 py-8 text-center text-xs text-neutral-400">No Sessions</p>}</div></section>
    {detail.todos.length > 0 && <section className="mt-8"><h2 className="text-sm font-semibold">Todos</h2><div className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">{detail.todos.map((todo) => <div key={todo.id} className="flex items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1 truncate text-sm">{todo.title}</span><Badge>{todo.status}</Badge></div>)}</div></section>}
  </Page>;
}

function Overview({ projects, busy, onCreate, onOpen }: { projects: ProjectDetail[]; busy: boolean; onCreate: () => void; onOpen: (id: string) => void }) { return <Page><div className="flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-neutral-400">Treefold</p><h1 className="mt-2 text-2xl font-semibold">Projects</h1><p className="mt-2 text-sm text-neutral-500">Repositories and their isolated development workspaces.</p></div><Button disabled={busy} onClick={onCreate}><Plus className="size-4" />New Project</Button></div><div className="mt-8 grid gap-4 md:grid-cols-2">{projects.filter((project) => project.status === "active").map((project) => <button key={project.id} className="rounded-xl border border-neutral-200 bg-white p-5 text-left hover:border-neutral-300" onClick={() => onOpen(project.id)}><div className="flex items-center gap-2"><FolderGit2 className="size-4 text-neutral-400" /><h2 className="font-medium">{project.name}</h2></div><p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-500">{project.description || project.git_common_dir}</p><p className="mt-4 text-[10px] text-neutral-400">{project.workspaces.filter((workspace) => workspace.status === "active").length} active Workspaces · target {project.default_target_branch}</p></button>)}</div></Page>; }

function Page({ children }: { children: React.ReactNode }) { return <div className="h-full overflow-y-auto px-6 py-8 sm:px-10 lg:px-14"><div className="mx-auto max-w-6xl">{children}</div></div>; }
function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p><p className={cn("mt-2 break-all text-xs text-neutral-700", mono && "font-mono text-[10px]")} title={value}>{value || "—"}</p></div>; }
function Message({ tone, onClose, children }: { tone: "error" | "success"; onClose: () => void; children: React.ReactNode }) { return <div role={tone === "error" ? "alert" : "status"} className={cn("flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs", tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>{tone === "error" ? <CircleAlert className="size-4" /> : <CircleCheck className="size-4" />}<span className="flex-1">{children}</span><button onClick={onClose}><X className="size-4" /></button></div>; }
function CenteredMessage({ children }: { children: React.ReactNode }) { return <div className="grid h-full place-items-center text-sm text-neutral-400">{children}</div>; }
function StatusDot({ status }: { status: string }) { return <span className={cn("size-1.5 shrink-0 rounded-full", status === "running" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "starting" || status === "stopping" ? "bg-amber-500" : "bg-neutral-400")} />; }

function SessionWorkspace({ session, busy, onStop, onRestart, onExit }: { session: Session; busy: boolean; onStop: () => void; onRestart: () => void; onExit: () => void }) {
  const terminalState = ["exited", "failed", "closed", "evicted"].includes(session.status);
  return <div className="flex h-full min-h-0 flex-col bg-[#111315]"><div className="flex h-10 shrink-0 items-center border-b border-white/10 bg-[#191b1e] px-3"><div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-neutral-200">{session.kind === "codex" ? <Bot className="size-3.5" /> : <TerminalSquare className="size-3.5" />}<span className="truncate font-medium">{session.name}</span><StatusDot status={session.status} /><span className="text-[10px] text-neutral-500">{session.status}</span></div>{terminalState ? <Button size="sm" variant="secondary" disabled={busy} onClick={onRestart}><RotateCcw className="size-3" />{session.kind === "codex" ? "Resume" : "Restart"}</Button> : <Button size="sm" variant="ghost" className="text-neutral-300 hover:bg-white/10" disabled={busy} onClick={onStop}><Square className="size-3" />Stop</Button>}</div><WebTerminal key={session.id} session={session} onExit={onExit} /></div>;
}

function WebTerminal({ session, onExit }: { session: Session; onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null); const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    const terminal = new Terminal({ cursorBlink: true, fontFamily: '"SFMono-Regular", Menlo, monospace', fontSize: 13, lineHeight: 1.2, scrollback: 10000, theme: { background: "#111315", foreground: "#e5e7eb", cursor: "#f5f5f5" } });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.loadAddon(new WebLinksAddon()); terminal.open(host); try { terminal.loadAddon(new WebglAddon()); } catch { /* canvas fallback */ } fit.fit();
    let socket: WebSocket | null = null; let reconnectTimer = 0; let disposed = false;
    const connect = () => { if (disposed) return; socket = new WebSocket(`ws://127.0.0.1:7331/api/sessions/${session.id}/terminal?takeover=true`); socket.binaryType = "arraybuffer"; socket.onopen = () => { fit.fit(); socket?.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols })); terminal.focus(); }; socket.onmessage = (event) => { if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data)); else if (typeof event.data === "string") { try { const message = JSON.parse(event.data) as { type?: string; code?: string }; if (message.type === "exit") onExitRef.current(); if (message.type === "error") terminal.writeln(`\r\n\x1b[31m${message.code || "terminal error"}\x1b[0m`); } catch { terminal.write(event.data); } } }; socket.onclose = () => { if (!disposed && !["exited", "failed", "closed", "evicted"].includes(session.status)) reconnectTimer = window.setTimeout(connect, 1200); }; socket.onerror = () => socket?.close(); };
    const input = terminal.onData((data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data)); }); const observer = new ResizeObserver(() => { fit.fit(); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols })); }); observer.observe(host); connect();
    return () => { disposed = true; window.clearTimeout(reconnectTimer); observer.disconnect(); input.dispose(); socket?.close(); terminal.dispose(); };
  }, [session.id, session.status]);
  return <div ref={hostRef} className="min-h-0 flex-1 p-2" />;
}

function DirectoryPathField({ busy }: { busy: boolean }) {
  const [path, setPath] = useState("");
  return <div className="flex gap-2"><Input className="min-w-0 flex-1 font-mono text-xs" name="path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/absolute/path/to/repository" required /><Button type="button" variant="secondary" disabled={busy} onClick={async () => { const selected = await open({ directory: true, multiple: false }); if (typeof selected === "string") setPath(selected); }}><FolderOpen className="size-4" />Choose</Button></div>;
}
function CreateProjectDialog({ open: opened, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={opened} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">New Project</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Project 保存 Git 仓库元信息和默认交付策略，不承载开发 Session。</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><DirectoryPathField busy={busy} /><Input name="name" placeholder="Project name（默认目录名）" /><Textarea name="description" placeholder="Project description" /><div className="grid grid-cols-2 gap-3"><Input name="preferred_remote" placeholder="Preferred remote（自动）" /><Input name="default_target_branch" placeholder="Default target（当前分支）" /></div><Select name="default_delivery_mode" defaultValue="remote_review"><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge + optional push</option></Select><Textarea name="worktree_setup_command" className="font-mono text-xs" placeholder="Worktree setup command（optional）" /><div className="flex justify-end"><Button disabled={busy}>Create Project</Button></div></form></DialogContent></Dialog>; }

function CreateWorkspaceDialog({ project, busy, onOpenChange, onSubmit }: { project: ProjectDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">New Workspace</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">创建隔离 worktree 和 feature branch。target 在创建后固定。</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><Input name="name" placeholder="Feature or fix name" required /><Textarea name="description" placeholder="Scope and expected outcome" /><label className="block text-[11px] text-neutral-500">Target branch<Input className="mt-1 font-mono text-xs" name="target_branch" defaultValue={project?.default_target_branch} required /></label><label className="block text-[11px] text-neutral-500">Local branch<Input className="mt-1 font-mono text-xs" name="branch" placeholder="留空则生成 treefold/name-random" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-[11px] text-neutral-500">Remote<Input className="mt-1 font-mono text-xs" name="remote_name" defaultValue={project?.preferred_remote ?? ""} placeholder="origin" /></label><label className="block text-[11px] text-neutral-500">Remote feature branch<Input className="mt-1 font-mono text-xs" name="remote_branch" placeholder="feature/my-change（optional）" /></label></div><Select name="delivery_mode" defaultValue={project?.default_delivery_mode ?? "remote_review"}><option value="remote_review">Deliver through remote review / CR-CI</option><option value="local_merge">Merge into local target</option></Select><p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-500">不设置 remote branch 也可以本地开发，但 Workspace 的 Pull / Push 会保持禁用。</p><div className="flex justify-end"><Button disabled={busy}>Create Workspace</Button></div></form></DialogContent></Dialog>; }

function ConfigureWorkspaceDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: WorkspaceDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">Workspace delivery settings</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">Target branch 固定为 {workspace?.target_branch}；这里只修改 feature branch 的 upstream 与交付方式。</DialogDescription>{workspace && <form key={workspace.id} className="mt-6 space-y-3" onSubmit={onSubmit}><div className="grid grid-cols-2 gap-3"><label className="block text-[11px] text-neutral-500">Remote<Input className="mt-1 font-mono text-xs" name="remote_name" defaultValue={workspace.remote_name ?? ""} placeholder="origin" /></label><label className="block text-[11px] text-neutral-500">Remote feature branch<Input className="mt-1 font-mono text-xs" name="remote_branch" defaultValue={workspace.remote_branch ?? ""} placeholder="feature/my-change" /></label></div><Select name="delivery_mode" defaultValue={workspace.delivery_mode}><option value="remote_review">Remote review / CR-CI</option><option value="local_merge">Local merge + optional push</option></Select><p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">两项都留空会清除 upstream。Treefold 不会替你 force push。</p><div className="flex justify-end"><Button disabled={busy}>Save</Button></div></form>}</DialogContent></Dialog>; }

function CreateCodexDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: WorkspaceDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="flex items-center gap-2 text-lg font-semibold"><Bot className="size-5" />New Codex Session</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">在 Workspace {workspace?.name} 的受管理 worktree 中启动 Codex。</DialogDescription><form className="mt-6 space-y-3" onSubmit={onSubmit}><Input name="name" placeholder="Session name" /><Textarea name="initial_prompt" placeholder="What should Codex work on?" /><label className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/60 p-4"><input className="mt-0.5" type="checkbox" name="yolo" /><span><span className="block text-sm font-medium text-red-800">YOLO mode</span><span className="mt-1 block text-xs text-red-600">Skip approvals and sandbox for this Workspace Session.</span></span></label><div className="flex justify-end"><Button disabled={busy}>Start Codex</Button></div></form></DialogContent></Dialog>; }

type FinishPayload = { code_action: string; todo_action: string; push_after_merge: boolean; keep_session_history: boolean; delete_worktree: boolean; delete_branch: boolean; commit_message?: string; preflight_id?: string };
function FinishWorkspaceDialog({ workspace, busy, onOpenChange, onSubmit }: { workspace: WorkspaceDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (payload: FinishPayload) => void }) {
  const [codeAction, setCodeAction] = useState("remote_merged"); const [todoAction, setTodoAction] = useState("keep"); const [pushAfterMerge, setPushAfterMerge] = useState(false); const [keepSessions, setKeepSessions] = useState(true); const [deleteWorktree, setDeleteWorktree] = useState(true); const [deleteBranch, setDeleteBranch] = useState(true); const [commitMessage, setCommitMessage] = useState(""); const [preflight, setPreflight] = useState<DeliveryPreflight | null>(null); const [preflightError, setPreflightError] = useState(""); const [checking, setChecking] = useState(false);
  useEffect(() => { if (!workspace) return; setCodeAction(workspace.delivery_mode === "local_merge" ? "local_merge" : "remote_merged"); setTodoAction("keep"); setPushAfterMerge(false); setKeepSessions(true); setDeleteWorktree(true); setDeleteBranch(true); setCommitMessage(""); }, [workspace?.id, workspace?.delivery_mode]);
  useEffect(() => { if (!workspace) return; let cancelled = false; setChecking(true); setPreflight(null); setPreflightError(""); void api<DeliveryPreflight>(`/api/workspaces/${workspace.id}/delivery-preflight`, { method: "POST", body: JSON.stringify({ code_action: codeAction }) }).then((value) => { if (!cancelled) setPreflight(value); }).catch((cause) => { if (!cancelled) setPreflightError(cause instanceof Error ? cause.message : "Preflight failed"); }).finally(() => { if (!cancelled) setChecking(false); }); return () => { cancelled = true; }; }, [workspace?.id, codeAction]);
  useEffect(() => { if (codeAction === "keep") { setDeleteWorktree(false); setDeleteBranch(false); } else if (codeAction === "discard") { setDeleteWorktree(true); setDeleteBranch(true); } }, [codeAction]);
  const blocked = !preflight || preflight.blockers.length > 0;
  return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[86vh] flex-col overflow-hidden"><DialogTitle className="text-lg font-semibold">Finish Workspace</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">把 {workspace?.name} 交付到固定 target {workspace?.target_branch}，或保留 / 丢弃当前工作。</DialogDescription><div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"><section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Delivery preflight</h3><Badge variant={preflight && !preflight.blockers.length ? "success" : "neutral"}>{checking ? "checking" : blocked ? "blocked" : "ready"}</Badge></div>{preflight && <div className="mt-3 text-[11px]"><p>{preflight.ahead} ahead · {preflight.behind} behind · {preflight.changed_files.length} files</p>{preflight.warnings.map((warning) => <p key={warning} className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-700">{warning}</p>)}{preflight.blockers.map((item) => <p key={item} className="mt-2 rounded-lg bg-red-50 p-2 text-red-700">{item}</p>)}</div>}{preflightError && <p className="mt-2 text-[11px] text-red-700">{preflightError}</p>}</section><fieldset className="rounded-xl border border-neutral-200 p-4"><legend className="px-1 text-xs font-semibold">Code delivery</legend><Select value={codeAction} onChange={(event) => setCodeAction(event.target.value)}><option value="remote_merged">Already merged through remote review / CI</option><option value="local_merge">Merge into local target branch</option><option value="keep">Preserve Workspace and branch</option><option value="discard">Discard Workspace code</option></Select>{codeAction === "local_merge" && <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={pushAfterMerge} onChange={(event) => setPushAfterMerge(event.target.checked)} />Push target branch after local merge</label>}<Input className="mt-3" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Final commit message（required if dirty）" /></fieldset><fieldset className="rounded-xl border border-neutral-200 p-4"><legend className="px-1 text-xs font-semibold">Records and cleanup</legend><label className="block text-[11px] text-neutral-500">Todos<Select className="mt-1" value={todoAction} onChange={(event) => setTodoAction(event.target.value)}><option value="keep">Keep in archived Workspace</option><option value="discard">Discard</option></Select></label><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={keepSessions} onChange={(event) => setKeepSessions(event.target.checked)} />Keep Session history</label><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={deleteWorktree} disabled={codeAction === "keep" || codeAction === "discard"} onChange={(event) => setDeleteWorktree(event.target.checked)} />Remove managed worktree</label><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={deleteBranch} disabled={codeAction === "keep" || codeAction === "discard" || !deleteWorktree} onChange={(event) => setDeleteBranch(event.target.checked)} />Delete delivered local branch</label></fieldset>{codeAction === "discard" && <p className="rounded-lg bg-red-50 p-3 text-[11px] text-red-700">Discard 会删除 worktree 和本地 branch；请先确认无需保留代码。</p>}</div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || checking || blocked} onClick={() => onSubmit({ code_action: codeAction, todo_action: todoAction, push_after_merge: codeAction === "local_merge" && pushAfterMerge, keep_session_history: keepSessions, delete_worktree: codeAction === "discard" || deleteWorktree, delete_branch: codeAction === "discard" || deleteBranch, commit_message: commitMessage || undefined, preflight_id: preflight?.id })}>{busy ? "Finishing…" : "Finish Workspace"}</Button></div></DialogContent></Dialog>;
}

function SettingsDialog({ open: opened, settings, system, busy, onOpenChange, onSave }: { open: boolean; settings: AppSettings | null; system: SystemStatus | null; busy: boolean; onOpenChange: (open: boolean) => void; onSave: (value: { language: string; extra_args: string[] }) => void }) {
  const [language, setLanguage] = useState("system");
  const [argumentsText, setArgumentsText] = useState("");
  useEffect(() => {
    if (!opened || !settings) return;
    setLanguage(settings.language);
    setArgumentsText(settings.agents.codex.extra_args.join("\n"));
  }, [opened, settings]);
  return <Dialog open={opened} onOpenChange={onOpenChange}><DialogContent><DialogTitle className="text-lg font-semibold">Settings</DialogTitle><DialogDescription className="mt-1 text-sm text-neutral-500">User preferences stay in settings.toml; Project and Workspace records stay in SQLite.</DialogDescription><div className="mt-6 space-y-4"><div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs"><p>Codex · {system?.codex_available ? system.codex_version : "unavailable"}</p><p className="mt-2 break-all text-neutral-500">Worktree root · {settings?.worktree_root ?? "—"}</p></div><label className="block text-xs text-neutral-600">Language<Select className="mt-1" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="system">System</option><option value="en-US">English</option><option value="zh-CN">简体中文</option></Select></label><label className="block text-xs text-neutral-600">Codex arguments (one per line)<Textarea className="mt-1 min-h-32 font-mono text-xs" value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} placeholder="--model\ngpt-5.4" /></label><div className="flex justify-end"><Button disabled={busy} onClick={() => onSave({ language, extra_args: argumentsText.split("\n").map((value) => value.trim()).filter(Boolean) })}>{busy ? "Saving…" : "Save"}</Button></div></div></DialogContent></Dialog>;
}

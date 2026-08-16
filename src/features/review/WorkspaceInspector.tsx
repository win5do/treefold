import { useEffect, useState } from "react";
import type * as React from "react";
import { Bot, GitBranch, Info, PanelsTopLeft, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { GitHistory, ProjectDetail, Session, WorkspaceDetail } from "@/domain/types";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";

export function WorkspaceInspector({ open, project, workspace, session }: { open: boolean; project: ProjectDetail; workspace: WorkspaceDetail | null; session: Session | null }) {
  const [tab, setTab] = useState<"info" | "history">("info");
  const [history, setHistory] = useState<GitHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  const historyRepositories = workspace
    ? workspace.repositories
        .filter((repository) => repository.git_status === "ready")
        .map((repository) => ({ id: repository.id, name: repository.location_name }))
    : project.repositories
        .filter((repository) => repository.git_status === "ready")
        .map((repository) => ({ id: repository.id, name: repository.name }));
  const primaryRepositoryId = workspace
    ? workspace.workspace_directories.find(
        (directory) => directory.project_directory_id === workspace.project_directory_id,
      )?.workspace_repository_id
    : project.directories.find(
        (directory) => directory.id === project.primary_directory_id,
      )?.repository_id;
  const defaultHistoryRepositoryId = historyRepositories.some(
    (repository) => repository.id === primaryRepositoryId,
  )
    ? primaryRepositoryId ?? ""
    : historyRepositories[0]?.id ?? "";
  const [historyRepositoryId, setHistoryRepositoryId] = useState("");
  const activeHistoryRepositoryId = historyRepositories.some(
    (repository) => repository.id === historyRepositoryId,
  )
    ? historyRepositoryId
    : defaultHistoryRepositoryId;

  useEffect(() => {
    setHistoryRepositoryId(defaultHistoryRepositoryId);
  }, [defaultHistoryRepositoryId, project.id, workspace?.id]);

  useEffect(() => {
    if (!open || tab !== "history") return;
    const controller = new AbortController();
    setHistory(null);
    setHistoryError("");
    if (!activeHistoryRepositoryId) return () => controller.abort();
    const load = workspace
      ? workspacesApi.locationHistory(activeHistoryRepositoryId, controller.signal)
      : projectsApi.history(activeHistoryRepositoryId, controller.signal);
    void load.then((value) => {
      if (!controller.signal.aborted) setHistory(value);
    }).catch((cause) => {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : "Git history could not be loaded");
    });
    return () => controller.abort();
  }, [activeHistoryRepositoryId, open, tab, workspace?.id]);

  return <aside data-testid="right-sidebar" aria-hidden={!open} inert={!open} className={cn("absolute inset-y-0 right-0 z-20 flex w-[min(88vw,340px)] shrink-0 flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out lg:shadow-none", open ? "translate-x-0" : "translate-x-full pointer-events-none")}>
    <div className="flex h-11 shrink-0 items-stretch border-b border-border">
      <div className="flex min-w-0 flex-1" role="tablist" aria-label="Sidebar sections">
        <button role="tab" aria-selected={tab === "info"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium", tab === "info" ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab("info")}><Info className="size-3.5" />Info{tab === "info" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground" />}</button>
        <button role="tab" aria-selected={tab === "history"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-xs font-medium", tab === "history" ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab("history")}><GitBranch className="size-3.5" />History{tab === "history" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground" />}</button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
    {tab === "history" ? <GitHistoryPanel repositories={historyRepositories} repositoryId={activeHistoryRepositoryId} onRepositoryChange={setHistoryRepositoryId} history={history} error={historyError} /> : session ? <div className="flex flex-col gap-6 p-4">
      <div><div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-lg bg-muted">{session.kind === "codex" ? <Bot className="size-4" /> : session.kind === "command" ? <PanelsTopLeft className="size-4" /> : <TerminalSquare className="size-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.name}</p><div className="mt-1 flex items-center gap-2"><Badge>{session.kind}</Badge><Badge variant={session.status === "running" ? "success" : session.status === "failed" ? "destructive" : "secondary"}>{session.status}</Badge></div></div></div></div>
      <InspectorGroup title="Process"><InspectorRow label="Workspace" value={session.amux_workspace_name} mono /><InspectorRow label="Name" value={session.amux_process_name} mono /><InspectorRow label="I/O" value={session.io_mode} /><InspectorRow label="Exit" value={session.exit_code === undefined ? "—" : `${session.exit_code}${session.exit_signal ? ` · ${session.exit_signal}` : ""}`} /></InspectorGroup>
      <InspectorGroup title={workspace ? "Workspace" : "Project Session"}>{workspace && <><InspectorRow label="Workspace" value={workspace.name} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Workspace ID" value={workspace.runtime_id} mono /></>}<InspectorRow label="Workdir" value={session.cwd} mono />{session.original_cwd !== session.cwd && <InspectorRow label="Original" value={session.original_cwd} mono />}</InspectorGroup>
      {session.kind === "codex" && <InspectorGroup title="Codex"><InspectorRow label="Session ID" value={session.codex_session_id || "Capturing…"} mono />{session.initial_prompt && <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-foreground">{session.initial_prompt}</div>}</InspectorGroup>}
      <InspectorGroup title="Command"><code className="block break-all rounded-lg bg-neutral-950 p-3 text-[10px] leading-5 text-neutral-300">{session.argv.join(" ") || "—"}</code></InspectorGroup>
    </div> : workspace ? <div className="flex flex-col gap-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={workspace.name}>{workspace.name}</p><div className="mt-2 flex gap-2"><Badge>{workspace.kind}</Badge><Badge variant={workspace.status === "active" ? "success" : "secondary"}>{workspace.status}</Badge></div></div>
      <InspectorGroup title="Git"><InspectorRow label="Branch" value={workspace.branch || "—"} mono /><InspectorRow label="Start" value={workspace.start_commit || "—"} mono /><InspectorRow label="Target" value={workspace.target_branch || "—"} mono /><InspectorRow label="Delivery" value={workspace.delivery_status} /></InspectorGroup>
      <InspectorGroup title="Workspace"><InspectorRow label="Mode" value={workspace.checkout_mode} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Path" value={workspace.checkout_path} mono /></InspectorGroup>
      <InspectorGroup title="Records"><InspectorRow label="Sessions" value={String(workspace.sessions.length)} /><InspectorRow label="Todos" value={String(workspace.todos.length)} />{workspace.kind === "workspace" && <InspectorRow label="Forks" value={String(workspace.forks.length)} />}</InspectorGroup>
    </div> : <div className="flex flex-col gap-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={project.name}>{project.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{project.description || "No project description."}</p></div>
      <InspectorGroup title="Repository"><InspectorRow label="Target" value={project.default_target_branch || "—"} mono /><InspectorRow label="Remote" value={project.preferred_remote || "—"} /><InspectorRow label="Directories" value={String(project.directories.length)} /><InspectorRow label="Workspaces" value={String(project.workspaces.filter((item) => !item.parent_workspace_id).length)} /></InspectorGroup>
    </div>}
    </div>
  </aside>;
}

function GitHistoryPanel({ repositories, repositoryId, onRepositoryChange, history, error }: { repositories: { id: string; name: string }[]; repositoryId: string; onRepositoryChange: (id: string) => void; history: GitHistory | null; error: string }) {
  return <div>
    <div className="flex flex-col gap-2 border-b border-border/60 p-3">
      <NativeSelect aria-label="Git history repository" data-testid="git-history-repository" className="w-full" value={repositoryId} disabled={repositories.length <= 1} onChange={(event) => onRepositoryChange(event.target.value)}>
        {repositories.length === 0 ? <NativeSelectOption value="">No Git repositories</NativeSelectOption> : repositories.map((repository) => <NativeSelectOption key={repository.id} value={repository.id}>{repository.name}</NativeSelectOption>)}
      </NativeSelect>
      {history && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono" title={history.branch}>{history.branch}</span><span>{history.commits.length} commits</span></div>}
    </div>
    {error ? <div className="p-4"><div className="rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div></div> : repositories.length === 0 ? <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">No Git repositories are available.</div> : !history ? <div className="grid h-32 place-items-center text-xs text-muted-foreground">Loading Git history…</div> : history.commits.length === 0 ? <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">No commits found for this repository.</div> : <div className="divide-y divide-border/60">{history.commits.map((commit) => <article key={commit.hash} data-testid="git-history-commit" className="px-4 py-3.5">
      <p className="break-words text-sm font-medium leading-5 text-foreground">{commit.subject}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[9px] font-semibold uppercase text-primary-foreground">{commit.author.trim().charAt(0) || "?"}</span>
        <span className="min-w-0 truncate" title={commit.author}>{commit.author}</span><span>·</span><time dateTime={commit.authored_at}>{formatExactGitTime(commit.authored_at)}</time><span>·</span><code className="text-[10px]">{commit.short_hash}</code>
      </div>
    </article>)}</div>}
  </div>;
}

function formatExactGitTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const two = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3><div className="flex flex-col gap-2">{children}</div></section>; }
function InspectorRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 text-xs"><span className="text-muted-foreground">{label}</span><span className={cn("min-w-0 break-all text-foreground", mono && "font-mono text-[10px]")}>{value}</span></div>; }

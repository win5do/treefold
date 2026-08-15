import { useEffect, useState } from "react";
import type * as React from "react";
import { Bot, GitBranch, Info, TerminalSquare, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GitHistory, GitOperationRecord, ProjectDetail, Session, WorkspaceDetail } from "@/domain/types";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";

export function WorkspaceInspector({ open, project, workspace, session }: { open: boolean; project: ProjectDetail; workspace: WorkspaceDetail | null; session: Session | null }) {
  const [tab, setTab] = useState<"info" | "history" | "operations">("info");
  const [history, setHistory] = useState<GitHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [operations, setOperations] = useState<GitOperationRecord[] | null>(null);
  const [operationsError, setOperationsError] = useState("");
  useEffect(() => {
    if (!open || tab !== "history") return;
    const controller = new AbortController();
    setHistory(null);
    setHistoryError("");
    const load = workspace ? workspacesApi.history(workspace.id, controller.signal) : projectsApi.history(project.id, controller.signal);
    void load.then((value) => {
      if (!controller.signal.aborted) setHistory(value);
    }).catch((cause) => {
      if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : "Git history could not be loaded");
    });
    return () => controller.abort();
  }, [open, project.id, tab, workspace?.id]);

  useEffect(() => {
    if (!open || tab !== "operations" || !workspace) return;
    const controller = new AbortController();
    setOperations(null); setOperationsError("");
    void workspacesApi.operations(workspace.id, controller.signal).then((value) => {
      if (!controller.signal.aborted) setOperations(value);
    }).catch((cause) => {
      if (!controller.signal.aborted) setOperationsError(cause instanceof Error ? cause.message : "Git operations could not be loaded");
    });
    return () => controller.abort();
  }, [open, tab, workspace?.id]);

  useEffect(() => {
    if (!workspace && tab === "operations") setTab("info");
  }, [tab, workspace]);

  return <aside data-testid="right-sidebar" aria-hidden={!open} inert={!open} className={cn("absolute inset-y-0 right-0 z-20 flex w-[min(88vw,340px)] shrink-0 flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out lg:shadow-none", open ? "translate-x-0" : "translate-x-full pointer-events-none")}>
    <div className="flex h-11 shrink-0 items-stretch border-b border-border">
      <div className="flex min-w-0 flex-1" role="tablist" aria-label="Sidebar sections">
        <button role="tab" aria-selected={tab === "info"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium", tab === "info" ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab("info")}><Info className="size-3.5" />Info{tab === "info" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground" />}</button>
        <button role="tab" aria-selected={tab === "history"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-xs font-medium", tab === "history" ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab("history")}><GitBranch className="size-3.5" />History{tab === "history" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground" />}</button>
        {workspace && <button role="tab" aria-selected={tab === "operations"} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-xs font-medium", tab === "operations" ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab("operations")}><Workflow className="size-3.5" />Operations{tab === "operations" && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground" />}</button>}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
    {tab === "history" ? <GitHistoryPanel history={history} error={historyError} /> : tab === "operations" ? <GitOperationsPanel operations={operations} error={operationsError} /> : session ? <div className="flex flex-col gap-6 p-4">
      <div><div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-lg bg-muted">{session.kind === "codex" ? <Bot className="size-4" /> : <TerminalSquare className="size-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.name}</p><div className="mt-1 flex items-center gap-2"><Badge>{session.kind}</Badge><Badge variant={session.status === "running" ? "success" : session.status === "failed" ? "destructive" : "secondary"}>{session.status}</Badge></div></div></div></div>
      <InspectorGroup title="Process"><InspectorRow label="Name" value={session.process_name} /><InspectorRow label="Process ID" value={session.process_id} mono /><InspectorRow label="PID" value={session.pid ? String(session.pid) : "—"} /><InspectorRow label="PGID" value={session.process_group_id ? String(session.process_group_id) : "—"} /><InspectorRow label="Exit" value={session.exit_code === undefined ? "—" : `${session.exit_code}${session.exit_signal ? ` · ${session.exit_signal}` : ""}`} /></InspectorGroup>
      <InspectorGroup title={workspace ? "Workspace" : "Project Session"}>{workspace && <><InspectorRow label="Workspace" value={workspace.name} /><InspectorRow label="Runtime" value={workspace.runtime_name} /><InspectorRow label="Workspace ID" value={workspace.runtime_id} mono /></>}<InspectorRow label="Workdir" value={session.cwd} mono />{session.original_cwd !== session.cwd && <InspectorRow label="Original" value={session.original_cwd} mono />}</InspectorGroup>
      {session.kind === "codex" && <InspectorGroup title="Codex"><InspectorRow label="Session ID" value={session.codex_session_id || "Capturing…"} mono />{session.initial_prompt && <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-foreground">{session.initial_prompt}</div>}</InspectorGroup>}
      <InspectorGroup title="Command"><code className="block break-all rounded-lg bg-neutral-950 p-3 text-[10px] leading-5 text-neutral-300">{session.command?.join(" ") || "—"}</code></InspectorGroup>
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

function GitHistoryPanel({ history, error }: { history: GitHistory | null; error: string }) {
  if (error) return <div className="p-4"><div className="rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div></div>;
  if (!history) return <div className="grid h-32 place-items-center text-xs text-muted-foreground">Loading Git history…</div>;
  if (history.commits.length === 0) return <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">No commits found for this workspace.</div>;
  return <div>
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-[10px] text-muted-foreground"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono" title={history.branch}>{history.branch}</span><span>{history.commits.length} commits</span></div>
    <div className="divide-y divide-border/60">{history.commits.map((commit) => <article key={commit.hash} data-testid="git-history-commit" className="px-4 py-3.5">
      <p className="break-words text-sm font-medium leading-5 text-foreground">{commit.subject}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[9px] font-semibold uppercase text-primary-foreground">{commit.author.trim().charAt(0) || "?"}</span>
        <span className="min-w-0 truncate" title={commit.author}>{commit.author}</span><span>·</span><time dateTime={commit.authored_at}>{formatExactGitTime(commit.authored_at)}</time><span>·</span><code className="text-[10px]">{commit.short_hash}</code>
      </div>
    </article>)}</div>
  </div>;
}

function GitOperationsPanel({ operations, error }: { operations: GitOperationRecord[] | null; error: string }) {
  if (error) return <div className="p-4"><div className="rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div></div>;
  if (!operations) return <div className="grid h-32 place-items-center text-xs text-muted-foreground">Loading Git operations…</div>;
  if (operations.length === 0) return <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">No managed Git operations yet.</div>;
  return <div className="divide-y divide-border/60">{operations.map((operation) => <article key={operation.id} data-testid="git-operation-record" className="flex flex-col gap-2 px-4 py-3.5">
    <div className="flex items-center gap-2"><Badge>{operation.kind}</Badge><span className="min-w-0 flex-1 truncate text-xs font-medium">{operation.action.replaceAll("_", " ")}</span><Badge variant={operation.status === "completed" || operation.status === "restored" ? "success" : operation.status === "failed" || operation.status === "conflicted" ? "destructive" : "secondary"}>{operation.status}</Badge></div>
    <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[9px] text-muted-foreground"><span>before</span><span className="truncate" title={operation.before_head}>{operation.before_head || "—"}</span><span>target</span><span className="truncate" title={operation.target_head}>{operation.target_head || "—"}</span>{operation.recovery_ref && <><span>recovery</span><span className="truncate" title={operation.recovery_ref}>{operation.recovery_ref}</span></>}</div>
    {operation.error && <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-[10px] leading-4 text-destructive">{operation.error}</p>}
    <time className="block text-[10px] text-muted-foreground" dateTime={operation.started_at}>{formatExactGitTime(operation.started_at)}</time>
  </article>)}</div>;
}

function formatExactGitTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const two = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3><div className="flex flex-col gap-2">{children}</div></section>; }
function InspectorRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 text-xs"><span className="text-muted-foreground">{label}</span><span className={cn("min-w-0 break-all text-foreground", mono && "font-mono text-[10px]")}>{value}</span></div>; }

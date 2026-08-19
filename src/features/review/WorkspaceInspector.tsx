import { useEffect, useState } from "react";
import type * as React from "react";
import { Bot, Check, Copy, GitBranch, GitCommitHorizontal, GitCompare, History, Info, PanelsTopLeft, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GitDiffLaunchPayload, GitHistory, GitStatus, ProjectDetail, Session, WorkspaceDetail } from "@/domain/types";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

type InspectorRepository = { id: string; name: string };

export function WorkspaceInspector({ open, project, workspace, session, gitChangesActive, onOpenChanges, onOpenDiff }: { open: boolean; project: ProjectDetail; workspace: WorkspaceDetail | null; session: Session | null; gitChangesActive: boolean; onOpenChanges: (repository: InspectorRepository) => void; onOpenDiff: (payload: GitDiffLaunchPayload) => void }) {
  const [tab, setTab] = useState<"info" | "changes" | "history">("changes");
  const [history, setHistory] = useState<GitHistory | null>(null);
  const [historyError, setHistoryError] = useState("");
  useEffect(() => { if (open) setTab("changes"); }, [open]);
  useEffect(() => { if (gitChangesActive) setTab("changes"); }, [gitChangesActive]);
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
    <div className="shrink-0 border-b border-border p-2">
      <NativeSelect aria-label="Git repository" data-testid="git-repository" value={activeHistoryRepositoryId} disabled={historyRepositories.length <= 1} onChange={(event) => setHistoryRepositoryId(event.target.value)}>
        {historyRepositories.length === 0 ? <NativeSelectOption value="">No Git repositories</NativeSelectOption> : historyRepositories.map((repository) => <NativeSelectOption key={repository.id} value={repository.id}>{repository.name}</NativeSelectOption>)}
      </NativeSelect>
    </div>
    <div className="flex h-11 shrink-0 items-stretch border-b border-border">
      <div className="flex min-w-0 flex-1" role="tablist" aria-label="Sidebar sections">
        {([ ["changes", GitCommitHorizontal, "Changes"], ["history", History, "Git History"], ["info", Info, "Repository Info"] ] as const).map(([value, Icon, label]) => <Tooltip key={value}><TooltipTrigger render={<button role="tab" aria-label={label} aria-selected={tab === value} className={cn("relative flex flex-1 items-center justify-center text-muted-foreground hover:text-foreground", tab === value && "text-foreground")} onClick={() => setTab(value)} />}><Icon />{tab === value && <span className="absolute inset-x-4 bottom-0 h-0.5 bg-foreground" />}</TooltipTrigger><TooltipContent side="bottom">{label}</TooltipContent></Tooltip>)}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
    {tab === "changes" ? <GitCommitPanel repositoryKind={workspace ? "workspace" : "project"} repositories={historyRepositories} repositoryId={activeHistoryRepositoryId} onOpenChanges={onOpenChanges} /> : tab === "history" ? <GitHistoryPanel repositoryKind={workspace ? "workspace" : "project"} repositories={historyRepositories} repositoryId={activeHistoryRepositoryId} history={history} error={historyError} onOpenDiff={onOpenDiff} /> : session ? <div className="flex flex-col gap-6 p-4">
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

function GitCommitPanel({ repositoryKind, repositories, repositoryId, onOpenChanges }: { repositoryKind: "project" | "workspace"; repositories: InspectorRepository[]; repositoryId: string; onOpenChanges: (repository: InspectorRepository) => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const api = repositoryKind === "project" ? projectsApi : workspacesApi;
  const load = async (signal?: AbortSignal) => {
    if (!repositoryId) return;
    const next = await api.gitStatus(repositoryId, signal);
    setStatus(next);
  };
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setError("");
    void load(controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Git changes could not be loaded"); });
    return () => controller.abort();
  }, [repositoryId, repositoryKind]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repositoryId: string; status: GitStatus }>).detail;
      if (detail?.repositoryId === repositoryId) setStatus(detail.status);
    };
    window.addEventListener("treefold:git-status-changed", refresh);
    return () => window.removeEventListener("treefold:git-status-changed", refresh);
  }, [repositoryId]);
  const commit = async () => {
    if (!status || !message.trim() || status.staged_count === 0 || loading) return;
    setLoading(true); setError("");
    try {
      const result = await api.commit(repositoryId, message.trim(), status.snapshot);
      setStatus(result.status); setMessage(""); window.dispatchEvent(new CustomEvent("treefold:git-status-changed", { detail: { repositoryId, status: result.status } })); toast.success(`Committed ${result.hash.slice(0, 10)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Commit failed"); }
    finally { setLoading(false); }
  };
  const repository = repositories.find((item) => item.id === repositoryId);
  const additions = status?.files.reduce((total, file) => total + file.additions, 0) ?? 0;
  const deletions = status?.files.reduce((total, file) => total + file.deletions, 0) ?? 0;
  return <div className="flex min-h-full flex-col gap-3 p-3">
    {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
    {!status ? <p className="py-8 text-center text-xs text-muted-foreground">Loading changes...</p> : status.files.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No changes</p> : <>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono">{status.branch}</span></div>
      <div className="flex flex-col gap-2">
        <div data-testid="git-change-summary" className="flex items-center gap-2 text-xs leading-none"><span className="text-muted-foreground">{status.files.length} files</span><span className="font-mono tabular-nums text-success">+{additions}</span><span className="font-mono tabular-nums text-destructive">−{deletions}</span>{status.staged_count > 0 && <><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{status.staged_count} staged</span></>}</div>
        {repository && <Button className="w-full" size="sm" variant="outline" onClick={() => onOpenChanges(repository)}><GitCompare data-icon="inline-start" />Review Changes</Button>}
      </div>
      <Textarea aria-label="Commit message" placeholder="Commit message" value={message} disabled={loading} onChange={(event) => setMessage(event.target.value)} />
      <Button className="w-full" disabled={loading || !message.trim() || !status.staged_count} onClick={() => void commit()}><Check data-icon="inline-start" />Commit {status.staged_count || ""}</Button>
    </>}
  </div>;
}

function GitHistoryPanel({ repositoryKind, repositories, repositoryId, history, error, onOpenDiff }: { repositoryKind: "project" | "workspace"; repositories: { id: string; name: string }[]; repositoryId: string; history: GitHistory | null; error: string; onOpenDiff: (payload: GitDiffLaunchPayload) => void }) {
  const [selection, setSelection] = useState<{ anchor: number; first: number; last: number } | null>(null);
  useEffect(() => setSelection(null), [history, repositoryId]);
  const selectCommit = (index: number, extend: boolean) => {
    setSelection((current) => {
      if (!extend || !current) return { anchor: index, first: index, last: index };
      return { anchor: current.anchor, first: Math.min(current.anchor, index), last: Math.max(current.anchor, index) };
    });
  };
  const viewDiff = () => {
    if (!history || !selection) return;
    const repository = repositories.find((item) => item.id === repositoryId);
    if (!repository) return;
    const newest = history.commits[selection.first];
    const oldest = history.commits[selection.last];
    if (!newest || !oldest) return;
    onOpenDiff({
      repositoryKind,
      repositoryId,
      repositoryName: repository.name,
      startCommit: oldest.hash,
      endCommit: newest.hash,
      commitCount: selection.last - selection.first + 1,
    });
  };
  const copyCommit = (hash: string) => {
    void navigator.clipboard.writeText(hash).then(() => {
      toast.success("Commit copied");
    }).catch((cause) => {
      console.error("Could not copy Git commit", cause);
      toast.error("Could not copy commit");
    });
  };
  return <div>
    <div className="flex flex-col gap-2 border-b border-border/60 p-3">
      {history && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono" title={history.branch}>{history.branch}</span><span>{history.commits.length} commits</span></div>}
    </div>
    {error ? <div className="p-4"><div className="rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div></div> : repositories.length === 0 ? <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">No Git repositories are available.</div> : !history ? <div className="grid h-32 place-items-center text-xs text-muted-foreground">Loading Git history…</div> : history.commits.length === 0 ? <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">No commits found for this repository.</div> : <div className="divide-y divide-border/60">{history.commits.map((commit, index) => {
      const selected = Boolean(selection && index >= selection.first && index <= selection.last);
      const rangeStart = selected && index === selection?.first;
      const rangeEnd = selected && index === selection?.last;
      return <ContextMenu key={commit.hash}>
        <ContextMenuTrigger className="contents">
          <article
            data-testid="git-history-commit"
            data-range-start={rangeStart || undefined}
            data-range-end={rangeEnd || undefined}
            aria-selected={selected}
            tabIndex={0}
            className={cn("cursor-default px-4 py-3.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", selected && "bg-accent text-accent-foreground", rangeStart && "rounded-t-md", rangeEnd && "rounded-b-md")}
            onClick={(event) => selectCommit(index, event.shiftKey)}
            onContextMenu={() => {
              if (!selected) selectCommit(index, false);
            }}
          >
      <p className="break-words text-sm font-medium leading-5 text-foreground">{commit.subject}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[9px] font-semibold uppercase text-primary-foreground">{commit.author.trim().charAt(0) || "?"}</span>
        <span className="min-w-0 truncate" title={commit.author}>{commit.author}</span><span>·</span><time dateTime={commit.authored_at}>{formatExactGitTime(commit.authored_at)}</time><span>·</span><code className="text-[10px]">{commit.short_hash}</code>
      </div>
          </article>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem data-testid="copy-git-commit-action" onClick={() => copyCommit(commit.hash)}>
              <Copy data-icon="inline-start" />
              Copy Commit
            </ContextMenuItem>
            <ContextMenuItem data-testid="view-git-diff-action" onClick={viewDiff}>
              <GitCompare data-icon="inline-start" />
              View Diff
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>;
    })}</div>}
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

import { AGENT_NAMES, isAgentKind } from "@/features/agents/model";
import { gitStatusQuery, refreshGitQueries } from "@/features/git/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gitHistoryQuery } from "./queries";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import type * as React from "react";
import { Bot, Check, Copy, Combine, GitBranch, GitCommitHorizontal, GitCompare, History, Info, PanelsTopLeft, RotateCcw, TerminalSquare, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import type { GitCommit, GitDiffLaunchPayload, GitHistory, GitStatus, ProjectDetail, Session, WorkspaceDetail } from "@/domain/types";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

import { HistorySquashDialog } from "./HistorySquashDialog";

type InspectorRepository = { id: string; name: string };

export function WorkspaceInspector({ open, project, workspace, session, gitChangesActive, onOpenChanges, onOpenDiff }: { open: boolean; project: ProjectDetail; workspace: WorkspaceDetail | null; session: Session | null; gitChangesActive: boolean; onOpenChanges: (repository: InspectorRepository) => void; onOpenDiff: (payload: GitDiffLaunchPayload) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"info" | "changes" | "history">("changes");
  const queryClient = useQueryClient();
  useEffect(() => { if (open) setTab("changes"); }, [open]);
  useEffect(() => { if (gitChangesActive) setTab("changes"); }, [gitChangesActive]);
  const historyRepositories = workspace
    ? workspace.repositories
        .filter((repository) => repository.git_status === "ready")
        .map((repository) => ({ id: repository.id, name: repository.repository_name }))
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

  const historyOptions = gitHistoryQuery(workspace ? "workspace" : "project", activeHistoryRepositoryId);
  const historyQuery = useQuery({ ...historyOptions, enabled: open && tab === "history" && Boolean(activeHistoryRepositoryId) });
  const history = historyQuery.data ?? null;
  const historyError = historyQuery.error?.message ?? "";
  const setHistory = (value: GitHistory) => {
    queryClient.setQueryData(historyOptions.queryKey, value);
    void refreshGitQueries(queryClient, workspace ? "workspace" : "project", activeHistoryRepositoryId, false).catch((cause) => toast.errorFrom(cause));
  };

  return <aside data-testid="right-sidebar" aria-hidden={!open} inert={!open} className={cn("absolute inset-y-0 right-0 z-20 flex w-[min(88vw,340px)] shrink-0 flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out lg:shadow-none", open ? "translate-x-0" : "translate-x-full pointer-events-none")}>
    <div className="shrink-0 border-b border-border p-2">
      <NativeSelect aria-label={t("reviewUi.gitRepository")} data-testid="git-repository" value={activeHistoryRepositoryId} disabled={historyRepositories.length <= 1} onChange={(event) => setHistoryRepositoryId(event.target.value)}>
        {historyRepositories.length === 0 ? <NativeSelectOption value="">{t("reviewUi.noGitRepositories")}</NativeSelectOption> : historyRepositories.map((repository) => <NativeSelectOption key={repository.id} value={repository.id}>{repository.name}</NativeSelectOption>)}
      </NativeSelect>
    </div>
    <div className="flex h-11 shrink-0 items-stretch border-b border-border">
      <div className="flex min-w-0 flex-1" role="tablist" aria-label={t("reviewUi.sidebarSections")}>
        {([ ["changes", GitCommitHorizontal, t("reviewUi.changes")], ["history", History, t("reviewUi.gitHistory")], ["info", Info, t("reviewUi.repositoryInfo")] ] as const).map(([value, Icon, label]) => <Tooltip key={value}><TooltipTrigger render={<button role="tab" aria-label={label} aria-selected={tab === value} className={cn("relative flex flex-1 items-center justify-center text-muted-foreground hover:text-foreground", tab === value && "text-foreground")} onClick={() => setTab(value)} />}><Icon />{tab === value && <span className="absolute inset-x-4 bottom-0 h-0.5 bg-foreground" />}</TooltipTrigger><TooltipContent side="bottom">{label}</TooltipContent></Tooltip>)}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
    {tab === "changes" ? <GitCommitPanel repositoryKind={workspace ? "workspace" : "project"} repositories={historyRepositories} repositoryId={activeHistoryRepositoryId} onOpenChanges={onOpenChanges} /> : tab === "history" ? <GitHistoryPanel repositoryKind={workspace ? "workspace" : "project"} repositories={historyRepositories} repositoryId={activeHistoryRepositoryId} history={history} error={historyError} onHistoryChange={setHistory} onOpenDiff={onOpenDiff} /> : session ? <div className="flex flex-col gap-6 p-4">
      <div><div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-lg bg-muted">{isAgentKind(session.kind) ? <Bot className="size-4" /> : session.kind === "command" ? <PanelsTopLeft className="size-4" /> : <TerminalSquare className="size-4" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.name}</p><div className="mt-1 flex items-center gap-2"><Badge>{isAgentKind(session.kind) ? AGENT_NAMES[session.kind] : t(`states.${session.kind}`, { defaultValue: session.kind })}</Badge><Badge variant={session.status === "running" ? "success" : session.status === "failed" ? "destructive" : "secondary"}>{t(`states.${session.status}`, { defaultValue: session.status })}</Badge></div></div></div></div>
      <InspectorGroup title={t("reviewUi.process")}><InspectorRow label="Workspace" value={session.amux_workspace_name} mono /><InspectorRow label={t("reviewUi.name")} value={session.amux_process_name} mono /><InspectorRow label="I/O" value={session.io_mode} /><InspectorRow label={t("reviewUi.exit")} value={session.exit_code === undefined ? "—" : `${session.exit_code}${session.exit_signal ? ` · ${session.exit_signal}` : ""}`} /></InspectorGroup>
      <InspectorGroup title={workspace ? "Workspace" : t("reviewUi.projectSession")}>{workspace && <><InspectorRow label="Workspace" value={workspace.name} /><InspectorRow label={t("reviewUi.runtime")} value={workspace.runtime_name} /><InspectorRow label={t("reviewUi.workspaceID")} value={workspace.runtime_id} mono /></>}<InspectorRow label={t("reviewUi.workdir")} value={session.cwd} mono />{session.original_cwd !== session.cwd && <InspectorRow label={t("reviewUi.original")} value={session.original_cwd} mono />}</InspectorGroup>
      {isAgentKind(session.kind) && <InspectorGroup title={AGENT_NAMES[session.kind]}><InspectorRow label={t("reviewUi.sessionID")} value={session.agent_session_id || t("reviewUi.capturing")} mono />{session.initial_prompt && <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-foreground">{session.initial_prompt}</div>}</InspectorGroup>}
      <InspectorGroup title={t("reviewUi.command")}><code className="block break-all rounded-lg bg-neutral-950 p-3 text-[10px] leading-5 text-neutral-300">{session.argv.join(" ") || "—"}</code></InspectorGroup>
    </div> : workspace ? <div className="flex flex-col gap-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={workspace.name}>{workspace.name}</p><div className="mt-2 flex gap-2"><Badge>{t(`states.${workspace.kind}`, { defaultValue: workspace.kind })}</Badge><Badge variant={workspace.status === "active" ? "success" : "secondary"}>{t(`states.${workspace.status}`, { defaultValue: workspace.status })}</Badge></div></div>
      <InspectorGroup title="Git"><InspectorRow label={t("reviewUi.branch")} value={workspace.branch || "—"} mono /><InspectorRow label={t("reviewUi.start")} value={workspace.start_commit || "—"} mono /><InspectorRow label={t("workspaceUi.baseBranch")} value={workspace.target_branch || "—"} mono /><InspectorRow label={t("reviewUi.delivery")} value={t(`states.${workspace.delivery_status}`, { defaultValue: workspace.delivery_status })} /></InspectorGroup>
      <InspectorGroup title="Workspace"><InspectorRow label={t("reviewUi.mode")} value={t(`states.${workspace.checkout_mode}`, { defaultValue: workspace.checkout_mode })} /><InspectorRow label={t("reviewUi.runtime")} value={workspace.runtime_name} /><InspectorRow label={t("reviewUi.path")} value={workspace.checkout_path} mono /></InspectorGroup>
      <InspectorGroup title={t("reviewUi.records")}><InspectorRow label={t("reviewUi.sessions")} value={String(workspace.sessions.length)} /><InspectorRow label={t("reviewUi.todos")} value={String(workspace.todos.length)} />{workspace.kind === "workspace" && <InspectorRow label={t("reviewUi.forks")} value={String(workspace.forks.length)} />}</InspectorGroup>
    </div> : <div className="flex flex-col gap-6 p-4">
      <div><p className="truncate text-sm font-semibold" title={project.name}>{project.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{project.description || t("reviewUi.noProjectDescription")}</p></div>
      <InspectorGroup title={t("reviewUi.repository")}><InspectorRow label={t("reviewUi.remote")} value={project.preferred_remote || "—"} /><InspectorRow label={t("reviewUi.directories")} value={String(project.directories.length)} /><InspectorRow label={t("reviewUi.workspaces")} value={String(project.workspaces.filter((item) => !item.parent_workspace_id).length)} /></InspectorGroup>
    </div>}
    </div>
  </aside>;
}

function GitCommitPanel({ repositoryKind, repositories, repositoryId, onOpenChanges }: { repositoryKind: "project" | "workspace"; repositories: InspectorRepository[]; repositoryId: string; onOpenChanges: (repository: InspectorRepository) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const statusOptions = gitStatusQuery(repositoryKind, repositoryId);
  const statusQuery = useQuery({ ...statusOptions, enabled: Boolean(repositoryId) });
  const status = statusQuery.data ?? null;
  const setStatus = (next: GitStatus) => queryClient.setQueryData(statusOptions.queryKey, next);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const api = repositoryKind === "project" ? projectsApi : workspacesApi;
  useEffect(() => setError(""), [repositoryKind, repositoryId]);
  const commit = async () => {
    if (!status || !message.trim() || status.staged_count === 0 || loading) return;
    setLoading(true); setError("");
    try {
      const result = await api.commit(repositoryId, message.trim(), status.snapshot);
      setStatus(result.status); setMessage(""); await refreshGitQueries(queryClient, repositoryKind, repositoryId); toast.success(t("reviewUi.committed", { commit: result.hash.slice(0, 10) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("reviewUi.commitFailed")); }
    finally { setLoading(false); }
  };
  const repository = repositories.find((item) => item.id === repositoryId);
  const additions = status?.files.reduce((total, file) => total + file.additions, 0) ?? 0;
  const deletions = status?.files.reduce((total, file) => total + file.deletions, 0) ?? 0;
  return <div className="flex min-h-full flex-col gap-3 p-3">
    {(error || statusQuery.error) && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error || statusQuery.error?.message}</p>}
    {!status ? <p className="py-8 text-center text-xs text-muted-foreground">{t("reviewUi.loadingChanges")}</p> : status.files.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">{t("reviewUi.noChanges")}</p> : <>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono">{status.branch}</span></div>
      <div className="flex flex-col gap-2">
        <div data-testid="git-change-summary" className="flex items-center gap-2 text-xs leading-none"><span className="text-muted-foreground">{t("counts.file", { count: status.files.length })}</span><span className="font-mono tabular-nums text-success">+{additions}</span><span className="font-mono tabular-nums text-destructive">−{deletions}</span>{status.staged_count > 0 && <><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{t("counts.staged", { count: status.staged_count })}</span></>}</div>
        {repository && <Button className="w-full" size="sm" variant="outline" onClick={() => onOpenChanges(repository)}><GitCompare data-icon="inline-start" />{t("reviewUi.reviewChanges")}</Button>}
      </div>
      <Textarea aria-label={t("reviewUi.commitMessage")} placeholder={t("reviewUi.commitMessage")} value={message} disabled={loading} onChange={(event) => setMessage(event.target.value)} />
      <Button className="w-full" disabled={loading || !message.trim() || !status.staged_count} onClick={() => void commit()}><Check data-icon="inline-start" />{t("reviewUi.commit")} {status.staged_count || ""}</Button>
    </>}
  </div>;
}

function GitHistoryPanel({ repositoryKind, repositories, repositoryId, history, error, onHistoryChange, onOpenDiff }: { repositoryKind: "project" | "workspace"; repositories: { id: string; name: string }[]; repositoryId: string; history: GitHistory | null; error: string; onHistoryChange: (history: GitHistory) => void; onOpenDiff: (payload: GitDiffLaunchPayload) => void }) {
  const { t } = useTranslation();
  const [squashOpen, setSquashOpen] = useState(false);
  const [selection, setSelection] = useState<{ anchor: number; first: number; last: number } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ kind: "revert" | "reset"; commit: GitCommit } | null>(null);
  const [resetMode, setResetMode] = useState<"soft" | "mixed" | "hard">("mixed");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => setSelection(null), [history, repositoryId]);
  const selectCommit = (index: number, extend: boolean) => {
    setSelection((current) => {
      if (!extend || !current) return { anchor: index, first: index, last: index };
      return { anchor: current.anchor, first: Math.min(current.anchor, index), last: Math.max(current.anchor, index) };
    });
  };
  const viewDiff = (range: { first: number; last: number } | null = selection) => {
    if (!history || !range) return;
    const repository = repositories.find((item) => item.id === repositoryId);
    if (!repository) return;
    const newest = history.commits[range.first];
    const oldest = history.commits[range.last];
    if (!newest || !oldest) return;
    onOpenDiff({
      repositoryKind,
      repositoryId,
      repositoryName: repository.name,
      startCommit: oldest.hash,
      endCommit: newest.hash,
      commitCount: range.last - range.first + 1,
    });
  };
  const openAction = (kind: "revert" | "reset", commit: GitCommit) => {
    setResetMode("mixed");
    setActionError("");
    setPendingAction({ kind, commit });
  };
  const runAction = async () => {
    if (!pendingAction || !repositoryId || actionPending) return;
    setActionPending(true);
    setActionError("");
    try {
      const api = repositoryKind === "workspace" ? workspacesApi : projectsApi;
      const nextHistory = pendingAction.kind === "revert"
        ? await api.revertCommit(repositoryId, pendingAction.commit.hash)
        : await api.resetCommit(repositoryId, pendingAction.commit.hash, resetMode);
      onHistoryChange(nextHistory);
      setSelection(null);
      setPendingAction(null);
      toast.success(pendingAction.kind === "revert" ? t("reviewUi.commitReverted") : t("reviewUi.repositoryReset", { mode: resetMode }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t(pendingAction.kind === "revert" ? "reviewUi.revertFailed" : "reviewUi.resetFailed"));
    } finally {
      setActionPending(false);
    }
  };
  const copyCommit = (hash: string) => {
    void navigator.clipboard.writeText(hash).then(() => {
      toast.success(t("reviewUi.commitCopied"));
    }).catch((cause) => {
      console.error("Could not copy Git commit", cause);
      toast.error(t("reviewUi.couldNotCopyCommit"));
    });
  };
  return <><div>
    <div className="flex flex-col gap-2 border-b border-border/60 p-3">
      {history && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><GitBranch className="size-3.5" /><span className="min-w-0 flex-1 truncate font-mono" title={history.branch}>{history.branch}</span><span>{t("counts.commit", { count: history.commits.length })}</span></div>}
    </div>
    {error ? <div className="p-4"><div className="rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div></div> : repositories.length === 0 ? <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">{t("reviewUi.noGitRepositoriesAreAvailable")}</div> : !history ? <div className="grid h-32 place-items-center text-xs text-muted-foreground">{t("reviewUi.loadingGitHistory")}</div> : history.commits.length === 0 ? <div className="grid h-40 place-items-center px-6 text-center text-xs leading-5 text-muted-foreground">{t("reviewUi.noCommitsFoundForThisRepository")}</div> : <div className="divide-y divide-border/60">{history.commits.map((commit, index) => {
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
            onDoubleClick={() => {
              selectCommit(index, false);
              viewDiff({ first: index, last: index });
            }}
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
            <ContextMenuItem data-testid="view-git-diff-action" onClick={() => viewDiff()}>
              <GitCompare data-icon="inline-start" />{t("reviewUi.viewDiff")}</ContextMenuItem>
            <ContextMenuItem data-testid="copy-git-commit-action" onClick={() => copyCommit(commit.hash)}>
              <Copy data-icon="inline-start" />{t("reviewUi.copyCommit")}</ContextMenuItem>
            <ContextMenuItem disabled={!selection || selection.last <= selection.first} onClick={() => setSquashOpen(true)}>
              <Combine data-icon="inline-start" />{t("squashUi.menu")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => openAction("revert", commit)}>
              <Undo2 data-icon="inline-start" />{t("reviewUi.revertCommit")}</ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => openAction("reset", commit)}>
              <RotateCcw data-icon="inline-start" />{t("reviewUi.resetToCommit")}</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>;
    })}</div>}
  </div>
  <HistorySquashDialog open={squashOpen} onOpenChange={setSquashOpen} repositoryKind={repositoryKind} repositoryId={repositoryId} commits={history && selection ? history.commits.slice(selection.first, selection.last + 1).reverse() : []} head={history?.commits[0]?.hash ?? ""} onHistoryChange={onHistoryChange} />
  <Dialog open={Boolean(pendingAction)} onOpenChange={(nextOpen) => { if (!nextOpen && !actionPending) setPendingAction(null); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{pendingAction?.kind === "revert" ? t("reviewUi.revertCommit2") : t("reviewUi.resetRepositoryToCommit")}</DialogTitle>
        <DialogDescription>
          {pendingAction?.kind === "revert"
            ? t("reviewUi.thisCreatesANewCommitThatReversesTheSelectedCommit")
            : t("reviewUi.resetDescription")}
        </DialogDescription>
      </DialogHeader>
      {pendingAction && <div className="rounded-lg bg-muted p-3"><p className="break-words font-medium">{pendingAction.commit.subject}</p><code className="mt-1 block text-[10px] text-muted-foreground">{pendingAction.commit.short_hash}</code></div>}
      {pendingAction?.kind === "reset" && <div className="flex flex-col gap-2">
        <label htmlFor="git-reset-mode" className="font-medium">{t("reviewUi.resetStrategy")}</label>
        <NativeSelect id="git-reset-mode" value={resetMode} disabled={actionPending} onChange={(event) => setResetMode(event.target.value as "soft" | "mixed" | "hard")}>
          <NativeSelectOption value="soft">{t("reviewUi.softKeepChangesStaged")}</NativeSelectOption>
          <NativeSelectOption value="mixed">{t("reviewUi.mixedKeepChangesUnstaged")}</NativeSelectOption>
          <NativeSelectOption value="hard">{t("reviewUi.hardDiscardTrackedChanges")}</NativeSelectOption>
        </NativeSelect>
        {resetMode === "hard" && <p className="text-destructive">{t("reviewUi.hardResetWarning")}</p>}
      </div>}
      {actionError && <p role="alert" className="text-destructive">{actionError}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={actionPending} onClick={() => setPendingAction(null)}>{t("reviewUi.cancel")}</Button>
        <Button variant={pendingAction?.kind === "reset" ? "destructive" : "default"} disabled={actionPending} onClick={() => void runAction()}>
          {actionPending ? t("reviewUi.working") : pendingAction?.kind === "revert" ? t("reviewUi.revertCommit") : t("reviewUi.reset", { mode: resetMode })}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog></>;
}

function formatExactGitTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const two = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3><div className="flex flex-col gap-2">{children}</div></section>; }
function InspectorRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 text-xs"><span className="text-muted-foreground">{label}</span><span className={cn("min-w-0 break-all text-foreground", mono && "font-mono text-[10px]")}>{value}</span></div>; }

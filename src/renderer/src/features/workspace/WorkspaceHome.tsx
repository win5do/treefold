import { Spinner } from "@/components/ui/spinner";
import { isSessionListed } from "@/features/terminal/model/sessionListVisibility";
import { WorkspaceRepositories } from "./WorkspaceRepositories";
import { sessionDisplayName } from "@/features/terminal/model/sessionDisplayName";
import { DelegateTodoDialog } from "./DelegateTodoDialog";
import { isAgentKind } from "@/features/agents/model";
import { ReopenForkButton } from "./ReopenForkButton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { NewSessionDialog } from "@/features/terminal/NewSessionDialog";
import { useTranslation } from "react-i18next";
import { SessionListActions } from "@/features/terminal/SessionListActions";
import { useEffect, useState } from "react";
import {
  Bot,
  ArrowUpRight,
  CircleAlert,
  Folder,
  GitBranch,
  PanelsTopLeft,
  TerminalSquare,
  GitFork,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { todosApi } from "@/api/todos";
import { DirectoryActionsMenu } from "@/features/open-in/DirectoryActionsMenu";
import { StatusDot } from "@/components/app/StatusDot";
import { RecordActionMenu } from "@/features/app/RecordActions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Directory,
  ProjectDetail,
  Session,
  Workspace,
  WorkspaceDetail,
  WorkspaceRepository,
} from "@/domain/types";
import { cn } from "@/lib/utils";

export function WorkspaceHome({
  detail,
  creation,
  busy,
  onOpenFork,
  onDeleteFork,
  onDeleteForkBlocked,
  onConfigureUpstream,
  onClearUpstream,
  onResync,
  onTodosChanged,
  onTodoForkCreated,
}: {
  detail: WorkspaceDetail;
  creation: {
    available: boolean;
    session: (kind: import("@/domain/types").NewSessionKind, directory: Directory) => void;
    fork: () => void;
    workspaceFromProject: (project: ProjectDetail) => void;
    forkFromParent: (parent: Workspace) => void;
    finish: () => void;
  };
  busy: boolean;
  onOpenFork: (fork: Workspace) => void;
  onDeleteFork: (fork: Workspace) => void;
  onDeleteForkBlocked: (fork: Workspace) => void;
  onConfigureUpstream: (location: WorkspaceRepository) => void;
  onClearUpstream: (location: WorkspaceRepository) => void;
  onResync: () => void;
  onTodosChanged: () => void;
  onTodoForkCreated: (fork: Workspace, session?: Session) => void;
}) {
  const { t, i18n } = useTranslation();
  const [creatingSession, setCreatingSession] = useState(false);
  useEffect(() => setCreatingSession(false), [detail.id]);
  const [filter, setFilter] = useState<"all" | "agent" | "shell" | "command">(
    "all",
  );
  const listedSessions = detail.sessions.filter(isSessionListed);
  const initializing = detail.repositories.some(repository => repository.git_status === "creating");
  const sessions = listedSessions.filter(
    (session) => filter === "all" || (filter === "agent" ? isAgentKind(session.kind) : session.kind === filter),
  );
  const [todoDialog, setTodoDialog] = useState<{
    id?: string;
    content: string;
  } | null>(null);
  const [todoDelegation, setTodoDelegation] = useState<{ id: string; trigger: HTMLButtonElement } | null>(null);
  const delegatedTodo = detail.todos.find(todo => todo.id === todoDelegation?.id);
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoError, setTodoError] = useState("");
  useEffect(() => { setTodoDialog(null); setTodoDelegation(null); }, [detail.id]);
  const runTodo = async (action: () => Promise<unknown>) => {
    setTodoBusy(true);
    setTodoError("");
    try {
      await action();
      onTodosChanged();
      return true;
    } catch (cause) {
      setTodoError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setTodoBusy(false);
    }
  };
  const displayStatus = (session: Session) => {
    if (session.initializing) return t("terminalUi.initializing");
    if (
      session.visibility !== "visible" &&
      isAgentKind(session.kind) &&
      session.status === "running"
    )
      return t("workspaceUi.background");
    return t(`states.${session.status}`, { defaultValue: session.status });
  };
  const formatTime = (value?: string) =>
    value
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(value))
      : "—";
  return (
    <div
      data-testid="page-scroll"
      className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"
    >
      <div data-testid="page-content" className="mx-auto max-w-[96rem]">
        <div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Badge>{t(`states.${detail.checkout_mode}`, { defaultValue: detail.checkout_mode })}</Badge>
              <Badge
                variant={detail.status === "active" ? "success" : "secondary"}
              >
                {t(`states.${detail.status}`, { defaultValue: detail.status })}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {detail.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {detail.description ||
                t(detail.kind === "fork" ? "workspaceUi.subtaskDescription" : "workspaceUi.featureDescription")}
            </p>
          </div>
        </div>
        {detail.status === "archived" && (
          <div className="mt-4"><ReopenForkButton key={detail.id} projectId={detail.project.id} onNewWorkspace={creation.workspaceFromProject} id={detail.id} parentId={detail.parent_workspace_id} onNewFork={creation.forkFromParent} /></div>
        )}
        {detail.finish_batch && detail.finish_batch.status !== "completed" && (
          <Alert className="mt-6">
            <CircleAlert />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{t(detail.finish_batch.continue_work ? "deliveryUi.forkDelivery.notice" : "deliveryUi.batchNotice")}</span>
              <Button size="sm" onClick={creation.finish}>{t("deliveryUi.batchView")}</Button>
            </AlertDescription>
          </Alert>
        )}
        {initializing && <Alert role="status" className="mt-6" data-testid="workspace-initializing"><Spinner aria-hidden="true" /><AlertDescription>{t("workspaceUi.initializing")}</AlertDescription></Alert>}
        <section data-testid="workspace-sessions-section" className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Session</h2>
            {creation.available && <Button size="sm" disabled={busy || initializing} onClick={() => setCreatingSession(true)}><Plus data-icon="inline-start" />{t("terminalUi.newSession")}</Button>}
          </div>
        {listedSessions.length > 0 && (
        <div className="mt-8 flex items-center justify-between border-b border-border">
          <div className="flex gap-5">
            {(
              [
                ["all", t("workspaceUi.all")],
                ["agent", "Agent"],
                ["shell", "Shell"],
                ["command", t("workspaceUi.command")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={cn(
                  "border-b-2 px-1 pb-3 text-xs font-medium",
                  filter === value
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="pb-3 text-[11px] text-muted-foreground">
            {t("counts.session", { count: sessions.length })}
          </span>
        </div>
        )}
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
          <div className={cn(listedSessions.length > 0 && "md:min-w-[56rem]")}>
            {listedSessions.length > 0 && (
            <div className="hidden grid-cols-[minmax(180px,1.4fr)_72px_90px_110px_110px_minmax(110px,1fr)_160px] gap-3 border-b border-border/60 bg-muted px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
              <span>Session</span>
              <span>{t("workspaceUi.type")}</span>
              <span>{t("workspaceUi.status")}</span>
              <span>{t("workspaceUi.started")}</span>
              <span>{t("workspaceUi.lastActive")}</span>
              <span>Workspace</span>
              <span className="sticky right-0 z-10 -my-2.5 -mr-4 border-l border-border/60 bg-muted py-2.5 pr-4 pl-3 text-right">{t("workspaceUi.actions")}</span>
            </div>
            )}
            {sessions.map((session) => {
              return (
                <div
                  key={session.id}
                  data-testid={`workspace-session-${session.id}`}
                  className="grid gap-3 border-b border-border/60 px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_72px_90px_110px_110px_minmax(110px,1fr)_160px] md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                      {isAgentKind(session.kind) ? (
                        <Bot className="size-4" />
                      ) : session.kind === "command" ? (
                        <PanelsTopLeft className="size-4" />
                      ) : (
                        <TerminalSquare className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {sessionDisplayName(session)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                        {session.agent_session_id || session.id}
                      </p>
                    </div>
                  </div>
                  <div>
                    <Badge>
                      {isAgentKind(session.kind)
                        ? "Agent"
                        : session.kind === "command"
                          ? t("workspaceUi.command")
                          : "Shell"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground">
                    <StatusDot status={session.status} />
                    {displayStatus(session)}
                  </div>
                  <span className="hidden text-xs text-muted-foreground md:block">
                    {formatTime(session.launch_started_at)}
                  </span>
                  <span className="hidden text-xs text-muted-foreground md:block">
                    {formatTime(
                      session.hidden_at ||
                        session.last_attached_at ||
                        session.updated_at ||
                        session.created_at,
                    )}
                  </span>
                  <code
                    className="hidden truncate text-[10px] text-muted-foreground md:block"
                    title={session.cwd}
                  >
                    {session.cwd}
                  </code>
                  <div className="flex items-center justify-end gap-1 md:sticky md:right-0 md:z-10 md:-my-3.5 md:-mr-4 md:self-stretch md:border-l md:border-border/60 md:bg-card md:py-3.5 md:pr-4 md:pl-3">
                    <SessionListActions session={session} path={`/workspaces/${detail.id}/sessions/${session.id}`} available={detail.status === "active"} busy={busy} />
                  </div>
                </div>
              );
            })}
            {sessions.length === 0 && (
              <Empty className="py-12"><EmptyHeader>
                <EmptyTitle>{t(listedSessions.length > 0 ? "workspaceUi.noSessionsMatchTheFilter" : !creation.available ? "projectsUi.noSessions" : detail.kind === "fork" ? "workspaceUi.startSubtask" : "workspaceUi.startFeature")}</EmptyTitle>
                {listedSessions.length === 0 && creation.available && <EmptyDescription>{t(detail.kind === "fork" ? "workspaceUi.startSubtaskDescription" : "workspaceUi.startFeatureDescription")}</EmptyDescription>}
              </EmptyHeader></Empty>
            )}
          </div>
        </div>
        </section>
        {creatingSession && creation.available && <NewSessionDialog
          key={detail.id} name={detail.name} directories={detail.directories}
          onClose={() => setCreatingSession(false)}
          onCreate={(kind, directory) => { setCreatingSession(false); creation.session(kind, directory); }}
        />}
        {detail.kind === "workspace" && (
          <section data-testid="workspace-todos-section" className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("workspaceUi.todos")}</h2>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {detail.todos.length}
                </span>
                {detail.status === "active" && (
                  <Button
                    size="sm"
                    onClick={() => setTodoDialog({ content: "" })}
                  >
                    <Plus data-icon="inline-start" />{t("workspaceUi.addTodo")}</Button>
                )}
              </div>
            </div>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
              {detail.todos.map((todo) => {
                const title = todo.content.split(/\r?\n/, 1)[0];
                const executionFork = todo.fork_id
                  ? detail.forks.find((fork) => fork.id === todo.fork_id)
                  : undefined;
                const hasActiveFork = executionFork?.status === "active";
                const canDelegate = ["pending", "blocked"].includes(todo.status);
                const statusLabel = hasActiveFork
                  ? todo.status === "blocked"
                    ? todo.blocked_reason ? t("workspaceUi.executionBlockedReason", { reason: todo.blocked_reason }) : t("workspaceUi.executionBlocked")
                    : t("workspaceUi.executionForkActive")
                  : undefined;
                const checkbox = (
                  <Checkbox
                    aria-label={
                      todo.status === "done" ? t("workspaceUi.reopenTodo") : t("workspaceUi.completeTodo")
                    }
                    checked={todo.status === "done"}
                    disabled={todoBusy || hasActiveFork}
                    onCheckedChange={(checked) =>
                      void runTodo(() =>
                        todosApi.update(todo.id, {
                          status: checked ? "done" : "pending",
                        }),
                      )
                    }
                  />
                );

                return (
                  <div
                    key={todo.id}
                    data-todo-id={todo.id}
                    className="flex min-w-0 items-center gap-3 px-4 py-2.5"
                  >
                    {statusLabel ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              className="flex shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              tabIndex={0}
                            />
                          }
                        >
                          {checkbox}
                        </TooltipTrigger>
                        <TooltipContent>{statusLabel}</TooltipContent>
                      </Tooltip>
                    ) : (
                      checkbox
                    )}
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-sm leading-6 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
                        todo.status === "done" &&
                          "text-muted-foreground line-through",
                      )}
                      title={todo.content}
                      disabled={todoBusy}
                      onClick={() =>
                        setTodoDialog({ id: todo.id, content: todo.content })
                      }
                    >
                      {title}
                    </button>
                    {todo.status === "blocked" && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              className="flex shrink-0 text-destructive outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                              tabIndex={0}
                            />
                          }
                        >
                          <CircleAlert className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {todo.blocked_reason || t("workspaceUi.executionBlocked")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t("workspaceUi.editTodo")}
                              disabled={todoBusy}
                              onClick={() =>
                                setTodoDialog({
                                  id: todo.id,
                                  content: todo.content,
                                })
                              }
                            />
                          }
                        >
                          <Pencil />
                        </TooltipTrigger>
                        <TooltipContent>{t("workspaceUi.editTodo")}</TooltipContent>
                      </Tooltip>
                      {hasActiveFork && executionFork ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("workspaceUi.openExecutionFork")}
                                onClick={() => onOpenFork(executionFork)}
                              />
                            }
                          >
                            <GitFork />
                          </TooltipTrigger>
                          <TooltipContent>{t("workspaceUi.openExecutionFork")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={<span className="inline-flex" />}
                          >
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t("workspaceUi.delegateTodoToFork")}
                              disabled={todoBusy || !canDelegate}
                              onClick={event => setTodoDelegation({ id: todo.id, trigger: event.currentTarget })}
                            >
                              <GitFork />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {canDelegate
                              ? t("workspaceUi.delegateTodoToFork")
                              : t("workspaceUi.reopenTodoBeforeDelegating")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("workspaceUi.permanentlyDeleteTodo")}
                            disabled={
                              todoBusy ||
                              hasActiveFork ||
                              todo.status === "in_progress"
                            }
                            onClick={() => {
                              if (window.confirm(t("workspaceUi.permanentlyDeleteThisTodo")))
                                void runTodo(() => todosApi.delete(todo.id));
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {hasActiveFork
                            ? t("workspaceUi.finishOrArchiveTheExecutionForkBeforeDeleting")
                            : t("workspaceUi.permanentlyDeleteTodo")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
              {detail.todos.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t("workspaceUi.noTodos")}</p>
              )}
            </div>
            {todoError && (
              <p className="mt-2 text-xs text-destructive">{todoError}</p>
            )}
          </section>
        )}
        {detail.kind === "workspace" && (
          <section data-testid="workspace-forks-section" className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("workspaceUi.forks")}</h2>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">{detail.forks.length}</span>
                {creation.available && <Button size="sm" disabled={busy || initializing} onClick={creation.fork}><Plus data-icon="inline-start" />{t("sidebar.newFork")}</Button>}
              </div>
            </div>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
              {detail.forks.map((fork) => (
                <div
                  key={fork.id}
                  data-testid={`fork-list-row-${fork.id}`}
                  className="flex items-center gap-1"
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left hover:bg-muted/50"
                    onClick={() => onOpenFork(fork)}
                  >
                    <GitBranch className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {fork.name}
                        </span>
                        <Badge
                          variant={
                            fork.status === "active" ? "success" : "neutral"
                          }
                        >
                          {t(`states.${fork.status}`, { defaultValue: fork.status })}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {fork.branch}
                      </p>
                    </div>
                    <ArrowUpRight className="size-4 text-foreground" />
                  </button>
                  <div className="pr-2">
                    <RecordActionMenu
                      kind="fork"
                      name={fork.name}
                      status={fork.status}
                      busy={busy}
                      onDelete={() => onDeleteFork(fork)}
                      onDeleteBlocked={() => onDeleteForkBlocked(fork)}
                    />
                  </div>
                </div>
              ))}
              {detail.forks.length === 0 && (
                <Empty className="py-8"><EmptyHeader>
                  <EmptyTitle>{t(creation.available ? "workspaceUi.splitFeature" : "workspaceUi.noForks")}</EmptyTitle>
                  {creation.available && <EmptyDescription>{t("workspaceUi.splitFeatureDescription")}</EmptyDescription>}
                </EmptyHeader></Empty>
              )}
            </div>
          </section>
        )}
        <WorkspaceRepositories
          detail={detail}
          busy={busy}
          onResync={onResync}
          onConfigureUpstream={onConfigureUpstream}
          onClearUpstream={onClearUpstream}
        />
        {detail.workspace_directories.some(
          (directory) => !directory.workspace_repository_id,
        ) && (
          <section className="mt-8" data-testid="workspace-context-directories">
            <h2 className="text-sm font-semibold">{t("workspaceUi.nonGitDirectories")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("workspaceUi.readOnlyContextAvailableOnlyAsAShellCwd")}</p>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
              {detail.workspace_directories
                .filter((directory) => !directory.workspace_repository_id)
                .map((directory) => (
                  <div
                    key={directory.id}
                    data-testid={`workspace-directory-${directory.project_directory_id}`}
                    className="flex items-center gap-3 p-4"
                  >
                    <Folder className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {directory.name}
                      </p>
                      <code
                        className="mt-1 block truncate text-[10px] text-muted-foreground"
                        title={directory.path}
                      >
                        {directory.path}
                      </code>
                    </div>
                    <Badge>{t("labels.readOnly")}</Badge>
                    <DirectoryActionsMenu
                      path={directory.path}
                      name={directory.name}
                      testId={`workspace-directory-actions-${directory.project_directory_id}`}
                    />
                  </div>
                ))}
            </div>
          </section>
        )}


        {detail.kind === "workspace" && delegatedTodo && todoDelegation && (
          <DelegateTodoDialog key={`${detail.id}-${delegatedTodo.id}`}
            todo={delegatedTodo} trigger={todoDelegation.trigger}
            onClose={() => setTodoDelegation(null)}
            onCreated={result => {
              setTodoDelegation(null);
              onTodosChanged();
              onTodoForkCreated(result.fork, result.session);
            }} />
        )}
        <Dialog
          open={detail.kind === "workspace" && Boolean(todoDialog)}
          onOpenChange={(open) => !open && setTodoDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {todoDialog?.id ? t("workspaceUi.editTodo") : t("workspaceUi.createTodo")}
              </DialogTitle>
              <DialogDescription>{t("workspaceUi.markdownIsSupportedTodoContentMaySpanMultipleLines")}</DialogDescription>
            </DialogHeader>
            <Textarea
              rows={10}
              className="min-h-48 resize-y"
              aria-label={t("workspaceUi.todoContent")}
              value={todoDialog?.content ?? ""}
              onChange={(event) =>
                setTodoDialog(
                  (current) =>
                    current && { ...current, content: event.target.value },
                )
              }
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTodoDialog(null)}>{t("workspaceUi.cancel")}</Button>
              <Button
                disabled={todoBusy || !todoDialog?.content.trim()}
                onClick={() => {
                  if (!todoDialog) return;
                  const current = todoDialog;
                  void runTodo(() =>
                    current.id
                      ? todosApi.update(current.id, {
                          content: current.content,
                        })
                      : todosApi.create(detail.id, current.content),
                  ).then((saved) => saved && setTodoDialog(null));
                }}
              >{t("workspaceUi.save")}</Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}

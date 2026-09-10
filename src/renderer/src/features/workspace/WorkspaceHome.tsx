import { useEffect, useState } from "react";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  Folder,
  GitBranch,
  PanelsTopLeft,
  RefreshCw,
  TerminalSquare,
  X,
  GitFork,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { todosApi } from "@/api/todos";
import { ActionMenu, ActionMenuItem } from "@/components/app/ActionMenu";
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
  Session,
  Workspace,
  WorkspaceDetail,
  WorkspaceDirectory,
  WorkspaceRepository,
} from "@/domain/types";
import { formatRepositoryRelativePath } from "@/lib/repositoryPath";
import { cn } from "@/lib/utils";

export function WorkspaceHome({
  detail,
  busy,
  onOpen,
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
  busy: boolean;
  onOpen: (session: Session) => void;
  onOpenFork: (fork: Workspace) => void;
  onDeleteFork: (fork: Workspace) => void;
  onDeleteForkBlocked: (fork: Workspace) => void;
  onConfigureUpstream: (location: WorkspaceRepository) => void;
  onClearUpstream: (location: WorkspaceRepository) => void;
  onResync: () => void;
  onTodosChanged: () => void;
  onTodoForkCreated: (fork: Workspace, session?: Session) => void;
}) {
  const [filter, setFilter] = useState<"all" | "codex" | "shell" | "command">(
    "all",
  );
  const sessions = detail.sessions.filter(
    (session) => filter === "all" || session.kind === filter,
  );
  const [todoDialog, setTodoDialog] = useState<{
    id?: string;
    content: string;
  } | null>(null);
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoError, setTodoError] = useState("");
  useEffect(() => setTodoDialog(null), [detail.id]);
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
  const actionLabel = (session: Session) => {
    if (session.visibility !== "visible" && session.kind === "codex")
      return session.status === "running" ? "Show in sidebar" : "Open";
    return "Open";
  };
  const displayStatus = (session: Session) => {
    if (
      session.visibility !== "visible" &&
      session.kind === "codex" &&
      session.status === "running"
    )
      return "Background";
    return session.status;
  };
  const formatTime = (value?: string) =>
    value
      ? new Intl.DateTimeFormat(undefined, {
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
              <Badge>{detail.checkout_mode}</Badge>
              <Badge
                variant={detail.status === "active" ? "success" : "secondary"}
              >
                {detail.status}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {detail.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {detail.description ||
                "在同一个 Workspace 中运行 Shell 和 Codex Sessions。"}
            </p>
          </div>
        </div>
        <section data-testid="workspace-repositories-section" className="mt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Workspace Repositories</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Git lifecycle and delivery run once per Repository; Sessions
                start in a Directory scope.
              </p>
            </div>
            {detail.status === "active" && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={onResync}
              >
                <RefreshCw data-icon="inline-start" />
                Resync
              </Button>
            )}
          </div>
          <div className="mt-3 grid gap-3">
            {detail.repositories.map((location) => (
              <WorkspaceRepositoryRow
                key={location.id}
                location={location}
                scopes={detail.workspace_directories.filter(
                  (directory) =>
                    directory.workspace_repository_id === location.id,
                )}
                busy={busy}
                actionsEnabled={
                  detail.kind === "workspace" && detail.status === "active"
                }
                onConfigureUpstream={() => onConfigureUpstream(location)}
                onClearUpstream={() => onClearUpstream(location)}
              />
            ))}
          </div>
        </section>
        {detail.workspace_directories.some(
          (directory) => !directory.workspace_repository_id,
        ) && (
          <section className="mt-8" data-testid="workspace-context-directories">
            <h2 className="text-sm font-semibold">Non-Git Directories</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only context; available only as a Shell cwd.
            </p>
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
                    <Badge>read only</Badge>
                  </div>
                ))}
            </div>
          </section>
        )}
        {detail.kind === "workspace" && (
          <section data-testid="workspace-forks-section" className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Forks</h2>
              <span className="text-[11px] text-muted-foreground">
                {detail.forks.length}
              </span>
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
                          {fork.delivery_status}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {fork.branch}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/60" />
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
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No Forks
                </p>
              )}
            </div>
          </section>
        )}
        <section data-testid="workspace-todos-section" className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Todos</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {detail.todos.length}
              </span>
              {detail.status === "active" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTodoDialog({ content: "" })}
                >
                  <Plus data-icon="inline-start" />
                  Add Todo
                </Button>
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
                  ? `Execution blocked${todo.blocked_reason ? `: ${todo.blocked_reason}` : ""}`
                  : "Execution Fork is active. Finish or archive it before changing status."
                : undefined;
              const checkbox = (
                <Checkbox
                  aria-label={
                    todo.status === "done" ? "Reopen Todo" : "Complete Todo"
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
                        {todo.blocked_reason || "Execution blocked"}
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
                            aria-label="Edit Todo"
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
                      <TooltipContent>Edit Todo</TooltipContent>
                    </Tooltip>
                    {hasActiveFork && executionFork ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Open execution Fork"
                              onClick={() => onOpenFork(executionFork)}
                            />
                          }
                        >
                          <GitFork />
                        </TooltipTrigger>
                        <TooltipContent>Open execution Fork</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="inline-flex" />}
                        >
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Delegate Todo to Fork"
                            disabled={todoBusy || !canDelegate}
                            onClick={() =>
                              void runTodo(async () => {
                                const result = await todosApi.createFork(
                                  todo.id,
                                );
                                onTodoForkCreated(result.fork, result.session);
                              })
                            }
                          >
                            <GitFork />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {canDelegate
                            ? "Delegate Todo to Fork"
                            : "Reopen Todo before delegating"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Permanently delete Todo"
                          disabled={
                            todoBusy ||
                            hasActiveFork ||
                            todo.status === "in_progress"
                          }
                          onClick={() => {
                            if (window.confirm("Permanently delete this Todo?"))
                              void runTodo(() => todosApi.delete(todo.id));
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {hasActiveFork
                          ? "Finish or archive the execution Fork before deleting"
                          : "Permanently delete Todo"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
            {detail.todos.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                No Todos
              </p>
            )}
          </div>
          {todoError && (
            <p className="mt-2 text-xs text-destructive">{todoError}</p>
          )}
        </section>
        <Dialog
          open={Boolean(todoDialog)}
          onOpenChange={(open) => !open && setTodoDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {todoDialog?.id ? "Edit Todo" : "Create Todo"}
              </DialogTitle>
              <DialogDescription>
                Markdown is supported. Todo content may span multiple lines.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              rows={10}
              className="min-h-48 resize-y"
              aria-label="Todo content"
              value={todoDialog?.content ?? ""}
              onChange={(event) =>
                setTodoDialog(
                  (current) =>
                    current && { ...current, content: event.target.value },
                )
              }
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTodoDialog(null)}>
                Cancel
              </Button>
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
              >
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <div className="mt-8 flex items-center justify-between border-b border-border">
          <div className="flex gap-5">
            {(
              [
                ["all", "All"],
                ["codex", "Agent"],
                ["shell", "Shell"],
                ["command", "Command"],
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
            {sessions.length} sessions
          </span>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[minmax(180px,1.4fr)_90px_130px_130px_130px_minmax(110px,1fr)_120px] gap-3 border-b border-border/60 bg-muted/50 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Session</span>
            <span>Type</span>
            <span>Status</span>
            <span>Started</span>
            <span>Last active</span>
            <span>Workspace</span>
            <span className="text-right">Actions</span>
          </div>
          {sessions.map((session) => {
            const label = actionLabel(session);
            return (
              <div
                key={session.id}
                data-testid={`workspace-session-${session.id}`}
                className="grid gap-3 border-b border-border/60 px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_90px_130px_130px_130px_minmax(110px,1fr)_120px] md:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                    {session.kind === "codex" ? (
                      <Bot className="size-4" />
                    ) : session.kind === "command" ? (
                      <PanelsTopLeft className="size-4" />
                    ) : (
                      <TerminalSquare className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {session.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                      {session.codex_session_id || session.id}
                    </p>
                  </div>
                </div>
                <div>
                  <Badge>
                    {session.kind === "codex"
                      ? "Agent"
                      : session.kind === "command"
                        ? "Command"
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
                <div className="flex justify-end">
                  {label && detail.status === "active" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busy ||
                        (session.kind === "codex" &&
                          session.visibility !== "visible" &&
                          !session.codex_session_id)
                      }
                      onClick={() => onOpen(session)}
                    >
                      {label}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && (
            <div className="py-16 text-center">
              <TerminalSquare className="mx-auto size-6 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">
                没有符合筛选条件的 Session
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceRepositoryRow({
  location,
  scopes,
  busy,
  actionsEnabled,
  onConfigureUpstream,
  onClearUpstream,
}: {
  location: WorkspaceRepository;
  scopes: WorkspaceDirectory[];
  busy: boolean;
  actionsEnabled: boolean;
  onConfigureUpstream: () => void;
  onClearUpstream: () => void;
}) {
  const writableGit =
    location.access_mode === "read_write" && location.git_status === "ready";
  const upstream =
    location.remote_name && location.remote_branch
      ? `${location.remote_name}/${location.remote_branch}`
      : "";
  return (
    <article
      data-testid={`workspace-location-${location.id}`}
      data-workspace-repository-id={location.id}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {location.repository_name}
            </h3>
            <Badge
              variant={
                location.git_status === "ready"
                  ? "success"
                  : location.git_status === "not_git"
                    ? "secondary"
                    : "destructive"
              }
            >
              {location.git_status}
            </Badge>
            <Badge>{location.access_mode}</Badge>
            <Badge>{location.delivery_status}</Badge>
          </div>
          <code
            className="mt-2 block truncate text-[10px] text-muted-foreground"
            title={location.checkout_path ?? location.source_root}
          >
            {location.checkout_path ?? location.source_root}
          </code>
          {location.creation_error && (
            <Alert
              role="alert"
              data-testid={`workspace-location-error-${location.id}`}
              variant="destructive"
              className="mt-3"
            >
              <CircleAlert />
              <AlertDescription className="font-mono text-[11px]">
                {location.creation_error}
              </AlertDescription>
            </Alert>
          )}
          {location.access_mode === "read_write" && (
            <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
              <span>
                branch <code>{location.branch}</code>
              </span>
              <span>
                base <code>{location.base_branch}</code>
              </span>
              <span>
                upstream <code>{upstream || "—"}</code>
              </span>
              <span>
                delivery <code>{location.delivery_mode}</code>
              </span>
            </div>
          )}
          {scopes.length > 0 && (
            <div
              className="mt-3 border-t border-border/60 pt-2"
              data-testid={`workspace-repository-scopes-${location.id}`}
            >
              {scopes.map((scope) => (
                <div
                  key={scope.id}
                  data-testid={`workspace-directory-${scope.project_directory_id}`}
                  className="flex min-w-0 items-center gap-2 py-1.5"
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">
                    {scope.name}
                  </span>
                  <code
                    className="ml-auto max-w-1/2 truncate text-[10px] text-muted-foreground"
                    title={scope.path}
                  >
                    {formatRepositoryRelativePath(scope.relative_path)}
                  </code>
                </div>
              ))}
            </div>
          )}
        </div>
        {actionsEnabled && writableGit && (
          <div className="-mt-2 self-start">
            <ActionMenu
              label={`Actions for ${location.repository_name}`}
              testId={`workspace-location-actions-${location.id}`}
              disabled={busy}
            >
              <ActionMenuItem
                icon={<GitBranch className="size-3.5" />}
                disabled={busy}
                testId={`workspace-location-upstream-${location.id}`}
                onClick={onConfigureUpstream}
              >
                {upstream ? "Change upstream" : "Set upstream"}
              </ActionMenuItem>
              {upstream && (
                <ActionMenuItem
                  icon={<X className="size-3.5" />}
                  disabled={busy}
                  testId={`workspace-location-clear-upstream-${location.id}`}
                  onClick={onClearUpstream}
                >
                  Clear upstream
                </ActionMenuItem>
              )}
            </ActionMenu>
          </div>
        )}
      </div>
    </article>
  );
}

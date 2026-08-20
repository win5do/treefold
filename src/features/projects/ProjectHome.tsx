import {
  Bot,
  ChevronRight,
  PanelsTopLeft,
  Plus,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import { RecordActionMenu } from "@/features/app/RecordActions";
import {
  DirectoryTreeRow,
  ProjectRepositoryTreeRow,
} from "@/features/projects/ProjectRepositoryTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  Directory,
  GitWorktree,
  ProjectDetail,
  ProjectRepository,
  Session,
  Workspace,
  WorktreeDeleteOperation,
} from "@/domain/types";

export function ProjectHome({
  project,
  busy,
  onOpen,
  onDeleteWorkspace,
  onDeleteWorkspaceBlocked,
  onOpenSession,
  onAddDirectory,
  onEditDirectory,
  onEditRepository,
  onOpenBranches,
  onRefreshLocation,
  onMakeDefault,
  onReattach,
  onDeleteRepository,
  onDeleteDirectory,
  onDeleteWorktree,
  worktreeDeletions,
}: {
  project: ProjectDetail;
  busy: boolean;
  onOpen: (id: string) => void;
  onDeleteWorkspace: (stream: Workspace) => void;
  onDeleteWorkspaceBlocked: (stream: Workspace) => void;
  onOpenSession: (session: Session) => void;
  onAddDirectory: () => void;
  onEditDirectory: (directory: Directory) => void;
  onEditRepository: (repository: ProjectRepository) => void;
  onOpenBranches: (repository: ProjectRepository) => void;
  onRefreshLocation: (directory: Directory) => void;
  onMakeDefault: (directory: Directory) => void;
  onReattach: (directory: Directory) => void;
  onDeleteRepository: (repository: ProjectRepository) => void;
  onDeleteDirectory: (directory: Directory) => void;
  onDeleteWorktree: (worktree: GitWorktree) => void;
  worktreeDeletions: Record<string, WorktreeDeleteOperation>;
}) {
  const rootWorkspaces = project.workspaces.filter(
    (stream) => !stream.parent_workspace_id,
  );
  const contextDirectories = project.directories.filter(
    (directory) => !directory.repository_id,
  );
  return (
    <div
      data-testid="page-scroll"
      className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"
    >
      <div data-testid="page-content" className="mx-auto max-w-[96rem]">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Project · multi-repository locations
            </p>
            {project.status === "archived" && (
              <Badge>archived · read-only</Badge>
            )}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {project.description}
          </p>
        </div>
        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Repositories</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Each repository contains peer Directories and Worktrees groups.
              </p>
            </div>
            {project.status === "active" && (
              <Button
                data-testid="project-add-location"
                size="sm"
                onClick={onAddDirectory}
              >
                <Plus data-icon="inline-start" />
                Add location
              </Button>
            )}
          </div>
          <div
            data-testid="project-repository-tree"
            className="relative mt-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card"
          >
            {project.repositories.map((repository) => {
              const scopes = project.directories.filter(
                (directory) => directory.repository_id === repository.id,
              );
              return (
                <ProjectRepositoryTreeRow
                  key={repository.id}
                  repository={repository}
                  directories={scopes}
                  worktrees={project.worktrees.filter(
                    (item) => item.project_repository_id === repository.id,
                  )}
                  busy={busy}
                  readOnly={project.status === "archived"}
                  onOpen={onOpen}
                  onOpenBranches={() => onOpenBranches(repository)}
                  onEditRepository={() => onEditRepository(repository)}
                  onEditDirectory={onEditDirectory}
                  onRefresh={() => scopes[0] && onRefreshLocation(scopes[0])}
                  onMakeDefault={onMakeDefault}
                  onReattach={() => scopes[0] && onReattach(scopes[0])}
                  onDeleteRepository={() => onDeleteRepository(repository)}
                  onDeleteDirectory={onDeleteDirectory}
                  onDeleteWorktree={onDeleteWorktree}
                  worktreeDeletions={worktreeDeletions}
                />
              );
            })}
            {project.repositories.length === 0 && (
              <div className="py-10 text-center text-xs text-muted-foreground">
                Add a Git Directory before creating a Workspace.
              </div>
            )}
          </div>
        </section>
        {contextDirectories.length > 0 && (
          <section className="mt-8" data-testid="project-context-directories">
            <h2 className="text-sm font-semibold">Non-Git Directories</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Available to Shell Sessions and provided to Agents as read-only
              context.
            </p>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
              {contextDirectories.map((directory) => (
                <DirectoryTreeRow
                  key={directory.id}
                  directory={directory}
                  worktrees={[]}
                  busy={busy}
                  readOnly={project.status === "archived"}
                  onOpen={onOpen}
                  onEdit={() => onEditDirectory(directory)}
                  onRefresh={() => onRefreshLocation(directory)}
                  onMakeDefault={() => undefined}
                  onReattach={() => undefined}
                  onDeleteWorktree={onDeleteWorktree}
                  worktreeDeletions={worktreeDeletions}
                />
              ))}
            </div>
          </section>
        )}
        <section data-testid="project-sessions-section" className="mt-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Project Sessions</h2>
              <p className="mt-1 text-xs text-warning">
                These Sessions operate directly in Project locations. Shell and
                Command records are deleted only when closed; Codex history is
                retained.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {project.sessions.length}
            </span>
          </div>
          <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
            {project.sessions.map((session) => (
              <div
                key={session.id}
                data-testid={`project-session-${session.id}`}
                className="flex items-center gap-3 p-4"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                  {session.kind === "codex" ? (
                    <Bot className="size-4 text-muted-foreground" />
                  ) : session.kind === "command" ? (
                    <PanelsTopLeft className="size-4 text-muted-foreground" />
                  ) : (
                    <TerminalSquare className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">
                      {session.name}
                    </p>
                    <Badge>
                      {session.kind === "codex"
                        ? "Codex"
                        : session.kind === "command"
                          ? "Command"
                          : "Shell"}
                    </Badge>
                    <Badge
                      variant={
                        session.status === "running"
                          ? "success"
                          : session.status === "failed"
                            ? "destructive"
                            : "neutral"
                      }
                    >
                      {session.visibility === "visible"
                        ? session.status
                        : "history"}
                    </Badge>
                  </div>
                  <code
                    className="mt-1 block truncate text-[10px] text-muted-foreground"
                    title={session.cwd}
                  >
                    {session.cwd}
                  </code>
                </div>
                {project.status === "active" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      busy ||
                      (session.kind === "codex" &&
                        session.visibility !== "visible" &&
                        !session.codex_session_id)
                    }
                    onClick={() => onOpenSession(session)}
                  >
                    {session.visibility === "visible" ? "Open" : "Resume"}
                  </Button>
                )}
              </div>
            ))}
            {project.sessions.length === 0 && (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No Sessions
              </div>
            )}
          </div>
        </section>
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Workspaces</h2>
            <span className="text-[11px] text-muted-foreground">
              {rootWorkspaces.length}
            </span>
          </div>
          <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
            {rootWorkspaces.map((stream) => (
              <div
                key={stream.id}
                data-testid={`workspace-list-row-${stream.id}`}
                className="flex items-center gap-1"
              >
                <button
                  onClick={() => onOpen(stream.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left hover:bg-muted/50"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <Workflow className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {stream.name}
                      </p>
                      {stream.status === "archived" && <Badge>archived</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {stream.description || stream.checkout_path}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                </button>
                <div className="pr-2">
                  <RecordActionMenu
                    kind="workspace"
                    name={stream.name}
                    status={stream.status}
                    busy={busy}
                    onDelete={() => onDeleteWorkspace(stream)}
                    onDeleteBlocked={() => onDeleteWorkspaceBlocked(stream)}
                  />
                </div>
              </div>
            ))}
            {rootWorkspaces.length === 0 && (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No Workspaces yet
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

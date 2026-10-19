import { ArchivedCleanupMenu } from "@/features/workspace/ArchivedCleanupMenu";
import { useQuery } from "@tanstack/react-query";
import { projectWorktreesQuery } from "./queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProjectReviewSettings } from "@/features/agent-review/ProjectReviewSettings";
import { isSessionListed } from "@/features/terminal/model/sessionListVisibility";
import { sessionDisplayName } from "@/features/terminal/model/sessionDisplayName";
import { AGENT_NAMES, isAgentKind } from "@/features/agents/model";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { useTranslation } from "react-i18next";
import { SessionListActions } from "@/features/terminal/SessionListActions";
import {
  Bot,
  ArrowUpRight,
  PanelsTopLeft,
  Plus,
  TerminalSquare,
  Workflow,
  CircleAlert,
  RefreshCw,
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
  Workspace,
  WorktreeDeleteOperation,
} from "@/domain/types";

export function ProjectHome({
  project,
  busy,
  onOpen,
  onCreateWorkspace,
  onDeleteWorkspace,
  onDeleteWorkspaceBlocked,
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
  onCreateWorkspace: () => void;
  onDeleteWorkspace: (stream: Workspace) => void;
  onDeleteWorkspaceBlocked: (stream: Workspace) => void;
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
  const { t } = useTranslation();
  const worktrees = useQuery(projectWorktreesQuery(project.id));
  const sessions = project.sessions.filter(isSessionListed);
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
            <p className="text-xs text-muted-foreground">{t("projectsUi.projectMultiRepositoryLocations")}</p>
            {project.status === "archived" && (
              <Badge>{t("labels.archivedReadOnly")}</Badge>
            )}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {project.description}
          </p>
          {project.status === "active" && <div className="mt-4"><ProjectReviewSettings key={project.id} projectId={project.id} /></div>}
        </div>
        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t("projectsUi.repositories")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("projectsUi.eachRepositoryContainsPeerDirectoriesAndWorktreesGroups")}</p>
            </div>
            {project.status === "active" && (
              <Button
                data-testid="project-add-location"
                size="sm"
                onClick={onAddDirectory}
              >
                <Plus data-icon="inline-start" />{t("projectsUi.addLocation")}</Button>
            )}
          </div>
          {worktrees.isPending && (
            <p role="status" className="mt-3 text-xs text-muted-foreground">{t("workspaceUi.loadingWorktreeStatus")}</p>
          )}
          {worktrees.isError && (
            <Alert variant="destructive" className="mt-3">
              <CircleAlert />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{t("workspaceUi.worktreeStatusLoadFailed")}</span>
                <Button size="sm" variant="outline" disabled={worktrees.isFetching} onClick={() => void worktrees.refetch()}>
                  <RefreshCw data-icon="inline-start" />{t("workspaceUi.retryWorktreeStatus")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
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
                  worktrees={(worktrees.data ?? []).filter(
                    (item) => item.project_repository_id === repository.id,
                  )}
                  worktreesLoaded={worktrees.data !== undefined}
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
              <div className="py-10 text-center text-xs text-muted-foreground">{t("projectsUi.addAGitDirectoryBeforeCreatingAWorkspace")}</div>
            )}
          </div>
        </section>
        {contextDirectories.length > 0 && (
          <section className="mt-8" data-testid="project-context-directories">
            <h2 className="text-sm font-semibold">{t("projectsUi.nonGitDirectories")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("projectsUi.contextDirectoriesDescription")}</p>
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
        <section data-testid="project-workspaces-section" className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("projectsUi.workspaces")}</h2>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground">{rootWorkspaces.length}</span>
              {project.status === "active" && (
                <Button size="sm" disabled={busy} onClick={onCreateWorkspace}>
                  <Plus data-icon="inline-start" />{t("sidebar.newWorkspace")}
                </Button>
              )}
              <ArchivedCleanupMenu key={project.id} scope="project" id={project.id}
                hasArchived={rootWorkspaces.some(workspace => workspace.status === "archived")} busy={busy} />
            </div>
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
                      {stream.status === "archived" && <Badge>{t("labels.archived")}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {stream.description || stream.checkout_path}
                    </p>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-foreground" />
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
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyTitle>{t(project.status === "active" ? "projectsUi.startFeature" : "projectsUi.noWorkspacesYet")}</EmptyTitle>
                  {project.status === "active" && <EmptyDescription>{t("projectsUi.startFeatureDescription")}</EmptyDescription>}
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </section>
        <section data-testid="project-sessions-section" className="mt-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">{t("projectsUi.projectSessions")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("projectsUi.projectSessionsDescription")}</p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {sessions.length}
            </span>
          </div>
          <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
            {sessions.map((session) => (
              <div
                key={session.id}
                data-testid={`project-session-${session.id}`}
                className="flex items-center gap-3 p-4"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                  {isAgentKind(session.kind) ? (
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
                      {sessionDisplayName(session)}
                    </p>
                    <Badge>
                      {isAgentKind(session.kind)
                        ? AGENT_NAMES[session.kind]
                        : session.kind === "command"
                          ? t("projectsUi.command")
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
                        ? t(session.initializing ? "terminalUi.initializing" : `states.${session.status}`, { defaultValue: session.status })
                        : t("projectsUi.history")}
                    </Badge>
                  </div>
                  <code
                    className="mt-1 block truncate text-[10px] text-muted-foreground"
                    title={session.cwd}
                  >
                    {session.cwd}
                  </code>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <SessionListActions session={session} path={`/projects/${project.id}/sessions/${session.id}`} available={project.status === "active"} busy={busy} />
                </div>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="py-10 text-center text-xs text-muted-foreground">{t("projectsUi.noSessions")}</div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

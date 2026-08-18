import { useMemo, useState } from "react";
import type * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  Folders,
  GitBranch,
  Pencil,
  RefreshCw,
  Trash2,
  Workflow,
} from "lucide-react";
import { ActionMenu, ActionMenuItem } from "@/components/app/ActionMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  Directory,
  GitWorktree,
  ProjectRepository,
} from "@/domain/types";
import { formatRepositoryRelativePath } from "@/lib/repositoryPath";

function repositoryLabel(remote?: string) {
  if (!remote) return "Local Git repository";
  return remote
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "");
}

export function ProjectLocationTreeRow({
  directory,
  scopes = [],
  worktrees,
  busy,
  readOnly,
  onOpen,
  onEdit,
  onEditScope,
  onRefresh,
  onMakeDefault,
  onReattach,
  onDeleteWorktree,
}: {
  directory: Directory;
  scopes?: Directory[];
  worktrees: GitWorktree[];
  busy: boolean;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onEdit: () => void;
  onEditScope?: (scope: Directory) => void;
  onRefresh: () => void;
  onMakeDefault: () => void;
  onReattach: () => void;
  onDeleteWorktree: (worktree: GitWorktree) => void;
}) {
  const isRepository = directory.git_status !== "not_git";
  const [expanded, setExpanded] = useState(
    isRepository &&
      (directory.role === "primary" || directory.git_status !== "ready"),
  );
  const orderedWorktrees = useMemo(
    () =>
      [...worktrees].sort(
        (left, right) => Number(right.is_main) - Number(left.is_main),
      ),
    [worktrees],
  );
  const currentBranch =
    directory.branch ||
    (directory.head_commit
      ? `detached @ ${directory.head_commit.slice(0, 7)}`
      : "detached");
  const repositoryDetails = (
    <>
      <span>
        current{" "}
        <strong className="font-medium text-foreground">{currentBranch}</strong>
      </span>
      <span>·</span>
      <span>
        base{" "}
        <strong className="font-medium text-foreground">
          {directory.base_branch || "—"}
        </strong>
      </span>
      <span>·</span>
      <span>{repositoryLabel(directory.repository_url)}</span>
      <span>·</span>
      <span>
        {directory.delivery_mode === "local_merge"
          ? "local merge"
          : "remote review"}
      </span>
    </>
  );
  const locationSummary = (
    <>
      <div
        data-testid={`project-location-icon-${directory.id}`}
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"
      >
        {isRepository ? (
          <FolderGit2 className="size-4" />
        ) : (
          <Folder className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{directory.name}</h3>
          <Badge>{directory.role}</Badge>
          <Badge
            variant={
              directory.git_status === "ready"
                ? "success"
                : directory.git_status === "not_git"
                  ? "secondary"
                  : "destructive"
            }
          >
            {directory.git_status}
          </Badge>
          {directory.worktree_setup_command && <Badge>Setup</Badge>}
          {isRepository && (
            <span className="text-[10px] text-muted-foreground">
              {worktrees.length}{" "}
              {worktrees.length === 1 ? "worktree" : "worktrees"}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {directory.description || "No purpose described yet."}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          {isRepository && repositoryDetails}
          <code className="min-w-0 truncate" title={directory.path}>
            {directory.path}
          </code>
        </div>
      </div>
    </>
  );

  return (
    <article data-testid={`project-location-${directory.id}`}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-start gap-3 p-4">
          {isRepository ? (
            <button
              data-testid={`project-location-toggle-${directory.id}`}
              className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-expanded={expanded}
              aria-controls={`project-location-worktrees-${directory.id}`}
              aria-label={`${expanded ? "Collapse" : "Expand"} repository ${directory.name}`}
              onClick={() => setExpanded((value) => !value)}
            >
              <span
                data-testid={`project-location-chevron-${directory.id}`}
                className="mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground"
              >
                {expanded ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </span>
              {locationSummary}
            </button>
          ) : (
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {locationSummary}
            </div>
          )}
          {!readOnly && (
            <div className="flex shrink-0 gap-1">
              <Button
                data-testid={`project-location-refresh-${directory.id}`}
                size="icon"
                variant="ghost"
                disabled={busy}
                aria-label={`Refresh ${directory.name}`}
                title={`Refresh ${directory.name}`}
                onClick={onRefresh}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
              <ActionMenu
                label={`Actions for ${directory.name}`}
                testId={`project-location-actions-${directory.id}`}
                disabled={busy}
              >
                {directory.git_status === "ready" &&
                  directory.role !== "primary" && (
                    <ActionMenuItem
                      icon={<FolderGit2 className="size-3.5" />}
                      disabled={busy}
                      testId={`project-location-make-default-${directory.id}`}
                      onClick={onMakeDefault}
                    >
                      Make default
                    </ActionMenuItem>
                  )}
                {["missing", "broken", "mismatch"].includes(
                  directory.git_status,
                ) && (
                  <ActionMenuItem
                    icon={<RefreshCw className="size-3.5" />}
                    disabled={busy}
                    onClick={onReattach}
                  >
                    Relink
                  </ActionMenuItem>
                )}
                <ActionMenuItem
                  icon={<Pencil className="size-3.5" />}
                  disabled={busy}
                  testId={`project-location-edit-${directory.id}`}
                  onClick={onEdit}
                >
                  Edit location
                </ActionMenuItem>
              </ActionMenu>
            </div>
          )}
        </div>
        {isRepository && expanded && (
          <CollapsibleContent
            id={`project-location-worktrees-${directory.id}`}
            data-testid={`project-location-worktrees-${directory.id}`}
            role="group"
            aria-label={`Scopes and worktrees for ${directory.name}`}
            className="border-t border-border/60 bg-muted/60 px-4 py-2"
          >
            {scopes.length > 0 && (
              <div
                className="ml-5 border-l border-border pb-2"
                data-testid={`project-repository-scopes-${directory.id}`}
              >
                {scopes.map((scope) => (
                  <div
                    key={scope.id}
                    data-testid={`project-directory-${scope.id}`}
                    className="flex min-w-0 items-center gap-3 py-2 pl-5"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {scope.name}
                        </span>
                        {scope.role === "primary" && <Badge>Default</Badge>}
                      </div>
                      <code
                        className="mt-1 block truncate text-[10px] text-muted-foreground"
                        title={scope.path}
                      >
                        {formatRepositoryRelativePath(scope.relative_path)}
                      </code>
                      {scope.description && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {scope.description}
                        </p>
                      )}
                    </div>
                    {!readOnly && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit Directory ${scope.name}`}
                        onClick={() => onEditScope?.(scope)}
                      >
                        <Pencil data-icon="inline-start" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="ml-5 divide-y divide-border border-l border-border">
              {orderedWorktrees.map((item) => (
                <div
                  key={`${item.project_location_id}:${item.path}`}
                  data-testid="project-worktree-row"
                  data-project-location-id={directory.id}
                  className="flex min-w-0 items-center gap-3 py-3 pl-5"
                >
                  <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {item.branch || "detached"}
                      </span>
                      {item.is_main && <Badge>Main checkout</Badge>}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                      {item.head_commit && (
                        <>
                          <span className="font-mono">
                            {item.head_commit.slice(0, 10)}
                          </span>
                          <span>·</span>
                        </>
                      )}
                      <code className="min-w-0 truncate" title={item.path}>
                        {item.path}
                      </code>
                    </div>
                  </div>
                  {item.workspace_id && (
                    <Badge
                      variant="outline"
                      className="max-w-48"
                      render={
                        <button
                          type="button"
                          aria-label={`Open Workspace ${item.workspace_name || item.workspace_id}`}
                          title={`Open Workspace “${item.workspace_name || item.workspace_id}”`}
                          onClick={() => onOpen(item.workspace_id!)}
                        />
                      }
                    >
                      <Workflow data-icon="inline-start" />
                      <span className="truncate">
                        {item.workspace_name || "Workspace"}
                      </span>
                    </Badge>
                  )}
                  {!readOnly && !item.is_main && (
                    <Button
                      size="icon"
                      variant={
                        item.workspace_id ? "muted" : "destructive-ghost"
                      }
                      disabled={busy}
                      aria-disabled={Boolean(item.workspace_id)}
                      data-worktree-delete-state={
                        item.workspace_id ? "blocked" : "available"
                      }
                      aria-label={
                        item.workspace_id
                          ? `Cannot delete worktree ${item.path}: active Workspace ${item.workspace_name || item.workspace_id}`
                          : `Delete worktree ${item.path}`
                      }
                      title={
                        item.workspace_id
                          ? `Finish Workspace “${item.workspace_name || item.workspace_id}” before deleting this worktree`
                          : `Delete worktree ${item.path}`
                      }
                      onClick={() => onDeleteWorktree(item)}
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  )}
                </div>
              ))}
              {orderedWorktrees.length === 0 && (
                <div className="py-5 pl-5 text-xs text-muted-foreground">
                  No worktrees found for this repository.
                </div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </article>
  );
}

export function ProjectRepositoryTreeRow({
  repository,
  directories,
  worktrees,
  busy,
  readOnly,
  onOpen,
  onOpenBranches,
  onEditRepository,
  onEditDirectory,
  onRefresh,
  onMakeDefault,
  onReattach,
  onDeleteRepository,
  onDeleteDirectory,
  onDeleteWorktree,
}: {
  repository: ProjectRepository;
  directories: Directory[];
  worktrees: GitWorktree[];
  busy: boolean;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onOpenBranches: () => void;
  onEditRepository: () => void;
  onEditDirectory: (directory: Directory) => void;
  onRefresh: () => void;
  onMakeDefault: (directory: Directory) => void;
  onReattach: () => void;
  onDeleteRepository: () => void;
  onDeleteDirectory: (directory: Directory) => void;
  onDeleteWorktree: (worktree: GitWorktree) => void;
}) {
  const [expanded, setExpanded] = useState(
    directories.some((directory) => directory.role === "primary") ||
      repository.git_status !== "ready",
  );
  const orderedWorktrees = useMemo(
    () =>
      [...worktrees].sort(
        (left, right) => Number(right.is_main) - Number(left.is_main),
      ),
    [worktrees],
  );
  const observedDirectory = directories[0];
  const mainWorktree = worktrees.find((item) => item.is_main);
  const currentBranch =
    mainWorktree?.branch && mainWorktree.branch !== "detached HEAD"
      ? mainWorktree.branch
      : observedDirectory?.branch ||
        (mainWorktree?.head_commit
          ? `detached @ ${mainWorktree.head_commit.slice(0, 7)}`
          : "detached");

  return (
    <article data-testid={`project-location-${repository.id}`}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-start gap-3 p-4">
          <button
            type="button"
            data-testid={`project-location-toggle-${repository.id}`}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={expanded}
            aria-controls={`project-repository-children-${repository.id}`}
            aria-label={`${expanded ? "Collapse" : "Expand"} repository ${repository.name}`}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground">
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </span>
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
              <FolderGit2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">
                  {repository.name}
                </h3>
                <Badge
                  variant={
                    repository.git_status === "ready"
                      ? "success"
                      : "destructive"
                  }
                >
                  {repository.git_status}
                </Badge>
                {repository.setup_command && <Badge>Setup</Badge>}
                <span className="text-[10px] text-muted-foreground">
                  {directories.length}{" "}
                  {directories.length === 1 ? "dir" : "dirs"}
                </span>
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                <span>
                  base{" "}
                  <strong className="font-medium text-foreground">
                    {repository.base_branch}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  current{" "}
                  <strong className="font-medium text-foreground">
                    {currentBranch}
                  </strong>
                </span>
                <span>·</span>
                <span>{repositoryLabel(repository.repository_url)}</span>
                <span>·</span>
                <span>
                  {repository.delivery_mode === "local_merge"
                    ? "local merge"
                    : "remote review"}
                </span>
              </div>
              <code
                className="mt-1 block min-w-0 truncate text-[10px] text-muted-foreground"
                title={repository.source_root}
              >
                {repository.source_root}
              </code>
            </div>
          </button>
          {!readOnly && (
            <div className="flex shrink-0 gap-1">
              <Button
                data-testid={`project-location-refresh-${repository.id}`}
                size="icon"
                variant="ghost"
                disabled={busy}
                aria-label={`Refresh ${repository.name}`}
                title={`Refresh ${repository.name}`}
                onClick={onRefresh}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
              <ActionMenu
                label={`Actions for repository ${repository.name}`}
                testId={`project-location-actions-${repository.id}`}
                disabled={busy}
              >
                {["missing", "broken", "mismatch"].includes(
                  repository.git_status,
                ) && (
                  <ActionMenuItem
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={onReattach}
                  >
                    Relink
                  </ActionMenuItem>
                )}
                <ActionMenuItem
                  icon={<GitBranch className="size-3.5" />}
                  testId={`project-repository-branches-${repository.id}`}
                  onClick={onOpenBranches}
                >
                  Branch
                </ActionMenuItem>
                <ActionMenuItem
                  icon={<Pencil className="size-3.5" />}
                  testId={`project-repository-edit-${repository.id}`}
                  onClick={onEditRepository}
                >
                  Edit repository
                </ActionMenuItem>
                <ActionMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  onClick={onDeleteRepository}
                >
                  Remove from project
                </ActionMenuItem>
              </ActionMenu>
            </div>
          )}
        </div>
        {expanded && (
          <CollapsibleContent
            id={`project-repository-children-${repository.id}`}
            data-testid={`project-repository-children-${repository.id}`}
            role="group"
            aria-label={`Directories and worktrees for ${repository.name}`}
            className="border-t border-border/60 bg-muted/60 px-4 py-2"
          >
            <div className="ml-5 divide-y divide-border border-l border-border">
              <ProjectRepositoryChildGroup
                id={`project-repository-directories-${repository.id}`}
                label="Directories"
                subject={repository.name}
                count={directories.length}
                icon={Folders}
              >
                {directories.map((directory) => (
                  <ProjectDirectoryTreeRow
                    key={directory.id}
                    directory={directory}
                    busy={busy}
                    readOnly={readOnly}
                    onEdit={() => onEditDirectory(directory)}
                    onMakeDefault={() => onMakeDefault(directory)}
                    onDelete={() => onDeleteDirectory(directory)}
                  />
                ))}
              </ProjectRepositoryChildGroup>
              <ProjectRepositoryChildGroup
                id={`project-repository-worktrees-${repository.id}`}
                label="Worktrees"
                subject={repository.name}
                count={orderedWorktrees.length}
                icon={GitBranch}
              >
                {orderedWorktrees.map((item) => (
                  <div
                    key={item.path}
                    data-testid="project-worktree-row"
                    data-project-location-id={repository.id}
                    className="flex min-w-0 items-center gap-3 py-3 pl-5"
                  >
                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {item.branch || "detached"}
                        </span>
                        {item.is_main && <Badge>Main checkout</Badge>}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                        {item.head_commit && (
                          <>
                            <span className="font-mono">
                              {item.head_commit.slice(0, 10)}
                            </span>
                            <span>·</span>
                          </>
                        )}
                        <code className="min-w-0 truncate" title={item.path}>
                          {item.path}
                        </code>
                      </div>
                    </div>
                    {item.workspace_id && (
                      <Badge
                        variant="outline"
                        className="max-w-48"
                        render={
                          <button
                            type="button"
                            aria-label={`Open Workspace ${item.workspace_name || item.workspace_id}`}
                            title={`Open Workspace “${item.workspace_name || item.workspace_id}”`}
                            onClick={() => onOpen(item.workspace_id!)}
                          />
                        }
                      >
                        <Workflow data-icon="inline-start" />
                        <span className="truncate">
                          {item.workspace_name || "Workspace"}
                        </span>
                      </Badge>
                    )}
                    {!readOnly && !item.is_main && (
                      <Button
                        size="icon"
                        variant={
                          item.workspace_id ? "muted" : "destructive-ghost"
                        }
                        disabled={busy}
                        aria-disabled={Boolean(item.workspace_id)}
                        data-worktree-delete-state={
                          item.workspace_id ? "blocked" : "available"
                        }
                        aria-label={
                          item.workspace_id
                            ? `Cannot delete worktree ${item.path}: active Workspace ${item.workspace_name || item.workspace_id}`
                            : `Delete worktree ${item.path}`
                        }
                        title={
                          item.workspace_id
                            ? `Finish Workspace “${item.workspace_name || item.workspace_id}” before deleting this worktree`
                            : `Delete worktree ${item.path}`
                        }
                        onClick={() => onDeleteWorktree(item)}
                      >
                        <Trash2 data-icon="inline-start" />
                      </Button>
                    )}
                  </div>
                ))}
                {orderedWorktrees.length === 0 && (
                  <div className="py-4 pl-5 text-xs text-muted-foreground">
                    No worktrees found for this repository.
                  </div>
                )}
              </ProjectRepositoryChildGroup>
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </article>
  );
}

function ProjectRepositoryChildGroup({
  id,
  label,
  subject,
  count,
  icon: Icon,
  children,
}: {
  id: string;
  label: string;
  subject: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        data-testid={`${id}-toggle`}
        className="flex w-full min-w-0 items-center gap-3 py-2 pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()} for ${subject}`}
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {label}
        </span>
        <Badge variant="secondary" className="mr-3">
          {count}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent
        id={id}
        data-testid={id}
        role="group"
        aria-label={`${label} for ${subject}`}
        className="ml-8 divide-y divide-border border-l border-border"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProjectDirectoryTreeRow({
  directory,
  busy,
  readOnly,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  directory: Directory;
  busy: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={`project-directory-${directory.id}`}
      className="flex min-w-0 items-center gap-3 py-2 pl-5"
    >
      <Folder className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{directory.name}</span>
          {directory.role === "primary" && <Badge>Default</Badge>}
        </div>
        <code
          className="mt-1 block truncate text-[10px] text-muted-foreground"
          title={directory.path}
        >
          {formatRepositoryRelativePath(directory.relative_path)}
        </code>
        {directory.description && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {directory.description}
          </p>
        )}
      </div>
      {!readOnly && (
        <ActionMenu
          label={`Actions for directory ${directory.name}`}
          testId={`project-directory-actions-${directory.id}`}
          disabled={busy}
        >
          {directory.role !== "primary" && (
            <ActionMenuItem
              icon={<Folder className="size-3.5" />}
              testId={`project-directory-make-default-${directory.id}`}
              onClick={onMakeDefault}
            >
              Make default
            </ActionMenuItem>
          )}
          <ActionMenuItem
            icon={<Pencil className="size-3.5" />}
            testId={`project-directory-edit-${directory.id}`}
            onClick={onEdit}
          >
            Edit directory
          </ActionMenuItem>
          <ActionMenuItem
            icon={<Trash2 className="size-3.5" />}
            onClick={onDelete}
          >
            Remove from project
          </ActionMenuItem>
        </ActionMenu>
      )}
    </div>
  );
}

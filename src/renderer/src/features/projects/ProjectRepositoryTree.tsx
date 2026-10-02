import { PruneWorktreesDialog } from "@/features/projects/PruneWorktreesDialog";
import { WorktreeStatusBadges } from "@/features/projects/WorktreeStatusBadges";
import { WorktreeWorkspaceButton } from "@/features/workspace/WorktreeWorkspaceButton";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useMemo, useState } from "react";
import type * as React from "react";
import {
  BrushCleaning,
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
import { DirectoryActionsMenu } from "@/features/open-in/DirectoryActionsMenu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MetadataList, MetadataListItem } from "@/components/ui/metadata-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  Directory,
  GitWorktree,
  ProjectRepository,
  WorktreeDeleteOperation,
} from "@/domain/types";
import { formatRepositoryRelativePath } from "@/lib/repositoryPath";

function repositoryLabel(remote?: string) {
  if (!remote) return i18n.t("projectsUi.localGitRepository");
  return remote
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "");
}


export function DirectoryTreeRow({
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
  worktreeDeletions,
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
  worktreeDeletions: Record<string, WorktreeDeleteOperation>;
}) {
  const { t } = useTranslation();
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
      ? t("projectsUi.detached", { commit: directory.head_commit.slice(0, 7) })
      : t("projectsUi.detachedHead"));
  const repositoryDetails = (
    <MetadataList size="compact">
      <MetadataListItem label={t("labels.current")}>
        <code>{currentBranch}</code>
      </MetadataListItem>
      <MetadataListItem label={t("labels.repository")}>
        {repositoryLabel(directory.repository_url)}
      </MetadataListItem>
    </MetadataList>
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
            {t(`states.${directory.git_status}`, { defaultValue: directory.git_status })}
          </Badge>
          {directory.worktree_setup_command && <Badge>{t("projectsUi.setup")}</Badge>}
          {isRepository && (
            <span className="text-[10px] text-muted-foreground">
              {t("counts.worktree", { count: worktrees.length })}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {directory.description || t("projectsUi.noPurposeDescribedYet")}
        </p>
        <div className="mt-2 flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground">
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
              aria-label={t(expanded ? "navigation.collapseRepository" : "navigation.expandRepository", { name: directory.name })}
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
          <div className="flex shrink-0 gap-1">
            {!readOnly && (
              <Button
                data-testid={`project-location-refresh-${directory.id}`}
                size="icon"
                variant="ghost"
                disabled={busy}
                aria-label={t("projectsUi.refresh", { name: directory.name })}
                title={t("projectsUi.refresh", { name: directory.name })}
                onClick={onRefresh}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
            )}
            <DirectoryActionsMenu
              path={directory.path}
              name={directory.name}
              label={t("projectsUi.actionsFor", { name: directory.name })}
              testId={`project-location-actions-${directory.id}`}
              disabled={busy}
            >
              {!readOnly && (
                <>
                  {directory.git_status === "ready" &&
                    directory.role !== "primary" && (
                      <DropdownMenuItem
                        disabled={busy}
                        data-testid={`project-location-make-default-${directory.id}`}
                        onClick={onMakeDefault}
                      >
                        <FolderGit2 />
                        {t("projectsUi.makeDefault")}
                      </DropdownMenuItem>
                    )}
                  {["missing", "broken", "mismatch"].includes(
                    directory.git_status,
                  ) && (
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={onReattach}
                    >
                      <RefreshCw />
                      {t("projectsUi.relink")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={busy}
                    data-testid={`project-location-edit-${directory.id}`}
                    onClick={onEdit}
                  >
                    <Pencil />
                    {t("projectsUi.editLocation")}
                  </DropdownMenuItem>
                </>
              )}
            </DirectoryActionsMenu>
          </div>
        </div>
        {isRepository && expanded && (
          <CollapsibleContent
            id={`project-location-worktrees-${directory.id}`}
            data-testid={`project-location-worktrees-${directory.id}`}
            role="group"
            aria-label={t("projectsUi.scopesAndWorktreesFor", { name: directory.name })}
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
                        {scope.role === "primary" && <Badge>{t("projectsUi.default")}</Badge>}
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
                        aria-label={t("projectsUi.editDirectory", { name: scope.name })}
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
                  key={`${item.project_repository_id}:${item.path}`}
                  data-testid="project-worktree-row"
                  data-project-location-id={directory.id}
                  className="flex min-w-0 items-start gap-3 py-3 pl-5"
                >
                  <GitBranch className="mt-1.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-h-7 flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {item.branch || t("projectsUi.detachedHead")}
                      </span>
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
                    <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                      {item.is_main && <Badge>{t("projectsUi.mainCheckout")}</Badge>}
                      {item.workspace_id && (
                        <Badge
                          variant="outline"
                          className="max-w-48"
                          render={
                            <button
                              type="button"
                              aria-label={t("projectsUi.openWorkspace", { name: item.workspace_name || item.workspace_id })}
                              title={t("projectsUi.openWorkspace2", { name: item.workspace_name || item.workspace_id })}
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
                      <WorktreeStatusBadges worktree={item} />
                      {worktreeDeletions[item.path]?.status === "deleting" && (
                        <Badge variant="secondary">
                          <Spinner data-icon="inline-start" />{t("projectsUi.deleting")}</Badge>
                      )}
                      {worktreeDeletions[item.path]?.status === "failed" && (
                        <Badge variant="destructive">{t("projectsUi.deleteFailed")}</Badge>
                      )}
                    </div>
                  </div>
                  {!readOnly && !item.is_main && (
                    <Button
                      size="icon"
                      variant={
                        item.workspace_id ||
                        worktreeDeletions[item.path]?.status === "deleting"
                          ? "muted"
                          : "destructive-ghost"
                      }
                      disabled={
                        busy ||
                        worktreeDeletions[item.path]?.status === "deleting"
                      }
                      aria-disabled={Boolean(
                        item.workspace_id ||
                          worktreeDeletions[item.path]?.status === "deleting",
                      )}
                      data-worktree-delete-state={
                        item.workspace_id
                          ? "blocked"
                          : worktreeDeletions[item.path]?.status === "deleting"
                            ? "deleting"
                            : "available"
                      }
                      aria-label={
                        item.workspace_id
                          ? t("projectsUi.cannotDeleteWorktreeActiveWorkspace", { path: item.path, name: item.workspace_name || item.workspace_id })
                          : worktreeDeletions[item.path]?.status === "deleting"
                            ? t("projectsUi.deletingWorktree", { path: item.path })
                          : t("projectsUi.deleteWorktree3", { path: item.path })
                      }
                      title={
                        item.workspace_id
                          ? t("projectsUi.finishWorkspaceBeforeDeletingThisWorktree", { name: item.workspace_name || item.workspace_id })
                          : worktreeDeletions[item.path]?.status === "deleting"
                            ? t("projectsUi.worktreeDeletionInProgress")
                          : t("projectsUi.deleteWorktree3", { path: item.path })
                      }
                      onClick={() => onDeleteWorktree(item)}
                    >
                      {worktreeDeletions[item.path]?.status === "deleting" ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Trash2 data-icon="inline-start" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
              {orderedWorktrees.length === 0 && (
                <div className="py-5 pl-5 text-xs text-muted-foreground">{t("projectsUi.noWorktreesFoundForThisRepository")}</div>
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
  worktreeDeletions,
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
  worktreeDeletions: Record<string, WorktreeDeleteOperation>;
}) {
  const { t } = useTranslation();
  const [pruneOpen, setPruneOpen] = useState(false);
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
          ? t("projectsUi.detached", { commit: mainWorktree.head_commit.slice(0, 7) })
          : t("projectsUi.detachedHead"));

  return (
    <article data-testid={`project-location-${repository.id}`}>
      {pruneOpen && <PruneWorktreesDialog repository={repository} onClose={() => setPruneOpen(false)} />}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-start gap-3 p-4">
          <button
            type="button"
            data-testid={`project-location-toggle-${repository.id}`}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={expanded}
            aria-controls={`project-repository-children-${repository.id}`}
            aria-label={t(expanded ? "navigation.collapseRepository" : "navigation.expandRepository", { name: repository.name })}
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
                  {t(`states.${repository.git_status}`, { defaultValue: repository.git_status })}
                </Badge>
                {repository.setup_command && <Badge>{t("projectsUi.setup")}</Badge>}
                <span className="text-[10px] text-muted-foreground">
                  {t("counts.directory", { count: directories.length })}
                </span>
              </div>
              <MetadataList size="compact" className="mt-2">
                <MetadataListItem label={t("labels.current")}>
                  <code>{currentBranch}</code>
                </MetadataListItem>
                <MetadataListItem label={t("labels.repository")}>
                  {repositoryLabel(repository.repository_url)}
                </MetadataListItem>
              </MetadataList>
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
                aria-label={t("projectsUi.refresh", { name: repository.name })}
                title={t("projectsUi.refresh", { name: repository.name })}
                onClick={onRefresh}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
              <ActionMenu
                label={t("projectsUi.actionsForRepository", { name: repository.name })}
                testId={`project-location-actions-${repository.id}`}
                disabled={busy}
              >
                {["missing", "broken", "mismatch"].includes(
                  repository.git_status,
                ) && (
                  <ActionMenuItem
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={onReattach}
                  >{t("projectsUi.relink")}</ActionMenuItem>
                )}
                <ActionMenuItem
                  icon={<GitBranch className="size-3.5" />}
                  testId={`project-repository-branches-${repository.id}`}
                  onClick={onOpenBranches}
                >{t("projectsUi.branch")}</ActionMenuItem>
                <ActionMenuItem
                  icon={<BrushCleaning className="size-3.5" />}
                  disabled={repository.git_status !== "ready"}
                  onClick={() => setPruneOpen(true)}
                >{t("projectsUi.worktreePruneMenu")}</ActionMenuItem>
                <ActionMenuItem
                  icon={<Pencil className="size-3.5" />}
                  testId={`project-repository-edit-${repository.id}`}
                  onClick={onEditRepository}
                >{t("projectsUi.editRepository")}</ActionMenuItem>
                <ActionMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  onClick={onDeleteRepository}
                >{t("projectsUi.removeFromProject")}</ActionMenuItem>
              </ActionMenu>
            </div>
          )}
        </div>
        {expanded && (
          <CollapsibleContent
            id={`project-repository-children-${repository.id}`}
            data-testid={`project-repository-children-${repository.id}`}
            role="group"
            aria-label={t("projectsUi.directoriesAndWorktreesFor", { name: repository.name })}
            className="border-t border-border/60 bg-muted/60 px-4 py-2"
          >
            <div className="ml-5 divide-y divide-border border-l border-border">
              <ProjectRepositoryChildGroup
                id={`project-repository-directories-${repository.id}`}
                label={t("projectsUi.directories")}
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
                label={t("projectsUi.worktrees")}
                subject={repository.name}
                count={orderedWorktrees.length}
                icon={GitBranch}
              >
                {orderedWorktrees.map((item) => (
                  <div
                    key={item.path}
                    data-testid="project-worktree-row"
                    data-project-location-id={repository.id}
                    className="flex min-w-0 items-start gap-3 py-3 pl-5"
                  >
                    <GitBranch className="mt-1.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-h-7 flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {item.branch || t("projectsUi.detachedHead")}
                        </span>
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
                      <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                        {item.is_main && <Badge>{t("projectsUi.mainCheckout")}</Badge>}
                        {item.workspace_id && (
                          <Badge
                            variant="outline"
                            className="max-w-48"
                            render={
                              <button
                                type="button"
                                aria-label={t("projectsUi.openWorkspace", { name: item.workspace_name || item.workspace_id })}
                                title={t("projectsUi.openWorkspace2", { name: item.workspace_name || item.workspace_id })}
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
                        <WorktreeStatusBadges worktree={item} />
                        {worktreeDeletions[item.path]?.status === "deleting" && (
                          <Badge variant="secondary">
                            <Spinner data-icon="inline-start" />{t("projectsUi.deleting")}</Badge>
                        )}
                        {worktreeDeletions[item.path]?.status === "failed" && (
                          <Badge variant="destructive">{t("projectsUi.deleteFailed")}</Badge>
                        )}
                      </div>
                    </div>
                    <WorktreeWorkspaceButton
                      worktree={item}
                      readOnly={readOnly}
                      disabled={busy || worktreeDeletions[item.path]?.status === "deleting"}
                      onOpen={onOpen}
                    />
                    {!readOnly && !item.is_main && (
                      <Button
                        size="icon"
                        variant={
                          item.workspace_id ||
                          worktreeDeletions[item.path]?.status === "deleting"
                            ? "muted"
                            : "destructive-ghost"
                        }
                        disabled={
                          busy ||
                          worktreeDeletions[item.path]?.status === "deleting"
                        }
                        aria-disabled={Boolean(
                          item.workspace_id ||
                            worktreeDeletions[item.path]?.status === "deleting",
                        )}
                        data-worktree-delete-state={
                          item.workspace_id
                            ? "blocked"
                            : worktreeDeletions[item.path]?.status === "deleting"
                              ? "deleting"
                              : "available"
                        }
                        aria-label={
                          item.workspace_id
                            ? t("projectsUi.cannotDeleteWorktreeActiveWorkspace", { path: item.path, name: item.workspace_name || item.workspace_id })
                            : worktreeDeletions[item.path]?.status === "deleting"
                              ? t("projectsUi.deletingWorktree", { path: item.path })
                            : t("projectsUi.deleteWorktree3", { path: item.path })
                        }
                        title={
                          item.workspace_id
                            ? t("projectsUi.finishWorkspaceBeforeDeletingThisWorktree", { name: item.workspace_name || item.workspace_id })
                            : worktreeDeletions[item.path]?.status === "deleting"
                              ? t("projectsUi.worktreeDeletionInProgress")
                            : t("projectsUi.deleteWorktree3", { path: item.path })
                        }
                        onClick={() => onDeleteWorktree(item)}
                      >
                        {worktreeDeletions[item.path]?.status === "deleting" ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Trash2 data-icon="inline-start" />
                        )}
                      </Button>
                    )}
                  </div>
                ))}
                {orderedWorktrees.length === 0 && (
                  <div className="py-4 pl-5 text-xs text-muted-foreground">{t("projectsUi.noWorktreesFoundForThisRepository")}</div>
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        data-testid={`${id}-toggle`}
        className="flex w-full min-w-0 items-center gap-3 py-2 pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t(expanded ? "navigation.collapseGroup" : "navigation.expandGroup", { label, subject })}
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
        <span className="flex w-7 shrink-0 justify-center">
          <Badge variant="secondary">{count}</Badge>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent
        id={id}
        data-testid={id}
        role="group"
        aria-label={t("navigation.groupLabel", { label, subject })}
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
  const { t } = useTranslation();
  return (
    <div
      data-testid={`project-directory-${directory.id}`}
      className="flex min-w-0 items-center gap-3 py-2 pl-5"
    >
      <Folder className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{directory.name}</span>
          {directory.role === "primary" && <Badge>{t("projectsUi.default")}</Badge>}
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
      <DirectoryActionsMenu
        path={directory.path}
        name={directory.name}
        testId={`project-directory-actions-${directory.id}`}
        disabled={busy}
      >
        {!readOnly && (
          <>
            {directory.role !== "primary" && (
              <DropdownMenuItem
                data-testid={`project-directory-make-default-${directory.id}`}
                onClick={onMakeDefault}
              >
                <Folder />
                {t("projectsUi.makeDefault")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              data-testid={`project-directory-edit-${directory.id}`}
              onClick={onEdit}
            >
              <Pencil />
              {t("projectsUi.editDirectory2")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete}>
              <Trash2 />
              {t("projectsUi.removeFromProject")}
            </DropdownMenuItem>
          </>
        )}
      </DirectoryActionsMenu>
    </div>
  );
}

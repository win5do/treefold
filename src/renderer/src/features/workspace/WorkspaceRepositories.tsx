import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleAlert, Folder, GitBranch, RefreshCw, X } from "lucide-react";
import { ActionMenu, ActionMenuItem } from "@/components/app/ActionMenu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetadataList, MetadataListItem } from "@/components/ui/metadata-list";
import { WorktreeStatusBadges } from "@/features/git/WorktreeStatusBadges";
import { DirectoryActionsMenu } from "@/features/open-in/DirectoryActionsMenu";
import { projectDetailQuery } from "@/features/projects/queries";
import type { GitWorktree, WorkspaceDetail, WorkspaceDirectory, WorkspaceRepository } from "@/domain/types";
import { formatRepositoryRelativePath } from "@/lib/repositoryPath";

export function WorkspaceRepositories({
  detail, busy, onResync, onConfigureUpstream, onClearUpstream,
}: {
  detail: WorkspaceDetail;
  busy: boolean;
  onResync: () => void;
  onConfigureUpstream: (location: WorkspaceRepository) => void;
  onClearUpstream: (location: WorkspaceRepository) => void;
}) {
  const { t } = useTranslation();
  const worktrees = useQuery({
    ...projectDetailQuery(detail.project.id),
    enabled: detail.repositories.some((repository) => Boolean(repository.checkout_path)),
    select: (project) => project.worktrees,
  });
  return (
    <section data-testid="workspace-repositories-section" className="mt-8">
      <div className="flex items-start justify-between gap-4 pr-[calc(1rem+1px)]">
        <div>
          <h2 className="text-sm font-semibold">{t("workspaceUi.workspaceRepositories")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("workspaceUi.repositoryLifecycleDescription")}</p>
        </div>
        {detail.status === "active" && (
          <ActionMenu
            label={t("workspaceUi.actions")}
            testId="workspace-repositories-actions"
            disabled={busy}
          >
            <ActionMenuItem
              icon={<RefreshCw className="size-3.5" />}
              disabled={busy}
              onClick={onResync}
            >
              {t("workspaceUi.resync")}
            </ActionMenuItem>
          </ActionMenu>
        )}
      </div>
      {worktrees.isLoading && (
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
      <div className="mt-3 grid gap-3">
        {detail.repositories.map((location) => (
          <WorkspaceRepositoryRow
            key={location.id}
            location={location}
            worktree={worktrees.data?.find((item) =>
              item.project_repository_id === location.project_repository_id &&
              item.path === location.checkout_path
            )}
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
  );
}

function WorkspaceRepositoryRow({
  location,
  worktree,
  scopes,
  busy,
  actionsEnabled,
  onConfigureUpstream,
  onClearUpstream,
}: {
  location: WorkspaceRepository;
  worktree?: GitWorktree;
  scopes: WorkspaceDirectory[];
  busy: boolean;
  actionsEnabled: boolean;
  onConfigureUpstream: () => void;
  onClearUpstream: () => void;
}) {
  const { t } = useTranslation();
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
              {t(`states.${location.git_status}`, { defaultValue: location.git_status })}
            </Badge>
            <Badge>{t(`states.${location.access_mode}`, { defaultValue: location.access_mode })}</Badge>
            <Badge>{location.close_outcome === "skipped" ? t("deliveryUi.batchStates.skipped") : t(`states.${location.delivery_status}`, { defaultValue: location.delivery_status })}</Badge>
          </div>
          <div className="mt-3 flex min-w-0 items-start gap-3">
            <GitBranch className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1" data-testid={`workspace-worktree-${location.id}`}>
              {(worktree || location.branch) && (
                <p className="truncate text-sm font-semibold" title={worktree?.branch || location.branch}>
                  {worktree ? worktree.branch || t("projectsUi.detachedHead") : location.branch}
                </p>
              )}
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                {worktree?.head_commit && <><span className="shrink-0 font-mono">{worktree.head_commit.slice(0, 10)}</span><span>·</span></>}
                <code className="min-w-0 truncate" title={location.checkout_path ?? location.source_root}>
                  {location.checkout_path ?? location.source_root}
                </code>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                {worktree && <WorktreeStatusBadges worktree={worktree} />}
              </div>
            </div>
          </div>
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
            <MetadataList className="mt-2">
              <MetadataListItem label={t("labels.base")}>
                <code>{location.base_branch}</code>
              </MetadataListItem>
              <MetadataListItem label={t("labels.upstream")}>
                <code>{upstream || "—"}</code>
              </MetadataListItem>
            </MetadataList>
          )}
        </div>
        {actionsEnabled && writableGit && (
          <div className="-mt-2 self-start">
            <ActionMenu
              label={t("workspaceUi.actionsFor", { name: location.repository_name })}
              testId={`workspace-location-actions-${location.id}`}
              disabled={busy}
            >
              <ActionMenuItem
                icon={<GitBranch className="size-3.5" />}
                disabled={busy}
                testId={`workspace-location-upstream-${location.id}`}
                onClick={onConfigureUpstream}
              >
                {upstream ? t("workspaceUi.changeUpstream") : t("workspaceUi.setUpstream")}
              </ActionMenuItem>
              {upstream && (
                <ActionMenuItem
                  icon={<X className="size-3.5" />}
                  disabled={busy}
                  testId={`workspace-location-clear-upstream-${location.id}`}
                  onClick={onClearUpstream}
                >{t("workspaceUi.clearUpstream")}</ActionMenuItem>
              )}
            </ActionMenu>
          </div>
        )}
      </div>
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
              <DirectoryActionsMenu
                path={scope.path}
                name={scope.name}
                testId={`workspace-directory-actions-${scope.project_directory_id}`}
              />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

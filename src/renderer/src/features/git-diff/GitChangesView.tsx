import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gitStatusQuery, gitDiffQuery, refreshGitQueries } from "@/features/git/queries";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { ChevronDown, ChevronUp, GitCompare, RefreshCw, X } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GitChangeFile, GitStatus } from "@/domain/types";
import { cn } from "@/lib/utils";
import { CommitDiffView } from "./CommitDiffView";
import { GitChangesTree } from "./GitChangesTree";
import { parseDiffComparison, sortByTreePath } from "./diffFiles";

export type GitChangesViewProps = {
  repositoryKind: "project" | "workspace";
  repositoryId: string;
  repositoryName: string;
  scope?: "working-tree" | "staged" | "commit";
  initialPath?: string;
  startCommit?: string;
  endCommit?: string;
  commitCount?: number;
  onStatusChange?: (status: GitStatus) => void;
  onClose?: () => void;
};

export function GitChangesView(props: GitChangesViewProps) {
  if (props.scope === "commit") {
    return <CommitDiffView repositoryKind={props.repositoryKind} repositoryId={props.repositoryId} repositoryName={props.repositoryName} initialPath={props.initialPath} startCommit={props.startCommit ?? ""} endCommit={props.endCommit ?? ""} commitCount={props.commitCount ?? 1} onClose={props.onClose} />;
  }
  return <WorkingTreeChangesView {...props} />;
}

function WorkingTreeChangesView({ repositoryKind, repositoryId, repositoryName, scope = "working-tree", initialPath, onStatusChange, onClose }: GitChangesViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const statusOptions = gitStatusQuery(repositoryKind, repositoryId);
  const statusQuery = useQuery(statusOptions);
  const status = statusQuery.data ?? null;
  const loading = statusQuery.isPending;
  const [selectedPath, setSelectedPath] = useState(initialPath ?? "");
  const [operationError, setError] = useState("");
  const [mutatingPath, setMutatingPath] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("treefold.git-changes.tree-width"));
    return Number.isFinite(stored) ? Math.min(520, Math.max(220, stored)) : 320;
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const api = repositoryKind === "project" ? projectsApi : workspacesApi;
  const files = useMemo(() => sortByTreePath((status?.files ?? []).filter((file) => scope === "staged" ? file.has_staged_changes : true)), [scope, status]);
  const selected = files.find((file) => file.path === selectedPath) ?? files[0];
  const diffQuery = useQuery({
    ...gitDiffQuery(repositoryKind, repositoryId, {
      scope: scope === "staged" || (selected?.has_staged_changes && !selected.has_unstaged_changes) ? "staged" : "unstaged",
      path: selected?.path ?? "",
    }),
    enabled: Boolean(selected),
  });
  const comparison = selected ? diffQuery.data ?? null : null;
  const diffError = selected ? diffQuery.error : null;
  const error = operationError || statusQuery.error?.message || (diffError instanceof ApiError && diffError.code === "DIFF_TOO_LARGE" ? t("gitDiffUi.diffIsTooLargeToDisplaySafely") : diffError?.message) || "";
  const parsed = useMemo(() => parseDiffComparison(comparison), [comparison, t]);
  const current = parsed.files.find((file) => file.path === selectedPath) ?? parsed.files[0];

  const publishStatus = async (next: GitStatus) => {
    queryClient.setQueryData(statusOptions.queryKey, next);
    await refreshGitQueries(queryClient, repositoryKind, repositoryId);
  };

  useEffect(() => {
    window.localStorage.setItem("treefold.git-changes.tree-width", String(treeWidth));
  }, [treeWidth]);

  useEffect(() => {
    setSelectedPath(initialPath ?? "");
    setError("");
  }, [repositoryId, repositoryKind, scope, initialPath]);

  useEffect(() => {
    if (status) onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (!selectedPath) {
      const preferred = initialPath ?? status?.files.find((file) => scope === "staged" ? file.has_staged_changes : file.has_unstaged_changes)?.path;
      setSelectedPath(preferred ?? files[0]?.path ?? "");
    } else if (!files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0]?.path ?? "");
    }
  }, [files, selectedPath, initialPath, status, scope]);

  const refreshChanges = async () => {
    if (loading || refreshing || mutatingPath) return;
    setRefreshing(true);
    setError("");
    try {
      await refreshGitQueries(queryClient, repositoryKind, repositoryId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("gitDiffUi.gitStatusCouldNotBeRefreshed"));
    } finally {
      setRefreshing(false);
    }
  };

  const toggleStage = async (file: GitChangeFile, stage: boolean) => {
    if (mutatingPath || file.status === "conflicted") return;
    setMutatingPath(file.path);
    setError("");
    try {
      const next = stage ? await api.stage(repositoryId, [file.path]) : await api.unstage(repositoryId, [file.path]);
      await publishStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("gitDiffUi.gitStageOperationFailed"));
    } finally {
      setMutatingPath("");
    }
  };

  const toggleStageAll = async (stage: boolean) => {
    if (mutatingPath) return;
    const paths = status?.files.filter((file) => file.status !== "conflicted" && (stage ? file.has_unstaged_changes : file.has_staged_changes)).map((file) => file.path) ?? [];
    if (paths.length === 0) return;
    setMutatingPath("*");
    setError("");
    try {
      const next = stage ? await api.stage(repositoryId, paths) : await api.unstage(repositoryId, paths);
      await publishStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("gitDiffUi.gitStageOperationFailed"));
    } finally {
      setMutatingPath("");
    }
  };

  const selectedIndex = files.findIndex((file) => file.path === selectedPath);
  const resizeTree = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = { startX: event.clientX, startWidth: treeWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    setTreeWidth(Math.max(220, Math.min(520, resizeRef.current.startWidth + event.clientX - resizeRef.current.startX)));
  };
  const stopResize = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <main data-git-changes-view className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <GitCompare className="size-4 text-muted-foreground" />
      <h1 className="truncate text-sm font-semibold">{t("gitDiffUi.gitChanges")}</h1>
      <Badge variant="secondary" className="ml-auto">{repositoryName}</Badge>
      {onClose && <Button size="icon-sm" variant="ghost" aria-label={t("gitDiffUi.closeGitChanges")} onClick={onClose}><X /></Button>}
    </header>
    {loading ? <State title={t("gitDiffUi.loadingGitChanges")} /> : error && !current ? <State title={t("gitDiffUi.couldNotLoadGitChanges")} detail={error} /> : files.length === 0 ? <State title={t("gitDiffUi.noChanges")} /> : <div className="flex min-h-0 flex-1">
      <aside className="flex min-w-[220px] shrink-0 flex-col border-r border-border bg-muted/20" style={{ width: treeWidth }}>
        <div className="flex h-10 shrink-0 items-center gap-2 px-2 text-xs font-semibold">
          <span>{t("gitDiffUi.changedFiles")}</span>
          {status && <Badge variant="outline" className="ml-auto">{t("counts.file", { count: status.files.length })}</Badge>}
          <Button size="icon-sm" variant="ghost" data-testid="git-changes-refresh" aria-label={t("gitDiffUi.refreshGitChanges")} title={t("gitDiffUi.refreshGitChanges")} disabled={loading || refreshing || Boolean(mutatingPath)} onClick={() => void refreshChanges()}><RefreshCw className={cn(refreshing && "animate-spin")} /></Button>
        </div>
        {status && <GitChangesTree files={files} allFiles={status.files} stagedCount={status.staged_count} selectedPath={selectedPath} mutatingPath={mutatingPath} onSelect={setSelectedPath} onToggle={(file, stage) => void toggleStage(file, stage)} onToggleAll={(stage) => void toggleStageAll(stage)} />}
      </aside>
      <div data-testid="git-changes-tree-resize-handle" role="separator" aria-label={t("gitDiffUi.resizeChangedFilesPanel")} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={520} aria-valuenow={treeWidth} className="w-1 shrink-0 cursor-col-resize touch-none hover:bg-ring/50 focus:bg-ring/50" onPointerDown={resizeTree} onPointerMove={continueResize} onPointerUp={stopResize} onPointerCancel={stopResize} />
      <section className="flex min-w-0 flex-1 flex-col">
        {current && <><div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"><span className="min-w-0 flex-1 truncate font-mono text-xs" title={current.path}>{current.path}</span><Button size="icon-sm" variant="ghost" aria-label={t("gitDiffUi.previousFile")} disabled={selectedIndex <= 0} onClick={() => setSelectedPath(files[selectedIndex - 1]?.path ?? selectedPath)}><ChevronUp /></Button><Button size="icon-sm" variant="ghost" aria-label={t("gitDiffUi.nextFile")} disabled={selectedIndex < 0 || selectedIndex >= files.length - 1} onClick={() => setSelectedPath(files[selectedIndex + 1]?.path ?? selectedPath)}><ChevronDown /></Button></div><div className="min-h-0 flex-1 overflow-hidden" data-testid="git-diff-content">{error ? <State title={t("gitDiffUi.couldNotLoadDiff")} detail={error} /> : current.binary || current.diff.hunks.length === 0 ? <State title={current.binary ? t("gitDiffUi.binaryFileChanged") : t("gitDiffUi.noLineChanges")} /> : <Virtualizer className="h-full overflow-auto" contentClassName="min-h-full"><FileDiff key={current.path} fileDiff={current.diff} options={diffOptions} /></Virtualizer>}</div></>}
      </section>
    </div>}
  </main>;
}

const diffOptions = { diffStyle: "unified", diffIndicators: "bars", disableFileHeader: true, enableLineSelection: false, expandUnchanged: false, collapsedContextThreshold: 8, hunkSeparators: "line-info-basic", lineDiffType: "word-alt", overflow: "scroll", themeType: "system" } as const;

function State({ title, detail }: { title: string; detail?: string }) {
  return <div className="grid min-h-0 flex-1 place-items-center p-6 text-center"><div><p className="text-sm font-medium">{title}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div></div>;
}

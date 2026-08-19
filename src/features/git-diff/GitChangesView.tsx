import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@win5do/pierre-trees/react";
import type { GitStatusEntry } from "@win5do/pierre-trees";
import { ChevronDown, ChevronUp, GitCompare, RefreshCw, X } from "lucide-react";
import { createRoot } from "react-dom/client";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { GitChangeFile, GitDiffComparison, GitDiffRequest, GitStatus } from "@/domain/types";
import { cn } from "@/lib/utils";

type Props = {
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

type ParsedFile = { diff: FileDiffMetadata; path: string; additions: number; deletions: number; binary: boolean; status: "added" | "modified" | "deleted" | "renamed" };

export function GitChangesView({ repositoryKind, repositoryId, repositoryName, scope = "working-tree", initialPath, startCommit, endCommit, commitCount = 1, onStatusChange, onClose }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [comparison, setComparison] = useState<GitDiffComparison | null>(null);
  const [selectedPath, setSelectedPath] = useState(initialPath ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutatingPath, setMutatingPath] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [diffRevision, setDiffRevision] = useState(0);
  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("treefold.git-changes.tree-width"));
    return Number.isFinite(stored) ? Math.min(520, Math.max(220, stored)) : 320;
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const api = repositoryKind === "project" ? projectsApi : workspacesApi;
  const files = useMemo(() => scope === "commit" ? parseComparison(comparison).files : (status?.files ?? []).filter((file) => scope === "staged" ? file.has_staged_changes : true), [comparison, scope, status]);
  const parsed = useMemo(() => scope === "commit" ? parseComparison(comparison).files : parseComparison(comparison).files, [comparison, scope]);
  const selected = files.find((file) => file.path === selectedPath) ?? files[0];

  useEffect(() => {
    window.localStorage.setItem("treefold.git-changes.tree-width", String(treeWidth));
  }, [treeWidth]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        if (scope === "commit") {
          setComparison(await api.gitDiff(repositoryId, { scope: "commit", start_commit: startCommit ?? "", end_commit: endCommit ?? "", commit_count: commitCount }, controller.signal));
        } else {
          const currentStatus = await api.gitStatus(repositoryId, controller.signal);
          setStatus(currentStatus); onStatusChange?.(currentStatus);
          const first = initialPath ?? currentStatus.files.find((file) => scope === "staged" ? file.has_staged_changes : file.has_unstaged_changes)?.path;
          setSelectedPath(first ?? "");
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Git status could not be loaded");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [repositoryId, scope, startCommit, endCommit, commitCount]);

  useEffect(() => {
    if (scope === "commit") return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repositoryId: string; status: GitStatus }>).detail;
      if (detail?.repositoryId !== repositoryId) return;
      setStatus(detail.status); onStatusChange?.(detail.status);
    };
    window.addEventListener("treefold:git-status-changed", refresh);
    return () => window.removeEventListener("treefold:git-status-changed", refresh);
  }, [repositoryId, scope]);

  useEffect(() => {
    if (!selectedPath && files[0]) setSelectedPath(files[0].path);
    if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0]?.path ?? "");
  }, [files, selectedPath]);

  useEffect(() => {
    if (!selected) { setComparison(null); return; }
    const controller = new AbortController();
    setError("");
    const request: GitDiffRequest = scope === "commit"
      ? { scope: "commit", start_commit: startCommit ?? "", end_commit: endCommit ?? "", commit_count: commitCount, path: selected.path }
      : { scope: scope === "staged" || ((selected as GitChangeFile).has_staged_changes && !(selected as GitChangeFile).has_unstaged_changes) ? "staged" : "unstaged", path: selected.path };
    void api.gitDiff(repositoryId, request, controller.signal).then(setComparison).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.code === "DIFF_TOO_LARGE" ? "Diff is too large to display safely." : cause instanceof Error ? cause.message : "Diff could not be loaded");
    });
    return () => controller.abort();
  }, [repositoryId, selected?.path, scope, startCommit, endCommit, commitCount, diffRevision]);

  const refreshChanges = async () => {
    if (scope === "commit" || loading || refreshing || mutatingPath) return;
    setRefreshing(true); setError("");
    try {
      const next = await api.gitStatus(repositoryId);
      setStatus(next); onStatusChange?.(next);
      window.dispatchEvent(new CustomEvent("treefold:git-status-changed", { detail: { repositoryId, status: next } }));
      setDiffRevision((current) => current + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Git status could not be refreshed"); }
    finally { setRefreshing(false); }
  };

  const toggleStage = async (file: GitChangeFile, stage: boolean) => {
    if (scope === "commit" || mutatingPath) return;
    setMutatingPath(file.path);
    try {
      const next = stage ? await api.stage(repositoryId, [file.path]) : await api.unstage(repositoryId, [file.path]);
      setStatus(next); onStatusChange?.(next);
      window.dispatchEvent(new CustomEvent("treefold:git-status-changed", { detail: { repositoryId, status: next } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Git stage operation failed"); }
    finally { setMutatingPath(""); }
  };

  const toggleStagePath = async (path: string, stage: boolean) => {
    const targets = status?.files.filter((file) => file.status !== "conflicted" && (file.path === path || file.path.startsWith(`${path}/`))) ?? [];
    if (targets.length === 1 && targets[0]?.path === path) {
      await toggleStage(targets[0], stage);
      return;
    }
    const paths = targets.filter((file) => stage ? file.has_unstaged_changes : file.has_staged_changes).map((file) => file.path);
    if (paths.length === 0 || mutatingPath) return;
    setMutatingPath(path);
    try {
      const next = stage ? await api.stage(repositoryId, paths) : await api.unstage(repositoryId, paths);
      setStatus(next); onStatusChange?.(next);
      window.dispatchEvent(new CustomEvent("treefold:git-status-changed", { detail: { repositoryId, status: next } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Git stage operation failed"); }
    finally { setMutatingPath(""); }
  };

  const toggleStageAll = async (stage: boolean) => {
    if (scope === "commit" || mutatingPath) return;
    const paths = status?.files.filter((file) => file.status !== "conflicted" && (stage ? file.has_unstaged_changes : file.has_staged_changes)).map((file) => file.path) ?? [];
    if (paths.length === 0) return;
    setMutatingPath("*");
    try {
      const next = stage ? await api.stage(repositoryId, paths) : await api.unstage(repositoryId, paths);
      setStatus(next); onStatusChange?.(next);
      window.dispatchEvent(new CustomEvent("treefold:git-status-changed", { detail: { repositoryId, status: next } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Git stage operation failed"); }
    finally { setMutatingPath(""); }
  };

  const parsedFiles = scope === "commit" ? parsed : comparison ? parseComparison(comparison).files : [];
  const current = parsedFiles.find((file) => file.path === selectedPath);
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
      <h1 className="truncate text-sm font-semibold">{scope === "commit" ? "Commit Diff" : "Git Changes"}</h1>
      <Badge variant="secondary" className="ml-auto">{repositoryName}</Badge>
      {onClose && <Button size="icon-sm" variant="ghost" aria-label="Close Git Changes" onClick={onClose}><X /></Button>}
    </header>
    {loading ? <State title="Loading Git changes" /> : error && !current ? <State title="Could not load Git changes" detail={error} /> : files.length === 0 ? <State title="No changes" /> : <div className="flex min-h-0 flex-1">
      <aside className="flex min-w-[220px] shrink-0 flex-col border-r border-border bg-muted/20" style={{ width: treeWidth }}>
        <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-xs font-semibold">
          <span>Changed files</span>
          {status && <Badge variant="outline" className="ml-auto">{status.files.length} files</Badge>}
          {scope !== "commit" && <Button size="icon-sm" variant="ghost" data-testid="git-changes-refresh" aria-label="Refresh Git changes" title="Refresh Git changes" disabled={loading || refreshing || Boolean(mutatingPath)} onClick={() => void refreshChanges()}><RefreshCw className={cn(refreshing && "animate-spin")} /></Button>}
        </div>
        <ChangesTree key={status?.files.map((file) => `${file.path}:${file.has_staged_changes ? 1 : 0}:${file.has_unstaged_changes ? 1 : 0}`).join("|")} files={files} status={status} selectedPath={selectedPath} onSelect={setSelectedPath} onToggle={scope === "commit" ? undefined : (path, stage) => void toggleStagePath(path, stage)} onToggleAll={scope === "commit" ? undefined : (stage) => void toggleStageAll(stage)} mutatingPath={mutatingPath} />
      </aside>
      <div
        data-testid="git-changes-tree-resize-handle"
        role="separator"
        aria-label="Resize changed files panel"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={520}
        aria-valuenow={treeWidth}
        className="w-1 shrink-0 cursor-col-resize touch-none hover:bg-ring/50 focus:bg-ring/50"
        onPointerDown={resizeTree}
        onPointerMove={continueResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        {current && <><div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"><span className="min-w-0 flex-1 truncate font-mono text-xs">{current.path}</span><Button size="icon-sm" variant="ghost" aria-label="Previous file" onClick={() => setSelectedPath(files[Math.max(0, files.findIndex((file) => file.path === selectedPath) - 1)]?.path ?? selectedPath)}><ChevronUp /></Button><Button size="icon-sm" variant="ghost" aria-label="Next file" onClick={() => setSelectedPath(files[Math.min(files.length - 1, files.findIndex((file) => file.path === selectedPath) + 1)]?.path ?? selectedPath)}><ChevronDown /></Button></div><div className="min-h-0 flex-1 overflow-hidden" data-testid="git-diff-content">{error ? <State title="Could not load diff" detail={error} /> : current.binary || current.diff.hunks.length === 0 ? <State title={current.binary ? "Binary file changed" : "No line changes"} /> : <Virtualizer className="h-full overflow-auto" contentClassName="min-h-full"><FileDiff key={current.path} fileDiff={current.diff} options={{ diffStyle: "unified", diffIndicators: "bars", disableFileHeader: true, enableLineSelection: false, expandUnchanged: false, collapsedContextThreshold: 8, hunkSeparators: "line-info-basic", lineDiffType: "word-alt", overflow: "scroll", themeType: "system" }} /></Virtualizer>}</div></>}
      </section>
    </div>}
  </main>;
}

function ChangesTree({ files, status: gitStatus, selectedPath, onSelect, onToggle, onToggleAll, mutatingPath }: { files: Array<GitChangeFile | ParsedFile>; status: GitStatus | null; selectedPath: string; onSelect: (path: string) => void; onToggle?: (path: string, stage: boolean) => void; onToggleAll?: (stage: boolean) => void; mutatingPath: string }) {
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const statusEntries = useMemo<GitStatusEntry[]>(() => files.map((file) => ({ path: file.path, status: file.status === "added" ? "added" : file.status === "deleted" ? "deleted" : file.status === "renamed" ? "renamed" : "modified" })), [files]);
  const stats = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const stageableFiles = gitStatus?.files.filter((file) => file.status !== "conflicted") ?? [];
  const allChecked = stageableFiles.length > 0 && stageableFiles.every((file) => !file.has_unstaged_changes);
  const allIndeterminate = !allChecked && stageableFiles.some((file) => file.has_staged_changes);
  const checkboxClassName = "size-4 shrink-0 align-middle";
  const checkboxStyle = (checked: boolean, indeterminate: boolean): React.CSSProperties => ({
    width: "1rem",
    height: "1rem",
    minWidth: "1rem",
    minHeight: "1rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    border: `1px solid ${checked || indeterminate ? "var(--primary)" : "var(--input)"}`,
    background: checked || indeterminate ? "var(--primary)" : "transparent",
    color: checked || indeterminate ? "var(--primary-foreground)" : "var(--foreground)",
    boxSizing: "border-box",
    flexShrink: 0,
    padding: 0,
    margin: 0,
    alignSelf: "center",
    backgroundColor: checked || indeterminate ? "var(--primary)" : "transparent",
  });
  const { model } = useFileTree({
    paths,
    gitStatus: statusEntries,
    initialExpansion: "open",
    initialSelectedPaths: paths.slice(0, 1),
    onSelectionChange: (selected) => {
      const path = [...selected].reverse().find((item) => paths.includes(item));
      if (path) onSelect(path);
    },
    renderRowDecoration: ({ item }) => {
      if (item.kind !== "file") return null;
      const file = stats.get(item.path);
      if (!file) return null;
      return { text: `+${file.additions} −${file.deletions}`, title: `${file.additions} additions, ${file.deletions} deletions` };
    },
    renderRowTrailing: onToggle && gitStatus
      ? ({ item }) => {
        const normalizedPath = item.path.endsWith("/") ? item.path.slice(0, -1) : item.path;
        const descendants = gitStatus.files.filter(
          (file) => file.status !== "conflicted" &&
            (item.kind === "file" ? file.path === normalizedPath : file.path.startsWith(`${normalizedPath}/`))
        );
        if (descendants.length === 0) return null;
        const checked = descendants.every((file) => !file.has_unstaged_changes);
        const indeterminate = !checked && descendants.some((file) => file.has_staged_changes);
        const title = checked ? `Unstage ${normalizedPath}` : `Stage ${normalizedPath}`;

        return {
          width: 24,
          render: (container) => {
            const mount = document.createElement("span");
            const root = createRoot(mount);
            root.render(
              <Checkbox
                className={checkboxClassName}
                style={checkboxStyle(checked, indeterminate)}
                checked={checked}
                indeterminate={indeterminate}
                disabled={Boolean(mutatingPath)}
                title={title}
                aria-label={title}
                data-item-checkbox="true"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(next) => onToggle(normalizedPath, next === true)}
              />
            );
            container.append(mount);
            return () => {
              mount.remove();
              queueMicrotask(() => root.unmount());
            };
          },
        };
      }
      : undefined,
  });
  useEffect(() => { model.getItem(selectedPath)?.select(); model.scrollToPath(selectedPath, { focus: false, offset: "nearest" }); }, [model, selectedPath]);
  return <div className="min-h-0 flex-1 overflow-auto">{onToggleAll && gitStatus && <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-4 pr-3"><span className="ml-auto text-[10px] text-muted-foreground">{gitStatus.staged_count} staged</span><span className="flex w-6 shrink-0 justify-center"><Checkbox className={checkboxClassName} style={checkboxStyle(allChecked, allIndeterminate)} checked={allChecked} indeterminate={allIndeterminate} disabled={Boolean(mutatingPath) || stageableFiles.length === 0} aria-label={allChecked ? "Unstage all changes" : "Stage all changes"} data-item-checkbox="true" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onCheckedChange={(value) => onToggleAll?.(value === true)} /></span></div>}<FileTree model={model} aria-label="Changed files" className="min-h-full w-full" style={{ height: "100%", width: "100%" }} /></div>;
}

function parseComparison(comparison: GitDiffComparison | null): { files: ParsedFile[]; error?: string } {
  if (!comparison?.patch.trim()) return { files: [] };
  try {
    const files = parsePatchFiles(comparison.patch, `${comparison.resolved_base}:${comparison.resolved_head}`, true).flatMap((patch) => patch.files).map((diff) => { const changes = diff.hunks.flatMap((hunk) => hunk.hunkContent).filter((content) => content.type !== "context"); return { diff, path: diff.name, additions: changes.reduce((sum, content) => sum + content.additions, 0), deletions: changes.reduce((sum, content) => sum + content.deletions, 0), binary: false, status: diff.type === "new" ? "added" : diff.type === "deleted" ? "deleted" : diff.type.startsWith("rename") ? "renamed" : "modified" } as ParsedFile; });
    return { files };
  } catch (cause) { return { files: [], error: cause instanceof Error ? cause.message : "Patch could not be parsed" }; }
}

function State({ title, detail }: { title: string; detail?: string }) { return <div className="grid min-h-0 flex-1 place-items-center p-6 text-center"><div><p className="text-sm font-medium">{title}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div></div>; }

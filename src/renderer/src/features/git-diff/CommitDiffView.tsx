import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { prepareFileTreeInput, type GitStatusEntry } from "@pierre/trees";
import { ChevronDown, ChevronUp, GitCompare, X } from "lucide-react";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GitDiffComparison } from "@/domain/types";
import { parseDiffComparison, type ParsedDiffFile } from "./diffFiles";

type Props = { repositoryKind: "project" | "workspace"; repositoryId: string; repositoryName: string; initialPath?: string; startCommit: string; endCommit: string; commitCount: number; onClose?: () => void };

export function CommitDiffView({ repositoryKind, repositoryId, repositoryName, initialPath, startCommit, endCommit, commitCount, onClose }: Props) {
  const { t } = useTranslation();
  const [comparison, setComparison] = useState<GitDiffComparison | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState(initialPath ?? "");
  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("treefold.git-changes.tree-width"));
    return Number.isFinite(stored) ? Math.min(520, Math.max(220, stored)) : 320;
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const api = repositoryKind === "project" ? projectsApi : workspacesApi;
  const parsed = useMemo(() => {
    const result = parseDiffComparison(comparison);
    const byPath = new Map(result.files.map((file) => [file.path, file]));
    // Match the FileTree default ordering, including punctuation in basenames.
    const paths = prepareFileTreeInput([...byPath.keys()]).paths;
    return { ...result, files: paths.map((path) => byPath.get(path)!) };
  }, [comparison, t]);
  const selectedIndex = parsed.files.findIndex((file) => file.path === selectedPath);
  const current = selectedIndex >= 0 ? parsed.files[selectedIndex] : parsed.files[0];

  useEffect(() => {
    window.localStorage.setItem("treefold.git-changes.tree-width", String(treeWidth));
  }, [treeWidth]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setComparison(null);
    void api.gitDiff(repositoryId, { scope: "commit", start_commit: startCommit, end_commit: endCommit, commit_count: commitCount }, controller.signal).then((next) => {
      if (!controller.signal.aborted) setComparison(next);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.code === "DIFF_TOO_LARGE" ? t("gitDiffUi.comparisonTooLarge") : cause instanceof Error ? cause.message : t("gitDiffUi.theComparisonCouldNotBeLoaded"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [repositoryId, repositoryKind, startCommit, endCommit, commitCount]);

  useEffect(() => {
    if (parsed.files.length === 0) {
      setSelectedPath("");
      return;
    }
    const requested = parsed.files.find((file) => file.path === initialPath);
    setSelectedPath(requested?.path ?? parsed.files[0].path);
  }, [comparison, initialPath, parsed.files]);

  const selectPath = (path: string) => {
    if (parsed.files.some((file) => file.path === path)) setSelectedPath(path);
  };
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

  return <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4"><GitCompare className="size-4 text-muted-foreground" /><h1 className="truncate text-sm font-semibold">{t("gitDiffUi.commitDiff")}</h1><Badge variant="secondary" className="ml-auto">{repositoryName}</Badge><Badge variant="outline">{t("counts.commit", { count: commitCount })}</Badge>{onClose && <Button size="icon-sm" variant="ghost" aria-label={t("gitDiffUi.closeCommitDiff")} onClick={onClose}><X /></Button>}</header>
    {loading ? <ViewerState title={t("gitDiffUi.loadingComparison")} detail={t("gitDiffUi.readingTheSelectedCommitsAndPreparingThePatch")} loading /> : error ? <ViewerState title={t("gitDiffUi.couldNotLoadDiff")} detail={error} /> : parsed.error ? <ViewerState title={t("gitDiffUi.unsupportedPatch")} detail={parsed.error} /> : parsed.files.length === 0 ? <ViewerState title={t("gitDiffUi.noChanges")} detail={t("gitDiffUi.theSelectedCommitRangeHasNoNetFileChanges")} /> : <div className="flex min-h-0 flex-1">
      <aside className="min-h-0 shrink-0 overflow-hidden border-r border-border bg-muted/20" style={{ width: treeWidth }}><CommitChangesTree files={parsed.files} selectedPath={current?.path ?? ""} onSelect={selectPath} /></aside>
      <div data-testid="git-changes-tree-resize-handle" role="separator" aria-label={t("gitDiffUi.resizeChangedFilesPanel")} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={520} aria-valuenow={treeWidth} className="w-1 shrink-0 cursor-col-resize touch-none hover:bg-ring/50 focus:bg-ring/50" onPointerDown={resizeTree} onPointerMove={continueResize} onPointerUp={stopResize} onPointerCancel={stopResize} />
      <section className="flex min-w-0 flex-1 flex-col">{current && <><div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"><span className="min-w-0 flex-1 truncate font-mono text-xs" title={current.path}>{current.path}</span><Button variant="outline" size="icon-sm" aria-label={t("gitDiffUi.previousFile")} disabled={selectedIndex <= 0} onClick={() => selectPath(parsed.files[selectedIndex - 1]?.path ?? current.path)}><ChevronUp /></Button><Button variant="outline" size="icon-sm" aria-label={t("gitDiffUi.nextFile")} disabled={selectedIndex < 0 || selectedIndex >= parsed.files.length - 1} onClick={() => selectPath(parsed.files[selectedIndex + 1]?.path ?? current.path)}><ChevronDown /></Button></div><div className="min-h-0 flex-1 overflow-hidden bg-background" data-testid="git-diff-content">{current.binary ? <ViewerState title={t("gitDiffUi.binaryFileChanged")} detail={t("gitDiffUi.aLineByLinePreviewIsNotAvailableForThisFile")} /> : current.diff.hunks.length === 0 ? <ViewerState title={t("gitDiffUi.noLineChanges")} detail={current.diff.type === "rename-pure" ? t("gitDiffUi.thisFileWasRenamedWithoutContentChanges") : t("gitDiffUi.thisPatchDoesNotContainRenderableLineChanges")} /> : <Virtualizer className="h-full overflow-auto" contentClassName="min-h-full"><FileDiff key={current.path} fileDiff={current.diff} options={diffOptions} /></Virtualizer>}</div></>}</section>
    </div>}
  </main>;
}

function CommitChangesTree({ files, selectedPath, onSelect }: { files: ParsedDiffFile[]; selectedPath: string; onSelect: (path: string) => void }) {
  const { t } = useTranslation();
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const stats = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const gitStatus = useMemo<GitStatusEntry[]>(() => files.map((file) => ({ path: file.path, status: file.status })), [files]);
  const { model } = useFileTree({ paths, gitStatus, initialExpansion: "open", initialSelectedPaths: paths.slice(0, 1), onSelectionChange: (selected) => { const path = [...selected].reverse().find((item) => paths.includes(item)); if (path) onSelect(path); }, renderRowDecoration: ({ item }) => { if (item.kind !== "file") return null; const file = stats.get(item.path); if (!file) return null; return { text: `+${file.additions} −${file.deletions}`, title: t("gitDiffUi.additionsDeletions", { additions: file.additions, deletions: file.deletions }), parts: [{ text: `+${file.additions}`, color: "var(--trees-status-added)" }, { text: `\u00a0−${file.deletions}`, color: "var(--trees-status-deleted)" }] }; } });
  useEffect(() => {
    if (!selectedPath) return;
    for (const path of model.getSelectedPaths()) if (path !== selectedPath) model.getItem(path)?.deselect();
    const parts = selectedPath.split("/");
    for (let index = 1; index < parts.length; index += 1) { const item = model.getItem(parts.slice(0, index).join("/")); if (item && "expand" in item) item.expand(); }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
  }, [model, selectedPath]);
  return <div className="flex h-full min-h-0 flex-col"><div className="flex h-10 shrink-0 items-center px-3 text-xs font-semibold">{t("gitDiffUi.changedFiles")}</div><FileTree model={model} aria-label={t("gitDiffUi.commitChangedFiles")} data-testid="commit-diff-tree" className="min-h-0 flex-1" style={{ height: "100%" }} /></div>;
}

const diffOptions = { diffStyle: "unified", diffIndicators: "bars", disableFileHeader: true, enableLineSelection: false, expandUnchanged: false, collapsedContextThreshold: 8, hunkSeparators: "line-info-basic", lineDiffType: "word-alt", overflow: "scroll", themeType: "system" } as const;

function ViewerState({ title, detail, loading }: { title: string; detail: string; loading?: boolean }) {
  return <div className="grid min-h-0 flex-1 place-items-center p-8"><div className="flex max-w-md flex-col items-center gap-3 text-center">{loading && <Spinner />}<h2 className="text-sm font-semibold">{title}</h2><p className="text-xs leading-5 text-muted-foreground">{detail}</p></div></div>;
}

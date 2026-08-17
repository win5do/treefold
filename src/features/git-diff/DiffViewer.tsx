import { useEffect, useMemo, useRef, useState } from "react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { ChevronLeft, ChevronRight, GitCompare, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLocation } from "react-router-dom";
import { projectsApi } from "@/api/projects";
import { workspacesApi } from "@/api/workspaces";
import { ApiError } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { GitDiffComparison, GitDiffLaunchPayload } from "@/domain/types";
import { cn } from "@/lib/utils";
import { GIT_DIFF_EVENT, GIT_DIFF_POSITION_EVENT, parseDiffLaunchParams, type DiffWindowPosition } from "./launch";

type ParsedDiffFile = {
  diff: FileDiffMetadata;
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
};

export function DiffViewer() {
  const location = useLocation();
  const [payload, setPayload] = useState<GitDiffLaunchPayload | null>(() => parseDiffLaunchParams(location.search));
  const [comparison, setComparison] = useState<GitDiffComparison | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(260);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setPayload(parseDiffLaunchParams(location.search));
  }, [location.search]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const window = getCurrentWebviewWindow();
    void Promise.all([
      window.listen<GitDiffLaunchPayload>(GIT_DIFF_EVENT, (event) => {
        if (!disposed) setPayload(event.payload);
      }),
      window.listen<DiffWindowPosition>(GIT_DIFF_POSITION_EVENT, (event) => {
        if (!disposed) {
          void window.setPosition(new LogicalPosition(event.payload.x, event.payload.y)).catch((cause) => {
            console.warn("Could not move the Git Diff window", cause);
          });
        }
      }),
    ]).then((values) => {
      if (disposed) values.forEach((unlisten) => unlisten());
      else unlisteners.push(...values);
    }).catch((cause) => {
      console.warn("Could not register Git Diff window listeners", cause);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setComparison(null);
    setSelectedPath("");
    const input = {
      start_commit: payload.startCommit,
      end_commit: payload.endCommit,
      commit_count: payload.commitCount,
    };
    const request = payload.repositoryKind === "project"
      ? projectsApi.compare(payload.repositoryId, input, controller.signal)
      : workspacesApi.compareLocation(payload.repositoryId, input, controller.signal);
    void request.then((value) => {
      if (!controller.signal.aborted) setComparison(value);
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof ApiError && cause.code === "DIFF_TOO_LARGE"
          ? "This comparison is too large to display safely. Narrow the selected commit range."
          : cause instanceof Error ? cause.message : "The comparison could not be loaded.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [payload]);

  const parsed = useMemo(() => parseComparison(comparison), [comparison]);
  useEffect(() => {
    setSelectedPath(parsed.files[0]?.path ?? "");
  }, [comparison, parsed.files]);
  const currentIndex = parsed.files.findIndex((file) => file.path === selectedPath);
  const current = currentIndex >= 0 ? parsed.files[currentIndex] : undefined;

  const resizeTree = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = { startX: event.clientX, startWidth: treeWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    setTreeWidth(Math.max(200, Math.min(480, resizeRef.current.startWidth + event.clientX - resizeRef.current.startX)));
  };

  if (!payload) return <ViewerState title="Invalid comparison" detail="The Diff Viewer was opened without a valid repository and commit range." />;

  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <GitCompare className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold" title={payload.repositoryName}>{payload.repositoryName}</h1>
          <Badge variant="secondary">{payload.commitCount} {payload.commitCount === 1 ? "commit" : "commits"}</Badge>
          {comparison && <Badge variant="outline">{parsed.files.length} {parsed.files.length === 1 ? "file" : "files"}</Badge>}
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={`${payload.startCommit} → ${payload.endCommit}`}>
          {payload.startCommit.slice(0, 10)} → {payload.endCommit.slice(0, 10)} · Compared with first parent
        </p>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={treeOpen ? "Collapse changes tree" : "Expand changes tree"} onClick={() => setTreeOpen((value) => !value)}>
        {treeOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
      </Button>
    </header>
    {loading ? <ViewerState title="Loading comparison" detail="Reading the selected commits and preparing the patch." loading />
      : error ? <ViewerState title="Could not load diff" detail={error} error />
      : parsed.error ? <ViewerState title="Unsupported patch" detail={parsed.error} error />
      : comparison && parsed.files.length === 0 ? <ViewerState title="No changes" detail="The selected commit range has no net file changes." />
      : comparison ? <div className="flex min-h-0 flex-1">
        {treeOpen && <>
          <aside className="min-h-0 shrink-0 overflow-hidden border-r border-border bg-muted/20" style={{ width: treeWidth }}>
            <ChangesTree key={`${comparison.resolved_base}:${comparison.resolved_head}`} files={parsed.files} selectedPath={selectedPath} onSelect={setSelectedPath} />
          </aside>
          <div
            role="separator"
            aria-label="Resize changes tree"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent"
            onPointerDown={resizeTree}
            onPointerMove={continueResize}
            onPointerUp={(event) => {
              resizeRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
        </>}
        <section className="flex min-w-0 flex-1 flex-col">
          {current && <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <p className="min-w-0 flex-1 truncate font-mono text-xs" title={current.path}>{current.path}</p>
              <span className="text-xs text-muted-foreground"><span className="text-foreground">+{current.additions}</span> / -{current.deletions}</span>
              <Separator orientation="vertical" className="h-5" />
              <Button variant="outline" size="icon-sm" aria-label="Previous file" disabled={currentIndex <= 0} onClick={() => setSelectedPath(parsed.files[currentIndex - 1]?.path ?? selectedPath)}><ChevronLeft /></Button>
              <Button variant="outline" size="icon-sm" aria-label="Next file" disabled={currentIndex < 0 || currentIndex >= parsed.files.length - 1} onClick={() => setSelectedPath(parsed.files[currentIndex + 1]?.path ?? selectedPath)}><ChevronRight /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-background" data-testid="git-diff-content">
              {current.binary ? <ViewerState title="Binary file changed" detail="A line-by-line preview is not available for this file." />
                : current.diff.hunks.length === 0 ? <ViewerState title="No line changes" detail={current.diff.type === "rename-pure" ? "This file was renamed without content changes." : "This patch does not contain renderable line changes."} />
                : <Virtualizer className="h-full overflow-auto" contentClassName="min-h-full">
                    <FileDiff
                      key={current.path}
                      fileDiff={current.diff}
                      options={{
                        diffStyle: "unified",
                        diffIndicators: "bars",
                        disableFileHeader: true,
                        enableLineSelection: false,
                        expandUnchanged: false,
                        collapsedContextThreshold: 8,
                        hunkSeparators: "line-info-basic",
                        lineDiffType: "word-alt",
                        overflow: "scroll",
                        themeType: "system",
                      }}
                    />
                  </Virtualizer>}
            </div>
          </>}
        </section>
      </div> : <ViewerState title="Waiting for comparison" detail="Select View Diff from Git History to load a comparison." />}
  </main>;
}

function ChangesTree({ files, selectedPath, onSelect }: { files: ParsedDiffFile[]; selectedPath: string; onSelect: (path: string) => void }) {
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const gitStatus = useMemo<GitStatusEntry[]>(() => files.map((file) => ({ path: file.path, status: file.diff.type === "new" ? "added" : file.diff.type === "deleted" ? "deleted" : file.diff.type.startsWith("rename") ? "renamed" : "modified" })), [files]);
  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: "open",
    initialSelectedPaths: paths.slice(0, 1),
    onSelectionChange: (selected) => {
      const filePath = [...selected].reverse().find((path) => paths.includes(path));
      if (filePath) onSelect(filePath);
    },
  });
  useEffect(() => {
    if (!selectedPath) return;
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedPath) model.getItem(path)?.deselect();
    }
    const parts = selectedPath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const item = model.getItem(parts.slice(0, index).join("/"));
      if (item && "expand" in item) item.expand();
    }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
  }, [model, selectedPath]);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-10 shrink-0 items-center px-3 text-xs font-semibold">Changes</div>
    <FileTree model={model} aria-label="Changed files" className="min-h-0 flex-1" style={{ height: "100%" }} />
  </div>;
}

function parseComparison(comparison: GitDiffComparison | null): { files: ParsedDiffFile[]; error: string } {
  if (!comparison || !comparison.patch.trim()) return { files: [], error: "" };
  try {
    const binaryPaths = binaryFilePaths(comparison.patch);
    const files = parsePatchFiles(comparison.patch, `${comparison.resolved_base}:${comparison.resolved_head}`, true)
      .flatMap((patch) => patch.files)
      .map((diff) => ({
        diff,
        path: diff.name,
        additions: diff.hunks.reduce((sum, hunk) => sum + hunk.additionCount, 0),
        deletions: diff.hunks.reduce((sum, hunk) => sum + hunk.deletionCount, 0),
        binary: binaryPaths.has(diff.name),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (files.length === 0) return { files: [], error: "The patch contains data that this viewer cannot parse." };
    return { files, error: "" };
  } catch (cause) {
    return { files: [], error: cause instanceof Error ? cause.message : "The patch could not be parsed." };
  }
}

function binaryFilePaths(patch: string) {
  const paths = new Set<string>();
  for (const block of patch.split(/^diff --git /m).slice(1)) {
    if (!block.includes("Binary files ") && !block.includes("GIT binary patch")) continue;
    const renamed = block.match(/^a\/(.+?) b\/(.+?)\n/);
    if (renamed?.[2]) paths.add(renamed[2]);
    const target = block.match(/^\+\+\+ b\/(.+)$/m);
    if (target?.[1]) paths.add(target[1]);
  }
  return paths;
}

function ViewerState({ title, detail, loading, error }: { title: string; detail: string; loading?: boolean; error?: boolean }) {
  return <div className="grid min-h-0 flex-1 place-items-center p-8">
    {error ? <Alert variant="destructive" className="max-w-lg"><AlertDescription><strong className="block text-sm">{title}</strong><span className="mt-1 block">{detail}</span></AlertDescription></Alert>
      : <div className="flex max-w-md flex-col items-center gap-3 text-center">{loading && <Spinner />}<h2 className="text-sm font-semibold">{title}</h2><p className={cn("text-xs leading-5 text-muted-foreground")}>{detail}</p></div>}
  </div>;
}

import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import type { GitDiffLaunchPayload } from "@/domain/types";

export const GIT_DIFF_EVENT = "git-diff:open";
export const GIT_DIFF_POSITION_EVENT = "git-diff:position";
export const GIT_DIFF_WINDOW_LABEL = "diff-viewer";

const DIFF_WINDOW_WIDTH = 1200;
const DIFF_WINDOW_HEIGHT = 800;
const DIFF_WINDOW_OFFSET = 32;

export type DiffWindowPosition = { x: number; y: number };

async function diffWindowPosition(): Promise<DiffWindowPosition | null> {
  try {
    const sourceWindow = getCurrentWindow();
    const [monitor, sourcePosition] = await Promise.all([
      currentMonitor(),
      sourceWindow.outerPosition(),
    ]);
    if (!monitor) return null;

    const workAreaPosition = monitor.workArea.position.toLogical(monitor.scaleFactor);
    const workAreaSize = monitor.workArea.size.toLogical(monitor.scaleFactor);
    const sourceLogicalPosition = sourcePosition.toLogical(monitor.scaleFactor);
    const maxX = workAreaPosition.x + Math.max(0, workAreaSize.width - DIFF_WINDOW_WIDTH);
    const maxY = workAreaPosition.y + Math.max(0, workAreaSize.height - DIFF_WINDOW_HEIGHT);

    return {
      x: Math.min(Math.max(sourceLogicalPosition.x + DIFF_WINDOW_OFFSET, workAreaPosition.x), maxX),
      y: Math.min(Math.max(sourceLogicalPosition.y + DIFF_WINDOW_OFFSET, workAreaPosition.y), maxY),
    };
  } catch (cause) {
    console.warn("Could not resolve the Git Diff window position", cause);
    return null;
  }
}

export function diffRoute(payload: GitDiffLaunchPayload) {
  const params = new URLSearchParams({
    repositoryKind: payload.repositoryKind,
    repositoryId: payload.repositoryId,
    repositoryName: payload.repositoryName,
    startCommit: payload.startCommit,
    endCommit: payload.endCommit,
    commitCount: String(payload.commitCount),
  });
  return `/diff?${params.toString()}`;
}

export async function openGitDiffViewer(payload: GitDiffLaunchPayload) {
  const route = diffRoute(payload);
  if (!isTauri()) {
    window.open(`#${route}`, GIT_DIFF_WINDOW_LABEL, "popup,width=1200,height=800");
    return;
  }

  const position = await diffWindowPosition();
  const existing = await WebviewWindow.getByLabel(GIT_DIFF_WINDOW_LABEL);
  if (existing) {
    await existing.emit(GIT_DIFF_EVENT, payload);
    if (await existing.isMinimized()) await existing.unminimize();
    await existing.show();
    if (position) await existing.emit(GIT_DIFF_POSITION_EVENT, position);
    await existing.setFocus();
    return;
  }

  const viewer = new WebviewWindow(GIT_DIFF_WINDOW_LABEL, {
    title: "Git Diff — Treefold",
    url: `index.html#${route}`,
    width: DIFF_WINDOW_WIDTH,
    height: DIFF_WINDOW_HEIGHT,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    preventOverflow: true,
    ...(position ? position : { center: true }),
  });
  await new Promise<void>((resolve, reject) => {
    void viewer.once("tauri://created", () => resolve());
    void viewer.once("tauri://error", (event) => reject(new Error(String(event.payload))));
  });
}

export function parseDiffLaunchParams(search: string): GitDiffLaunchPayload | null {
  const params = new URLSearchParams(search);
  const repositoryKind = params.get("repositoryKind");
  const repositoryId = params.get("repositoryId") ?? "";
  const repositoryName = params.get("repositoryName") ?? "";
  const startCommit = params.get("startCommit") ?? "";
  const endCommit = params.get("endCommit") ?? "";
  const commitCount = Number(params.get("commitCount"));
  if (
    (repositoryKind !== "project" && repositoryKind !== "workspace") ||
    !repositoryId ||
    !repositoryName ||
    !startCommit ||
    !endCommit ||
    !Number.isInteger(commitCount) ||
    commitCount < 1
  ) return null;
  return {
    repositoryKind,
    repositoryId,
    repositoryName,
    startCommit,
    endCommit,
    commitCount,
  };
}

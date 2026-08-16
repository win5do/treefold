import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { GitDiffLaunchPayload } from "@/domain/types";

export const GIT_DIFF_EVENT = "git-diff:open";
export const GIT_DIFF_WINDOW_LABEL = "diff-viewer";

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

  const existing = await WebviewWindow.getByLabel(GIT_DIFF_WINDOW_LABEL);
  if (existing) {
    await existing.emit(GIT_DIFF_EVENT, payload);
    if (await existing.isMinimized()) await existing.unminimize();
    await existing.show();
    await existing.setFocus();
    return;
  }

  const viewer = new WebviewWindow(GIT_DIFF_WINDOW_LABEL, {
    title: "Git Diff — Treefold",
    url: `index.html#${route}`,
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    center: true,
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

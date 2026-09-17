import i18n from "@/i18n";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type { GitDiffComparison } from "@/domain/types";

export type ParsedDiffFile = { diff: FileDiffMetadata; path: string; additions: number; deletions: number; binary: boolean; status: "added" | "modified" | "deleted" | "renamed" };

export function parseDiffComparison(comparison: GitDiffComparison | null): { files: ParsedDiffFile[]; error: string } {
  if (!comparison?.patch.trim()) return { files: [], error: "" };
  try {
    const binaryPaths = binaryFilePaths(comparison.patch);
    const files = parsePatchFiles(comparison.patch, `${comparison.resolved_base}:${comparison.resolved_head}`, true).flatMap((patch) => patch.files).map((diff) => {
      const changes = diff.hunks.flatMap((hunk) => hunk.hunkContent).filter((content) => content.type !== "context");
      return { diff, path: diff.name, additions: changes.reduce((sum, content) => sum + content.additions, 0), deletions: changes.reduce((sum, content) => sum + content.deletions, 0), binary: binaryPaths.has(diff.name), status: diff.type === "new" ? "added" : diff.type === "deleted" ? "deleted" : diff.type.startsWith("rename") ? "renamed" : "modified" } satisfies ParsedDiffFile;
    });
    const sorted = sortByTreePath(files);
    if (sorted.length === 0) return { files: [], error: i18n.t("gitDiffUi.thePatchContainsDataThatThisViewerCannotParse") };
    return { files: sorted, error: "" };
  } catch (cause) {
    return { files: [], error: cause instanceof Error ? cause.message : i18n.t("gitDiffUi.thePatchCouldNotBeParsed") };
  }
}

export function sortByTreePath<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort(treeLeafPathComparator<T>(files.map((file) => file.path)));
}

function treeLeafPathComparator<T extends { path: string }>(paths: string[]) {
  const directories = new Set<string>();
  for (const path of paths) { const parts = path.split("/"); for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join("/")); }
  return (left: T, right: T) => {
    const leftParts = left.path.split("/");
    const rightParts = right.path.split("/");
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index];
      const rightPart = rightParts[index];
      if (leftPart === rightPart) continue;
      if (leftPart == null) return 1;
      if (rightPart == null) return -1;
      const parent = leftParts.slice(0, index).join("/");
      const leftPath = parent ? `${parent}/${leftPart}` : leftPart;
      const rightPath = parent ? `${parent}/${rightPart}` : rightPart;
      const leftDirectory = directories.has(leftPath);
      const rightDirectory = directories.has(rightPath);
      if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
      return leftPart.localeCompare(rightPart);
    }
    return 0;
  };
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

import type { TFunction } from "i18next";
import { ApiError } from "@/api/client";

export type FinishError = { message: string; code?: string | null };
export const finishError = (cause: unknown): FinishError => ({
  message: cause instanceof Error ? cause.message : String(cause),
  code: cause instanceof ApiError ? cause.code : undefined,
});
export function isWorktreeError(code?: string | null) {
  return [
    "WORKTREE_DIRECTORY_MISSING",
    "WORKTREE_NOT_GIT",
    "WORKTREE_GIT_BROKEN",
  ].includes(code ?? "");
}
export function finishErrorText(error: FinishError, t: TFunction) {
  const keys: Record<string, string> = {
    PARENT_WORKTREE_DIRECTORY_MISSING: "parentDirectoryMissing",
    PARENT_WORKTREE_NOT_GIT: "parentNotGit",
    PARENT_WORKTREE_GIT_BROKEN: "parentGitBroken",
    WORKTREE_DIRECTORY_MISSING: "directoryMissing",
    WORKTREE_NOT_GIT: "notGit",
    WORKTREE_GIT_BROKEN: "gitBroken",
    FORCE_DELETE_NOT_AVAILABLE: "unavailable",
    FORCE_DELETE_SESSION_ACTIVE: "sessionActive",
    FORCE_DELETE_OPERATION_ACTIVE: "operationActive",
  };
  const key = keys[error.code ?? ""];
  return key ? t(`deliveryUi.recovery.${key}`) : error.message;
}

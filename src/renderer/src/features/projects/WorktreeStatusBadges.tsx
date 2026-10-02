import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { GitWorktree } from "@/domain/types";

export function WorktreeStatusBadges({ worktree }: { worktree: GitWorktree }) {
  const { t } = useTranslation();
  const status = worktree.status;
  if (!status) return null;
  const branch = status.target_branch ?? "";
  return <>
    {status.prunable_reason !== null && <Badge variant="warning" title={status.prunable_reason || t("projectsUi.worktreePrunableHint")}>{t("projectsUi.worktreePrunable")}</Badge>}
    {!status.available && <Badge variant="destructive" title={t("projectsUi.worktreeUnavailableHint")}>{t("projectsUi.worktreeUnavailable")}</Badge>}
    {status.locked_reason !== null && <Badge variant="outline" title={status.locked_reason || t("projectsUi.worktreeLockedHint")}>{t("projectsUi.worktreeLocked")}</Badge>}
    {status.detached && <Badge variant="secondary" title={t("projectsUi.worktreeDetachedHint")}>{t("projectsUi.worktreeDetached")}</Badge>}
    {status.conflicted && <Badge variant="destructive" title={t("projectsUi.worktreeConflictedHint")}>{t("projectsUi.worktreeConflicted")}</Badge>}
    {status.dirty && !status.conflicted && <Badge variant="warning" title={t("projectsUi.worktreeDirtyHint")}>{t("projectsUi.worktreeDirty")}</Badge>}
    {status.has_ignored_files && <Badge variant="outline" title={t("projectsUi.worktreeIgnoredHint")}>{t("projectsUi.worktreeIgnored")}</Badge>}
    {status.operation_in_progress && <Badge variant="warning">{t("projectsUi.worktreeOperationInProgress")}</Badge>}
    {status.comparison === "uncontained" && (status.ahead ?? 0) > 0 && (status.behind ?? 0) > 0 && <Badge variant="warning" title={t("projectsUi.worktreeDivergedHint", { branch })}>{t("projectsUi.worktreeDiverged")}</Badge>}
    {status.comparison === "contained" && <Badge variant="success" className="max-w-full min-w-0" title={t("projectsUi.worktreeContainedHint", { branch })}><span className="truncate">{t("projectsUi.worktreeContained", { branch })}</span></Badge>}
    {status.comparison === "same" && <Badge variant="success" className="max-w-full min-w-0" title={t("projectsUi.worktreeSameHint", { branch })}><span className="truncate">{t("projectsUi.worktreeSame", { branch })}</span></Badge>}
    {status.comparison === "squashed" && <Badge variant="success" className="max-w-full min-w-0" title={t("projectsUi.worktreeSquashedHint", { branch })}><span className="truncate">{t("projectsUi.worktreeSquashed", { branch })}</span></Badge>}
    {status.ahead != null && status.behind != null && <Badge variant="outline" title={t("projectsUi.worktreeCountsHint", { branch, ahead: status.ahead, behind: status.behind })}>{t("projectsUi.worktreeCounts", { ahead: status.ahead, behind: status.behind })}</Badge>}
    {status.cleanup_candidate && !worktree.is_main && !worktree.workspace_id && <Badge variant="success" title={t("projectsUi.worktreeCleanupHint", { branch })}>{t("projectsUi.worktreeCleanup")}</Badge>}
    {status.available && status.comparison === "unknown" && <Badge variant="outline" title={t("projectsUi.worktreeComparisonUnknownHint")}>{t("projectsUi.worktreeComparisonUnknown")}</Badge>}
  </>;
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCompare, SquareTerminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { NativeSelect as Select } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { ParentOperation, Session, WorkspaceDetail } from "@/domain/types";
import { useFinishBatch } from "./useFinishBatch";
import { ForceFinishWorkspace } from "./ForceFinishWorkspace";
import { finishErrorText, isWorktreeError } from "./finishErrors";
import { FinishConflict } from "./FinishConflict";

export function FinishWorkspaceDialog({
  workspace,
  onOpenChange,
  onCompleted,
  onOpenSession,
  onOpenShell,
  onReviewChanges,
}: {
  workspace: WorkspaceDetail | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
  onOpenSession: (operation: ParentOperation, session: Session) => void;
  onOpenShell: (locationId: string) => void;
  onReviewChanges: (locationId: string) => void;
}) {
  const { t } = useTranslation();
  const flow = useFinishBatch(workspace);
  const [selected, setSelected] = useState("");
  useEffect(() => setSelected(""), [workspace?.id]);
  const repositories =
    workspace?.repositories.filter((item) =>
      flow.batch
        ? flow.batch.items.some((entry) => entry.repository_id === item.id)
        : item.access_mode === "read_write" &&
          ["active", "failed", "conflicted", "published"].includes(
            item.delivery_status,
          ),
    ) ?? [];
  const current = repositories.some((item) => item.id === selected)
    ? selected
    : repositories[0]?.id;
  const skippedCount =
    flow.batch?.items.filter((item) => item.status === "skipped").length ?? 0;
  const completed = flow.batch?.status === "completed";
  const progress = flow.batch?.items.filter((item) => item.cleaned).length ?? 0;
  const hasDamagedRepositories = flow.skippedRepositories.length > 0;
  return (
    <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {t("deliveryUi.batchTitle", {
              type: workspace?.kind === "fork" ? "Fork" : "Workspace",
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              completed
                ? skippedCount
                  ? "deliveryUi.recovery.completedWithSkips"
                  : "deliveryUi.batchCompletedDescription"
                : flow.batch?.status === "paused"
                  ? "deliveryUi.batchPausedDescription"
                  : flow.batch
                    ? "deliveryUi.batchRunningDescription"
                    : "deliveryUi.batchDescription",
              { count: skippedCount },
            )}
          </DialogDescription>
        </DialogHeader>
        {!flow.loaded ? (
          <p>{t("states.checking")}</p>
        ) : !repositories.length && !flow.batch ? (
          <p>{t("deliveryUi.batchReadyToArchive")}</p>
        ) : (
          <Tabs
            orientation="vertical"
            value={current ?? ""}
            onValueChange={(value) => setSelected(String(value))}
            className="min-h-0 flex-1 gap-4 overflow-hidden"
          >
            <TabsList
              aria-label={t("deliveryUi.rEPOSITORY")}
              variant="line"
              className="max-h-[60vh] w-40 shrink-0 justify-start overflow-y-auto sm:w-48"
            >
              {repositories.map((item) => {
                const status = flow.batch?.items.find(
                  (entry) => entry.repository_id === item.id,
                )?.status;
                const check = flow.preflights[item.id];
                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className="h-auto flex-none flex-wrap gap-2"
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={item.repository_name}
                    >
                      {item.repository_name}
                    </span>
                    <Badge
                      variant={
                        status === "blocked" ||
                        flow.checks[item.id] ||
                        check?.blockers.length
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {status
                        ? t(`deliveryUi.batchStates.${status}`)
                        : t(
                            check
                              ? check.blockers.length
                                ? "states.blocked"
                                : "states.ready"
                              : flow.checks[item.id]
                                ? "states.failed"
                                : "states.checking",
                          )}
                    </Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <div
              data-testid="finish-scroll-region"
              className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1"
            >
              {repositories.map((item) => {
                const draft = flow.drafts[item.id];
                const check = flow.preflights[item.id];
                const progressItem = flow.batch?.items.find(
                  (entry) => entry.repository_id === item.id,
                );
                const structuralCheck =
                  !progressItem?.cleaned &&
                  isWorktreeError(flow.checks[item.id]?.code)
                    ? flow.checks[item.id]
                    : null;
                const progressError =
                  structuralCheck ??
                  (progressItem?.error &&
                  !(
                    isWorktreeError(progressItem.error_code) &&
                    flow.preflights[item.id]
                  )
                    ? {
                        message: progressItem.error,
                        code: progressItem.error_code,
                      }
                    : null);
                return (
                  <TabsContent
                    key={item.id}
                    value={item.id}
                    className="flex flex-col gap-4"
                  >
                    <h3 className="break-words text-sm font-semibold">
                      {item.repository_name}
                    </h3>
                    {flow.batch ? (
                      <>
                        <p role="status">
                          {t(
                            `deliveryUi.batchStates.${progressItem?.status ?? "pending"}`,
                          )}
                        </p>
                        {progressError && (
                          <p
                            role="alert"
                            className="break-words text-destructive"
                          >
                            {finishErrorText(progressError, t)}
                            {structuralCheck && (
                              <span className="mt-2 block">
                                {t("deliveryUi.recovery.repairHint")}
                              </span>
                            )}
                          </p>
                        )}
                        {progressItem?.operation_id && (
                          <FinishConflict
                            id={progressItem.operation_id}
                            onOpenSession={onOpenSession}
                          />
                        )}
                        {flow.batch.status === "paused" && (
                          <p className="text-muted-foreground">
                            {t("deliveryUi.batchResumeHint")}
                          </p>
                        )}
                      </>
                    ) : (
                      draft && (
                        <>
                          <Field>
                            <FieldLabel htmlFor={`finish-strategy-${item.id}`}>
                              {t("deliveryUi.finishStrategy")}
                            </FieldLabel>
                            <Select
                              id={`finish-strategy-${item.id}`}
                              value={draft.code_action}
                              onChange={(event) => {
                                const code_action = event.target
                                  .value as typeof draft.code_action;
                                flow.update(item.id, {
                                  code_action,
                                  delete_worktree: code_action !== "keep",
                                  delete_branch:
                                    code_action !== "keep" && item.branch_ownership === "managed",
                                });
                              }}
                            >
                              <option value="squash_merge">{t("squashUi.delivery")}</option>
                              <option value="local_merge">
                                {t("deliveryUi.mergeTarget", {
                                  target:
                                    workspace?.kind === "fork"
                                      ? t("deliveryUi.parentWorkspace")
                                      : t("deliveryUi.localBaseBranch"),
                                })}
                              </option>
                              {workspace?.kind !== "fork" &&
                                item.remote_name && (
                                  <option value="push_branch">
                                    {t("deliveryUi.pushWorkspaceFeatureBranch")}
                                  </option>
                                )}
                              <option value="keep">
                                {t("deliveryUi.preserveWithoutDelivery")}
                              </option>
                            </Select>
                            {draft.code_action === "squash_merge" && <p className="text-xs text-muted-foreground">{t("squashUi.deliveryHint")}</p>}
                          </Field>
                          <section
                            data-testid="delivery-preflight"
                            className="flex flex-col gap-2 rounded-lg border p-4"
                          >
                            <p>
                              {t(
                                check
                                  ? check.blockers.length
                                    ? "states.blocked"
                                    : "states.ready"
                                  : flow.checks[item.id]
                                    ? "states.failed"
                                    : "states.checking",
                              )}
                            </p>
                            {check && (
                              <>
                                <p className="break-words">
                                  {t("deliveryUi.batchTarget", {
                                    branch: check.target_branch,
                                  })}
                                </p>
                                {(draft.code_action === "local_merge" || draft.code_action === "squash_merge") && item.base_branch && item.base_branch !== check.target_branch && (
                                  <p role="status" className="text-warning">{t("deliveryUi.differentCreationBase", { base: item.base_branch, target: check.target_branch })}</p>
                                )}
                                <p>
                                  {t("deliveryUi.preflightSummary", {
                                    ahead: check.ahead,
                                    behind: check.behind,
                                    files: check.changed_files.length,
                                  })}
                                </p>
                              </>
                            )}
                            {check?.warnings.map((text) => (
                              <p key={text} className="text-warning">
                                {text}
                              </p>
                            ))}
                            {check?.blockers.map((text) => (
                              <p
                                key={text}
                                className="break-words text-destructive"
                              >
                                {text}
                              </p>
                            ))}
                            {flow.checks[item.id] && (
                              <p
                                role="alert"
                                className="break-words text-destructive"
                              >
                                {finishErrorText(flow.checks[item.id], t)}
                                {isWorktreeError(
                                  flow.checks[item.id]?.code,
                                ) && (
                                  <span className="mt-2 block">
                                    {t("deliveryUi.recovery.repairHint")}
                                  </span>
                                )}
                              </p>
                            )}
                            {check?.source_dirty && (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => onReviewChanges(item.id)}
                                >
                                  <GitCompare data-icon="inline-start" />
                                  {t("deliveryUi.reviewChanges")}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onOpenShell(item.id)}
                                >
                                  <SquareTerminal data-icon="inline-start" />
                                  {t("deliveryUi.openShell")}
                                </Button>
                              </div>
                            )}
                          </section>
                          <FieldSet>
                            <FieldLegend>{t("deliveryUi.cleanup")}</FieldLegend>
                            <FieldGroup>
                              <Field orientation="horizontal">
                                <Checkbox
                                  id={`finish-worktree-${item.id}`}
                                  checked={draft.delete_worktree}
                                  onCheckedChange={(value) =>
                                    flow.update(item.id, {
                                      delete_worktree: value,
                                      delete_branch:
                                        value && draft.delete_branch,
                                    })
                                  }
                                />
                                <FieldLabel
                                  htmlFor={`finish-worktree-${item.id}`}
                                >
                                  {t("deliveryUi.removeManagedWorktree")}
                                </FieldLabel>
                              </Field>
                              <Field orientation="horizontal">
                                <Checkbox
                                  id={`finish-branch-${item.id}`}
                                  checked={draft.delete_branch}
                                  disabled={!draft.delete_worktree}
                                  onCheckedChange={(value) =>
                                    flow.update(item.id, {
                                      delete_branch: value,
                                    })
                                  }
                                />
                                <FieldLabel
                                  htmlFor={`finish-branch-${item.id}`}
                                >
                                  {t("deliveryUi.deleteLocalBranch")}
                                </FieldLabel>
                              </Field>
                            </FieldGroup>
                          </FieldSet>
                        </>
                      )
                    )}
                  </TabsContent>
                );
              })}
            </div>
          </Tabs>
        )}
        {(flow.error || flow.batch?.error) && (
          <p
            role="alert"
            className="max-h-24 overflow-y-auto break-words text-xs text-destructive"
          >
            {flow.error || flow.batch?.error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p role="status" className="text-xs text-muted-foreground">
            {flow.batch
              ? t(
                  completed
                    ? skippedCount
                      ? "deliveryUi.recovery.completedWithSkips"
                      : "deliveryUi.batchCompleted"
                    : "deliveryUi.batchProgress",
                  {
                    done: progress,
                    total: repositories.length,
                    count: skippedCount,
                  },
                )
              : repositories.length
                ? t("deliveryUi.batchCount", { count: repositories.length })
                : null}
          </p>
          <div className="flex gap-2">
            {(!flow.batch || flow.batch.status === "paused") &&
              repositories.length > 0 && (
                <Button
                  variant="ghost"
                  disabled={flow.busy}
                  onClick={flow.recheck}
                >
                  {t("deliveryUi.batchRecheck")}
                </Button>
              )}
            <Button
              variant="secondary"
              onClick={() => (completed ? onCompleted() : onOpenChange(false))}
            >
              {t(
                flow.batch
                  ? completed
                    ? "deliveryUi.batchDone"
                    : "deliveryUi.batchClose"
                  : "deliveryUi.cancel",
              )}
            </Button>
            {!completed && (
              <Button
                data-testid="finish-confirm-action"
                disabled={
                  flow.busy ||
                  hasDamagedRepositories ||
                  !flow.loaded ||
                  (flow.batch ? flow.batch.status === "running" : !flow.ready)
                }
                onClick={() => void flow.execute()}
              >
                {t(
                  flow.batch
                    ? flow.batch.status === "running"
                      ? "deliveryUi.finishing"
                      : "deliveryUi.batchResume"
                    : "deliveryUi.batchExecute",
                )}
              </Button>
            )}
            {!completed &&
              hasDamagedRepositories &&
              flow.batch?.status !== "running" && (
                <ForceFinishWorkspace
                  repositories={flow.skippedRepositories}
                  ready={flow.forceReady}
                  busy={flow.busy}
                  execute={() => flow.execute(true)}
                />
              )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

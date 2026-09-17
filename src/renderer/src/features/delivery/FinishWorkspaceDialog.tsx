import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { GitCompare, SquareTerminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { NativeSelect as Select } from "@/components/ui/native-select";
import type { DeliveryPreflight, ParentOperation, Session, WorkspaceDetail } from "@/domain/types";
import { workspacesApi } from "@/api/workspaces";
import { sessionsApi } from "@/api/sessions";
import { ParentOperationPanel } from "@/features/workspace/ParentOperationDialog";

type FinishStrategy = "local_merge" | "push_branch" | "keep";
type FinishDraft = {
  codeAction: FinishStrategy;
  deleteWorktree: boolean;
  deleteBranch: boolean;
};

export type FinishPayload = {
  code_action: FinishStrategy;
  keep_session_history: boolean;
  delete_worktree: boolean;
  delete_branch: boolean;
  preflight_id?: string;
  resume_finish?: boolean;
};

function initialDraft(isFork: boolean, deliveryMode: string): FinishDraft {
  const codeAction: FinishStrategy = isFork
    ? "local_merge"
    : deliveryMode === "local_merge" || deliveryMode === "keep"
      ? deliveryMode
      : "push_branch";
  const cleanup = codeAction !== "keep";
  return { codeAction, deleteWorktree: cleanup, deleteBranch: cleanup };
}

export function FinishWorkspaceDialog({
  workspace,
  busy,
  operation: operationProp,
  onOperationChange,
  onOpenChange,
  onSubmit,
  onOpenSession,
  onOpenShell,
  onReviewChanges,
}: {
  workspace: WorkspaceDetail | null;
  busy: boolean;
  operation: ParentOperation | null;
  onOperationChange: (operation: ParentOperation | null) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (locationId: string, payload: FinishPayload) => void;
  onOpenSession: (operation: ParentOperation, session: Session) => void;
  onOpenShell: (locationId: string) => void;
  onReviewChanges: (locationId: string) => void;
}) {
  const { t } = useTranslation();
  const finishable = workspace?.repositories.filter(
    (location) =>
      location.access_mode === "read_write" &&
      ["active", "failed", "conflicted", "published"].includes(
        location.delivery_status,
      ),
  ) ?? [];
  const isFork = workspace?.kind === "fork";
  const [locationId, setLocationId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, FinishDraft>>({});
  const location =
    finishable.find((item) => item.id === locationId) ?? finishable[0];
  const draft = location ? drafts[location.id] : undefined;
  const [preflight, setPreflight] = useState<DeliveryPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [resolverSession, setResolverSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const locations = workspace.repositories.filter(
      (item) =>
        item.access_mode === "read_write" &&
        ["active", "failed", "conflicted", "published"].includes(
          item.delivery_status,
        ),
    );
    setLocationId(locations[0]?.id ?? "");
    setDrafts(
      Object.fromEntries(
        locations.map((item) => [
          item.id,
          initialDraft(workspace.kind === "fork", item.delivery_mode),
        ]),
      ),
    );
  }, [workspace?.id]);

  useEffect(() => {
    if (!location || !draft) return;
    const controller = new AbortController();
    setChecking(true);
    setPreflight(null);
    setPreflightError("");
    void workspacesApi
      .preflight(location.id, draft.codeAction, controller.signal)
      .then(setPreflight)
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setPreflightError(
            cause instanceof Error ? cause.message : t("deliveryUi.preflightFailed"),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [location?.id, draft?.codeAction]);

  useEffect(() => {
    if (
      !operationProp ||
      !["active", "conflicted", "resolving", "recovery_required"].includes(
        operationProp.status,
      )
    )
      return;
    const timer = window.setInterval(() => {
      void workspacesApi
        .parentOperation(operationProp.id)
        .then(onOperationChange)
        .catch((cause: Error) => setOperationError(cause.message));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [operationProp?.id, operationProp?.status, onOperationChange]);

  const updateDraft = (update: Partial<FinishDraft>) => {
    if (!location || !draft) return;
    setDrafts((current) => ({
      ...current,
      [location.id]: { ...draft, ...update },
    }));
  };
  const selectStrategy = (codeAction: FinishStrategy) => {
    const cleanup = codeAction !== "keep";
    updateDraft({ codeAction, deleteWorktree: cleanup, deleteBranch: cleanup });
  };
  const blocked = !preflight || preflight.blockers.length > 0;
  const payload = (resumeFinish = false): FinishPayload | null =>
    draft
      ? {
          code_action: draft.codeAction,
          keep_session_history: true,
          delete_worktree: draft.deleteWorktree,
          delete_branch: draft.deleteBranch,
          preflight_id: preflight?.id,
          resume_finish: resumeFinish,
        }
      : null;
  const operationAction = async (action: () => Promise<ParentOperation>) => {
    setOperationBusy(true);
    setOperationError("");
    try {
      onOperationChange(await action());
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOperationBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("deliveryUi.finishLocation", { type: isFork ? "Fork" : "Workspace" })}</DialogTitle>
          <DialogDescription>{t("deliveryUi.finishDescription")}</DialogDescription>
        </DialogHeader>
        <div
          data-testid="finish-scroll-region"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
        >
          <Field>
            <FieldLabel htmlFor="finish-location">{t("deliveryUi.rEPOSITORY")}</FieldLabel>
            <Select
              id="finish-location"
              className="w-full"
              value={location?.id ?? ""}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {finishable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.repository_name} · {t(`states.${item.delivery_status}`, { defaultValue: item.delivery_status })}
                </option>
              ))}
            </Select>
          </Field>
          <section
            data-testid="delivery-preflight"
            className="rounded-lg border bg-muted/40 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold">
                {t("deliveryUi.preflightTitle", { name: location?.repository_name })}
              </h3>
              <Badge
                variant={preflight && !preflight.blockers.length ? "success" : "neutral"}
              >
                {t(checking ? "states.checking" : blocked ? "states.blocked" : "states.ready")}
              </Badge>
            </div>
            {preflight && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("deliveryUi.preflightSummary", { ahead: preflight.ahead, behind: preflight.behind, files: preflight.changed_files.length })}
              </p>
            )}
            {preflight?.warnings.map((item) => (
              <p key={item} className="mt-2 text-xs text-warning">
                {item}
              </p>
            ))}
            {preflight?.blockers.map((item) => (
              <p key={item} className="mt-2 text-xs text-destructive">
                {item}
              </p>
            ))}
            {preflight?.source_dirty && location && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => onReviewChanges(location.id)}><GitCompare data-icon="inline-start" />{t("deliveryUi.reviewChanges")}</Button>
                <Button size="sm" variant="outline" onClick={() => onOpenShell(location.id)}><SquareTerminal data-icon="inline-start" />{t("deliveryUi.openShell")}</Button>
              </div>
            )}
            {preflightError && (
              <p className="mt-2 text-xs text-destructive">{preflightError}</p>
            )}
          </section>
          <FieldSet className="rounded-lg border p-4">
            <FieldLegend variant="label">{t("deliveryUi.strategy")}</FieldLegend>
            <Field>
              <FieldLabel className="sr-only" htmlFor="finish-code-action">{t("deliveryUi.finishStrategy")}</FieldLabel>
              <Select
                id="finish-code-action"
                className="w-full"
                value={draft?.codeAction ?? ""}
                onChange={(event) =>
                  selectStrategy(event.target.value as FinishStrategy)
                }
              >
                <option value="local_merge">
                  {t("deliveryUi.mergeTarget", { target: isFork ? t("deliveryUi.parentWorkspace") : t("deliveryUi.localBaseBranch") })}
                </option>
                {!isFork && (
                  <option value="push_branch">{t("deliveryUi.pushWorkspaceFeatureBranch")}</option>
                )}
                <option value="keep">{t("deliveryUi.preserveWithoutDelivery")}</option>
              </Select>
            </Field>
          </FieldSet>
          {operationProp && (
            <ParentOperationPanel
              operation={operationProp}
              busy={operationBusy || busy}
              resolverSession={resolverSession}
              onResolve={() => {
                setOperationBusy(true);
                void workspacesApi
                  .resolveParentOperation(operationProp.id)
                  .then((session) => {
                    setResolverSession(session);
                    return workspacesApi.parentOperation(operationProp.id);
                  })
                  .then(onOperationChange)
                  .catch((cause: Error) => setOperationError(cause.message))
                  .finally(() => setOperationBusy(false));
              }}
              onOpenSession={() => {
                if (resolverSession) onOpenSession(operationProp, resolverSession);
                else if (operationProp.resolver_session_id) {
                  void sessionsApi
                    .get(operationProp.resolver_session_id)
                    .then((session) => onOpenSession(operationProp, session))
                    .catch((cause: Error) => setOperationError(cause.message));
                }
              }}
              onAbort={() =>
                void operationAction(() =>
                  workspacesApi.abortParentOperation(operationProp.id),
                )
              }
              onUndo={() =>
                void operationAction(() =>
                  workspacesApi.undoParentOperation(operationProp.id),
                )
              }
              onResumeFinish={() => {
                const nextPayload = payload(true);
                if (location && nextPayload) onSubmit(location.id, nextPayload);
              }}
            />
          )}
          {operationError && (
            <p className="text-xs text-destructive">{operationError}</p>
          )}
          <FieldSet className="rounded-lg border p-4">
            <FieldLegend variant="label">{t("deliveryUi.cleanup")}</FieldLegend>
            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox
                  id="finish-delete-worktree"
                  checked={draft?.deleteWorktree ?? false}
                  onCheckedChange={(checked) =>
                    updateDraft({
                      deleteWorktree: checked,
                      deleteBranch: checked ? draft?.deleteBranch : false,
                    })
                  }
                />
                <FieldLabel htmlFor="finish-delete-worktree">{t("deliveryUi.removeManagedWorktree")}</FieldLabel>
              </Field>
              <Field
                orientation="horizontal"
                data-disabled={!draft?.deleteWorktree || undefined}
              >
                <Checkbox
                  id="finish-delete-branch"
                  checked={draft?.deleteBranch ?? false}
                  disabled={!draft?.deleteWorktree}
                  onCheckedChange={(checked) =>
                    updateDraft({ deleteBranch: checked })
                  }
                />
                <FieldLabel htmlFor="finish-delete-branch">{t("deliveryUi.deleteLocalBranch")}</FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >{t("deliveryUi.cancel")}</Button>
          <Button
            data-testid="finish-confirm-action"
            variant="destructive"
            disabled={
              busy ||
              checking ||
              blocked ||
              !location ||
              !draft ||
              Boolean(
                operationProp &&
                  [
                    "active",
                    "conflicted",
                    "resolving",
                    "completed",
                    "recovery_required",
                  ].includes(operationProp.status),
              )
            }
            onClick={() => {
              const nextPayload = payload();
              if (location && nextPayload) onSubmit(location.id, nextPayload);
            }}
          >
            {busy ? t("deliveryUi.finishing") : t("deliveryUi.finish", { name: location?.repository_name ?? t("deliveryUi.location") })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

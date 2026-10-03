import { AgentSelect, useAgentChoice } from "@/features/agents/AgentSelect";
import { compactPath } from "@/lib/compactPath";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitPullRequestArrow, Sparkles } from "lucide-react";
import { workspacesApi } from "@/api/workspaces";
import { sessionsApi } from "@/api/sessions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  AgentKind,
  ParentOperation,
  ParentOperationPreview,
  ParentOperationStrategy,
  Session,
  WorkspaceDetail,
} from "@/domain/types";

const liveStatuses = new Set(["active", "conflicted", "resolving", "recovery_required"]);

export function ParentOperationDialog({
  workspace,
  direction,
  onOpenChange,
  onOpenSession,
}: {
  workspace: WorkspaceDetail | null;
  direction: "update" | null;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (operation: ParentOperation, session: Session) => void;
}) {
  const { t } = useTranslation();
  const repositories = useMemo(
    () =>
      (workspace?.repositories ?? []).filter(
        (location) => location.access_mode === "read_write" && location.git_status === "ready",
      ),
    [workspace],
  );
  const [repositoryId, setRepositoryId] = useState("");
  const [strategy, setStrategy] = useState<ParentOperationStrategy>("rebase");
  const [preview, setPreview] = useState<ParentOperationPreview | null>(null);
  const [operation, setOperation] = useState<ParentOperation | null>(null);
  const [resolverSession, setResolverSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRepositoryId(repositories[0]?.id ?? "");
    setStrategy("rebase");
    setPreview(null);
    setOperation(null);
    setResolverSession(null);
    setError("");
  }, [workspace?.id, direction, repositories]);

  useEffect(() => {
    if (!repositoryId || !direction) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    workspacesApi
      .parentOperationPreview(repositoryId, direction, controller.signal)
      .then((next) => {
        setPreview(next);
        setOperation(next.operation ?? null);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [repositoryId, direction]);

  useEffect(() => {
    if (!operation || !liveStatuses.has(operation.status)) return;
    const timer = window.setInterval(() => {
      workspacesApi
        .parentOperation(operation.id)
        .then(setOperation)
        .catch((reason: Error) => setError(reason.message));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [operation?.id, operation?.status]);

  if (!workspace || !direction) return null;
  const title = t("workspaceUi.updateFromParent");
  const currentOperation = operation ?? preview?.operation ?? null;
  const blocked = !preview || preview.blockers.length > 0;
  const canStart =
    !currentOperation ||
    ["aborted", "undone", "failed"].includes(currentOperation.status) ||
    currentOperation.status === "completed";

  const run = async (action: () => Promise<ParentOperation>) => {
    setBusy(true);
    setError("");
    try {
      setOperation(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (kind?: AgentKind) => {
    if (!currentOperation) return;
    setBusy(true);
    setError("");
    try {
      const session = await workspacesApi.resolveParentOperation(currentOperation.id, kind);
      setResolverSession(session);
      setOperation(await workspacesApi.parentOperation(currentOperation.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="parent-operation-dialog" className="grid-cols-1 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t("workspaceUi.updateFromParentDescription")}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="parent-operation-repository">{t("workspaceUi.repository")}</FieldLabel>
            <NativeSelect
              id="parent-operation-repository"
              className="w-full"
              value={repositoryId}
              disabled={busy && !preview}
              onChange={(event) => setRepositoryId(event.target.value)}
            >
              {repositories.map((repository) => (
                <NativeSelectOption key={repository.id} value={repository.id}>
                  {repository.repository_name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          {canStart && (
            <Field>
              <FieldLabel>{t("workspaceUi.strategy")}</FieldLabel>
              <ToggleGroup
                value={[strategy]}
                onValueChange={(value) => {
                  const next = value[0] as ParentOperationStrategy | undefined;
                  if (next) setStrategy(next);
                }}
                variant="outline"
                spacing={0}
              >
                <ToggleGroupItem value="rebase">{t("workspaceUi.rebaseRecommended")}</ToggleGroupItem>
                <ToggleGroupItem value="merge">{t("workspaceUi.merge")}</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>{t("workspaceUi.strategyDescription")}</FieldDescription>
            </Field>
          )}
        </FieldGroup>

        {busy && !preview && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner />{t("workspaceUi.checkingRepositoryState")}</div>
        )}

        {preview && (
          <Alert>
            <GitPullRequestArrow />
            <AlertTitle className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 truncate" title={preview.repository_name}>{preview.repository_name}</span>
              <Badge variant="secondary">{outcomeLabel(preview.outcome)}</Badge>
            </AlertTitle>
            <AlertDescription className="min-w-0">
              <p className="[overflow-wrap:anywhere]">{preview.source_branch} → {preview.target_branch}</p>
              <p className="truncate" title={preview.target_path}>{t("workspaceUi.target")}{compactPath(preview.target_path)}</p>
            </AlertDescription>
          </Alert>
        )}

        {preview?.blockers.map((blocker) => (
          <Alert key={blocker} variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t("workspaceUi.blocked")}</AlertTitle>
            <AlertDescription>{blocker}</AlertDescription>
          </Alert>
        ))}

        {currentOperation && (
          <ParentOperationPanel
            operation={currentOperation}
            busy={busy}
            resolverSession={resolverSession}
            onResolve={kind => void resolve(kind)}
            onOpenSession={() => {
              if (resolverSession) {
                onOpenSession(currentOperation, resolverSession);
              } else if (currentOperation.resolver_session_id) {
                void sessionsApi
                  .get(currentOperation.resolver_session_id)
                  .then((session) => onOpenSession(currentOperation, session))
                  .catch((reason: Error) => setError(reason.message));
              }
            }}
            onAbort={() => void run(() => workspacesApi.abortParentOperation(currentOperation.id))}
          />
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t("workspaceUi.operationFailed")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>{t("workspaceUi.close")}</Button>
          {canStart && (
            <Button
              data-testid="start-parent-operation"
              disabled={busy || blocked || !repositoryId}
              onClick={() =>
                void run(() =>
                  workspacesApi.startParentOperation(
                    repositoryId,
                    direction,
                    strategy,
                  ),
                )
              }
            >
              {busy ? <Spinner data-icon="inline-start" /> : <GitPullRequestArrow data-icon="inline-start" />}
              {title}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ParentOperationPanel({
  operation,
  busy,
  resolverSession,
  onResolve,
  onOpenSession,
  onAbort,
}: {
  operation: ParentOperation;
  busy: boolean;
  resolverSession?: Session | null;
  onResolve: (kind?: AgentKind) => void;
  onOpenSession: () => void;
  onAbort: () => void;
}) {
  const { t } = useTranslation();
  const choice = useAgentChoice();
  const conflicted = operation.status === "conflicted" || operation.status === "resolving";
  return (
    <Alert variant={conflicted || operation.status === "recovery_required" ? "warning" : "default"}>
      {conflicted ? <AlertTriangle /> : <Sparkles />}
      <AlertTitle className="flex items-center gap-2">
        {statusLabel(operation.status)}
        <Badge variant="outline">{t(`states.${operation.strategy}`, { defaultValue: operation.strategy })}</Badge>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {operation.error && <p>{operation.error}</p>}
        {operation.strategy === "squash" && conflicted && <p>{t("squashUi.resolveHint")} <code className="break-all">git commit --allow-empty -m "Squash delivery" -m "Treefold-Squash: {operation.id}"</code></p>}
        {conflicted && !operation.resolver_session_id && <AgentSelect choice={choice} disabled={busy} />}
        <div className="flex flex-wrap gap-2">
          {conflicted && (
            <Button size="sm" disabled={busy || (!operation.resolver_session_id && !choice.kind)} onClick={() => onResolve(choice.kind)}>
              {busy ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}{t("workspaceUi.resolveWithAI")}</Button>
          )}
          {(resolverSession || operation.resolver_session_id) && (
            <Button size="sm" variant="outline" onClick={onOpenSession}>{t("workspaceUi.openSession")}</Button>
          )}
          {(conflicted || operation.status === "recovery_required") && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={onAbort}>{t("workspaceUi.stopAIAbort")}</Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function outcomeLabel(outcome: ParentOperationPreview["outcome"]) {
  return i18n.t(`states.${outcome}`, { defaultValue: outcome });
}

function statusLabel(status: ParentOperation["status"]) {
  return i18n.t(`parentOperationStatus.${status}`, { defaultValue: status });
}

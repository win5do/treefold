import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitMerge, GitPullRequestArrow, Sparkles } from "lucide-react";
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
  ParentOperation,
  ParentOperationDirection,
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
  direction: ParentOperationDirection | null;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (operation: ParentOperation, session: Session) => void;
}) {
  const repositories = useMemo(
    () =>
      (workspace?.locations ?? []).filter(
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
    setStrategy(direction === "integrate" ? "merge" : "rebase");
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
  const title = direction === "update" ? "Update from Parent" : "Integrate into Parent";
  const currentOperation = operation ?? preview?.operation ?? null;
  const blocked = !preview || preview.blockers.length > 0;
  const canStart =
    !currentOperation ||
    ["aborted", "undone", "failed"].includes(currentOperation.status) ||
    (currentOperation.status === "completed" && !currentOperation.undo_available);

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

  const resolve = async () => {
    if (!currentOperation) return;
    setBusy(true);
    setError("");
    try {
      const session = await workspacesApi.resolveParentOperation(currentOperation.id);
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
      <DialogContent data-testid="parent-operation-dialog" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {direction === "update"
              ? "Bring the selected Workspace or Fork Repository up to its parent without fetching remotes."
              : "Merge the selected Repository into its parent checkout. Git fast-forwards when possible."}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="parent-operation-repository">Repository</FieldLabel>
            <NativeSelect
              id="parent-operation-repository"
              className="w-full"
              value={repositoryId}
              disabled={busy && !preview}
              onChange={(event) => setRepositoryId(event.target.value)}
            >
              {repositories.map((repository) => (
                <NativeSelectOption key={repository.id} value={repository.id}>
                  {repository.location_name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          {direction === "update" && canStart && (
            <Field>
              <FieldLabel>Strategy</FieldLabel>
              <ToggleGroup
                value={[strategy]}
                onValueChange={(value) => {
                  const next = value[0] as ParentOperationStrategy | undefined;
                  if (next) setStrategy(next);
                }}
                variant="outline"
                spacing={0}
              >
                <ToggleGroupItem value="rebase">Rebase (Recommended)</ToggleGroupItem>
                <ToggleGroupItem value="merge">Merge</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>Rebase keeps a linear branch; Merge preserves existing commit topology.</FieldDescription>
            </Field>
          )}
        </FieldGroup>

        {busy && !preview && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Checking Repository state…
          </div>
        )}

        {preview && (
          <Alert>
            {direction === "update" ? <GitPullRequestArrow /> : <GitMerge />}
            <AlertTitle className="flex items-center gap-2">
              {preview.repository_name}
              <Badge variant="secondary">{outcomeLabel(preview.outcome)}</Badge>
            </AlertTitle>
            <AlertDescription>
              <p>{preview.source_branch} → {preview.target_branch}</p>
              <p className="truncate" title={preview.target_path}>Target: {preview.target_path}</p>
            </AlertDescription>
          </Alert>
        )}

        {preview?.blockers.map((blocker) => (
          <Alert key={blocker} variant="destructive">
            <AlertTriangle />
            <AlertTitle>Blocked</AlertTitle>
            <AlertDescription>{blocker}</AlertDescription>
          </Alert>
        ))}

        {currentOperation && (
          <ParentOperationPanel
            operation={currentOperation}
            busy={busy}
            resolverSession={resolverSession}
            onResolve={() => void resolve()}
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
            onUndo={() => void run(() => workspacesApi.undoParentOperation(currentOperation.id))}
          />
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Operation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
          {canStart && (
            <Button
              data-testid="start-parent-operation"
              disabled={busy || blocked || !repositoryId}
              onClick={() =>
                void run(() =>
                  workspacesApi.startParentOperation(
                    repositoryId,
                    direction,
                    direction === "integrate" ? "merge" : strategy,
                  ),
                )
              }
            >
              {busy ? <Spinner data-icon="inline-start" /> : direction === "update" ? <GitPullRequestArrow data-icon="inline-start" /> : <GitMerge data-icon="inline-start" />}
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
  onUndo,
  onResumeFinish,
}: {
  operation: ParentOperation;
  busy: boolean;
  resolverSession?: Session | null;
  onResolve: () => void;
  onOpenSession: () => void;
  onAbort: () => void;
  onUndo: () => void;
  onResumeFinish?: () => void;
}) {
  const conflicted = operation.status === "conflicted" || operation.status === "resolving";
  return (
    <Alert variant={conflicted || operation.status === "recovery_required" ? "warning" : "default"}>
      {conflicted ? <AlertTriangle /> : <Sparkles />}
      <AlertTitle className="flex items-center gap-2">
        {statusLabel(operation.status)}
        <Badge variant="outline">{operation.strategy}</Badge>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {operation.error && <p>{operation.error}</p>}
        <div className="flex flex-wrap gap-2">
          {conflicted && (
            <Button size="sm" disabled={busy} onClick={onResolve}>
              {busy ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              Resolve with AI
            </Button>
          )}
          {(resolverSession || operation.resolver_session_id) && (
            <Button size="sm" variant="outline" onClick={onOpenSession}>Open Session</Button>
          )}
          {conflicted && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={onAbort}>Stop AI & Abort</Button>
          )}
          {operation.status === "completed" && operation.undo_available && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onUndo}>
              {operation.direction === "update" ? "Undo Update" : "Undo Integration"}
            </Button>
          )}
          {operation.status === "completed" && operation.origin === "finish" && onResumeFinish && (
            <Button size="sm" disabled={busy} onClick={onResumeFinish}>Resume Finish</Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function outcomeLabel(outcome: ParentOperationPreview["outcome"]) {
  if (outcome === "up_to_date") return "up to date";
  if (outcome === "fast_forward") return "fast-forward";
  return "merge commit";
}

function statusLabel(status: ParentOperation["status"]) {
  if (status === "recovery_required") return "Recovery required";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

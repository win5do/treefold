import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect as Select } from "@/components/ui/native-select";
import type { DeliveryPreflight, ParentOperation, Session, WorkspaceDetail } from "@/domain/types";
import { workspacesApi } from "@/api/workspaces";
import { sessionsApi } from "@/api/sessions";
import { ParentOperationPanel } from "@/features/workspace/ParentOperationDialog";

export type FinishPayload = { code_action: string; push_after_merge: boolean; keep_session_history: boolean; delete_worktree: boolean; delete_branch: boolean; commit_message?: string; preflight_id?: string; resume_finish?: boolean };
export function FinishWorkspaceDialog({ workspace, busy, operation: operationProp, onOperationChange, onOpenChange, onSubmit, onOpenSession }: { workspace: WorkspaceDetail | null; busy: boolean; operation: ParentOperation | null; onOperationChange: (operation: ParentOperation | null) => void; onOpenChange: (open: boolean) => void; onSubmit: (locationId: string, payload: FinishPayload) => void; onOpenSession: (operation: ParentOperation, session: Session) => void }) {
  const finishable = workspace?.locations.filter((location) => location.access_mode === "read_write" && ["active", "failed", "conflicted"].includes(location.delivery_status)) ?? [];
  const [locationId, setLocationId] = useState("");
  const location = finishable.find((item) => item.id === locationId) ?? finishable[0];
  const [codeAction, setCodeAction] = useState("remote_merged");
  const [keepSessions, setKeepSessions] = useState(true);
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [preflight, setPreflight] = useState<DeliveryPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [resolverSession, setResolverSession] = useState<Session | null>(null);
  const isFork = workspace?.kind === "fork";
  useEffect(() => { if (!workspace) return; const first = workspace.locations.find((item) => item.access_mode === "read_write" && ["active", "failed", "conflicted"].includes(item.delivery_status)); setLocationId(first?.id ?? ""); }, [workspace?.id]);
  useEffect(() => { if (!workspace || !location) return; setCodeAction(isFork || location.delivery_mode === "local_merge" ? "local_merge" : "remote_merged"); setKeepSessions(true); setDeleteWorktree(true); setDeleteBranch(true); setCommitMessage(""); }, [workspace?.id, location?.id, isFork]);
  useEffect(() => { if (!location) return; const controller = new AbortController(); setChecking(true); setPreflight(null); setPreflightError(""); void workspacesApi.preflight(location.id, codeAction, controller.signal).then(setPreflight).catch((cause) => { if (!controller.signal.aborted) setPreflightError(cause instanceof Error ? cause.message : "Preflight failed"); }).finally(() => { if (!controller.signal.aborted) setChecking(false); }); return () => controller.abort(); }, [location?.id, codeAction]);
  useEffect(() => { if (codeAction === "keep") { setDeleteWorktree(false); setDeleteBranch(false); } else if (codeAction === "discard") { setDeleteWorktree(true); setDeleteBranch(true); } }, [codeAction]);
  useEffect(() => {
    if (!operationProp || !["active", "conflicted", "resolving", "recovery_required"].includes(operationProp.status)) return;
    const timer = window.setInterval(() => {
      void workspacesApi.parentOperation(operationProp.id).then(onOperationChange).catch((cause: Error) => setOperationError(cause.message));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [operationProp?.id, operationProp?.status, onOperationChange]);
  const blocked = !preflight || preflight.blockers.length > 0;
  const payload = (resumeFinish = false): FinishPayload => ({ code_action: codeAction, push_after_merge: false, keep_session_history: keepSessions, delete_worktree: codeAction === "discard" || deleteWorktree, delete_branch: codeAction === "discard" || deleteBranch, commit_message: commitMessage || undefined, preflight_id: preflight?.id, resume_finish: resumeFinish });
  const operationAction = async (action: () => Promise<ParentOperation>) => {
    setOperationBusy(true);
    setOperationError("");
    try { onOperationChange(await action()); } catch (cause) { setOperationError(cause instanceof Error ? cause.message : String(cause)); } finally { setOperationBusy(false); }
  };
  return <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Finish {isFork ? "Fork" : "Workspace"} location</DialogTitle>
        <DialogDescription>Finish each Git location independently. The Workspace is archived only after all repositories reach a terminal state.</DialogDescription>
      </DialogHeader>
      <div data-testid="finish-scroll-region" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <Field>
          <FieldLabel htmlFor="finish-location">REPOSITORY</FieldLabel>
          <Select id="finish-location" className="w-full" value={location?.id ?? ""} onChange={(event) => setLocationId(event.target.value)}>
            {finishable.map((item) => <option key={item.id} value={item.id}>{item.location_name} · {item.delivery_status}</option>)}
          </Select>
        </Field>
        <section data-testid="delivery-preflight" className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">Delivery preflight · {location?.location_name}</h3>
            <Badge variant={preflight && !preflight.blockers.length ? "success" : "neutral"}>{checking ? "checking" : blocked ? "blocked" : "ready"}</Badge>
          </div>
          {preflight && <p className="mt-3 text-xs text-muted-foreground">{preflight.ahead} ahead · {preflight.behind} behind · {preflight.changed_files.length} files</p>}
          {preflight?.warnings.map((item) => <p key={item} className="mt-2 text-xs text-warning">{item}</p>)}
          {preflight?.blockers.map((item) => <p key={item} className="mt-2 text-xs text-destructive">{item}</p>)}
          {preflightError && <p className="mt-2 text-xs text-destructive">{preflightError}</p>}
        </section>
        <FieldSet className="rounded-lg border p-4">
          <FieldLegend variant="label">Code delivery</FieldLegend>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel className="sr-only" htmlFor="finish-code-action">Code delivery action</FieldLabel>
              <Select id="finish-code-action" className="w-full" value={codeAction} onChange={(event) => setCodeAction(event.target.value)}>
                {!isFork && <option value="remote_merged">Already merged through remote review / CI</option>}
                <option value="local_merge">Merge into {isFork ? "parent Workspace" : "local base branch"}</option>
                <option value="keep">Preserve branch</option>
                <option value="discard">Discard code</option>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="finish-commit-message">Final commit message</FieldLabel>
              <Input id="finish-commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Final commit message（required if dirty）" />
            </Field>
          </FieldGroup>
        </FieldSet>
        {operationProp && (
          <ParentOperationPanel
            operation={operationProp}
            busy={operationBusy || busy}
            resolverSession={resolverSession}
            onResolve={() => {
              setOperationBusy(true);
              void workspacesApi.resolveParentOperation(operationProp.id).then((session) => { setResolverSession(session); return workspacesApi.parentOperation(operationProp.id); }).then(onOperationChange).catch((cause: Error) => setOperationError(cause.message)).finally(() => setOperationBusy(false));
            }}
            onOpenSession={() => {
              if (resolverSession) onOpenSession(operationProp, resolverSession);
              else if (operationProp.resolver_session_id) void sessionsApi.get(operationProp.resolver_session_id).then((session) => onOpenSession(operationProp, session)).catch((cause: Error) => setOperationError(cause.message));
            }}
            onAbort={() => void operationAction(() => workspacesApi.abortParentOperation(operationProp.id))}
            onUndo={() => void operationAction(() => workspacesApi.undoParentOperation(operationProp.id))}
            onResumeFinish={() => location && onSubmit(location.id, payload(true))}
          />
        )}
        {operationError && <p className="text-xs text-destructive">{operationError}</p>}
        <FieldSet className="rounded-lg border p-4">
          <FieldLegend variant="label">Cleanup</FieldLegend>
          <FieldGroup className="gap-3">
            <Field orientation="horizontal" data-disabled={codeAction === "keep" || codeAction === "discard" || undefined}>
              <Checkbox id="finish-delete-worktree" checked={deleteWorktree} disabled={codeAction === "keep" || codeAction === "discard"} onCheckedChange={setDeleteWorktree} />
              <FieldLabel htmlFor="finish-delete-worktree">Remove managed worktree</FieldLabel>
            </Field>
            <Field orientation="horizontal" data-disabled={codeAction === "keep" || codeAction === "discard" || !deleteWorktree || undefined}>
              <Checkbox id="finish-delete-branch" checked={deleteBranch} disabled={codeAction === "keep" || codeAction === "discard" || !deleteWorktree} onCheckedChange={setDeleteBranch} />
              <FieldLabel htmlFor="finish-delete-branch">Delete delivered local branch</FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button data-testid="finish-confirm-action" variant="destructive" disabled={busy || checking || blocked || !location || Boolean(operationProp && ["active", "conflicted", "resolving", "completed", "recovery_required"].includes(operationProp.status))} onClick={() => location && onSubmit(location.id, payload())}>{busy ? "Finishing…" : `Finish ${location?.location_name ?? "location"}`}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

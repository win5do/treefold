import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { toast } from "@/lib/toast";
import type { GitBranches, GitBranchRef } from "@/domain/types";
import { compactPath } from "@/lib/compactPath";
import { BranchList } from "./BranchList";
import { branchRefLabel } from "./BranchPicker";

export type BranchCheckout = {
  kind: "local" | "remote" | "new";
  branch: string;
  remote?: string;
  local_branch?: string;
  base?: GitBranchRef;
  expected_branch?: string;
  expected_head?: string;
};

export function BranchSwitchDialog({ repository, busy, hint, loadBranches, onSwitch, onDelete, onOpenChange }: {
  repository: { id: string; name: string } | null;
  busy: boolean;
  hint?: string;
  loadBranches: (id: string, signal?: AbortSignal) => Promise<GitBranches>;
  onSwitch: (target: BranchCheckout) => Promise<void>;
  onDelete?: (target: GitBranchRef) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [target, setTarget] = useState<GitBranchRef | null>(null);
  const [name, setName] = useState("");
  const [newBranch, setNewBranch] = useState(false);
  const [remoteCheckout, setRemoteCheckout] = useState(false);
  const naming = newBranch || remoteCheckout;
  const [pending, setPending] = useState(false);
  const disabled = busy || pending || loading;
  useEffect(() => {
    setTarget(null); setName(""); setNewBranch(false); setRemoteCheckout(false); setBranches(null);
  }, [repository?.id]);
  useEffect(() => {
    if (!repository) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    loadBranches(repository.id, controller.signal).then((value) => {
      if (!controller.signal.aborted) setBranches(value);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repository?.id, version, loadBranches]);
  const newName = name.trim();
  const nameExists = Boolean(branches?.local.includes(newName));
  const nameInvalid = naming &&
    (!newName || newName.startsWith("-") || newName === "HEAD" || nameExists);
  const switchBlocked = !newBranch && (!target || (target.kind === "local" &&
    (target.branch === branches?.current || Boolean(branches?.occupied?.[target.branch]))));
  const submit = async () => {
    if (!branches || disabled || nameInvalid || switchBlocked) return;
    const payload: BranchCheckout = newBranch
      ? { kind: "new", branch: newName, ...(target ? { base: target } : {}) }
      : { ...target!, ...(target!.kind === "remote" ? { local_branch: newName } : {}) };
    setPending(true); setError("");
    try { await onSwitch({ ...payload, expected_branch: branches.current, ...(branches.head ? { expected_head: branches.head } : {}) }); }
    catch (cause) { toast.errorFrom(cause); }
    finally { setPending(false); }
  };
  return <Dialog open={Boolean(repository)} onOpenChange={(open) => { if (!pending) onOpenChange(open); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("branchSwitch.title")}</DialogTitle>
        <DialogDescription>{repository?.name}</DialogDescription>
      </DialogHeader>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {!naming && <BranchList compact key={repository?.id ?? "closed"} branches={branches} loading={loading} error={error} busy={disabled}
        onRefresh={() => setVersion((value) => value + 1)}
        renderBranch={(ref, current) => {
          const occupied = ref.kind === "local" && !current ? branches?.occupied?.[ref.branch] : undefined;
          const selection = target;
          const selected = selection && branchRefLabel(selection) === branchRefLabel(ref) && selection.kind === ref.kind;
          return <div className="flex items-center gap-1">
            <Button type="button" variant={selected ? "secondary" : "ghost"}
              className="h-auto min-h-8 min-w-0 flex-1 justify-start py-2"
              disabled={disabled}
              aria-pressed={Boolean(selected)}
              data-testid={`branch-${ref.kind}-${branchRefLabel(ref)}`}
              onClick={() => {
                if (!newBranch || !name || name === target?.branch) setName(ref.branch);
                setTarget(ref);
              }}>
              <GitBranch data-icon="inline-start" />
              <span className="min-w-0 text-left">
                <span className="block truncate" title={ref.branch}>{ref.branch}{current && ` (${t("labels.current")})`}</span>
                {occupied && <span className="pointer-events-auto block whitespace-normal break-all text-xs text-muted-foreground" title={occupied}>{t("workspaceUi.branchOccupied", { path: compactPath(occupied, 40) })}</span>}
              </span>
            </Button>
            {onDelete && <Button type="button" size="icon-sm" variant="ghost" disabled={disabled || current || Boolean(occupied)}
              aria-label={t("branchSwitch.deleteBranch", { branch: branchRefLabel(ref) })}
              onClick={async () => {
                if (!window.confirm(ref.kind === "remote" ? t("projectsUi.deleteRemoteBranch", { branch: ref.branch, remote: ref.remote }) : t("projectsUi.deleteLocalBranch", { branch: ref.branch }))) return;
                setPending(true);
                try { await onDelete(ref); setTarget(null); setVersion((value) => value + 1); }
                catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                finally { setPending(false); }
              }}><Trash2 data-icon="inline-start" /></Button>}
          </div>;
        }} />}
      {naming && target && <p className="break-all text-sm text-muted-foreground">{t("branchSwitch.from", { branch: branchRefLabel(target) })}</p>}
      {naming && <Field>
        <FieldLabel htmlFor="switch-branch-name">{t(newBranch ? "branchSwitch.branchName" : "branchSwitch.localName")}</FieldLabel>
        <Input key={newBranch ? "new" : "remote"} autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} id="switch-branch-name" value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} aria-invalid={Boolean(newName) && nameInvalid} />
        {nameInvalid && <FieldDescription className="text-destructive">{t(nameExists ? "branchSwitch.nameExists" : "branchSwitch.availableName")}</FieldDescription>}
      </Field>}
      <div className="flex justify-end gap-2">
        {naming ? <>
          <Button variant="outline" disabled={disabled} onClick={() => { setNewBranch(false); setRemoteCheckout(false); }}>{t("branchSwitch.back")}</Button>
          <Button disabled={disabled || switchBlocked || nameInvalid || !branches} onClick={() => void submit()}>{t(newBranch ? "branchSwitch.createAndSwitch" : "branchSwitch.checkout")}</Button>
        </> : <>
          <Button variant="outline" disabled={disabled || !target} onClick={() => { setName(target!.branch); setNewBranch(true); }}>{t("branchSwitch.newBranch")}</Button>
          <Button disabled={disabled || switchBlocked || !branches} onClick={() => {
            if (target?.kind === "remote") { setName(target.branch); setRemoteCheckout(true); }
            else void submit();
          }}>{t("branchSwitch.checkout")}</Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Plus, Trash2 } from "lucide-react";
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
  const [target, setTarget] = useState<GitBranchRef | "new" | null>(null);
  const [name, setName] = useState("");
  const [base, setBase] = useState<GitBranchRef | null>(null);
  const [pending, setPending] = useState(false);
  const disabled = busy || pending || loading;
  useEffect(() => {
    setTarget(null); setName(""); setBase(null); setBranches(null);
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
  const nameInvalid = Boolean(target === "new" || target?.kind === "remote") &&
    (!newName || newName.startsWith("-") || newName === "HEAD" || nameExists);
  const submit = async () => {
    if (!target || !branches || disabled || nameInvalid) return;
    const payload: BranchCheckout = target === "new"
      ? { kind: "new", branch: newName, ...(base ? { base } : {}) }
      : { ...target, ...(target.kind === "remote" ? { local_branch: newName } : {}) };
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
      <BranchList compact key={repository?.id ?? "closed"} branches={branches} loading={loading} error={error} busy={disabled}
        onRefresh={() => setVersion((value) => value + 1)}
        renderBranch={(ref, current) => {
          const occupied = ref.kind === "local" && !current ? branches?.occupied?.[ref.branch] : undefined;
          const selection = target === "new" ? base : target;
          const selected = selection && branchRefLabel(selection) === branchRefLabel(ref) && selection.kind === ref.kind;
          return <div className="flex items-center gap-1">
            <Button type="button" variant={selected ? "secondary" : "ghost"}
              className="h-auto min-h-8 min-w-0 flex-1 justify-start py-2"
              disabled={disabled || current || Boolean(occupied)}
              data-testid={`branch-${ref.kind}-${branchRefLabel(ref)}`}
              onClick={() => { setTarget(ref); setName(ref.branch); }}>
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
        }} />
      <Button type="button" variant={target === "new" ? "secondary" : "outline"} disabled={disabled || !branches}
        onClick={() => {
          if (target === "new") return;
          const source = target ?? (branches?.current ? { kind: "local" as const, branch: branches.current } : null);
          setBase(source);
          setName(source?.branch ?? "");
          setTarget("new");
        }}><Plus data-icon="inline-start" />{t("branchSwitch.newBranch")}</Button>
      {(target === "new" || target?.kind === "remote") && <Field>
        <FieldLabel htmlFor="switch-branch-name">{t(target === "new" ? "branchSwitch.branchName" : "branchSwitch.localName")}</FieldLabel>
        <Input key={target === "new" ? "new" : "remote"} autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} id="switch-branch-name" value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} aria-invalid={Boolean(newName) && nameInvalid} />
        {nameInvalid && <FieldDescription className="text-destructive">{t(nameExists ? "branchSwitch.nameExists" : "branchSwitch.availableName")}</FieldDescription>}
      </Field>}
      <div className="flex justify-end"><Button disabled={disabled || !target || nameInvalid || !branches} onClick={() => void submit()}>{t(target === "new" ? "branchSwitch.createAndSwitch" : "branchSwitch.switch")}</Button></div>
    </DialogContent>
  </Dialog>;
}

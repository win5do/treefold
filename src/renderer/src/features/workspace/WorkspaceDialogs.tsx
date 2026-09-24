import { useTranslation } from "react-i18next";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BranchNameField } from "@/features/git/BranchNameField";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { NativeSelect as Select } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type {
  GitBranches,
  ProjectDetail,
  WorkspaceRepository,
} from "@/domain/types";

export function CreateWorkspaceDialog({ project, busy, onOpenChange, onSubmit }: {
  project: ProjectDetail | null; busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  const repositories = useMemo(() => project?.repositories ?? [], [project]);
  const [branches, setBranches] = useState<Record<string, GitBranches>>({});
  const [remotes, setRemotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setBranches({}); setRemotes({}); setError("");
    if (!project) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    Promise.all(repositories.map(async repository => [repository.id, await projectsApi.repositoryBranches(repository.id, controller.signal)] as const))
      .then(entries => {
        if (controller.signal.aborted) return;
        setBranches(Object.fromEntries(entries));
        setRemotes(Object.fromEntries(entries.map(([id, options]) => [id, options.current_remote ?? ""])));
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project?.id, repositories]);
  const invalid = repositories.some(repository => { const options = branches[repository.id]; return !options?.current || !options.local.includes(options.current); });
  return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden">
      <DialogTitle>{t("workspaceUi.newWorkspace")}</DialogTitle>
      <DialogDescription>{t("workspaceUi.checkoutRemoteInheritance")}</DialogDescription>
      <form key={project?.id ?? "closed"} className="mt-4 flex min-h-0 flex-col gap-4" onSubmit={onSubmit}>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <FieldGroup>
          <Field><FieldLabel htmlFor="workspace-description">{t("workspaceUi.workspaceDescription")}</FieldLabel><Textarea id="workspace-description" name="description" placeholder={t("workspaceUi.scopeAndExpectedOutcome")} /></Field>
          <BranchNameField label={t("workspaceUi.sharedLocalBranch")} />
        </FieldGroup>
        {repositories.map(repository => <FieldSet key={repository.id}>
          <FieldLegend>{repository.name}</FieldLegend>
          <Field><FieldLabel htmlFor={`workspace-base-${repository.id}`}>{t("workspaceUi.baseBranch")}</FieldLabel><Input id={`workspace-base-${repository.id}`} name={`expected_base:${repository.id}`} readOnly value={branches[repository.id]?.current ?? ""} /></Field>
          <Field><FieldLabel htmlFor={`workspace-remote-${repository.id}`}>{t("workspaceUi.remote")}</FieldLabel>
            <Select id={`workspace-remote-${repository.id}`} name={`remote:${repository.id}`} value={remotes[repository.id] ?? ""} disabled={loading} onChange={event => setRemotes(current => ({ ...current, [repository.id]: event.target.value }))}>
              <option value="">{t("workspaceUi.configureBeforePush")}</option>
              {branches[repository.id]?.remotes.map(remote => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
            </Select>
            <FieldDescription>{t("workspaceUi.sameNameRemoteBranch")}</FieldDescription>
          </Field>
        </FieldSet>)}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <div className="flex shrink-0 justify-end"><Button type="submit" disabled={busy || loading || !!error || invalid}>{t("workspaceUi.createWorkspace")}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
export function ConfigureWorkspaceRepositoryDialog({
  location,
  busy,
  onOpenChange,
  onSubmit,
}: {
  location: WorkspaceRepository | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(location)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {t(location?.remote_branch ? "workspaceUi.changeUpstream" : "workspaceUi.setUpstream")}
        </DialogTitle>
        <DialogDescription className="mt-1">
          {t("workspaceUi.configureUpstream", { name: location?.repository_name })}
        </DialogDescription>
        {location && (
          <form
            key={JSON.stringify([
              location.id,
              location.remote_name,
              location.remote_branch,
            ])}
            className="mt-6 flex flex-col gap-3"
            onSubmit={onSubmit}
          >
            <FieldGroup className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="workspace-upstream-remote">{t("workspaceUi.remote")}</FieldLabel>
                <Input
                  id="workspace-upstream-remote"
                  name="remote_name"
                  defaultValue={location.remote_name ?? ""}
                  placeholder="origin"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="workspace-upstream-branch">{t("workspaceUi.remoteFeatureBranch")}</FieldLabel>
                <Input
                  id="workspace-upstream-branch"
                  name="remote_branch"
                  defaultValue={location.remote_branch ?? ""}
                  placeholder={location.branch || "feature/my-change"}
                  required
                />
              </Field>
            </FieldGroup>
            <FieldDescription className="rounded-lg bg-muted/50 px-3 py-2">{t("workspaceUi.upstreamDescription")}</FieldDescription>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>{t("workspaceUi.saveUpstream")}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

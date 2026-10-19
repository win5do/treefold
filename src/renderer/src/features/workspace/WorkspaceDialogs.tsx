import { useTranslation } from "react-i18next";
import { type FormEvent, useEffect, useState } from "react";
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
} from "@/components/ui/field";
import { NativeSelect as Select } from "@/components/ui/native-select";
import type {
  GitBranches,
  WorkspaceRepository,
} from "@/domain/types";

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
  const [remotes, setRemotes] = useState<GitBranches["remotes"]>([]);
  const [remoteName, setRemoteName] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRemotes([]);
    setRemoteName(location?.remote_name ?? "");
    setRemoteBranch(location?.remote_branch ?? "");
    setError("");
    if (!location) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    projectsApi.repositoryBranches(location.project_repository_id, controller.signal)
      .then((branches) => {
        if (controller.signal.aborted) return;
        setRemotes(branches.remotes);
        if (!branches.remotes.some((remote) => remote.name === location.remote_name)) {
          setRemoteName("");
          setRemoteBranch("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [location]);

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
                <Select
                  id="workspace-upstream-remote"
                  name="remote_name"
                  value={remoteName}
                  disabled={busy || loading}
                  onChange={(event) => {
                    const remote = event.target.value;
                    setRemoteName(remote);
                    setRemoteBranch(remote ? location.branch ?? "" : "");
                  }}
                >
                  <option value="">{t("workspaceUi.configureBeforePush")}</option>
                  {remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
                </Select>
              </Field>
              {remoteName ? <Field>
                <FieldLabel htmlFor="workspace-upstream-branch">{t("workspaceUi.remoteFeatureBranch")}</FieldLabel>
                <Input
                  id="workspace-upstream-branch"
                  name="remote_branch"
                  value={remoteBranch}
                  onChange={(event) => setRemoteBranch(event.target.value)}
                  disabled={busy || loading}
                  required
                />
              </Field> : <input type="hidden" name="remote_branch" value="" />}
            </FieldGroup>
            <FieldDescription>{t(remoteName ? "workspaceUi.upstreamDescription" : "workspaceUi.upstreamNotConfigured")}</FieldDescription>
            {error && <p role="alert" className="text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || loading || !!error || (!!remoteName && !remoteBranch.trim())}>{t("workspaceUi.saveUpstream")}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

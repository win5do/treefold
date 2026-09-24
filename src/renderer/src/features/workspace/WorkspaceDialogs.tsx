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
  ProjectRepository,
  WorkspaceRepository,
} from "@/domain/types";

function repositoryNeedsSetup(repository: ProjectRepository) {
  return (
    !repository.delivery_mode ||
    (repository.delivery_mode === "push_branch" &&
      !repository.preferred_remote_name)
  );
}

export function CreateWorkspaceDialog({
  project,
  busy,
  onOpenChange,
  onSubmit,
}: {
  project: ProjectDetail | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  const repositories = useMemo(() => project?.repositories ?? [], [project]);
  const setupRepositories = useMemo(
    () => repositories.filter(repositoryNeedsSetup),
    [repositories],
  );
  const defaultRepositoryId = useMemo(() => {
    const directory = project?.directories.find(
      (item) => item.id === project.default_directory_id,
    );
    return directory?.repository_id;
  }, [project]);
  const [branches, setBranches] = useState<Record<string, GitBranches>>({});
  const [remotes, setRemotes] = useState<Record<string, string>>({});
  const [deliveryModes, setDeliveryModes] = useState<
    Record<string, "push_branch" | "local_merge" | "keep">
  >({});
  const [loading, setLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [sharedBranch, setSharedBranch] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");
  const [remoteBranchEdited, setRemoteBranchEdited] = useState(false);

  useEffect(() => {
    setBranches({});
    setRemotes({});
    setOptionsError("");
    setSharedBranch("");
    setRemoteBranch("");
    setRemoteBranchEdited(false);
    setDeliveryModes(
      Object.fromEntries(
        (project?.repositories ?? []).map((repository) => [
          repository.id,
          repository.delivery_mode ?? "push_branch",
        ]),
      ),
    );
    if (!project) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    Promise.all(
      repositories.map(async (repository) => [
        repository.id,
        await projectsApi.repositoryBranches(repository.id, controller.signal),
      ] as const),
    )
      .then((entries) => {
        if (controller.signal.aborted) return;
        setDeliveryModes((current) => {
          const next = { ...current };
          for (const [id, options] of entries) {
            if (setupRepositories.some(repository => repository.id === id) && options.remotes.length === 0 && (next[id] ?? "push_branch") === "push_branch") {
              next[id] = "local_merge";
            }
          }
          return next;
        });
        setBranches(Object.fromEntries(entries));
        setRemotes(
          Object.fromEntries(
            entries.map(([id, options]) => {
              const repository = setupRepositories.find(
                (item) => item.id === id,
              );
              const selected =
                repository?.preferred_remote_name &&
                options.remotes.some(
                  (remote) => remote.name === repository.preferred_remote_name,
                )
                  ? repository.preferred_remote_name
                  : options.remotes[0]?.name || "";
              return [id, selected];
            }),
          ),
        );
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setOptionsError(
          cause instanceof Error
            ? cause.message
            : t("workspaceUi.couldNotLoadRepositoryBranches"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project?.id, repositories]);

  const defaultRepository = repositories.find(
    (repository) => repository.id === defaultRepositoryId,
  );
  const defaultDeliveryMode = defaultRepository
    ? deliveryModes[defaultRepository.id] ??
      defaultRepository.delivery_mode ??
      "push_branch"
    : "keep";
  const invalidSetup = repositories.some((repository) => {
    const options = branches[repository.id];
    const mode = deliveryModes[repository.id] ?? "push_branch";
    return (
      !options?.current || !options.local.includes(options.current) ||
      (mode === "push_branch" && options.remotes.length === 0)
    );
  });

  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("workspaceUi.newWorkspace")}</DialogTitle>
        <DialogDescription className="mt-1">{t("workspaceUi.eachGitLocationUsesItsOwnBaseBranchAndDeliveryMode")}</DialogDescription>
        <form
          key={project ? project.id : "closed"}
          className="mt-6 flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
          onSubmit={onSubmit}
        >
          <FieldGroup>
            <Field>
              <FieldLabel className="sr-only" htmlFor="workspace-description">{t("workspaceUi.workspaceDescription")}</FieldLabel>
              <Textarea
                id="workspace-description"
                name="description"
                placeholder={t("workspaceUi.scopeAndExpectedOutcome")}
              />
            </Field>
            <BranchNameField
              key={project?.id ?? "closed"}
              label={t("workspaceUi.sharedLocalBranch")}
              onChange={setSharedBranch}
            />
          </FieldGroup>

          <FieldSet>
            <FieldLegend>{t("workspaceUi.baseBranch")}</FieldLegend>
            <FieldDescription>{t("workspaceUi.currentBranchBaseHint")}</FieldDescription>
            {repositories.map((repository) => (
              <Field key={repository.id}>
                <FieldLabel htmlFor={`workspace-base-${repository.id}`}>{repository.name}</FieldLabel>
                <Input id={`workspace-base-${repository.id}`} name={`expected_base:${repository.id}`} readOnly value={branches[repository.id]?.current || ""} />
                {branches[repository.id] && (!branches[repository.id].current || !branches[repository.id].local.includes(branches[repository.id].current)) && <FieldDescription>{t("workspaceUi.currentBranchUnavailable")}</FieldDescription>}
              </Field>
            ))}
          </FieldSet>
          {setupRepositories.map((repository) => {
            const options = branches[repository.id];
            const mode = deliveryModes[repository.id] ?? "push_branch";
            return (
              <FieldSet key={repository.id} className="rounded-lg border p-3">
                <FieldLegend>{t("workspaceUi.repositoryDefaults", { name: repository.name })}</FieldLegend>
                <input
                  type="hidden"
                  name="setup_repository_id"
                  value={repository.id}
                />
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor={`delivery-mode-${repository.id}`}>{t("workspaceUi.defaultWorkspaceFinishStrategy")}</FieldLabel>
                    <Select
                      id={`delivery-mode-${repository.id}`}
                      className="w-full"
                      name={`delivery_mode:${repository.id}`}
                      value={mode}
                      onChange={(event) =>
                        setDeliveryModes((current) => ({
                          ...current,
                          [repository.id]: event.target.value as typeof mode,
                        }))
                      }
                    >
                      <option value="push_branch" disabled={!options?.remotes.length}>{t("workspaceUi.pushFeatureBranch")}</option>
                      <option value="local_merge">{t("workspaceUi.mergeIntoLocalBase")}</option>
                      <option value="keep">{t("workspaceUi.preserveWithoutDelivery")}</option>
                    </Select>
                    {options && options.remotes.length === 0 && (
                      <FieldDescription>{t("workspaceUi.noRemoteDeliveryHint")}</FieldDescription>
                    )}
                  </Field>
                  {mode === "push_branch" && (
                    <Field>
                      <FieldLabel htmlFor={`base-remote-${repository.id}`}>{t("workspaceUi.remote")}</FieldLabel>
                      <Select
                        id={`base-remote-${repository.id}`}
                        className="w-full"
                        name={`base_remote:${repository.id}`}
                        value={remotes[repository.id] || ""}
                        onChange={(event) =>
                          setRemotes((current) => ({
                            ...current,
                            [repository.id]: event.target.value,
                          }))
                        }
                        disabled={!options}
                        required
                      >
                        {options?.remotes.map((remote) => (
                          <option key={remote.name} value={remote.name}>
                            {remote.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </FieldGroup>
              </FieldSet>
            );
          })}

          {defaultDeliveryMode === "push_branch" && (
            <Field>
              <FieldLabel htmlFor="workspace-remote-branch">{t("workspaceUi.remoteFeatureBranch")}</FieldLabel>
              <Input
                id="workspace-remote-branch"
                name="remote_branch"
                value={remoteBranchEdited ? remoteBranch : sharedBranch}
                onChange={(event) => {
                  setRemoteBranchEdited(true);
                  setRemoteBranch(event.target.value);
                }}
                placeholder={t("workspaceUi.defaultsToTheLocalBranchName")}
              />
              <FieldDescription>{t("workspaceUi.generatedRemoteBranchDescription")}</FieldDescription>
            </Field>
          )}

          {loading && (
            <FieldDescription>{t("workspaceUi.loadingLocalBranchesAndRemotes")}</FieldDescription>
          )}
          {optionsError && (
            <FieldDescription className="text-destructive">
              {optionsError}
            </FieldDescription>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={busy || loading || Boolean(optionsError) || invalidSetup}
            >{t("workspaceUi.createWorkspace")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
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

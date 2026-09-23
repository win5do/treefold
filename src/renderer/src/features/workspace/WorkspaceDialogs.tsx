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
    !repository.base_branch ||
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
  const [baseBranches, setBaseBranches] = useState<Record<string, string>>({});
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
    setBaseBranches({});
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
    if (!project || setupRepositories.length === 0) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    Promise.all(
      setupRepositories.map(async (repository) => [
        repository.id,
        await projectsApi.repositoryBranches(repository.id, controller.signal),
      ] as const),
    )
      .then((entries) => {
        if (controller.signal.aborted) return;
        setDeliveryModes((current) => {
          const next = { ...current };
          for (const [id, options] of entries) {
            if (options.remotes.length === 0 && (next[id] ?? "push_branch") === "push_branch") {
              next[id] = "local_merge";
            }
          }
          return next;
        });
        setBranches(Object.fromEntries(entries));
        setBaseBranches(
          Object.fromEntries(
            entries.map(([id, options]) => {
              const repository = setupRepositories.find(
                (item) => item.id === id,
              );
              const selected =
                repository?.base_branch &&
                options.local.includes(repository.base_branch)
                  ? repository.base_branch
                  : options.current || options.local[0] || "";
              return [id, selected];
            }),
          ),
        );
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
  }, [project?.id, setupRepositories]);

  const defaultRepository = repositories.find(
    (repository) => repository.id === defaultRepositoryId,
  );
  const defaultDeliveryMode = defaultRepository
    ? deliveryModes[defaultRepository.id] ??
      defaultRepository.delivery_mode ??
      "push_branch"
    : "keep";
  const invalidSetup = setupRepositories.some((repository) => {
    const options = branches[repository.id];
    const mode = deliveryModes[repository.id] ?? "push_branch";
    return (
      !options?.local.length ||
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
                    <FieldLabel htmlFor={`base-branch-${repository.id}`}>{t("workspaceUi.baseBranch")}</FieldLabel>
                    <Select
                      id={`base-branch-${repository.id}`}
                      className="w-full"
                      name={`base_branch:${repository.id}`}
                      value={baseBranches[repository.id] || ""}
                      onChange={(event) =>
                        setBaseBranches((current) => ({
                          ...current,
                          [repository.id]: event.target.value,
                        }))
                      }
                      disabled={!options}
                      required
                    >
                      {options?.local.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </Select>
                  </Field>
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
        <DialogTitle className="text-lg font-semibold">
          {t(location?.remote_branch ? "workspaceUi.changeUpstream" : "workspaceUi.setUpstream")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
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
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[11px] text-muted-foreground">{t("workspaceUi.remote")}<Input
                  className="mt-1 font-mono text-xs"
                  name="remote_name"
                  defaultValue={location.remote_name ?? ""}
                  placeholder="origin"
                  required
                />
              </label>
              <label className="block text-[11px] text-muted-foreground">{t("workspaceUi.remoteFeatureBranch")}<Input
                  className="mt-1 font-mono text-xs"
                  name="remote_branch"
                  defaultValue={location.remote_branch ?? ""}
                  placeholder={location.branch || "feature/my-change"}
                  required
                />
              </label>
            </div>
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">{t("workspaceUi.upstreamDescription")}</p>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>{t("workspaceUi.saveUpstream")}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

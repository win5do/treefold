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
            : "Could not load repository branches",
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
        <DialogTitle className="text-lg font-semibold">
          New Workspace
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Each Git location uses its own base branch and delivery mode.
        </DialogDescription>
        <form
          key={project ? project.id : "closed"}
          className="mt-6 flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
          onSubmit={onSubmit}
        >
          <FieldGroup>
            <Field>
              <FieldLabel className="sr-only" htmlFor="workspace-description">
                Workspace description
              </FieldLabel>
              <Textarea
                id="workspace-description"
                name="description"
                placeholder="Scope and expected outcome"
              />
            </Field>
            <BranchNameField
              key={project?.id ?? "closed"}
              label="Shared local branch"
              onChange={setSharedBranch}
            />
          </FieldGroup>

          {setupRepositories.map((repository) => {
            const options = branches[repository.id];
            const mode = deliveryModes[repository.id] ?? "push_branch";
            return (
              <FieldSet key={repository.id} className="rounded-lg border p-3">
                <FieldLegend>{repository.name} repository defaults</FieldLegend>
                <input
                  type="hidden"
                  name="setup_repository_id"
                  value={repository.id}
                />
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor={`base-branch-${repository.id}`}>
                      Base branch
                    </FieldLabel>
                    <Select
                      id={`base-branch-${repository.id}`}
                      className="w-full font-mono"
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
                    <FieldLabel htmlFor={`delivery-mode-${repository.id}`}>
                      Default Workspace finish strategy
                    </FieldLabel>
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
                      <option value="push_branch">Push feature branch</option>
                      <option value="local_merge">Merge into local base</option>
                      <option value="keep">Preserve without delivery</option>
                    </Select>
                  </Field>
                  {mode === "push_branch" && (
                    <Field>
                      <FieldLabel htmlFor={`base-remote-${repository.id}`}>
                        Remote
                      </FieldLabel>
                      <Select
                        id={`base-remote-${repository.id}`}
                        className="w-full font-mono"
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
              <FieldLabel htmlFor="workspace-remote-branch">
                Remote feature branch
              </FieldLabel>
              <Input
                id="workspace-remote-branch"
                className="font-mono text-xs"
                name="remote_branch"
                value={remoteBranchEdited ? remoteBranch : sharedBranch}
                onChange={(event) => {
                  setRemoteBranchEdited(true);
                  setRemoteBranch(event.target.value);
                }}
                placeholder="Defaults to the local branch name"
              />
              <FieldDescription>
                Leave empty when the local branch is generated; Treefold will use
                the same generated name remotely.
              </FieldDescription>
            </Field>
          )}

          {loading && (
            <FieldDescription>Loading local branches and remotes…</FieldDescription>
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
            >
              Create Workspace
            </Button>
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
  return (
    <Dialog open={Boolean(location)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {location?.remote_branch ? "Change" : "Set"} upstream
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Configure the remote feature branch for {location?.repository_name}.
          Base branch and delivery mode remain inherited from its Project
          repository.
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
              <label className="block text-[11px] text-muted-foreground">
                Remote
                <Input
                  className="mt-1 font-mono text-xs"
                  name="remote_name"
                  defaultValue={location.remote_name ?? ""}
                  placeholder="origin"
                  required
                />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Remote feature branch
                <Input
                  className="mt-1 font-mono text-xs"
                  name="remote_branch"
                  defaultValue={location.remote_branch ?? ""}
                  placeholder={location.branch || "feature/my-change"}
                  required
                />
              </label>
            </div>
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              Pull and Push for this repository use this upstream. Treefold
              never force pushes.
            </p>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save upstream
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

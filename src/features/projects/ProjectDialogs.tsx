import { type FormEvent, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Plus,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { projectsApi } from "@/api/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect as Select } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type {
  Directory,
  LocationDraft,
  ProjectDetail,
  ProjectRepository,
} from "@/domain/types";

function DirectoryPathField({
  busy,
  path,
  label,
  onPathChange,
  onInspect,
}: {
  busy: boolean;
  path: string;
  label: string;
  onPathChange: (path: string) => void;
  onInspect: (path: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState("");
  async function chooseDirectory() {
    setPicking(true);
    setPickerError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose a directory for Treefold",
      });
      if (typeof selected === "string") {
        onPathChange(selected);
        await onInspect(selected);
      }
    } catch (cause) {
      setPickerError(
        cause instanceof Error ? cause.message : "Could not open Finder",
      );
    } finally {
      setPicking(false);
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1 font-mono text-xs"
          aria-label={label}
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          placeholder="/absolute/path/to/location"
          required
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy || picking || !path.trim()}
          onClick={() => void onInspect(path)}
        >
          Check
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || picking}
          onClick={() => void chooseDirectory()}
        >
          <FolderOpen data-icon="inline-start" />
          {picking ? "Choosing…" : "Choose…"}
        </Button>
      </div>
      {pickerError && (
        <p className="mt-1.5 text-[11px] text-destructive">{pickerError}</p>
      )}
    </div>
  );
}

function WorktreeSetupField({
  defaultValue,
  name = "worktree_setup_command",
}: {
  defaultValue?: string;
  name?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="worktree-setup-command">
        Worktree setup command{" "}
        <span className="text-muted-foreground">(optional)</span>
      </FieldLabel>
      <Textarea
        id="worktree-setup-command"
        className="font-mono"
        name={name}
        aria-label="Worktree setup command"
        defaultValue={defaultValue}
        placeholder="npm install"
      />
      <FieldDescription>
        Starts after worktree creation in a visible setup Shell.
      </FieldDescription>
    </Field>
  );
}

export function CreateProjectDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Project 只负责组织 locations；Git 分支和交付方式在 repository
            location 上配置。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel className="sr-only" htmlFor="project-name">
                Project name
              </FieldLabel>
              <Input
                id="project-name"
                name="name"
                placeholder="Project name"
                required
              />
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="project-description">
                Project description
              </FieldLabel>
              <Textarea
                id="project-description"
                name="description"
                placeholder="Project description"
              />
            </Field>
          </FieldGroup>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

let locationDraftSequence = 0;
function newLocationDraft(): LocationDraft {
  locationDraftSequence += 1;
  return {
    key: `location-draft-${locationDraftSequence}`,
    source: "local",
    path: "",
    description: "",
    worktree_setup_command: "",
    base_branch: "",
    delivery_mode: "remote_review",
  };
}

export function AddDirectoryDialog({
  project,
  busy,
  onOpenChange,
  onSubmit,
}: {
  project: ProjectDetail | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (locations: LocationDraft[]) => Promise<void>;
}) {
  const [locations, setLocations] = useState<LocationDraft[]>([
    newLocationDraft(),
  ]);
  const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (project) setLocations([newLocationDraft()]);
  }, [project?.id]);
  const update = (key: string, patch: Partial<LocationDraft>) =>
    setLocations((current) =>
      current.map((location) =>
        location.key === key ? { ...location, ...patch } : location,
      ),
    );
  async function inspect(key: string, rawPath: string) {
    const path = rawPath.trim();
    if (!path) return;
    setCheckingKeys((current) => new Set(current).add(key));
    update(key, { inspection: undefined, inspectionError: undefined });
    try {
      const result = await projectsApi.inspectLocation(path, project?.id);
      update(key, {
        path: result.path,
        inspection: result,
        base_branch: result.base_branch ?? "main",
        inspectionError: undefined,
      });
    } catch (cause) {
      update(key, {
        inspection: undefined,
        inspectionError:
          cause instanceof Error ? cause.message : "Could not inspect location",
      });
    } finally {
      setCheckingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }
  const duplicatePath = new Set(
    locations
      .map((location) => location.path.trim())
      .filter((path, index, all) => path && all.indexOf(path) !== index),
  );
  const requiresPrimaryGit = !project?.default_location_id;
  const hasReadyGit = locations.some(
    (location) =>
      location.source === "url" || location.inspection?.git_status === "ready",
  );
  const canSubmit =
    locations.length > 0 &&
    (!requiresPrimaryGit || hasReadyGit) &&
    locations.every(
      (location) =>
        (location.source === "url" || location.inspection) &&
        location.path.trim() &&
        !location.inspectionError &&
        (location.source === "url" ||
          (!duplicatePath.has(location.path.trim()) &&
            (location.inspection?.git_status !== "ready" ||
              location.base_branch.trim()))),
    ) &&
    checkingKeys.size === 0;
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="location-list-dialog">
        <DialogTitle className="text-lg font-semibold">
          Add project locations
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Add Git repositories and read-only context directories to{" "}
          {project?.name}. Names always use the directory name.
        </DialogDescription>
        {requiresPrimaryGit && (
          <p
            data-testid="primary-git-location-requirement"
            className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-foreground"
          >
            Include at least one Git repository to use as this Project's primary
            location.
          </p>
        )}
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void onSubmit(locations);
          }}
        >
          <div
            className="max-h-[58vh] flex flex-col gap-3 overflow-y-auto pr-1"
            data-testid="location-draft-list"
          >
            {locations.map((location, index) => {
              const isUrl = location.source === "url";
              const isGit = location.inspection?.git_status === "ready";
              const existingRepository = Boolean(
                location.inspection?.repository_id,
              );
              const checking = checkingKeys.has(location.key);
              return (
                <section
                  key={location.key}
                  data-testid="location-draft-row"
                  className="rounded-xl border border-border bg-muted/60 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold">
                      Location {index + 1}
                    </span>
                    {location.inspection && (
                      <>
                        <Badge variant={isGit ? "success" : "neutral"}>
                          {location.inspection.git_status}
                        </Badge>
                        {existingRepository && (
                          <Badge variant="outline">
                            Existing Repository · scope only
                          </Badge>
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                          {location.inspection.name}
                        </span>
                      </>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove location ${index + 1}`}
                      disabled={locations.length === 1 || busy}
                      onClick={() =>
                        setLocations((current) =>
                          current.filter((item) => item.key !== location.key),
                        )
                      }
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </div>
                  <div className="mb-3 grid gap-2 sm:grid-cols-[9rem_1fr]">
                    <Select
                      aria-label={`Location ${index + 1} source`}
                      value={location.source}
                      onChange={(event) =>
                        update(location.key, {
                          source: event.target.value as LocationDraft["source"],
                          path: "",
                          inspection: undefined,
                          inspectionError: undefined,
                        })
                      }
                    >
                      <option value="local">Local folder</option>
                      <option value="url">Git URL</option>
                    </Select>
                    {isUrl ? (
                      <Input
                        className="min-w-0 font-mono text-xs"
                        aria-label={`Location ${index + 1} Git URL`}
                        value={location.path}
                        onChange={(event) =>
                          update(location.key, {
                            path: event.target.value,
                            inspection: undefined,
                            inspectionError: undefined,
                          })
                        }
                        placeholder="https://github.com/org/repository.git"
                        required
                      />
                    ) : (
                      <DirectoryPathField
                        busy={busy || checking}
                        path={location.path}
                        label={`Location ${index + 1} path`}
                        onPathChange={(path) =>
                          update(location.key, {
                            path,
                            inspection: undefined,
                            inspectionError: undefined,
                          })
                        }
                        onInspect={(path) => inspect(location.key, path)}
                      />
                    )}
                  </div>
                  {isUrl && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Treefold clones the remote default branch into a managed source.
                    </p>
                  )}
                  {checking && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Checking repository…
                    </p>
                  )}
                  {location.inspectionError && (
                    <p className="mt-2 text-[11px] text-destructive">
                      {location.inspectionError}
                    </p>
                  )}
                  {duplicatePath.has(location.path.trim()) && (
                    <p className="mt-2 text-[11px] text-destructive">
                      This path is already in the list.
                    </p>
                  )}
                  {location.inspection && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {!existingRepository && (
                        <label className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            Purpose{" "}
                            <span className="font-normal text-muted-foreground">
                              (optional)
                            </span>
                          </span>
                          <Textarea
                            className="mt-1 min-h-16"
                            aria-label={`Location ${index + 1} purpose`}
                            value={location.description}
                            onChange={(event) =>
                              update(location.key, {
                                description: event.target.value,
                              })
                            }
                            placeholder="API service, docs, design assets…"
                          />
                        </label>
                      )}
                      <label className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Worktree setup{" "}
                          <span className="font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </span>
                        <Textarea
                          className="mt-1 min-h-16 font-mono text-xs"
                          aria-label={`Location ${index + 1} worktree setup`}
                          value={location.worktree_setup_command}
                          onChange={(event) =>
                            update(location.key, {
                              worktree_setup_command: event.target.value,
                            })
                          }
                          placeholder="npm install"
                          disabled={!isGit}
                        />
                      </label>
                    </div>
                  )}
                  {isGit && !existingRepository && (
                    <div className="mt-3 grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
                      <label className="text-[11px] text-muted-foreground">
                        Base branch
                        <Input
                          className="mt-1 font-mono text-xs"
                          aria-label={`Location ${index + 1} base branch`}
                          value={location.base_branch}
                          onChange={(event) =>
                            update(location.key, {
                              base_branch: event.target.value,
                            })
                          }
                          required
                        />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        Delivery mode
                        <Select
                          className="mt-1"
                          aria-label={`Location ${index + 1} delivery mode`}
                          value={location.delivery_mode}
                          onChange={(event) =>
                            update(location.key, {
                              delivery_mode: event.target
                                .value as LocationDraft["delivery_mode"],
                            })
                          }
                        >
                          <option value="remote_review">
                            Remote review / CR-CI
                          </option>
                          <option value="local_merge">Local merge</option>
                        </Select>
                      </label>
                    </div>
                  )}
                  {location.inspection?.git_status === "not_git" && (
                    <p className="mt-3 rounded-lg bg-card px-3 py-2 text-[11px] text-muted-foreground">
                      Read-only Workspace context · no Git branch or delivery
                      settings.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                setLocations((current) => [...current, newLocationDraft()])
              }
            >
              <Plus data-icon="inline-start" />
              Add another
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy
                ? "Adding…"
                : `Add ${locations.length} location${locations.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditDirectoryDialog({
  directory,
  busy,
  onOpenChange,
  onSubmit,
}: {
  directory: Directory | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(directory)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {directory?.name}
        </DialogTitle>
        <DialogDescription className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {directory?.path}
        </DialogDescription>
        {directory && (
          <form
            key={JSON.stringify([directory.id, directory.name, directory.description])}
            className="mt-6 flex flex-col gap-3"
            onSubmit={onSubmit}
          >
            <Field>
              <FieldLabel htmlFor="directory-name">Name</FieldLabel>
              <Input
                id="directory-name"
                name="name"
                defaultValue={directory.name}
                required
              />
              <FieldDescription>
                Changes the name shown in Treefold. The local folder is not renamed.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="directory-description">Purpose</FieldLabel>
              <Textarea
                id="directory-description"
                name="description"
                defaultValue={directory.description}
                placeholder="What is this directory used for?"
              />
              <FieldDescription>
                Default is managed from the directory row. Branch and delivery
                settings belong to the repository.
              </FieldDescription>
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EditRepositoryDialog({
  repository,
  busy,
  onOpenChange,
  onSubmit,
}: {
  repository: ProjectRepository | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(repository)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {repository?.name}
        </DialogTitle>
        <DialogDescription className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          Repository settings · {repository?.source_root}
        </DialogDescription>
        {repository && (
          <form
            key={JSON.stringify([
              repository.id,
              repository.setup_command,
              repository.setup_workdir,
              repository.base_branch,
              repository.delivery_mode,
            ])}
            className="mt-6 flex flex-col gap-4"
            onSubmit={onSubmit}
          >
            <FieldGroup>
              <WorktreeSetupField
                name="setup_command"
                defaultValue={repository.setup_command}
              />
              <Field>
                <FieldLabel htmlFor="repository-setup-workdir">
                  Setup working directory
                </FieldLabel>
                <Input
                  id="repository-setup-workdir"
                  className="font-mono text-xs"
                  name="setup_workdir"
                  defaultValue={repository.setup_workdir || "."}
                  required
                />
                <FieldDescription>
                  Relative to the repository root.
                </FieldDescription>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="repository-base-branch">
                    Base branch
                  </FieldLabel>
                  <Input
                    id="repository-base-branch"
                    className="font-mono text-xs"
                    name="base_branch"
                    defaultValue={repository.base_branch}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="repository-base-remote">
                    Base remote <span className="text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Input
                    id="repository-base-remote"
                    className="font-mono text-xs"
                    name="base_remote"
                    defaultValue={repository.preferred_remote_name || "origin"}
                    placeholder="origin"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="repository-delivery-mode">
                    Delivery mode
                  </FieldLabel>
                  <Select
                    id="repository-delivery-mode"
                    name="delivery_mode"
                    defaultValue={repository.delivery_mode}
                  >
                    <option value="remote_review">Remote review / CR-CI</option>
                    <option value="local_merge">Local merge</option>
                  </Select>
                </Field>
              </div>
            </FieldGroup>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save repository
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type RepositoryBranches = Awaited<
  ReturnType<typeof projectsApi.repositoryBranches>
>;

type RepositoryBranchTarget = {
  branch: string;
  kind: "local" | "remote";
  remote?: string;
};

function BranchActionRow({
  branch,
  current,
  busy,
  target,
  onSwitch,
  onDelete,
}: {
  branch: string;
  current: boolean;
  busy: boolean;
  target: RepositoryBranchTarget;
  onSwitch: (target: RepositoryBranchTarget) => Promise<void>;
  onDelete: (target: RepositoryBranchTarget) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const label = target.remote ? `${target.remote}/${branch}` : branch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid={`branch-${target.kind}-${label}`}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={busy}
          />
        }
      >
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono" title={label}>
          {branch}
        </span>
        {current && <Badge variant="secondary">current</Badge>}
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        data-testid={`branch-actions-${target.kind}-${label}`}
        side="right"
        align="start"
        sideOffset={4}
        className="w-36 gap-0 p-1"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || current}
          onClick={async () => {
            await onSwitch(target);
            setOpen(false);
          }}
        >
          <GitBranch className="size-3.5" />
          Switch
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || current}
          onClick={async () => {
            const location = target.remote ? ` on ${target.remote}` : "";
            if (!window.confirm(`Delete branch ${branch}${location}?`)) return;
            await onDelete(target);
            setOpen(false);
          }}
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </PopoverContent>
    </Popover>
  );
}

function BranchGroup({
  label,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={onOpenChange}
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <FolderGit2 className="size-3.5 text-muted-foreground" />
        {label}
      </button>
      {open && <div className="ml-4 border-l border-border pl-2">{children}</div>}
    </div>
  );
}

export function RepositoryBranchesDialog({
  repository,
  busy,
  onOpenChange,
  onSwitch,
  onDelete,
}: {
  repository: ProjectRepository | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (target: RepositoryBranchTarget) => Promise<void>;
  onDelete: (target: RepositoryBranchTarget) => Promise<void>;
}) {
  const [branches, setBranches] = useState<RepositoryBranches | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(true);
  const [openRemotes, setOpenRemotes] = useState<Record<string, boolean>>({});

  const loadBranches = async (repositoryId: string, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      setBranches(await projectsApi.repositoryBranches(repositoryId, signal));
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not load branches");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!repository) {
      setBranches(null);
      return;
    }
    const controller = new AbortController();
    setLocalOpen(true);
    setRemoteOpen(true);
    setOpenRemotes({});
    void loadBranches(repository.id, controller.signal);
    return () => controller.abort();
  }, [repository?.id]);

  const runAndReload = async (
    action: (target: RepositoryBranchTarget) => Promise<void>,
    target: RepositoryBranchTarget,
  ) => {
    if (!repository) return;
    await action(target);
    await loadBranches(repository.id);
  };

  return (
    <Dialog open={Boolean(repository)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Branch</DialogTitle>
          <DialogDescription className="truncate">
            {repository?.name}
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="repository-branches"
          className="max-h-[24rem] min-h-28 overflow-y-auto rounded-lg border border-border p-1"
        >
          {loading && !branches ? (
            <div className="grid min-h-24 place-items-center text-xs text-muted-foreground">
              Loading branches…
            </div>
          ) : error ? (
            <div className="grid min-h-24 place-items-center px-4 text-center text-xs text-destructive">
              {error}
            </div>
          ) : branches ? (
            <>
              <BranchGroup
                label="Local"
                open={localOpen}
                onOpenChange={() => setLocalOpen((value) => !value)}
              >
                {branches.local.map((branch) => (
                  <BranchActionRow
                    key={branch}
                    branch={branch}
                    current={branch === branches.current}
                    busy={busy || loading}
                    target={{ kind: "local", branch }}
                    onSwitch={(target) => runAndReload(onSwitch, target)}
                    onDelete={(target) => runAndReload(onDelete, target)}
                  />
                ))}
              </BranchGroup>
              <BranchGroup
                label="Remote"
                open={remoteOpen}
                onOpenChange={() => setRemoteOpen((value) => !value)}
              >
                {branches.remotes.map((remote) => (
                  <BranchGroup
                    key={remote.name}
                    label={remote.name}
                    open={Boolean(openRemotes[remote.name])}
                    onOpenChange={() =>
                      setOpenRemotes((current) => ({
                        ...current,
                        [remote.name]: !current[remote.name],
                      }))
                    }
                  >
                    {remote.branches.map((branch) => (
                      <BranchActionRow
                        key={branch}
                        branch={branch}
                        current={false}
                        busy={busy || loading}
                        target={{ kind: "remote", remote: remote.name, branch }}
                        onSwitch={(target) => runAndReload(onSwitch, target)}
                        onDelete={(target) => runAndReload(onDelete, target)}
                      />
                    ))}
                  </BranchGroup>
                ))}
              </BranchGroup>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

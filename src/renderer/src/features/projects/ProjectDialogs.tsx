import { Badge } from "@/components/ui/badge";
import { BranchSwitchDialog, type BranchCheckout } from "@/features/git/BranchSwitchDialog";
import type { GitBranchRef } from "@/domain/types";
import { compactPath } from "@/lib/compactPath";
import { useTranslation } from "react-i18next";
import { type FormEvent, useEffect, useState } from "react";
import {
  FolderOpen,
} from "lucide-react";
import { open as openDirectory } from "@/lib/desktop";
import { projectsApi } from "@/api/projects";
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
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Textarea } from "@/components/ui/textarea";
import type {
  Directory,
  LocationDraft,
  ProjectDetail,
  ProjectRepository,
} from "@/domain/types";

function WorktreeSetupField({
  defaultValue,
  name = "worktree_setup_command",
}: {
  defaultValue?: string;
  name?: string;
}) {
  const { t } = useTranslation();
  return (
    <Field>
      <FieldLabel htmlFor="worktree-setup-command">{t("projectsUi.worktreeSetupCommand")}{" "}
        <span className="text-muted-foreground">{t("projectsUi.optional")}</span>
      </FieldLabel>
      <Textarea
        id="worktree-setup-command"
        className="font-mono"
        name={name}
        aria-label={t("projectsUi.worktreeSetupCommand")}
        defaultValue={defaultValue}
        placeholder="npm install"
      />
      <FieldDescription>{t("projectsUi.startsAfterWorktreeCreationInAVisibleSetupShell")}</FieldDescription>
    </Field>
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
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [locations, setLocations] = useState<LocationDraft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [resolvedPath, setResolvedPath] = useState("");
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setPath(""); setLocations([]); setSelected([]); setResolvedPath(""); setError("");
  }, [project?.id]);
  useEffect(() => {
    const value = path.trim();
    if (!project || !value) {
      setLocations([]); setSelected([]); setResolvedPath(""); setChecking(false); setError("");
      return;
    }
    const controller = new AbortController();
    setChecking(true);
    setError("");
    const timer = setTimeout(() => {
      async function discover() {
        if (/^(https?:\/\/|ssh:\/\/|git@)/.test(value)) {
          return [{ ...newLocationDraft(), source: "url" as const, path: value }];
        }
        const result = await projectsApi.inspectProjectPath(value, controller.signal);
        const candidates = result.candidates.length ? result.candidates : [{ path: result.path }];
        return Promise.all(candidates.map(async (candidate) => ({
          ...newLocationDraft(), path: candidate.path,
          inspection: await projectsApi.inspectLocation(candidate.path, project!.id, controller.signal),
        })));
      }
      void discover().then((drafts) => {
        if (controller.signal.aborted) return;
        const available = drafts.filter((draft) => !project.directories.some((directory) => directory.path === draft.path));
        setLocations(drafts);
        setSelected(available.map((draft) => draft.key));
        setResolvedPath(value);
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setLocations([]); setSelected([]); setResolvedPath("");
        setError(cause instanceof Error ? cause.message : t("projectsUi.couldNotInspectLocation"));
      }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [project?.id, path, t]);
  async function choosePath() {
    setPicking(true);
    try {
      const value = await openDirectory({ directory: true, multiple: false, title: t("projectsUi.chooseADirectoryForTreefold") });
      if (typeof value === "string") setPath(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("projectsUi.couldNotOpenFinder"));
    } finally { setPicking(false); }
  }
  const chosen = locations.filter((location) => selected.includes(location.key));
  const requiresPrimaryGit = !(project?.default_directory_id || project?.default_location_id);
  const canSubmit = !busy && !checking && !picking && resolvedPath === path.trim() && chosen.length > 0 &&
    (!requiresPrimaryGit || chosen.some((location) => location.source === "url" || location.inspection?.git_status === "ready"));
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(94vw,52rem)] overflow-x-hidden sm:max-w-[min(94vw,52rem)]">
        <DialogHeader>
          <DialogTitle>{t("projectsUi.addProjectLocations")}</DialogTitle>
          <DialogDescription>{t("projectsUi.addLocationsDescription", { name: project?.name })}</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void onSubmit(chosen);
        }}>
          <Field className="min-w-0">
            <FieldLabel htmlFor="project-location-path">{t("projectsUi.projectPath")}</FieldLabel>
            <div className="flex min-w-0 gap-2">
              <Input id="project-location-path" className="min-w-0 flex-1"
                value={path} title={path} disabled={busy} onChange={(event) => setPath(event.target.value)} placeholder="/absolute/path/to/location" />
              <Button type="button" variant="secondary" disabled={busy || picking} onClick={() => void choosePath()}>
                <FolderOpen data-icon="inline-start" />{t("projectsUi.choose")}
              </Button>
            </div>
            {checking && <FieldDescription>{t("projectsUi.checkingRepository")}</FieldDescription>}
            {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
          </Field>
          {requiresPrimaryGit && <p data-testid="primary-git-location-requirement" className="text-xs text-muted-foreground">{t("projectsUi.primaryRepositoryRequired")}</p>}
          {locations.length > 0 && <div className="min-w-0 max-h-[40vh] overflow-y-auto rounded-lg border p-2" data-testid="location-draft-list">
            {locations.map((location) => {
              const isGit = location.source === "url" || location.inspection?.git_status === "ready";
              const exists = project?.directories.some((directory) => directory.path === location.path);
              const root = location.inspection?.source_root;
              return <label key={location.key} data-testid="location-draft-row" className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2">
                <input type="checkbox" aria-label={t("projectsUi.includeLocation", { name: location.path })}
                  disabled={busy || checking || exists} checked={selected.includes(location.key)}
                  onChange={(event) => setSelected((current) => event.target.checked ? [...current, location.key] : current.filter((key) => key !== location.key))} />
                <span className="min-w-0 flex-1 truncate" title={location.path}>
                  {location.source === "url" ? location.path : compactPath(location.path)}
                  {root && root !== location.path && <span className="block truncate text-muted-foreground" title={root}>{t("projectsUi.repositoryRoot", { path: compactPath(root) })}</span>}
                </span>
                <Badge className="shrink-0" variant={isGit ? "success" : "neutral"}>{isGit ? t("projectsUi.gitRepository") : t("projectsUi.readOnlyContext")}</Badge>
                {exists && <Badge className="shrink-0" variant="outline">{t("projectsUi.locationAlreadyAdded")}</Badge>}
              </label>;
            })}
          </div>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit}>{busy ? t("projectsUi.adding") : t("projectsUi.addLocations", { count: chosen.length })}</Button>
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
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(directory)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {directory?.name}
        </DialogTitle>
        <DialogDescription className="mt-1 truncate">
          {directory?.path}
        </DialogDescription>
        {directory && (
          <form
            key={JSON.stringify([directory.id, directory.name, directory.description])}
            className="mt-6 flex flex-col gap-3"
            onSubmit={onSubmit}
          >
            <Field>
              <FieldLabel htmlFor="directory-name">{t("projectsUi.name")}</FieldLabel>
              <Input
                id="directory-name"
                name="name"
                defaultValue={directory.name}
                required
              />
              <FieldDescription>{t("projectsUi.changesTheNameShownInTreefoldTheLocalFolderIsNotRenamed")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="directory-description">{t("projectsUi.purpose")}</FieldLabel>
              <Textarea
                id="directory-description"
                name="description"
                defaultValue={directory.description}
                placeholder={t("projectsUi.whatIsThisDirectoryUsedFor")}
              />
              <FieldDescription>{t("projectsUi.directorySettingsDescription")}</FieldDescription>
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>{t("projectsUi.save")}</Button>
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
  const { t } = useTranslation();
  const [branches, setBranches] = useState<RepositoryBranches | null>(null);
  const [branchesError, setBranchesError] = useState("");
  const [baseRemote, setBaseRemote] = useState("");

  useEffect(() => {
    if (!repository) {
      setBranches(null);
      setBranchesError("");
      setBaseRemote("");
      return;
    }
    const controller = new AbortController();
    setBranches(null);
    setBranchesError("");
    setBaseRemote(repository.preferred_remote_name || "");
    projectsApi
      .repositoryBranches(repository.id, controller.signal)
      .then(setBranches)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setBranchesError(
          cause instanceof Error ? cause.message : t("projectsUi.couldNotLoadBranches"),
        );
      });
    return () => controller.abort();
  }, [repository?.id]);

  return (
    <Dialog open={Boolean(repository)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          {repository?.name}
        </DialogTitle>
        <DialogDescription className="mt-1 truncate">
          {t("projectsUi.repositorySettings", { name: repository?.source_root })}
        </DialogDescription>
        {repository && (
          <form
            key={JSON.stringify([
              repository.id,
              repository.setup_command,
              repository.setup_workdir,
              repository.preferred_remote_name,
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
                <FieldLabel htmlFor="repository-setup-workdir">{t("projectsUi.setupWorkingDirectory")}</FieldLabel>
                <Input
                  id="repository-setup-workdir"
                  name="setup_workdir"
                  defaultValue={repository.setup_workdir || "."}
                  required
                />
                <FieldDescription>{t("projectsUi.relativeToTheRepositoryRoot")}</FieldDescription>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="repository-base-remote">{t("projectsUi.remote")}<span className="text-muted-foreground">{t("projectsUi.optional")}</span>
                  </FieldLabel>
                  <ChoiceSelect
                    id="repository-base-remote"
                    className="w-full"
                    name="base_remote"
                    value={baseRemote}
                    onValueChange={(value) => setBaseRemote(value)}
                    disabled={busy || !branches}
                    options={[
                      { value: "", label: t("projectsUi.none") },
                      ...(!branches && repository.preferred_remote_name
                        ? [
                            {
                              value: repository.preferred_remote_name,
                              label: t("projectsUi.loading"),
                            },
                          ]
                        : []),
                      ...(branches &&
                      repository.preferred_remote_name &&
                      !branches.remotes.some(
                        (remote) => remote.name === repository.preferred_remote_name,
                      )
                        ? [
                            {
                              value: repository.preferred_remote_name,
                              label: `${repository.preferred_remote_name}${t("projectsUi.notFound")}`,
                              disabled: true,
                            },
                          ]
                        : []),
                      ...(branches?.remotes.map((remote) => ({
                        value: remote.name,
                        label: remote.name,
                      })) ?? []),
                    ]}
                  />
                </Field>
              </div>
              {branchesError && (
                <FieldDescription className="text-destructive">
                  {branchesError}
                </FieldDescription>
              )}
            </FieldGroup>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !branches}>{t("projectsUi.saveRepository")}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RepositoryBranchesDialog({ repository, busy, onOpenChange, onSwitch, onDelete }: {
  repository: ProjectRepository | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (target: BranchCheckout) => Promise<void>;
  onDelete: (target: GitBranchRef) => Promise<void>;
}) {
  return <BranchSwitchDialog repository={repository} busy={busy} onOpenChange={onOpenChange}
    loadBranches={projectsApi.repositoryBranches} onSwitch={onSwitch} onDelete={onDelete} />;
}

type RepositoryBranches = Awaited<ReturnType<typeof projectsApi.repositoryBranches>>;

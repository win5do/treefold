import { useTranslation } from "react-i18next";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Plus,
  Trash2,
} from "lucide-react";
import { open as openDirectory } from "@/lib/desktop";
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
  ProjectPathCandidate,
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
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState("");
  async function chooseDirectory() {
    setPicking(true);
    setPickerError("");
    try {
      const selected = await openDirectory({
        directory: true,
        multiple: false,
        title: t("projectsUi.chooseADirectoryForTreefold"),
      });
      if (typeof selected === "string") {
        onPathChange(selected);
        await onInspect(selected);
      }
    } catch (cause) {
      setPickerError(
        cause instanceof Error ? cause.message : t("projectsUi.couldNotOpenFinder"),
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
        >{t("projectsUi.check")}</Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || picking}
          onClick={() => void chooseDirectory()}
        >
          <FolderOpen data-icon="inline-start" />
          {picking ? t("projectsUi.choosing") : t("projectsUi.choose")}
        </Button>
      </div>
      {pickerError && (
        <p className="mt-1.5 text-[11px] text-destructive">{pickerError}</p>
      )}
    </div>
  );
}

function compactPath(path: string, maxLength = 64): string {
  if (path.length <= maxLength) return path;
  const tailLength = Math.floor(maxLength * 0.65);
  return `${path.slice(0, maxLength - tailLength - 1)}…${path.slice(-tailLength)}`;
}

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

export function CreateProjectDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: { name: string; locations: string[] }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const nameEdited = useRef(false);
  const [path, setPath] = useState("");
  const [candidates, setCandidates] = useState<ProjectPathCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!open) {
      setName(""); nameEdited.current = false; setPath(""); setCandidates([]); setSelected([]);
      setPrimary(""); setChecking(false); setError("");
      return;
    }
    const value = path.trim();
    if (!value) { setCandidates([]); setSelected([]); setPrimary(""); setChecking(false); setError(""); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      void projectsApi.inspectProjectPath(value, controller.signal).then((result) => {
        const paths = result.candidates.map((candidate) => candidate.path);
        setCandidates(result.candidates);
        setSelected(paths);
        setPrimary(result.candidates.find((candidate) => candidate.is_git)?.path ?? "");
        setError(result.candidates.some((candidate) => candidate.is_git) ? "" : t("projectsUi.noGitRepositoryFound"));
        if (!nameEdited.current) setName(result.path.split("/").pop() || "");
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setCandidates([]); setSelected([]); setPrimary("");
        setError(cause instanceof Error ? cause.message : t("projectsUi.couldNotInspectLocation"));
      }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, path, t]);
  async function choosePath() {
    setPicking(true);
    try {
      const value = await openDirectory({ directory: true, multiple: false, title: t("projectsUi.chooseADirectoryForTreefold") });
      if (typeof value === "string") setPath(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("projectsUi.couldNotOpenFinder"));
    } finally { setPicking(false); }
  }
  const chosen = candidates.filter((candidate) => selected.includes(candidate.path));
  const canCreate = !busy && !checking && Boolean(name.trim()) &&
    chosen.some((candidate) => candidate.is_git) && Boolean(primary) &&
    chosen.some((candidate) => candidate.path === primary);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(94vw,52rem)] overflow-x-hidden sm:max-w-[min(94vw,52rem)]">
        <DialogHeader>
          <DialogTitle>{t("projectsUi.newProject")}</DialogTitle>
          <DialogDescription>{t("projectsUi.projectDescription")}</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) void onSubmit({ name: name.trim(), locations: [primary, ...chosen.map((candidate) => candidate.path).filter((value) => value !== primary)] });
        }}>
          <FieldGroup className="min-w-0 gap-3">
            <Field>
              <FieldLabel className="sr-only" htmlFor="project-name">{t("projectsUi.projectName")}</FieldLabel>
              <Input
                id="project-name"
                name="name"
                value={name}
                onChange={(event) => { setName(event.target.value); nameEdited.current = true; }}
                placeholder={t("projectsUi.projectName")}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-path">{t("projectsUi.projectPath")}</FieldLabel>
              <div className="flex gap-2">
                <Input id="project-path" className="min-w-0 flex-1 font-mono text-xs" value={path} title={path}
                  onChange={(event) => { setPath(event.target.value); setChecking(Boolean(event.target.value.trim())); }}
                  placeholder="/absolute/path/to/project" />
                <Button type="button" variant="secondary" disabled={busy || picking} onClick={() => void choosePath()}>
                  <FolderOpen data-icon="inline-start" />{t("projectsUi.choose")}
                </Button>
              </div>
              {checking && <FieldDescription>{t("projectsUi.checkingRepository")}</FieldDescription>}
              {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
            </Field>
          </FieldGroup>
          {candidates.length > 0 && <div className="min-w-0 max-h-[40vh] overflow-y-auto rounded-lg border p-2">
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("projectsUi.confirmLocations")}</p>
            {candidates.map((candidate) => <div key={candidate.path} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm">
              <input type="checkbox" aria-label={t("projectsUi.includeLocation", { name: candidate.path })}
                checked={selected.includes(candidate.path)} onChange={(event) => {
                  const next = event.target.checked ? [...selected, candidate.path] : selected.filter((value) => value !== candidate.path);
                  setSelected(next);
                  if (!next.includes(primary)) setPrimary(candidates.find((item) => item.is_git && next.includes(item.path))?.path ?? "");
                }} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={candidate.path}>
                {compactPath(candidate.path)}
                {candidate.repository_root && candidate.repository_root !== candidate.path &&
                  <span className="block truncate text-muted-foreground" title={candidate.repository_root}>{t("projectsUi.repositoryRoot", { path: compactPath(candidate.repository_root) })}</span>}
              </span>
              <Badge className="shrink-0" variant={candidate.is_git ? "success" : "neutral"}>{candidate.is_git ? t("projectsUi.gitRepository") : t("projectsUi.readOnlyContext")}</Badge>
              {candidate.is_git && selected.includes(candidate.path) && <label className="flex shrink-0 items-center gap-1 text-xs">
                <input type="radio" name="primary-location" checked={primary === candidate.path} onChange={() => setPrimary(candidate.path)} />
                {t("projectsUi.primaryLocation")}
              </label>}
            </div>)}
          </div>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!canCreate}>{t("projectsUi.createProject")}</Button>
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
  const [locations, setLocations] = useState<LocationDraft[]>([
    newLocationDraft(),
  ]);
  const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
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
        inspectionError: undefined,
      });
    } catch (cause) {
      update(key, {
        inspection: undefined,
        inspectionError:
          cause instanceof Error ? cause.message : t("projectsUi.couldNotInspectLocation"),
      });
    } finally {
      setCheckingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }
  async function discoverFromDirectory() {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const path = await openDirectory({ directory: true, multiple: false, title: t("projectsUi.chooseADirectoryForTreefold") });
      if (!path) return;
      const result = await projectsApi.inspectProjectPath(path);
      const drafts = await Promise.all(result.candidates.map(async (candidate) => ({
        ...newLocationDraft(),
        path: candidate.path,
        inspection: await projectsApi.inspectLocation(candidate.path, project?.id),
      })));
      if (drafts.length === 0) {
        setDiscoveryError(t("projectsUi.noLocationsFound"));
        return;
      }
      setLocations((current) => {
        const existing = current.filter((item) => item.path.trim());
        const paths = new Set(existing.map((item) => item.path.trim()));
        return [...existing, ...drafts.filter((item) => !paths.has(item.path))];
      });
    } catch (cause) {
      setDiscoveryError(cause instanceof Error ? cause.message : t("projectsUi.couldNotInspectLocation"));
    } finally {
      setDiscovering(false);
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
          !duplicatePath.has(location.path.trim())),
    ) &&
    checkingKeys.size === 0;
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="location-list-dialog">
        <DialogTitle className="text-lg font-semibold">{t("projectsUi.addProjectLocations")}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("projectsUi.addLocationsDescription", { name: project?.name })}
        </DialogDescription>
        <div className="mt-4">
          <Button type="button" variant="secondary" disabled={busy || discovering} onClick={() => void discoverFromDirectory()}>
            <FolderOpen data-icon="inline-start" />{t("projectsUi.discoverLocations")}
          </Button>
          {discoveryError && <p className="mt-2 text-xs text-destructive">{discoveryError}</p>}
        </div>
        {requiresPrimaryGit && (
          <p
            data-testid="primary-git-location-requirement"
            className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-foreground"
          >{t("projectsUi.primaryRepositoryRequired")}</p>
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
                    <span className="text-xs font-semibold">{t("projectsUi.location")}{index + 1}
                    </span>
                    {location.inspection && (
                      <>
                        <Badge variant={isGit ? "success" : "neutral"}>
                          {t(`states.${location.inspection.git_status}`, { defaultValue: location.inspection.git_status })}
                        </Badge>
                        {existingRepository && (
                          <Badge variant="outline">{t("projectsUi.existingRepositoryScopeOnly")}</Badge>
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
                      aria-label={t("projectsUi.removeLocation", { index: index + 1 })}
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
                      aria-label={t("projectsUi.locationSource", { index: index + 1 })}
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
                      <option value="local">{t("projectsUi.localFolder")}</option>
                      <option value="url">{t("projectsUi.gitURL")}</option>
                    </Select>
                    {isUrl ? (
                      <Input
                        className="min-w-0 font-mono text-xs"
                        aria-label={t("projectsUi.locationGitURL", { index: index + 1 })}
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
                        label={t("projectsUi.locationPath", { index: index + 1 })}
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
                    <p className="mt-2 text-[11px] text-muted-foreground">{t("projectsUi.treefoldClonesTheRemoteDefaultBranchIntoAManagedSource")}</p>
                  )}
                  {checking && (
                    <p className="mt-2 text-[11px] text-muted-foreground">{t("projectsUi.checkingRepository")}</p>
                  )}
                  {location.inspectionError && (
                    <p className="mt-2 text-[11px] text-destructive">
                      {location.inspectionError}
                    </p>
                  )}
                  {duplicatePath.has(location.path.trim()) && (
                    <p className="mt-2 text-[11px] text-destructive">{t("projectsUi.thisPathIsAlreadyInTheList")}</p>
                  )}
                  {location.inspection && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {!existingRepository && (
                        <label className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{t("projectsUi.purpose")}{" "}
                            <span className="font-normal text-muted-foreground">{t("projectsUi.optional")}</span>
                          </span>
                          <Textarea
                            className="mt-1 min-h-16"
                            aria-label={t("projectsUi.locationPurpose", { index: index + 1 })}
                            value={location.description}
                            onChange={(event) =>
                              update(location.key, {
                                description: event.target.value,
                              })
                            }
                            placeholder={t("projectsUi.aPIServiceDocsDesignAssets")}
                          />
                        </label>
                      )}
                      <label className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{t("projectsUi.worktreeSetup")}{" "}
                          <span className="font-normal text-muted-foreground">{t("projectsUi.optional")}</span>
                        </span>
                        <Textarea
                          className="mt-1 min-h-16 font-mono text-xs"
                          aria-label={t("projectsUi.locationWorktreeSetup", { index: index + 1 })}
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
                  {location.inspection?.git_status === "not_git" && (
                    <p className="mt-3 rounded-lg bg-card px-3 py-2 text-[11px] text-muted-foreground">{t("projectsUi.readOnlyWorkspaceContextNoGitBranchOrDeliverySettings")}</p>
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
              <Plus data-icon="inline-start" />{t("projectsUi.addAnother")}</Button>
            <Button type="submit" disabled={busy || discovering || !canSubmit}>
              {busy
                ? t("projectsUi.adding")
                : t("projectsUi.addLocations", { count: locations.length })}
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
  const { t } = useTranslation();
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
  const [baseBranch, setBaseBranch] = useState("");
  const [baseRemote, setBaseRemote] = useState("");

  useEffect(() => {
    if (!repository) {
      setBranches(null);
      setBranchesError("");
      setBaseBranch("");
      setBaseRemote("");
      return;
    }
    const controller = new AbortController();
    setBranches(null);
    setBranchesError("");
    setBaseBranch(repository.base_branch || "");
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
        <DialogTitle className="text-lg font-semibold">
          {repository?.name}
        </DialogTitle>
        <DialogDescription className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {t("projectsUi.repositorySettings", { name: repository?.source_root })}
        </DialogDescription>
        {repository && (
          <form
            key={JSON.stringify([
              repository.id,
              repository.setup_command,
              repository.setup_workdir,
              repository.base_branch,
              repository.preferred_remote_name,
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
                <FieldLabel htmlFor="repository-setup-workdir">{t("projectsUi.setupWorkingDirectory")}</FieldLabel>
                <Input
                  id="repository-setup-workdir"
                  className="font-mono text-xs"
                  name="setup_workdir"
                  defaultValue={repository.setup_workdir || "."}
                  required
                />
                <FieldDescription>{t("projectsUi.relativeToTheRepositoryRoot")}</FieldDescription>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="repository-base-branch">{t("projectsUi.baseBranch")}</FieldLabel>
                  <Select
                    id="repository-base-branch"
                    className="w-full font-mono"
                    name="base_branch"
                    value={baseBranch}
                    onChange={(event) => setBaseBranch(event.target.value)}
                    disabled={busy || !branches}
                    required
                  >
                    {!branches ? (
                      <option value={repository.base_branch || ""}>{t("projectsUi.loading")}</option>
                    ) : (
                      <>
                        {repository.base_branch &&
                          !branches.local.includes(repository.base_branch) && (
                          <option value={repository.base_branch} disabled>
                            {repository.base_branch}{t("projectsUi.notFound")}</option>
                        )}
                        {branches.local.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </>
                    )}
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="repository-base-remote">{t("projectsUi.remote")}<span className="text-muted-foreground">{t("projectsUi.optional")}</span>
                  </FieldLabel>
                  <Select
                    id="repository-base-remote"
                    className="w-full font-mono"
                    name="base_remote"
                    value={baseRemote}
                    onChange={(event) => setBaseRemote(event.target.value)}
                    disabled={busy || !branches}
                  >
                    <option value="">{t("projectsUi.none")}</option>
                    {!branches && repository.preferred_remote_name && (
                      <option value={repository.preferred_remote_name}>{t("projectsUi.loading")}</option>
                    )}
                    {branches &&
                      repository.preferred_remote_name &&
                      !branches.remotes.some(
                        (remote) =>
                          remote.name === repository.preferred_remote_name,
                      ) && (
                        <option
                          value={repository.preferred_remote_name}
                          disabled
                        >
                          {repository.preferred_remote_name}{t("projectsUi.notFound")}</option>
                      )}
                    {branches?.remotes.map((remote) => (
                      <option key={remote.name} value={remote.name}>
                        {remote.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="repository-delivery-mode">{t("projectsUi.defaultWorkspaceFinishStrategy")}</FieldLabel>
                  <Select
                    id="repository-delivery-mode"
                    name="delivery_mode"
                    defaultValue={repository.delivery_mode}
                  >
                    <option value="push_branch">{t("projectsUi.pushFeatureBranch")}</option>
                    <option value="local_merge">{t("projectsUi.mergeIntoLocalBase")}</option>
                    <option value="keep">{t("projectsUi.preserveWithoutDelivery")}</option>
                  </Select>
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
  const { t } = useTranslation();
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
        {current && <Badge variant="secondary">{t("labels.current")}</Badge>}
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
          <GitBranch className="size-3.5" />{t("projectsUi.switch")}</button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || current}
          onClick={async () => {
            const confirmation = target.kind === "remote"
                    ? t("projectsUi.deleteRemoteBranch", { branch, remote: target.remote })
                    : t("projectsUi.deleteLocalBranch", { branch });
            if (!window.confirm(confirmation)) return;
            await onDelete(target);
            setOpen(false);
          }}
        >
          <Trash2 className="size-3.5" />{t("projectsUi.delete")}</button>
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
  const { t } = useTranslation();
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
      setError(cause instanceof Error ? cause.message : t("projectsUi.couldNotLoadBranches"));
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
          <DialogTitle>{t("projectsUi.branch")}</DialogTitle>
          <DialogDescription className="truncate">
            {repository?.name}
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="repository-branches"
          className="max-h-[24rem] min-h-28 overflow-y-auto rounded-lg border border-border p-1"
        >
          {loading && !branches ? (
            <div className="grid min-h-24 place-items-center text-xs text-muted-foreground">{t("projectsUi.loadingBranches")}</div>
          ) : error ? (
            <div className="grid min-h-24 place-items-center px-4 text-center text-xs text-destructive">
              {error}
            </div>
          ) : branches ? (
            <>
              <BranchGroup
                label={t("projectsUi.local")}
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
                label={t("projectsUi.remote")}
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

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, FolderOpen, FolderPlus, Link, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { open as openDirectory } from "@/lib/desktop";
import { compactPath } from "@/lib/compactPath";
import type { Project, ProjectCreation } from "@/domain/types";
import { LocalProjectLocations, useLocalProjectLocations } from "./LocalProjectLocations";
import { projectCreationApi, projectCreationError, suggestedRepositoryName } from "./projectCreation";
import { projectKeys } from "./queries";

type SourceKind = "local" | "git_url" | "empty";

export function CreateProjectDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}) {
  // Unmount drafts on close so an old validation can never reach a reopened dialog.
  return open ? <ProjectCreationForm onOpenChange={onOpenChange} onCreated={onCreated} /> : null;
}

function ProjectCreationForm({ onOpenChange, onCreated }: Omit<Parameters<typeof CreateProjectDialog>[0], "open">) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<SourceKind | null>(null);
  const [step, setStep] = useState<"source" | "input" | "review">("source");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [review, setReview] = useState<{ input: ProjectCreation; path?: string } | null>(null);
  const nameEdited = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const sourceList = useRef<HTMLDivElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const validation = useRef<AbortController | null>(null);
  const discovery = useLocalProjectLocations(path, source === "local");
  const busy = checking || picking || creating;
  const kinds = ["local", "git_url", "empty"] as const;
  const labels = { local: t("projectsUi.creation.local"), git_url: t("projectsUi.gitURL"), empty: t("projectsUi.creation.empty") };
  const descriptions = { local: t("projectsUi.creation.localDescription"), git_url: t("projectsUi.creation.urlDescription"), empty: t("projectsUi.creation.emptyDescription") };
  const icons = { local: FolderOpen, git_url: Link, empty: FolderPlus };

  useEffect(() => () => { validation.current?.abort(); }, []);
  useEffect(() => {
    if (step === "source") sourceList.current?.focus();
    else if (step === "review") createButton.current?.focus();
    else firstInput.current?.focus();
  }, [step, source]);
  useEffect(() => {
    if (nameEdited.current) return;
    if (source === "local" && discovery.resolvedPath) setName(discovery.resolvedPath.split("/").at(-1) ?? "");
    if (source === "git_url") setName(suggestedRepositoryName(url));
  }, [source, url, discovery.resolvedPath]);

  function selectSource(kind: SourceKind) {
    if (source !== kind) { setName(""); nameEdited.current = false; }
    setSource(kind); setError(""); setStep("input");
  }
  async function chooseDirectory() {
    setPicking(true); setError("");
    try {
      const selected = await openDirectory({ directory: true, multiple: false, title: t("projectsUi.chooseADirectoryForTreefold") });
      if (selected) { if (source === "empty") setParent(selected); else setPath(selected); }
    } catch (cause) { setError(projectCreationError(cause)); }
    finally { setPicking(false); }
  }
  async function validate() {
    if (busy || !name.trim() || !source) return;
    setError("");
    if (source === "local") {
      if (discovery.ready) { setReview({ input: { name: name.trim(), locations: discovery.locations } }); setStep("review"); }
      return;
    }
    const input = { name: name.trim(), source: source === "git_url"
      ? { kind: "git_url" as const, url: url.trim() }
      : { kind: "empty" as const, parent_path: parent.trim() } };
    const controller = new AbortController();
    validation.current = controller;
    setChecking(true);
    try {
      const result = await projectCreationApi.validate(input.name, input.source, controller.signal);
      if (!controller.signal.aborted) { setReview({ input, path: result.path ?? undefined }); setStep("review"); }
    } catch (cause) { if (!controller.signal.aborted) setError(projectCreationError(cause)); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }
  async function create() {
    if (!review || busy) return;
    setCreating(true); setError("");
    try {
      const project = await projectCreationApi.create(review.input);
      void queryClient.invalidateQueries({ queryKey: projectKeys.summaries });
      void queryClient.invalidateQueries({ queryKey: projectKeys.sidebar });
      onCreated(project);
      onOpenChange(false);
    } catch (cause) { setError(projectCreationError(cause)); }
    finally { setCreating(false); }
  }
  const canContinue = !busy && Boolean(name.trim()) && (source === "local" ? discovery.ready : source === "git_url" ? Boolean(url.trim()) : Boolean(parent.trim()));
  const inputError = error || (source === "local" ? discovery.error : "");
  const directoryValue = source === "empty" ? parent : path;
  return <Dialog open onOpenChange={next => { if (!creating) onOpenChange(next); }}>
    <DialogContent className="max-w-[min(94vw,40rem)] overflow-x-hidden sm:max-w-[min(94vw,40rem)]"
      showCloseButton={!creating} initialFocus={sourceList}>
    <DialogHeader>
      <DialogTitle>{t("projectsUi.newProject")}{source && step !== "source" && ` · ${labels[source]}`}</DialogTitle>
      <DialogDescription>{step === "source" ? t("projectsUi.creation.chooseSource") : step === "review" ? t("projectsUi.creation.reviewDescription") : source === "local" ? t("projectsUi.projectDescription") : descriptions[source!]}</DialogDescription>
    </DialogHeader>
    {step === "source" ? <Command data-testid="project-source-list" ref={sourceList} tabIndex={0} label={t("projectsUi.creation.chooseSource")} shouldFilter={false} defaultValue={source ?? "local"} loop>
      <CommandList><CommandGroup>
        {kinds.map(kind => {
          const Icon = icons[kind];
          return <CommandItem key={kind} value={kind} aria-label={labels[kind]} onSelect={() => selectSource(kind)} className="gap-3 py-3">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-1"><span>{labels[kind]}</span><span className="text-muted-foreground">{descriptions[kind]}</span></span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </CommandItem>;
        })}
      </CommandGroup></CommandList>
    </Command> : <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void (step === "review" ? create() : validate()); }}>
      {step === "input" ? <>
        <FieldGroup className="min-w-0 gap-4">
          {source === "git_url" ? <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="project-url">{t("projectsUi.gitURL")}</FieldLabel>
            <Input ref={firstInput} id="project-url" value={url} onChange={event => { setUrl(event.target.value); setError(""); }} disabled={busy} aria-invalid={Boolean(error)} placeholder="https://github.com/org/repository.git" required />
            <FieldDescription>{t("projectsUi.treefoldClonesTheRemoteDefaultBranchIntoAManagedSource")}</FieldDescription>
          </Field> : source === "local" ? <Field data-invalid={Boolean(inputError)}>
            <FieldLabel htmlFor="project-path">{t("projectsUi.projectPath")}</FieldLabel>
            <div className="flex min-w-0 gap-2">
              <Input ref={firstInput} id="project-path" value={path} title={path} className="min-w-0 flex-1" onChange={event => { setPath(event.target.value); setError(""); }} disabled={busy} aria-invalid={Boolean(inputError)} placeholder="/absolute/path/to/project" required />
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void chooseDirectory()}><FolderOpen data-icon="inline-start" />{t("projectsUi.choose")}</Button>
            </div>
            {discovery.checking && <FieldDescription role="status">{t("projectsUi.checkingRepository")}</FieldDescription>}
          </Field> : null}
          <Field data-invalid={Boolean(error) && source === "empty"}>
            <FieldLabel htmlFor="project-name">{t("projectsUi.projectName")}</FieldLabel>
            <Input ref={source === "empty" ? firstInput : undefined} id="project-name" name="name" value={name} onChange={event => { setName(event.target.value); nameEdited.current = true; setError(""); }} disabled={busy} aria-invalid={Boolean(error) && source === "empty"} placeholder={t("projectsUi.projectName")} required />
          </Field>
          {source === "empty" && <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="project-parent">{t("projectsUi.creation.parentDirectory")}</FieldLabel>
            <div className="flex min-w-0 gap-2">
              <Input id="project-parent" value={parent} title={parent} className="min-w-0 flex-1" onChange={event => { setParent(event.target.value); setError(""); }} disabled={busy} aria-invalid={Boolean(error)} placeholder="/absolute/path/to/parent" required />
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void chooseDirectory()}><FolderOpen data-icon="inline-start" />{t("projectsUi.choose")}</Button>
            </div>
            <FieldDescription className="break-all">{name.trim() && directoryValue.trim() ? t("projectsUi.creation.emptyDestination", { path: `${directoryValue.trim().replace(/\/+$/, "")}/${name.trim()}` }) : t("projectsUi.creation.initDescription")}</FieldDescription>
          </Field>}
        </FieldGroup>
        {source === "local" && <LocalProjectLocations discovery={discovery} />}
      </> : review && <div className="flex min-w-0 flex-col gap-3">
        <p className="flex items-center gap-2" role="status"><Check className="size-4 text-success" />{t("projectsUi.creation.validated")}</p>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
          <dt className="text-muted-foreground">{t("projectsUi.projectName")}</dt><dd className="break-all">{review.input.name}</dd>
          <dt className="text-muted-foreground">{t("projectsUi.creation.source")}</dt><dd>{labels[source!]}</dd>
          {"locations" in review.input ? <><dt className="text-muted-foreground">{t("projectsUi.creation.locations")}</dt><dd className="flex min-w-0 flex-col gap-2">
            {review.input.locations.map((location, index) => <span key={location} className="break-all" title={location}>{compactPath(location)}{index === 0 && ` · ${t("projectsUi.primaryLocation")}`}</span>)}
          </dd></> : review.input.source.kind === "git_url" ? <><dt className="text-muted-foreground">{t("projectsUi.gitURL")}</dt><dd className="break-all">{review.input.source.url}</dd></>
            : <><dt className="text-muted-foreground">{t("projectsUi.projectPath")}</dt><dd className="break-all">{review.path}</dd></>}
        </dl>
        {source !== "local" && <p className="text-muted-foreground">{source === "empty" ? t("projectsUi.creation.initDescription") : t("projectsUi.treefoldClonesTheRemoteDefaultBranchIntoAManagedSource")}</p>}
      </div>}
      {inputError && <p role="alert" className="break-words text-destructive">{inputError}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { setError(""); setReview(null); setStep(step === "review" ? "input" : "source"); }}><ArrowLeft data-icon="inline-start" />{t("projectsUi.creation.back")}</Button>
        {step === "review" ? <Button ref={createButton} type="submit" disabled={busy}>{creating && <LoaderCircle data-icon="inline-start" className="animate-spin" />}{creating ? t("projectsUi.creation.creating") : t("projectsUi.createProject")}</Button>
          : <Button type="submit" disabled={!canContinue}>{checking && <LoaderCircle data-icon="inline-start" className="animate-spin" />}{checking ? t("projectsUi.creation.validating") : t("projectsUi.creation.continue")}</Button>}
      </div>
    </form>}
    </DialogContent>
  </Dialog>;
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreateWorkspaceInput,
  GitBranches,
  ProjectDetail,
} from "@/domain/types";
import { generateBranchName } from "@/features/git/BranchNameField";
import { BranchPicker } from "@/features/git/BranchPicker";
import {
  checkoutIssue,
  initialRepositoryDraft,
  repositoryPayload,
  selectExistingBranch,
  type RepositoryDraft,
} from "./workspaceCreation";

type Props = {
  project: ProjectDetail | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateWorkspaceInput) => Promise<void>;
};

export function CreateWorkspaceDialog({
  project,
  busy,
  onOpenChange,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogTitle>{t("workspaceUi.newWorkspace")}</DialogTitle>
        <DialogDescription>
          {t("workspaceUi.checkoutRemoteInheritance")}
        </DialogDescription>
        {project && (
          <WorkspaceCreationForm
            key={project.id}
            project={project}
            busy={busy}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceCreationForm({
  project,
  busy,
  onSubmit,
}: Pick<Props, "busy" | "onSubmit"> & { project: ProjectDetail }) {
  const { t } = useTranslation();
  const [generated] = useState(generateBranchName);
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<Record<string, GitBranches>>({});
  const [drafts, setDrafts] = useState<Record<string, RepositoryDraft>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requests = useRef<Record<string, AbortController>>({});
  const load = async (id: string) => {
    requests.current[id]?.abort();
    const controller = new AbortController();
    requests.current[id] = controller;
    setLoading((current) => ({ ...current, [id]: true }));
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const branches = await projectsApi.repositoryBranches(
        id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setOptions((current) => ({ ...current, [id]: branches }));
      setDrafts((current) => ({
        ...current,
        [id]:
          current[id] ??
          initialRepositoryDraft(
            project.repositories.find((repo) => repo.id === id)!,
            branches,
            generated,
          ),
      }));
    } catch (cause) {
      if (!controller.signal.aborted)
        setErrors((current) => ({
          ...current,
          [id]: cause instanceof Error ? cause.message : String(cause),
        }));
    } finally {
      if (!controller.signal.aborted)
        setLoading((current) => ({ ...current, [id]: false }));
    }
  };
  useEffect(() => {
    for (const repository of project.repositories) void load(repository.id);
    return () => {
      for (const request of Object.values(requests.current)) request.abort();
    };
  }, [project.id]);

  const invalid =
    !project.repositories.length ||
    project.repositories.some(
      (repo) =>
        !drafts[repo.id] ||
        loading[repo.id] ||
        errors[repo.id] ||
        checkoutIssue(drafts[repo.id], options[repo.id]),
    );
  return (
    <form
      className="mt-2 flex min-h-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || invalid) return;
        void onSubmit({
          generated_branch: generated,
          description,
          repositories: project.repositories.map((repo) =>
            repositoryPayload(repo.id, drafts[repo.id]),
          ),
        });
      }}
    >
      <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-1">
        <Field>
          <FieldLabel htmlFor="workspace-description">
            {t("workspaceUi.workspaceDescription")}
          </FieldLabel>
          <Textarea
            id="workspace-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("workspaceUi.scopeAndExpectedOutcome")}
            disabled={busy}
          />
        </Field>
        {project.repositories.map((repo) => {
          const id = repo.id;
          const draft = drafts[id];
          const branches = options[id];
          const active = draft?.[draft.mode];
          const update = (value: Partial<NonNullable<typeof active>>) =>
            setDrafts((current) => ({
              ...current,
              [id]: {
                ...current[id],
                [current[id].mode]: {
                  ...current[id][current[id].mode],
                  ...value,
                },
              },
            }));
          const issue =
            draft && branches ? checkoutIssue(draft, branches) : null;
          const occupied =
            active?.source?.kind === "local"
              ? branches?.occupied?.[active.source.branch]
              : "";
          return (
            <FieldSet
              key={id}
              data-testid={`workspace-create-repository-${id}`}
              className="rounded-lg border p-4"
            >
              <FieldLegend>{repo.name}</FieldLegend>
              {draft && active && branches ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel id={`workspace-mode-label-${id}`}>
                      {t("workspaceUi.branchStrategy")}
                    </FieldLabel>
                    <ToggleGroup
                      aria-labelledby={`workspace-mode-label-${id}`}
                      variant="outline"
                      spacing={0}
                      value={[draft.mode]}
                      disabled={busy || loading[id]}
                      onValueChange={(values) => {
                        const mode = values[0];
                        if (mode === "new" || mode === "existing")
                          setDrafts((current) => ({
                            ...current,
                            [id]: { ...current[id], mode },
                          }));
                      }}
                    >
                      <ToggleGroupItem value="new">
                        {t("workspaceUi.newBranch")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="existing">
                        {t("workspaceUi.existingBranch")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`workspace-base-${id}`}>
                      {t(
                        draft.mode === "new"
                          ? "workspaceUi.baseBranch"
                          : "workspaceUi.checkoutBranch",
                      )}
                    </FieldLabel>
                    <BranchPicker
                      id={`workspace-base-${id}`}
                      label={t(
                        draft.mode === "new"
                          ? "workspaceUi.baseBranch"
                          : "workspaceUi.checkoutBranch",
                      )}
                      repositoryName={repo.name}
                      value={active.source}
                      branches={branches}
                      loading={Boolean(loading[id])}
                      disabled={busy}
                      error={errors[id]}
                      rejectOccupied={draft.mode === "existing"}
                      onRefresh={() => void load(id)}
                      onChange={(ref) =>
                        draft.mode === "new"
                          ? update({ source: ref })
                          : update(selectExistingBranch(ref, branches, repo))
                      }
                    />
                  </Field>
                  {(draft.mode === "new" ||
                    active.source?.kind === "remote") && (
                    <Field
                      data-invalid={
                        issue === "branchExists" || issue === "branchRequired"
                      }
                    >
                      <FieldLabel htmlFor={`workspace-branch-${id}`}>
                        {t(
                          draft.mode === "new"
                            ? "workspaceUi.newBranchName"
                            : "workspaceUi.localBranchName",
                        )}
                      </FieldLabel>
                      <Input
                        id={`workspace-branch-${id}`}
                        value={active.branch}
                        autoComplete="off"
                        spellCheck={false}
                        required
                        disabled={busy || loading[id]}
                        aria-invalid={
                          issue === "branchExists" || issue === "branchRequired"
                        }
                        onChange={(event) =>
                          update({
                            branch: event.target.value,
                            ...(!active.customRemoteBranch && active.remote
                              ? { remoteBranch: event.target.value }
                              : {}),
                          })
                        }
                      />
                      {draft.mode === "existing" && (
                        <FieldDescription>
                          {t("workspaceUi.remoteCheckoutDescription")}
                        </FieldDescription>
                      )}
                    </Field>
                  )}
                  <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`workspace-remote-${id}`}>
                        {t("workspaceUi.remote")}
                      </FieldLabel>
                      <NativeSelect
                        id={`workspace-remote-${id}`}
                        name={`remote:${id}`}
                        value={active.remote}
                        disabled={busy || loading[id]}
                        onChange={(event) =>
                          update({
                            remote: event.target.value,
                            remoteBranch: event.target.value
                              ? active.branch
                              : "",
                            customRemoteBranch: false,
                          })
                        }
                      >
                        <option value="">
                          {t("workspaceUi.configureBeforePush")}
                        </option>
                        {branches.remotes.map((remote) => (
                          <option key={remote.name} value={remote.name}>
                            {remote.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    {active.remote && (
                      <Field data-invalid={issue === "upstreamInvalid"}>
                        <FieldLabel htmlFor={`workspace-upstream-${id}`}>
                          {t("workspaceUi.remoteFeatureBranch")}
                        </FieldLabel>
                        <Input
                          id={`workspace-upstream-${id}`}
                          value={active.remoteBranch}
                          disabled={busy || loading[id]}
                          required
                          aria-invalid={issue === "upstreamInvalid"}
                          onChange={(event) =>
                            update({
                              remoteBranch: event.target.value,
                              customRemoteBranch: true,
                            })
                          }
                        />
                      </Field>
                    )}
                  </FieldGroup>
                  <FieldDescription>
                    {t(
                      active.remote
                        ? "workspaceUi.sameNameRemoteBranch"
                        : "workspaceUi.upstreamNotConfigured",
                    )}
                  </FieldDescription>
                  {issue && issue !== "chooseBranch" && (
                    <p role="alert" className="text-sm text-destructive">
                      {t(`workspaceUi.${issue}`, { path: occupied })}
                    </p>
                  )}
                </FieldGroup>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("projectsUi.loadingBranches")}
                </p>
              )}
              {errors[id] && (
                <div>
                  <p role="alert" className="text-sm text-destructive">
                    {errors[id]}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || loading[id]}
                    onClick={() => void load(id)}
                  >
                    {t("projectsUi.refreshBranches")}
                  </Button>
                </div>
              )}
            </FieldSet>
          );
        })}
      </div>
      <div className="flex shrink-0 justify-end">
        <Button type="submit" disabled={busy || Boolean(invalid)}>
          {busy && <Spinner data-icon="inline-start" />}
          {t(busy ? "workspaceUi.creating" : "workspaceUi.createWorkspace")}
        </Button>
      </div>
    </form>
  );
}

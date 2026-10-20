import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { projectDetailQuery, projectKeys } from "@/features/projects/queries";
import { projectsApi } from "@/api/projects";
import { invalidateHierarchyQueries } from "@/features/app/runtimeInvalidation";
import type { ProjectDetail } from "@/domain/types";

export function ProjectReviewSettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t("agentReview.settings")}</Button>
    {open && <ProjectReviewSettingsDialog projectId={projectId} onClose={() => setOpen(false)} />}
  </>;
}

function ProjectReviewSettingsDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const project = useQuery({ ...projectDetailQuery(projectId), refetchOnMount: "always" });
  const save = useMutation({
    mutationFn: (prompt: string) => projectsApi.update(projectId, { review_prompt: prompt }),
    onSuccess: saved => {
      client.setQueryData<ProjectDetail>(projectKeys.detail(projectId), current => current ? { ...current, review_prompt: saved.review_prompt } : current);
      void invalidateHierarchyQueries(client);
      onClose();
    },
  });
  const saving = save.isPending;
  const submitting = useRef(false);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState("");
  const prompt = draft ?? project.data?.review_prompt ?? "";
  return <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose(); }}>
    <DialogContent showCloseButton={!saving}>
      <DialogHeader>
        <DialogTitle>{t("agentReview.settings")}</DialogTitle>
        <DialogDescription>{t("agentReview.settingsDescription")}</DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-col gap-4" onSubmit={async event => {
        event.preventDefault();
        if (submitting.current || project.isFetching || !project.data || project.error) return;
        submitting.current = true;
        setError("");
        try { await save.mutateAsync(prompt); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { submitting.current = false; }
      }}>
        <Field>
          <FieldLabel htmlFor={id}>{t("agentReview.defaultPromptLabel")}</FieldLabel>
          <Textarea id={id} rows={8} value={prompt} disabled={saving || project.isFetching || !!project.error}
            placeholder={t("agentReview.defaultPrompt")} onChange={event => setDraft(event.target.value)} />
          <FieldDescription>{t("agentReview.defaultPromptDescription")}</FieldDescription>
        </Field>
        {(error || project.error) && <Alert variant="destructive"><AlertDescription>{error || project.error?.message}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={saving || project.isFetching || !project.data || !!project.error}>{t("common.save")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

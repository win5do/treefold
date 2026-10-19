import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { settingsQuery } from "@/features/app/queries";
import { useSettingsSave } from "@/features/settings/useSettingsSave";

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
  const settings = useQuery({ ...settingsQuery(), refetchOnMount: "always" });
  const { save, saving } = useSettingsSave();
  const submitting = useRef(false);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState("");
  const prompt = draft ?? settings.data?.projects?.[projectId]?.review_prompt ?? "";
  return <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose(); }}>
    <DialogContent showCloseButton={!saving}>
      <DialogHeader>
        <DialogTitle>{t("agentReview.settings")}</DialogTitle>
        <DialogDescription>{t("agentReview.settingsDescription")}</DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-col gap-4" onSubmit={async event => {
        event.preventDefault();
        if (submitting.current || settings.isFetching || !settings.data || settings.error) return;
        submitting.current = true;
        setError("");
        const result = await save({ projects: { [projectId]: { review_prompt: prompt } } });
        submitting.current = false;
        if (result.ok) onClose(); else setError(result.error);
      }}>
        <Field>
          <FieldLabel htmlFor={id}>{t("agentReview.defaultPromptLabel")}</FieldLabel>
          <Textarea id={id} rows={8} value={prompt} disabled={saving || settings.isFetching || !!settings.error}
            placeholder={t("agentReview.defaultPrompt")} onChange={event => setDraft(event.target.value)} />
          <FieldDescription>{t("agentReview.defaultPromptDescription")}</FieldDescription>
        </Field>
        {(error || settings.error) && <Alert variant="destructive"><AlertDescription>{error || settings.error?.message}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={saving || settings.isFetching || !settings.data || !!settings.error}>{t("common.save")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

import { useTranslation } from "react-i18next";
import type { FormEvent } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { BranchNameField } from "@/features/git/BranchNameField";
import type { Workspace } from "@/domain/types";

export function CreateForkDialog({ workspace, busy, onOpenChange, onSubmit }: {
  workspace: Workspace | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(workspace)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2">
          <GitBranch className="size-4" />{t("forkUi.forkWork")}</DialogTitle>
        <DialogDescription className="mt-1">
          {t("forkUi.createDescription", { name: workspace?.name })}
        </DialogDescription>
        <form key={workspace?.id ?? "closed"} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel className="sr-only" htmlFor="fork-description">{t("forkUi.forkDescription")}</FieldLabel>
              <Textarea id="fork-description" name="description" placeholder={t("forkUi.independentFeatureOrExperiment")} />
            </Field>
            <Field>
              <FieldLabel>{t("workspaceUi.baseBranch")}</FieldLabel>
              <FieldDescription>{workspace?.branch}</FieldDescription>
            </Field>
            <BranchNameField />
          </FieldGroup>
          <FieldDescription className="rounded-lg bg-muted/50 px-3 py-2">{t("forkUi.parentRequirement")}</FieldDescription>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>{t("forkUi.createFork")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

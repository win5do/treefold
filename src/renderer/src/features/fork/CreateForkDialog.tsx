import { useTranslation } from "react-i18next";
import type { FormEvent } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <GitBranch className="size-5" />{t("forkUi.forkWork")}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("forkUi.createDescription", { name: workspace?.name })}
        </DialogDescription>
        <form key={workspace?.id ?? "closed"} className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel className="sr-only" htmlFor="fork-description">{t("forkUi.forkDescription")}</FieldLabel>
              <Textarea id="fork-description" name="description" placeholder={t("forkUi.independentFeatureOrExperiment")} />
            </Field>
            <BranchNameField />
          </FieldGroup>
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">{t("forkUi.parentRequirement")}</div>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>{t("forkUi.createFork")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

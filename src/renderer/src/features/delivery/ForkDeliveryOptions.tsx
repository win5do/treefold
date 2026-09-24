import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";

type Action = "local_merge" | "squash_merge" | "push_branch" | "keep";
export function ForkDeliveryOptions({ kind, continueWork, onContinueWork, action, onAction, disabled }: {
  kind: string; continueWork: boolean; onContinueWork: (value: boolean) => void;
  action: Action; onAction: (value: Action) => void; disabled: boolean;
}) {
  const { t } = useTranslation();
  return <FieldGroup className="shrink-0 gap-4">
    <div className="grid gap-4">
      <FieldSet>
        <FieldLegend id="delivery-purpose-label">{t("deliveryUi.forkDelivery.purpose")}</FieldLegend>
        <RadioGroup className="flex flex-wrap gap-x-6 gap-y-2" aria-labelledby="delivery-purpose-label" disabled={disabled} value={continueWork ? "continue" : "finish"} onValueChange={value => onContinueWork(value === "continue")}>
          {["finish", "continue"].map(value => <Field key={value} orientation="horizontal" className="w-auto"><RadioGroupItem id={`delivery-${value}`} value={value} /><FieldLabel htmlFor={`delivery-${value}`}>{t(value === "finish" ? "deliveryUi.forkDelivery.finish" : "deliveryUi.forkDelivery.intermediate")}</FieldLabel></Field>)}
        </RadioGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend id="delivery-method-label">{t("deliveryUi.forkDelivery.method")}</FieldLegend>
        <RadioGroup className="flex flex-wrap gap-x-6 gap-y-2" aria-labelledby="delivery-method-label" disabled={disabled} value={action === "squash_merge" ? "local_merge" : action} onValueChange={value => onAction(value as Action)}>
          <Field orientation="horizontal" className="w-auto"><RadioGroupItem id="delivery-merge" value="local_merge" /><FieldLabel htmlFor="delivery-merge">{t(kind === "fork" ? "deliveryUi.forkDelivery.merge" : "deliveryUi.mergeProject")}</FieldLabel></Field>
          {kind !== "fork" && <Field orientation="horizontal" className="w-auto"><RadioGroupItem id="delivery-push" value="push_branch" /><FieldLabel htmlFor="delivery-push">{t("workspaceUi.pushFeatureBranch")}</FieldLabel></Field>}
          {!continueWork && <Field orientation="horizontal" className="w-auto"><RadioGroupItem id="delivery-keep" value="keep" /><FieldLabel htmlFor="delivery-keep">{t("deliveryUi.forkDelivery.abandon")}</FieldLabel></Field>}
        </RadioGroup>
      </FieldSet>
    </div>
    {!continueWork && (action === "local_merge" || action === "squash_merge") && <Field orientation="horizontal">
      <Checkbox id="delivery-squash" disabled={disabled} checked={action === "squash_merge"} onCheckedChange={checked => onAction(checked ? "squash_merge" : "local_merge")} />
      <FieldLabel htmlFor="delivery-squash">{t("deliveryUi.forkDelivery.squash")}</FieldLabel>
    </Field>}
    {!continueWork && action === "squash_merge" && <Alert><AlertDescription>{t("deliveryUi.forkDelivery.squashHint", { type: kind === "fork" ? "Fork" : "Workspace" })}</AlertDescription></Alert>}
  </FieldGroup>;
}
